// State the effects panel and the effect properties panel share: the target, the selection, the
// browser query, the hover preview, the error line and the custom GLSL draft. Document edits all go
// through the store, so undo covers them. No DOM or Svelte.
import type { ApplyOptions, Command, CommandError, DocumentStore, JsonValue } from '@mytw/document'
import { createCustomEffect, EFFECTS, isChunkId } from '@mytw/fx'
import type { ChunkId, CompileResult, EffectDefinition, EffectError } from '@mytw/fx'
import type { EffectInstance, Project, ProjectCustomEffect } from '@mytw/schema'
import {
	addCustomEffect,
	addEffect,
	customEffectUsage,
	deleteCustomEffect,
	moveEffectTo,
	removeEffect,
	setEffectEnabled,
	updateCustomEffect,
} from './commands'
import { catalog, customEntry, resolveDefinition, resolveInstance } from './resolve'
import type { CatalogItem, EffectBank, StackRow } from './resolve'
import { chainAt, chainPath, findLayer, sameTarget } from './target'
import type { EffectTarget } from './target'

export type EffectScope = 'layer' | 'global'

/** Compiles an effect to check it. The caller deletes nothing: the function owns its programs. */
export type EffectCompile = (effect: EffectDefinition) => CompileResult

export interface EffectsControllerOptions {
	readonly store: DocumentStore<Project>
	/** The built-in effects the browser lists. Defaults to `EFFECTS` from `@mytw/fx`. */
	readonly bank?: EffectBank
	/** Checks a custom effect's GLSL on Apply. `createWebGLCompile()` in the browser. */
	readonly compile: EffectCompile
}

/** The hover preview: an effect to show appended, at its defaults, to the target's chain. */
export interface EffectPreview {
	readonly target: EffectTarget
	readonly definition: EffectDefinition
}

/** The custom GLSL editor's draft. Edits change only the draft until Apply. */
export interface CustomEffectDraft {
	readonly id: string
	readonly name: string
	readonly glsl: string
	/** The param definitions as JSON text. */
	readonly paramsText: string
	readonly chunks: readonly ChunkId[]
	/** The last Apply's or Delete's errors. A line is relative to the draft's GLSL. */
	readonly errors: readonly EffectError[]
	/** Whether the draft differs from what was last loaded or applied. */
	readonly dirty: boolean
}

export type DraftPatch = Partial<Pick<CustomEffectDraft, 'name' | 'glsl' | 'paramsText' | 'chunks'>>

export interface EffectsController {
	readonly store: DocumentStore<Project>
	readonly bank: EffectBank
	readonly project: Project
	readonly scope: EffectScope
	/** The layer the host selected, whether or not it still exists. */
	readonly layerId: string | null
	/** The chain being edited, or `null` with Layer chosen and no existing layer. */
	readonly target: EffectTarget | null
	/** The target's chain, in apply order. Empty with no target. */
	readonly chain: readonly EffectInstance[]
	/** One row per instance in `chain`, with its definition or why it has none. */
	readonly rows: readonly StackRow[]
	readonly selectedId: string | null
	/** The selected row, or `null`. */
	readonly selected: StackRow | null
	readonly query: string
	/** The browser's items for `query`. */
	readonly catalog: readonly CatalogItem[]
	/** View state only: never written to the document. */
	readonly preview: EffectPreview | null
	/** The error line: the last rejected command, cleared by the next success. */
	readonly error: string | null
	/** The open custom effect draft, or `null`. */
	readonly editor: CustomEffectDraft | null
	/** Sets the layer that Layer edits. The host passes the layers panel's selection. */
	setLayer(id: string | null): void
	setScope(scope: EffectScope): void
	select(id: string | null): void
	setQuery(query: string): void
	/** Appends an effect at its defaults to the target's chain and selects it. */
	add(effectId: string): void
	remove(id: string): void
	/** Moves an effect `delta` rows down (positive, applied later) or up (negative). */
	move(id: string, delta: number): void
	toggleEnabled(id: string): void
	setPreview(effectId: string | null): void
	/** Adds a custom effect with the template GLSL and opens it in the editor. */
	newCustomEffect(): void
	openEditor(id: string): void
	closeEditor(): void
	editDraft(patch: DraftPatch): void
	/** Checks and compiles the draft, and writes it only when both succeed. */
	applyDraft(): boolean
	revertDraft(): void
	/** Removes the open custom effect, unless an instance uses it. */
	deleteCustom(): void
	/** Called after any change to the document or the controller's state. */
	subscribe(fn: () => void): () => void
	destroy(): void
}

export const UNAVAILABLE_MESSAGE = "WebGL2 is unavailable, so the effect can't be checked."

/** A store error's text, preferring the validator's first issue message. */
function errorMessage(error: CommandError): string {
	const first = error.issues?.[0]
	if (typeof first === 'object' && first !== null && 'message' in first) {
		const { message } = first as { message: unknown }
		if (typeof message === 'string') return message
	}
	return error.message
}

function draftFrom(entry: ProjectCustomEffect, errors: readonly EffectError[] = []) {
	const draft: CustomEffectDraft = {
		id: entry.id,
		name: entry.name,
		glsl: entry.glsl,
		paramsText: JSON.stringify(entry.params, null, 2),
		chunks: entry.chunks.filter(isChunkId),
		errors,
		dirty: false,
	}
	return draft
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createEffectsController(options: EffectsControllerOptions): EffectsController {
	const { store, compile } = options
	const bank = options.bank ?? EFFECTS
	let scope: EffectScope = 'layer'
	let layerId: string | null = null
	let selectedId: string | null = null
	let query = ''
	let preview: EffectPreview | null = null
	let error: string | null = null
	let editor: CustomEffectDraft | null = null
	let destroyed = false
	const subscribers = new Set<() => void>()

	// The browser's items, recomputed only when the document or the query changes.
	let catalogCache: { project: Project; query: string; items: CatalogItem[] } | null = null

	const notify = () => {
		for (const fn of [...subscribers]) fn()
	}

	const target = (): EffectTarget | null => {
		if (scope === 'global') return { kind: 'global' }
		if (layerId === null || findLayer(store.document, layerId) === null) return null
		return { kind: 'layer', layerId }
	}

	const chain = (): readonly EffectInstance[] => {
		const current = target()
		return current === null ? [] : (chainAt(store.document, current) ?? [])
	}

	const indexOf = (id: string) => chain().findIndex((instance) => instance.id === id)

	const setSelected = (id: string | null) => {
		if (id === selectedId) return
		selectedId = id
		store.seal()
	}

	/** Runs `fn`, then clears the selection and preview if it changed the target. */
	const retarget = (fn: () => void) => {
		const before = target()
		fn()
		if (!sameTarget(before, target())) {
			setSelected(null)
			preview = null
		}
	}

	/** Drops a selection that left the chain, a preview with no target, and a vanished draft. */
	const prune = () => {
		if (selectedId !== null && indexOf(selectedId) === -1) setSelected(null)
		const current = target()
		if (preview !== null && (current === null || !sameTarget(preview.target, current)))
			preview = null
		if (editor !== null) {
			const entry = customEntry(store.document, editor.id)
			if (entry === null) editor = null
			else if (!editor.dirty) editor = draftFrom(entry, editor.errors)
		}
	}

	const stopStore = store.subscribe(() => {
		prune()
		notify()
	})

	/** Applies a command. The store notifies on success, which prunes and re-renders. */
	const run = (command: Command | null, applyOptions?: ApplyOptions): boolean => {
		if (destroyed || command === null) return false
		const result = store.apply(command, applyOptions)
		if (!result.ok) {
			error = errorMessage(result.error)
			notify()
			return false
		}
		if (error !== null) {
			error = null
			notify()
		}
		return true
	}

	/** Runs a command for the editor: a rejection also goes to the draft's error list. */
	const runForEditor = (command: Command): boolean => {
		if (run(command)) return true
		setEditorErrors([{ line: null, message: error ?? 'The change was rejected' }])
		return false
	}

	const withInstance = (id: string, fn: (index: number, current: EffectTarget) => void) => {
		const current = target()
		const index = indexOf(id)
		if (current !== null && index !== -1) fn(index, current)
	}

	const setEditorErrors = (errors: readonly EffectError[]) => {
		if (editor === null) return
		editor = { ...editor, errors }
		notify()
	}

	/** The draft's effect, or the errors that stop it being built or compiled. */
	const checkDraft = (draft: CustomEffectDraft): EffectError[] | Record<string, JsonValue> => {
		let params: unknown
		try {
			params = JSON.parse(draft.paramsText)
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause)
			return [{ line: null, message: `Params: ${message}` }]
		}
		if (!isJsonRecord(params))
			return [{ line: null, message: 'Params: expected an object of param definitions' }]
		const entry = customEntry(store.document, draft.id)
		const built = createCustomEffect({
			id: draft.id,
			version: entry?.version ?? 1,
			name: draft.name,
			glsl: draft.glsl,
			params,
			chunks: draft.chunks,
		})
		if (!built.ok) return [...built.errors]
		const compiled = compile(built.effect)
		if (!compiled.ok) return [...compiled.errors]
		return params
	}

	return {
		store,
		bank,
		get project() {
			return store.document
		},
		get scope() {
			return scope
		},
		get layerId() {
			return layerId
		},
		get target() {
			return target()
		},
		get chain() {
			return chain()
		},
		get rows() {
			return chain().map((instance) => resolveInstance(store.document, bank, instance))
		},
		get selectedId() {
			return selectedId
		},
		get selected() {
			if (selectedId === null) return null
			const instance = chain().find((item) => item.id === selectedId)
			return instance ? resolveInstance(store.document, bank, instance) : null
		},
		get query() {
			return query
		},
		get catalog() {
			const project = store.document
			if (catalogCache === null || catalogCache.project !== project || catalogCache.query !== query)
				catalogCache = { project, query, items: catalog(project, bank, query) }
			return catalogCache.items
		},
		get preview() {
			return preview
		},
		get error() {
			return error
		},
		get editor() {
			return editor
		},
		setLayer(id) {
			if (id === layerId) return
			retarget(() => {
				layerId = id
			})
			notify()
		},
		setScope(next) {
			if (next === scope) return
			retarget(() => {
				scope = next
			})
			notify()
		},
		select(id) {
			const next = id !== null && indexOf(id) === -1 ? null : id
			if (next === selectedId) return
			setSelected(next)
			notify()
		},
		setQuery(next) {
			if (next === query) return
			query = next
			notify()
		},
		add(effectId) {
			const current = target()
			if (current === null) return
			const definition = resolveDefinition(store.document, bank, effectId)
			if (definition === null) return
			const built = addEffect(store.document, current, definition)
			if (built === null) return
			preview = null
			if (run(built.command)) setSelected(built.id)
			notify()
		},
		remove(id) {
			withInstance(id, (index, current) => {
				const wasSelected = selectedId === id
				if (!run(removeEffect(store.document, current, index))) return
				if (!wasSelected) return
				const remaining = chain()
				setSelected(remaining[index]?.id ?? remaining[index - 1]?.id ?? null)
				notify()
			})
		},
		move(id, delta) {
			withInstance(id, (index, current) => {
				run(moveEffectTo(store.document, current, index, index + delta))
			})
		},
		toggleEnabled(id) {
			withInstance(id, (index, current) => {
				run(setEffectEnabled(store.document, current, index, !chain()[index].enabled))
			})
		},
		setPreview(effectId) {
			const current = target()
			const definition =
				effectId === null || current === null
					? null
					: resolveDefinition(store.document, bank, effectId)
			const next = current !== null && definition !== null ? { target: current, definition } : null
			if (
				next?.definition === preview?.definition &&
				sameTarget(next?.target ?? null, preview?.target ?? null)
			)
				return
			preview = next
			notify()
		},
		newCustomEffect() {
			const built = addCustomEffect(store.document, bank)
			if (!run(built.command)) return
			const entry = customEntry(store.document, built.id)
			if (entry !== null) editor = draftFrom(entry)
			notify()
		},
		openEditor(id) {
			const entry = customEntry(store.document, id)
			if (entry === null) return
			editor = draftFrom(entry)
			notify()
		},
		closeEditor() {
			if (editor === null) return
			editor = null
			notify()
		},
		editDraft(patch) {
			if (editor === null) return
			editor = { ...editor, ...patch, dirty: true }
			notify()
		},
		applyDraft() {
			const draft = editor
			if (draft === null || destroyed) return false
			const checked = checkDraft(draft)
			if (Array.isArray(checked)) {
				setEditorErrors(checked)
				return false
			}
			const command = updateCustomEffect(store.document, draft.id, {
				name: draft.name,
				glsl: draft.glsl,
				params: checked,
				chunks: draft.chunks,
			})
			if (command !== null && !runForEditor(command)) return false
			const entry = customEntry(store.document, draft.id)
			editor = entry === null ? null : draftFrom(entry)
			notify()
			return true
		},
		revertDraft() {
			if (editor === null) return
			const entry = customEntry(store.document, editor.id)
			editor = entry === null ? null : draftFrom(entry)
			notify()
		},
		deleteCustom() {
			if (editor === null) return
			const entry = customEntry(store.document, editor.id)
			if (entry === null) {
				editor = null
				notify()
				return
			}
			const uses = customEffectUsage(store.document, entry.id)
			if (uses > 0) {
				setEditorErrors([
					{
						line: null,
						message: `"${entry.name}" is used by ${uses} effect(s). Remove them first.`,
					},
				])
				return
			}
			const command = deleteCustomEffect(store.document, entry.id)
			if (command === null || !runForEditor(command)) return
			editor = null
			notify()
		},
		subscribe(fn) {
			subscribers.add(fn)
			return () => {
				subscribers.delete(fn)
			}
		},
		destroy() {
			if (destroyed) return
			destroyed = true
			stopStore()
			subscribers.clear()
		},
	}
}

/** The document path of the selected instance's `params`, or `null`. Used by the properties model. */
export function selectedParamsPath(controller: EffectsController): (string | number)[] | null {
	const current = controller.target
	const id = controller.selectedId
	if (current === null || id === null) return null
	const path = chainPath(controller.project, current)
	const index = controller.chain.findIndex((instance) => instance.id === id)
	return path === null || index === -1 ? null : [...path, index, 'params']
}
