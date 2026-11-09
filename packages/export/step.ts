import { ExportError, throwIfAborted } from './errors'
import type { FrameEntry } from './frames'
import type { ExportProgress, ExportSize, FrameSource, SourceCanvas } from './types'

/**
 * Reads the canvas for one frame. It runs synchronously right after `draw`
 * resolves, so it must read the canvas before its first `await`. A returned
 * promise is awaited before the next draw, which is how encoders apply backpressure.
 */
export type Capture<C extends SourceCanvas> = (canvas: C, entry: FrameEntry) => void | Promise<void>

/**
 * Drives `source` through `plan`: `begin`, then `draw` and `capture` per frame,
 * then `end` in a `finally`. Checks `signal` before `begin` and before every draw.
 * Never reads a clock, so the frames don't depend on how fast the machine is.
 */
export async function stepFrames<C extends SourceCanvas>(
	source: FrameSource<C>,
	plan: readonly FrameEntry[],
	size: ExportSize,
	signal: AbortSignal | undefined,
	capture: Capture<C>,
	onProgress?: (progress: ExportProgress) => void
): Promise<void> {
	throwIfAborted(signal)
	try {
		await source.begin({ width: size.width, height: size.height })
		const { canvas } = source
		if (canvas.width !== size.width || canvas.height !== size.height) {
			throw new ExportError(
				'invalid-options',
				`width and height: the source canvas is ${canvas.width}x${canvas.height} after begin, expected ${size.width}x${size.height}`
			)
		}
		for (const entry of plan) {
			throwIfAborted(signal)
			await source.draw(entry.phase, entry.index)
			const pending = capture(canvas, entry)
			if (pending) await pending
			onProgress?.({ done: entry.index + 1, total: plan.length })
		}
	} finally {
		await source.end()
	}
}
