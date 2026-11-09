/**
 * The canvas a source draws into. `HTMLCanvasElement` and `OffscreenCanvas` both
 * fit; the exporter reads it as an image right after each `draw`.
 */
export interface SourceCanvas {
	readonly width: number
	readonly height: number
}

/** The canvases a browser export reads. */
export type ExportCanvas = HTMLCanvasElement | OffscreenCanvas

export interface ExportSize {
	width: number
	height: number
}

/**
 * What an export draws. The exporter calls `begin` once, awaits `draw` for each
 * frame, captures `canvas` before it awaits anything else, then calls `end` once.
 */
export interface FrameSource<C extends SourceCanvas = ExportCanvas> {
	readonly canvas: C
	/** Sizes the canvas to the export size. */
	begin(size: ExportSize): void | Promise<void>
	/** Draws loop phase `phase` (0 inclusive to 1 exclusive) for output frame `index`. */
	draw(phase: number, index: number): void | Promise<void>
	/** Runs once, in a `finally`, after the last frame, a failure or a cancel. */
	end(): void | Promise<void>
}

export type Quality = 'low' | 'medium' | 'high' | 'very-high'

/** A positioned write, the shape `FileSystemWritableFileStream` and Mediabunny's `StreamTarget` take. */
export interface ExportChunk {
	type: 'write'
	data: Uint8Array
	position: number
}

export interface ExportProgress {
	/** Frames handed to the encoder or zip so far, 1 to `total`. */
	done: number
	total: number
}

export interface ExportOptions {
	/** Positive integer, even for video. */
	width: number
	/** Positive integer, even for video. */
	height: number
	/** Finite, greater than 0 and at most 240. */
	fps: number
	/** Positive integer: how many frames the export holds. */
	frames: number
	/** Positive integer: the frames in one loop. Default `frames`. */
	loopFrames?: number
	/** Abort to cancel; the export rejects with `ExportError('cancelled')`. */
	signal?: AbortSignal
	onProgress?: (progress: ExportProgress) => void
	/** Streams the output here as positioned writes; the result's `blob` is then `null`. */
	destination?: WritableStream<ExportChunk>
}

export interface VideoOptions extends ExportOptions {
	/** Bits per second, a positive integer. Pass this or `quality`, not both. */
	bitrate?: number
	/** Default `'high'`. */
	quality?: Quality
}

export interface StillOptions extends ExportSize {
	/** Loop phase to draw, 0 inclusive to 1 exclusive. */
	phase: number
	signal?: AbortSignal
}

export interface ExportResult {
	/** `null` when the output went to `destination`. */
	blob: Blob | null
	mimeType: 'video/mp4' | 'application/zip' | 'image/png'
	width: number
	height: number
	fps: number
	frames: number
	/** `frames / fps`, in seconds. */
	duration: number
	/** The H.264 codec string, for video. */
	codec?: string
}
