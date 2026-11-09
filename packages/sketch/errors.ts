export type SketchErrorCode =
	| 'p5-unavailable'
	| 'setup-failed'
	| 'invalid-time'
	| 'draw-failed'
	| 'disposed'

/** Thrown or rejected by the sketch runtime. `code` says which rule failed. */
export class SketchError extends Error {
	readonly code: SketchErrorCode

	constructor(code: SketchErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'SketchError'
		this.code = code
	}
}

/** The message of a thrown value, for wrapping it in a `SketchError`. */
export function describeError(error: unknown): string {
	if (error instanceof Error) return error.message
	return typeof error === 'string' ? error : 'a non-Error value was thrown'
}
