import { describe, expect, it } from '@jest/globals'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'

import {
	avcCodecString,
	checkVideoSupport,
	ExportError,
	exportVideo,
	MAX_ENCODE_QUEUE,
} from '@mytw/export'
import type { ExportChunk, ExportErrorCode, ExportProgress } from '@mytw/export'

import { RecordingSource, seededDelays } from '../testing/fake-canvas'
import { FIXTURE_HEIGHT, FIXTURE_WIDTH, fakeWebCodecs } from '../testing/fake-webcodecs'

const SIZE = { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT }

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

async function parse(bytes: ArrayBuffer) {
	const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
	const tracks = await input.getVideoTracks()
	expect(tracks).toHaveLength(1)
	const track = tracks[0]
	return {
		audio: (await input.getAudioTracks()).length,
		codec: track.codec,
		width: track.displayWidth,
		height: track.displayHeight,
		packets: (await track.computePacketStats()).packetCount,
		duration: await track.computeDuration(),
	}
}

/** A destination that records positioned writes and whether it was closed or aborted. */
function recordingDestination() {
	const chunks: ExportChunk[] = []
	const state = { closed: false, aborted: false }
	const stream = new WritableStream<ExportChunk>({
		write(chunk) {
			chunks.push(chunk)
		},
		close() {
			state.closed = true
		},
		abort() {
			state.aborted = true
		},
	})
	return { stream, chunks, state }
}

describe('exportVideo', () => {
	it.each([
		[225, 225, 30],
		[240, 240, 23.976],
		[1, 1, 60],
		[450, 225, 30],
	])(
		'encodes exactly N frames with frame-accurate timestamps whatever the draw latency: %i frames, loop %i @ %d',
		async (frames, loopFrames, fps) => {
			const { deps, stats } = fakeWebCodecs()
			const source = new RecordingSource({ delay: seededDelays(frames, 2), clearAfterTask: true })
			const result = await exportVideo(source, { ...SIZE, fps, frames, loopFrames }, deps)

			expect(source.draws).toEqual(
				Array.from({ length: frames }, (_, i) => ({
					index: i,
					phase: (i % loopFrames) / loopFrames,
				}))
			)
			expect(stats.encoded).toHaveLength(frames)
			const keyInterval = Math.round(2 * fps)
			stats.encoded.forEach((frame, i) => {
				// The canvas was read straight after its draw, before compositing cleared it.
				expect(frame.content).toBe(i)
				expect(frame.timestamp).toBe(Math.round((i * 1e6) / fps))
				expect(frame.duration).toBe(Math.round(((i + 1) * 1e6) / fps) - frame.timestamp)
				expect(frame.keyFrame).toBe(i % keyInterval === 0)
			})
			expect(source.count('begin')).toBe(1)
			expect(source.count('end')).toBe(1)
			expect(result).toMatchObject({
				mimeType: 'video/mp4',
				...SIZE,
				fps,
				frames,
				duration: frames / fps,
				codec: avcCodecString(SIZE.width, SIZE.height, fps),
			})
		}
	)

	it.each([
		[225, 30],
		[240, 23.976],
	])(
		'muxes an MP4 whose frame count, duration and dimensions match the options: %i @ %d',
		async (frames, fps) => {
			const { deps } = fakeWebCodecs()
			const result = await exportVideo(new RecordingSource(), { ...SIZE, fps, frames }, deps)
			if (!result.blob) throw new Error('expected a blob')
			expect(result.blob.type).toBe('video/mp4')
			const mp4 = await parse(await result.blob.arrayBuffer())
			expect(mp4.audio).toBe(0)
			expect(mp4.codec).toBe('avc')
			expect(mp4.width).toBe(SIZE.width)
			expect(mp4.height).toBe(SIZE.height)
			expect(mp4.packets).toBe(frames)
			expect(Math.abs(mp4.duration - frames / fps)).toBeLessThan(0.001)
		}
	)

	it('reports progress per frame', async () => {
		const { deps } = fakeWebCodecs()
		const progress: ExportProgress[] = []
		await exportVideo(
			new RecordingSource(),
			{ ...SIZE, fps: 30, frames: 20, onProgress: (p) => progress.push(p) },
			deps
		)
		expect(progress).toEqual(Array.from({ length: 20 }, (_, i) => ({ done: i + 1, total: 20 })))
	})

	it('cancels cleanly', async () => {
		const { deps, stats } = fakeWebCodecs({ outputDelay: 1 })
		const controller = new AbortController()
		const destination = recordingDestination()
		const source = new RecordingSource({
			onDraw: (index) => {
				if (index === 10) controller.abort()
			},
		})
		const err = await rejection(
			exportVideo(
				source,
				{
					...SIZE,
					fps: 30,
					frames: 225,
					signal: controller.signal,
					destination: destination.stream,
				},
				deps
			)
		)
		expectExportError(err, 'cancelled')
		expect(source.count('draw')).toBe(11)
		expect(source.count('end')).toBe(1)
		expect(stats.encoders.map((e) => e.state)).toEqual(['closed'])
		expect(stats.framesClosed).toBe(stats.framesCreated)
		expect(destination.state).toEqual({ closed: false, aborted: true })
	})

	it('cancels before begin when the signal is already aborted', async () => {
		const { deps, stats } = fakeWebCodecs()
		const source = new RecordingSource()
		const err = await rejection(
			exportVideo(source, { ...SIZE, fps: 30, frames: 10, signal: AbortSignal.abort() }, deps)
		)
		expectExportError(err, 'cancelled')
		expect(source.calls).toEqual([])
		expect(stats.encoders).toHaveLength(0)
	})

	it('applies encoder backpressure', async () => {
		const { deps, stats } = fakeWebCodecs({ outputDelay: 2 })
		await exportVideo(new RecordingSource(), { ...SIZE, fps: 30, frames: 40 }, deps)
		expect(stats.encoded).toHaveLength(40)
		expect(stats.maxQueue).toBe(MAX_ENCODE_QUEUE)
		expect(stats.maxOpenFrames).toBe(1)
		expect(stats.framesClosed).toBe(40)
	})

	it('streams to a destination', async () => {
		const { deps } = fakeWebCodecs({ outputDelay: 1 })
		const destination = recordingDestination()
		const result = await exportVideo(
			new RecordingSource(),
			{ ...SIZE, fps: 30, frames: 60, destination: destination.stream },
			deps
		)
		expect(result.blob).toBeNull()
		expect(destination.state).toEqual({ closed: true, aborted: false })
		expect(destination.chunks.length).toBeGreaterThan(0)
		let size = 0
		for (const chunk of destination.chunks) {
			expect(chunk.type).toBe('write')
			expect(Number.isInteger(chunk.position)).toBe(true)
			size = Math.max(size, chunk.position + chunk.data.byteLength)
		}
		const file = new Uint8Array(size)
		for (const chunk of destination.chunks) file.set(chunk.data, chunk.position)
		const mp4 = await parse(file.buffer)
		expect(mp4.packets).toBe(60)
		expect(Math.abs(mp4.duration - 2)).toBeLessThan(0.001)
	})

	it('reports unavailable encoding', async () => {
		const message =
			"This browser can't encode H.264 video at 1080x1920. Use a recent Chrome, Edge or Safari, or export a PNG sequence instead."
		const options = { ...SIZE, fps: 30, frames: 10 }

		const missing = fakeWebCodecs()
		const noEncoder = { VideoFrame: missing.deps.VideoFrame }
		expect(await checkVideoSupport(options, noEncoder)).toEqual({ ok: false, message })
		const source = new RecordingSource()
		const err = await rejection(exportVideo(source, options, noEncoder))
		expectExportError(err, 'encoding-unavailable')
		expect(err instanceof Error && err.message).toBe(message)
		expect(source.calls).toEqual([])

		const refused = fakeWebCodecs({ supports: () => false })
		expect(await checkVideoSupport(options, refused.deps)).toEqual({ ok: false, message })
		expect(refused.stats.queries).toEqual(['avc1.640028', 'avc1.4D0028', 'avc1.42E028'])
		const refusedSource = new RecordingSource()
		expectExportError(
			await rejection(exportVideo(refusedSource, options, refused.deps)),
			'encoding-unavailable'
		)
		expect(refusedSource.calls).toEqual([])
	})

	it('falls back to Main, then Baseline', async () => {
		const { deps } = fakeWebCodecs({ supports: (c) => c.codec.startsWith('avc1.42') })
		expect(await checkVideoSupport({ ...SIZE, fps: 30, quality: 'low' }, deps)).toEqual({
			ok: true,
			codec: 'avc1.42E028',
			bitrate: 3_110_400,
		})
	})

	it('fails with encode-failed when the encoder errors, and still calls end', async () => {
		const { deps, stats } = fakeWebCodecs({ errorAt: 5 })
		const source = new RecordingSource()
		const err = await rejection(exportVideo(source, { ...SIZE, fps: 30, frames: 30 }, deps))
		expectExportError(err, 'encode-failed')
		expect(err instanceof Error && err.cause).toBeInstanceOf(DOMException)
		expect(source.count('end')).toBe(1)
		expect(stats.framesClosed).toBe(stats.framesCreated)
	})
})
