// The document store: one serializable command path with undo, redo and change notifications.
import { applyCommand, copyJson, parseCommand } from './commands'
import type {
	ApplyOptions,
	ApplyResult,
	ChangeSource,
	Command,
	DocumentChange,
	DocumentListener,
	DocumentStore,
	DocumentStoreOptions,
	DocumentValidator,
	JsonValue,
	Path,
} from './types'

/** Thrown when a starting or loaded document is not plain JSON or fails validation. */
export class DocumentLoadError extends Error {
	readonly issues: readonly unknown[]

	constructor(message: string, issues: readonly unknown[] = []) {
		super(message)
		this.name = 'DocumentLoadError'
		this.issues = issues
	}
}

/** One undoable step. Every field is plain JSON, so history can be inspected or stored. */
interface HistoryEntry {
	readonly forward: readonly Command[]
	readonly inverse: readonly Command[]
	readonly mergeKey: string | null
}

function checkDocument(document: unknown, validate: DocumentValidator): JsonValue {
	const copied = copyJson(document, 'document')
	if (!copied.ok) throw new DocumentLoadError(copied.message)
	const result = validate(copied.value)
	if (!result.ok) throw new DocumentLoadError('the document failed validation', result.issues)
	return copied.value
}

function startsWith(path: Path, prefix: Path): boolean {
	if (prefix.length > path.length) return false
	return prefix.every((segment, i) => path[i] === segment)
}

/** Whether a change touched `path`: a changed path equals it, or is its ancestor or descendant. */
export function affects<D>(change: DocumentChange<D>, path: Path): boolean {
	return change.paths.some((changed) => startsWith(path, changed) || startsWith(changed, path))
}

export function createDocumentStore<D>(options: DocumentStoreOptions<D>): DocumentStore<D> {
	const { validate } = options
	let current = checkDocument(options.document, validate)
	let undoStack: HistoryEntry[] = []
	let redoStack: HistoryEntry[] = []
	// Whether the top undo entry may still absorb an apply with the same merge key.
	let mergeOpen = false
	const listeners = new Set<DocumentListener<D>>()

	// The store only holds documents that passed `validate`, which is what makes them a `D`.
	const asDocument = (value: JsonValue) => value as D

	const commit = (next: JsonValue, paths: readonly Path[], source: ChangeSource) => {
		const previous = current
		current = next
		const change: DocumentChange<D> = {
			document: asDocument(next),
			previous: asDocument(previous),
			paths,
			source,
		}
		for (const fn of [...listeners]) fn(change)
	}

	/** Replays stored commands. They restore states that already passed validation. */
	const replay = (commands: readonly Command[]) => {
		const result = applyCommand(current, { op: 'batch', commands })
		if (!result.ok) throw new Error(`document history is corrupt: ${result.error.message}`)
		return result
	}

	const step = (from: HistoryEntry[], to: HistoryEntry[], source: 'undo' | 'redo') => {
		const entry = from.pop()
		mergeOpen = false
		if (!entry) return false
		const result = replay(source === 'undo' ? entry.inverse : entry.forward)
		to.push(entry)
		commit(result.doc, result.paths, source)
		return true
	}

	return {
		get document() {
			return asDocument(current)
		},
		get canUndo() {
			return undoStack.length > 0
		},
		get canRedo() {
			return redoStack.length > 0
		},
		apply(input: Command, applyOptions: ApplyOptions = {}): ApplyResult {
			const parsed = parseCommand(input)
			if (!parsed.ok) return parsed
			const result = applyCommand(current, parsed.command)
			if (!result.ok) return result
			if (result.paths.length === 0) return { ok: true }
			const validation = validate(result.doc)
			if (!validation.ok) {
				const error = {
					code: 'invalid',
					message: 'the document validator rejected the result',
					issues: validation.issues,
				} as const
				return { ok: false, error }
			}

			const mergeKey = applyOptions.mergeKey ?? null
			const top = undoStack[undoStack.length - 1]
			if (mergeKey !== null && mergeOpen && top !== undefined && top.mergeKey === mergeKey) {
				undoStack[undoStack.length - 1] = {
					forward: [...top.forward, parsed.command],
					inverse: [...result.inverse, ...top.inverse],
					mergeKey,
				}
			} else {
				undoStack.push({ forward: [parsed.command], inverse: result.inverse, mergeKey })
			}
			mergeOpen = mergeKey !== null
			redoStack = []
			commit(result.doc, result.paths, 'apply')
			return { ok: true }
		},
		undo() {
			return step(undoStack, redoStack, 'undo')
		},
		redo() {
			return step(redoStack, undoStack, 'redo')
		},
		seal() {
			mergeOpen = false
		},
		load(document) {
			const next = checkDocument(document, validate)
			undoStack = []
			redoStack = []
			mergeOpen = false
			commit(next, [[]], 'load')
		},
		subscribe(fn) {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
	}
}
