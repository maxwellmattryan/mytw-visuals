export type ExportErrorCode =
	| 'invalid-options'
	| 'encoding-unavailable'
	| 'encode-failed'
	| 'context-lost'
	| 'cancelled'

export class ExportError extends Error {
	readonly code: ExportErrorCode

	constructor(code: ExportErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'ExportError'
		this.code = code
	}
}

/** Rejects with `ExportError('cancelled')` once `signal` is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new ExportError('cancelled', 'Export cancelled')
}

/** Wraps an encoder, muxer or zip failure, keeping an `ExportError` as it is. */
export function encodeFailed(cause: unknown): ExportError {
	if (cause instanceof ExportError) return cause
	const reason = cause instanceof Error ? cause.message : String(cause)
	return new ExportError('encode-failed', `Encoding failed: ${reason}`, { cause })
}
