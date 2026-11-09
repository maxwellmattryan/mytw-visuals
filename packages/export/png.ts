import { Zip, ZipPassThrough } from 'fflate'

import { encodeFailed, ExportError, throwIfAborted } from './errors'
import { framePlan, validateOptions, validateStill } from './frames'
import { stepFrames } from './step'
import type {
	ExportCanvas,
	ExportChunk,
	ExportOptions,
	ExportResult,
	FrameSource,
	SourceCanvas,
	StillOptions,
} from './types'

/** A reused 2D canvas that copies a frame synchronously and encodes it as PNG later. */
export interface PngScratch<C extends SourceCanvas = ExportCanvas> {
	copy: (canvas: C) => void
	encode: () => Promise<Blob>
}

/** Canvas access for PNG export. Defaults to the browser; tests pass fakes. */
export interface PngDeps<C extends SourceCanvas = ExportCanvas> {
	createScratch: (width: number, height: number) => PngScratch<C>
}

function context2d<T>(ctx: T | null): T {
	if (!ctx) throw new ExportError('encode-failed', 'A 2D canvas context is not available')
	return ctx
}

/** An `OffscreenCanvas`, or an `HTMLCanvasElement` where `OffscreenCanvas` is missing. */
export const BROWSER_PNG: PngDeps = {
	createScratch: (width, height) => {
		if (typeof OffscreenCanvas === 'function') {
			const canvas = new OffscreenCanvas(width, height)
			const ctx = context2d(canvas.getContext('2d'))
			return {
				copy: (source) => {
					ctx.clearRect(0, 0, width, height)
					ctx.drawImage(source, 0, 0)
				},
				encode: () => canvas.convertToBlob({ type: 'image/png' }),
			}
		}
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const ctx = context2d(canvas.getContext('2d'))
		return {
			copy: (source) => {
				ctx.clearRect(0, 0, width, height)
				ctx.drawImage(source, 0, 0)
			},
			encode: () =>
				new Promise<Blob>((resolve, reject) =>
					canvas.toBlob(
						(blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
						'image/png'
					)
				),
		}
	},
}

/** `frame-00000.png`: 5 digits, or more when `frames > 99999`. */
export function pngEntryName(index: number, frames: number): string {
	const digits = Math.max(5, String(frames).length)
	return `frame-${String(index).padStart(digits, '0')}.png`
}

/**
 * Writes the loop as a zip of PNGs, stored without compression since PNG is
 * already compressed. Frames are encoded one at a time.
 */
export function exportPngSequence(
	source: FrameSource,
	options: ExportOptions
): Promise<ExportResult>
export function exportPngSequence<C extends SourceCanvas>(
	source: FrameSource<C>,
	options: ExportOptions,
	deps: PngDeps<C>
): Promise<ExportResult>
export function exportPngSequence<C extends SourceCanvas>(
	...args: [FrameSource, ExportOptions] | [FrameSource<C>, ExportOptions, PngDeps<C>]
): Promise<ExportResult> {
	if (args.length === 3) return zipFrames(args[0], args[1], args[2])
	return zipFrames(args[0], args[1], BROWSER_PNG)
}

async function zipFrames<C extends SourceCanvas>(
	source: FrameSource<C>,
	options: ExportOptions,
	deps: PngDeps<C>
): Promise<ExportResult> {
	const valid = validateOptions(options, 'png')
	const { signal, onProgress, destination } = options
	throwIfAborted(signal)

	const writer = destination?.getWriter() ?? null
	const parts: Uint8Array<ArrayBuffer>[] = []
	let position = 0
	let writes: Promise<void> = Promise.resolve()
	let failure: unknown = null
	const zip = new Zip((err, data) => {
		if (err) {
			failure ??= err
			return
		}
		if (writer) {
			const chunk: ExportChunk = { type: 'write', data, position }
			writes = writes
				.then(() => writer.write(chunk))
				.catch((e: unknown) => {
					failure ??= e
				})
		} else {
			parts.push(new Uint8Array(data))
		}
		position += data.byteLength
	})
	const settle = async (): Promise<void> => {
		await writes
		if (failure !== null) throw encodeFailed(failure)
	}

	try {
		const scratch = deps.createScratch(valid.width, valid.height)
		const plan = framePlan(valid.frames, valid.loopFrames, valid.fps)
		await stepFrames(
			source,
			plan,
			valid,
			signal,
			(canvas, entry) => {
				scratch.copy(canvas)
				return (async () => {
					const blob = await scratch.encode().catch(rethrow)
					const png = new Uint8Array(await blob.arrayBuffer())
					throwIfAborted(signal)
					const file = new ZipPassThrough(pngEntryName(entry.index, valid.frames))
					zip.add(file)
					file.push(png, true)
					await settle()
				})()
			},
			onProgress
		)
		zip.end()
		await settle()
		await writer?.close()
	} catch (err) {
		zip.terminate()
		await writer?.abort(err).catch(() => {})
		throw err
	}

	return {
		blob: writer ? null : new Blob(parts, { type: 'application/zip' }),
		mimeType: 'application/zip',
		width: valid.width,
		height: valid.height,
		fps: valid.fps,
		frames: valid.frames,
		duration: valid.frames / valid.fps,
	}
}

function rethrow(err: unknown): never {
	throw encodeFailed(err)
}

/** Draws one phase at the requested size and resolves its PNG. */
export function exportStill(source: FrameSource, options: StillOptions): Promise<Blob>
export function exportStill<C extends SourceCanvas>(
	source: FrameSource<C>,
	options: StillOptions,
	deps: PngDeps<C>
): Promise<Blob>
export function exportStill<C extends SourceCanvas>(
	...args: [FrameSource, StillOptions] | [FrameSource<C>, StillOptions, PngDeps<C>]
): Promise<Blob> {
	if (args.length === 3) return still(args[0], args[1], args[2])
	return still(args[0], args[1], BROWSER_PNG)
}

async function still<C extends SourceCanvas>(
	source: FrameSource<C>,
	options: StillOptions,
	deps: PngDeps<C>
): Promise<Blob> {
	const { width, height, phase } = validateStill(options)
	throwIfAborted(options.signal)
	const scratch = deps.createScratch(width, height)
	const out: { blob: Blob | null } = { blob: null }
	await stepFrames(
		source,
		[{ index: 0, phase, timestamp: 0, duration: 0 }],
		{ width, height },
		options.signal,
		(canvas) => {
			scratch.copy(canvas)
			return scratch.encode().then((blob) => {
				out.blob = blob
			}, rethrow)
		}
	)
	if (!out.blob) throw new ExportError('encode-failed', 'No PNG was produced')
	return out.blob
}
