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
