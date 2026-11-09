/**
 * Test doubles for sources and PNG encoding. The canvas holds the index of the
 * frame drawn into it, so a capture shows which frame it read.
 */
import type { PngDeps } from '../png'
import type { ExportSize, FrameSource, SourceCanvas } from '../types'

/** A canvas whose content is the index of the last frame drawn, or -1. */
export class FakeExportCanvas implements SourceCanvas {
	width = 0
	height = 0
	content = -1
}

export type SourceCall =
	| { kind: 'begin'; size: ExportSize }
	| { kind: 'draw'; phase: number; index: number }
	| { kind: 'end' }

export interface RecordingSourceOptions {
	/** Milliseconds to wait before each draw resolves; 0 yields a microtask. */
	delay?: () => number
	/**
	 * Clears the canvas one task after each draw, as a WebGL canvas with
	 * `preserveDrawingBuffer: false` does when the browser composites.
	 */
	clearAfterTask?: boolean
	/** The size `begin` gives the canvas. Default the requested size. */
	sizeAfterBegin?: (size: ExportSize) => ExportSize
	/** Runs after each draw, for aborting mid-export. */
	onDraw?: (index: number) => void
}

/** A `FrameSource` that records every call. */
export class RecordingSource implements FrameSource<FakeExportCanvas> {
	readonly canvas = new FakeExportCanvas()
	readonly calls: SourceCall[] = []
	private readonly options: RecordingSourceOptions

	constructor(options: RecordingSourceOptions = {}) {
		this.options = options
	}

	begin(size: ExportSize): void {
		this.calls.push({ kind: 'begin', size })
		const actual = this.options.sizeAfterBegin?.(size) ?? size
		this.canvas.width = actual.width
		this.canvas.height = actual.height
	}

	async draw(phase: number, index: number): Promise<void> {
		this.calls.push({ kind: 'draw', phase, index })
		const ms = this.options.delay?.() ?? 0
		if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
		else await Promise.resolve()
		this.canvas.content = index
		if (this.options.clearAfterTask) {
			setTimeout(() => {
				this.canvas.content = -1
			}, 0)
		}
		this.options.onDraw?.(index)
	}

	end(): void {
		this.calls.push({ kind: 'end' })
	}

	get draws(): { phase: number; index: number }[] {
		return this.calls.flatMap((c) =>
			c.kind === 'draw' ? [{ phase: c.phase, index: c.index }] : []
		)
	}

	count(kind: SourceCall['kind']): number {
		return this.calls.filter((c) => c.kind === kind).length
	}
}

/** Deterministic delays in `[0, maxMs]` from a seeded PRNG (mulberry32). */
export function seededDelays(seed: number, maxMs: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
		return Math.floor(r * (maxMs + 1))
	}
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Stand-in PNG bytes: the PNG signature, then the frame index as 4 bytes. */
export function fakePngBytes(index: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(PNG_SIGNATURE.length + 4)
	bytes.set(PNG_SIGNATURE)
	new DataView(bytes.buffer).setInt32(PNG_SIGNATURE.length, index)
	return bytes
}

/** Reads the index back from `fakePngBytes`. */
export function fakePngIndex(bytes: Uint8Array): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(
		PNG_SIGNATURE.length
	)
}

export interface FakePngStats {
	scratches: ExportSize[]
	/** Most PNG encodes in flight at once. */
	maxEncoding: number
}

/** PNG deps whose scratch copies the fake canvas content and encodes it with `fakePngBytes`. */
export function fakePng(): { deps: PngDeps<FakeExportCanvas>; stats: FakePngStats } {
	const stats: FakePngStats = { scratches: [], maxEncoding: 0 }
	let encoding = 0
	const deps: PngDeps<FakeExportCanvas> = {
		createScratch: (width, height) => {
			stats.scratches.push({ width, height })
			let copied = -1
			return {
				copy: (canvas) => {
					copied = canvas.content
				},
				encode: async () => {
					encoding++
					stats.maxEncoding = Math.max(stats.maxEncoding, encoding)
					await new Promise((resolve) => setTimeout(resolve, 0))
					encoding--
					return new Blob([fakePngBytes(copied)], { type: 'image/png' })
				},
			}
		},
	}
	return { deps, stats }
}
