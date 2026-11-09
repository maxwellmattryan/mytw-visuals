import { DocumentLoadError } from '@mytw/document'

/** `path: message` for a `ProjectIssue`-like value, or `null` when it carries no message. */
function describeIssue(issue: unknown): string | null {
	if (typeof issue !== 'object' || issue === null) return null
	const { path, message } = issue as { path?: unknown; message?: unknown }
	if (typeof message !== 'string' || message === '') return null
	// A ProjectIssue's message already starts with its path.
	if (typeof path !== 'string' || path === '' || message.startsWith(`${path}:`)) return message
	return `${path}: ${message}`
}

/**
 * A readable message for anything thrown or rejected. A `SceneError`'s message is already
 * `path: message`, and a `DocumentLoadError` adds its first issue. Never throws.
 */
export function describeError(error: unknown): string {
	if (error instanceof DocumentLoadError) {
		const issue = describeIssue(error.issues[0])
		return issue === null ? error.message : `${error.message}: ${issue}`
	}
	if (error instanceof Error) return error.message || error.name || 'Unknown error'
	if (typeof error === 'string' && error !== '') return error
	return 'Unknown error'
}

export interface ErrorEntry {
	readonly id: number
	readonly message: string
}

/** The runtime errors the editor is showing, newest last. Fed by the global error listeners. */
export interface ErrorFeed {
	readonly entries: readonly ErrorEntry[]
	/** Adds `describeError(error)`, unless it repeats the newest entry (a per-frame failure). */
	push(error: unknown): void
	dismiss(id: number): void
	subscribe(fn: () => void): () => void
}

/** How many errors the feed keeps. Older ones drop off. */
const MAX_ERRORS = 5

export function createErrorFeed(): ErrorFeed {
	let entries: readonly ErrorEntry[] = []
	let nextId = 1
	const listeners = new Set<() => void>()
	const notify = () => {
		for (const fn of [...listeners]) fn()
	}
	return {
		get entries() {
			return entries
		},
		push(error) {
			const message = describeError(error)
			if (entries.at(-1)?.message === message) return
			entries = [...entries, { id: nextId++, message }].slice(-MAX_ERRORS)
			notify()
		},
		dismiss(id) {
			const next = entries.filter((entry) => entry.id !== id)
			if (next.length === entries.length) return
			entries = next
			notify()
		},
		subscribe(fn) {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
	}
}
