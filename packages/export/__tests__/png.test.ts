import { describe, expect, it } from '@jest/globals'
import { unzipSync } from 'fflate'

import { ExportError, exportPngSequence, exportStill, pngEntryName } from '@mytw/export'
import type { ExportChunk, ExportErrorCode, ExportProgress } from '@mytw/export'

import { fakePng, fakePngBytes, RecordingSource, seededDelays } from '../testing/fake-canvas'

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise
	} catch (err) {
		return err
	}
	return null
}

function expectExportError(err: unknown, code: ExportErrorCode): void {
	expect(err).toBeInstanceOf(ExportError)
	if (err instanceof ExportError) expect(err.code).toBe(code)
}

function names(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `frame-${String(i).padStart(5, '0')}.png`)
}

describe('exportPngSequence', () => {
	it('zips one PNG per frame in order', async () => {
		const { deps, stats } = fakePng()
		const source = new RecordingSource({ delay: seededDelays(7, 2), clearAfterTask: true })
		const progress: ExportProgress[] = []
		const result = await exportPngSequence(
			source,
			{
				width: 1081,
				height: 607,
				fps: 30,
				frames: 12,
				loopFrames: 6,
				onProgress: (p) => progress.push(p),
			},
			deps
		)
		expect(result).toMatchObject({
			mimeType: 'application/zip',
			width: 1081,
			height: 607,
			fps: 30,
			frames: 12,
			duration: 0.4,
		})
		if (!result.blob) throw new Error('expected a blob')
		expect(result.blob.type).toBe('application/zip')
		const zip = new Uint8Array(await result.blob.arrayBuffer())
		// Stored: the first local header's compression method is 0.
		expect(zip[8] | (zip[9] << 8)).toBe(0)
		const entries = unzipSync(zip)
		expect(Object.keys(entries)).toEqual(names(12))
		Object.values(entries).forEach((bytes, i) => expect(bytes).toEqual(fakePngBytes(i)))
		expect(source.draws.map((d) => d.phase)).toEqual(
			Array.from({ length: 12 }, (_, i) => (i % 6) / 6)
		)
		expect(progress.map((p) => p.done)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
		expect(stats.scratches).toEqual([{ width: 1081, height: 607 }])
		expect(stats.maxEncoding).toBe(1)
	})

	it('names entries with 5 digits, or more past 99999 frames', () => {
		expect(pngEntryName(0, 225)).toBe('frame-00000.png')
		expect(pngEntryName(99998, 99999)).toBe('frame-99998.png')
		expect(pngEntryName(5, 100000)).toBe('frame-000005.png')
	})

	it('streams the zip to a destination', async () => {
		const { deps } = fakePng()
		const chunks: ExportChunk[] = []
		let closed = false
		const destination = new WritableStream<ExportChunk>({
			write: (chunk) => {
				chunks.push(chunk)
			},
			close: () => {
				closed = true
			},
		})
		const result = await exportPngSequence(
			new RecordingSource(),
			{ width: 8, height: 8, fps: 24, frames: 5, destination },
			deps
		)
		expect(result.blob).toBeNull()
		expect(closed).toBe(true)
		let end = 0
		for (const chunk of chunks) {
			expect(chunk.type).toBe('write')
			expect(chunk.position).toBe(end)
			end += chunk.data.byteLength
		}
		const file = new Uint8Array(end)
		for (const chunk of chunks) file.set(chunk.data, chunk.position)
		expect(Object.keys(unzipSync(file))).toEqual(names(5))
	})

	it('cancels cleanly', async () => {
		const { deps } = fakePng()
		const controller = new AbortController()
		const state = { closed: false, aborted: false }
		const destination = new WritableStream<ExportChunk>({
			close: () => {
				state.closed = true
			},
			abort: () => {
				state.aborted = true
			},
		})
		const source = new RecordingSource({
			onDraw: (index) => {
				if (index === 3) controller.abort()
			},
		})
		const err = await rejection(
			exportPngSequence(
				source,
				{ width: 8, height: 8, fps: 30, frames: 30, signal: controller.signal, destination },
				deps
			)
		)
		expectExportError(err, 'cancelled')
		expect(source.count('draw')).toBe(4)
		expect(source.count('end')).toBe(1)
		expect(state).toEqual({ closed: false, aborted: true })

		const early = new RecordingSource()
		expectExportError(
			await rejection(
				exportPngSequence(
					early,
					{ width: 8, height: 8, fps: 30, frames: 30, signal: AbortSignal.abort() },
					deps
				)
			),
			'cancelled'
		)
		expect(early.calls).toEqual([])
	})
})

describe('exportStill', () => {
	it('exportStill draws one phase at the requested size', async () => {
		const { deps, stats } = fakePng()
		const source = new RecordingSource({ clearAfterTask: true })
		const blob = await exportStill(source, { width: 1080, height: 1920, phase: 0.25 }, deps)
		expect(source.calls).toEqual([
			{ kind: 'begin', size: { width: 1080, height: 1920 } },
			{ kind: 'draw', phase: 0.25, index: 0 },
			{ kind: 'end' },
		])
		expect(stats.scratches).toEqual([{ width: 1080, height: 1920 }])
		expect(blob.type).toBe('image/png')
		expect(new Uint8Array(await blob.arrayBuffer())).toEqual(fakePngBytes(0))
	})
})
