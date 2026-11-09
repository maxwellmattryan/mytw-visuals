import { isTypingTarget } from '@lib/capture'

export type Shortcut = 'undo' | 'redo' | 'toggle-play'

/** The fields of a `KeyboardEvent` that shortcuts read. */
export interface KeyLike {
	readonly key: string
	readonly ctrlKey: boolean
	readonly metaKey: boolean
	readonly shiftKey: boolean
	readonly altKey?: boolean
	readonly repeat?: boolean
}

/** Where Space keeps its native behaviour (pressing a button, opening a select). */
const SPACE_EXEMPT_TAGS = new Set(['BUTTON', 'SELECT'])

function tagOf(el: unknown): string {
	if (typeof el !== 'object' || el === null) return ''
	const { tagName } = el as { tagName?: unknown }
	return typeof tagName === 'string' ? tagName.toUpperCase() : ''
}

/**
 * The editor shortcut for a key press, given the focused element, or `null`. Nothing maps while
 * focus is in a text field, so the browser's own text undo works there.
 */
export function shortcutFor(event: KeyLike, active: unknown): Shortcut | null {
	if (isTypingTarget(active) || event.altKey) return null
	if (event.ctrlKey || event.metaKey) {
		const key = event.key.toLowerCase()
		if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
		if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo'
		return null
	}
	if (event.key === ' ' && !event.shiftKey) {
		if (event.repeat || SPACE_EXEMPT_TAGS.has(tagOf(active))) return null
		return 'toggle-play'
	}
	return null
}
