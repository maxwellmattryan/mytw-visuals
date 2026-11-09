import {
	BufferTarget,
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
	StreamTarget,
} from 'mediabunny'
import type { StreamTargetChunk } from 'mediabunny'

import { avcCodecString, MAX_ENCODE_QUEUE, resolveBitrate } from './codec'
import type { AvcProfile, BitrateOptions } from './codec'
import { encodeFailed, ExportError, throwIfAborted } from './errors'
import { framePlan, validateOptions } from './frames'
import { stepFrames } from './step'
import type { ExportCanvas, ExportResult, FrameSource, SourceCanvas, VideoOptions } from './types'

/** The parts of an `EncodedVideoChunk` the exporter reads. */
export interface ChunkLike {
	readonly type: 'key' | 'delta'
	readonly timestamp: number
	readonly duration: number | null
	readonly byteLength: number
	copyTo(destination: Uint8Array): void
}

export interface EncoderInit {
	output: (chunk: ChunkLike, metadata?: EncodedVideoChunkMetadata) => void
	error: (error: DOMException) => void
}

export interface FrameLike {
	close(): void
}

/** The parts of a `VideoEncoder` the exporter uses. */
export interface EncoderLike {
	readonly encodeQueueSize: number
	readonly state: CodecState
	configure(config: VideoEncoderConfig): void
	encode(frame: FrameLike, options?: VideoEncoderEncodeOptions): void
	flush(): Promise<void>
	close(): void
	addEventListener(type: 'dequeue', listener: () => void): void
	removeEventListener(type: 'dequeue', listener: () => void): void
}

export interface EncoderClass {
	new (init: EncoderInit): EncoderLike
	isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>
}

export interface FrameClass<C extends SourceCanvas = ExportCanvas> {
	new (source: C, init: VideoFrameInit): FrameLike
}

/**
 * WebCodecs constructors, read from `globalThis` unless given, so tests inject
 * fakes. `C` is the source's canvas type, which the frame constructor takes.
 */
export interface VideoDeps<C extends SourceCanvas = ExportCanvas> {
	VideoEncoder?: EncoderClass
	VideoFrame?: FrameClass<C>
}

export type VideoSupport =
	| { ok: true; codec: string; bitrate: number }
	| { ok: false; message: string }

const PROFILES: readonly AvcProfile[] = ['high', 'main', 'baseline']

function unavailable(width: number, height: number): string {
	return `This browser can't encode H.264 video at ${width}x${height}. Use a recent Chrome, Edge or Safari, or export a PNG sequence instead.`
}

function encoderConfig(
	codec: string,
	{ width, height, fps }: BitrateOptions,
	bitrate: number
): VideoEncoderConfig {
	return {
		codec,
		width,
		height,
		bitrate,
		framerate: fps,
		bitrateMode: 'variable',
		latencyMode: 'quality',
		avc: { format: 'avc' },
	}
}

/**
 * Finds an H.264 config the browser can encode: High, then Main, then
 * Constrained Baseline, at the lowest level that fits.
 */
export async function checkVideoSupport(
	options: BitrateOptions,
	deps: { VideoEncoder?: EncoderClass; VideoFrame?: unknown } = globalThis
): Promise<VideoSupport> {
	const { width, height, fps } = options
	const message = unavailable(width, height)
	const { VideoEncoder: Encoder, VideoFrame: Frame } = deps
	if (typeof Encoder !== 'function' || typeof Frame !== 'function') return { ok: false, message }
	const bitrate = resolveBitrate(options)
	for (const profile of PROFILES) {
		const codec = avcCodecString(width, height, fps, profile)
		try {
			const support = await Encoder.isConfigSupported(encoderConfig(codec, options, bitrate))
			if (support.supported) return { ok: true, codec, bitrate }
		} catch {
			// A rejected config counts as unsupported; try the next profile.
		}
	}
	return { ok: false, message }
}

/**
 * Encodes the loop as H.264 in an MP4 with no audio. Frame `i` shows phase
 * `(i % loopFrames) / loopFrames` at `round(i * 1e6 / fps)` µs, with a keyframe
 * every `round(2 * fps)` frames.
 */
export function exportVideo(source: FrameSource, options: VideoOptions): Promise<ExportResult>
export function exportVideo<C extends SourceCanvas>(
	source: FrameSource<C>,
	options: VideoOptions,
	deps: VideoDeps<C>
): Promise<ExportResult>
export function exportVideo<C extends SourceCanvas>(
	...args: [FrameSource, VideoOptions] | [FrameSource<C>, VideoOptions, VideoDeps<C>]
): Promise<ExportResult> {
	if (args.length === 3) return encodeVideo(args[0], args[1], args[2])
	return encodeVideo(args[0], args[1], globalThis)
}

async function encodeVideo<C extends SourceCanvas>(
	source: FrameSource<C>,
	options: VideoOptions,
	deps: VideoDeps<C>
): Promise<ExportResult> {
	const valid = validateOptions(options, 'video')
	const { signal, onProgress, destination } = options
	throwIfAborted(signal)
	const support = await checkVideoSupport(
		{ ...valid, bitrate: options.bitrate, quality: options.quality },
		deps
	)
	const { VideoEncoder: Encoder, VideoFrame: Frame } = deps
	if (!support.ok || !Encoder || !Frame) {
		throw new ExportError('encoding-unavailable', unavailable(valid.width, valid.height))
	}
	throwIfAborted(signal)

	// Mediabunny closes its writable when it finishes or cancels, so it gets a
	// relay and the exporter keeps the destination's writer: close on success,
	// abort on failure, so a cancelled export never commits a partial file.
	const writer = destination?.getWriter() ?? null
	const buffer = writer ? null : new BufferTarget()
	const target =
		buffer ??
		new StreamTarget(
			new WritableStream<StreamTargetChunk>({ write: (chunk) => writer?.write(chunk) }),
			{ chunked: true }
		)
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: writer ? false : 'in-memory' }),
		target,
	})
	const packets = new EncodedVideoPacketSource('avc')
	output.addVideoTrack(packets, { frameRate: valid.fps })

	let failure: ExportError | null = null
	let adds: Promise<void> = Promise.resolve()
	let wake: (() => void) | null = null
	const wakeUp = (): void => {
		const resolve = wake
		wake = null
		resolve?.()
	}
	const fail = (cause: unknown): void => {
		failure ??= encodeFailed(cause)
		wakeUp()
	}
	const check = (): void => {
		if (failure) throw failure
		throwIfAborted(signal)
	}

	let encoder: EncoderLike | null = null
	signal?.addEventListener('abort', wakeUp)
	try {
		await output.start()
		const enc = new Encoder({
			output: (chunk, metadata) => {
				if (failure) return
				try {
					const data = new Uint8Array(chunk.byteLength)
					chunk.copyTo(data)
					// Built by hand: `EncodedPacket.fromEncodedChunk` only takes a native chunk.
					const packet = new EncodedPacket(
						data,
						chunk.type,
						chunk.timestamp / 1e6,
						(chunk.duration ?? 0) / 1e6
					)
					adds = adds.then(() => (failure ? undefined : packets.add(packet, metadata))).catch(fail)
				} catch (err) {
					fail(err)
				}
			},
			error: fail,
		})
		encoder = enc
		enc.addEventListener('dequeue', wakeUp)
		enc.configure(encoderConfig(support.codec, valid, support.bitrate))

		const keyInterval = Math.max(1, Math.round(2 * valid.fps))
		const backpressure = async (): Promise<void> => {
			while (enc.encodeQueueSize >= MAX_ENCODE_QUEUE) {
				check()
				await new Promise<void>((resolve) => (wake = resolve))
			}
			check()
			await adds
			check()
		}
		const plan = framePlan(valid.frames, valid.loopFrames, valid.fps)
		await stepFrames(
			source,
			plan,
			valid,
			signal,
			(canvas, entry) => {
				const frame = new Frame(canvas, { timestamp: entry.timestamp, duration: entry.duration })
				try {
					enc.encode(frame, { keyFrame: entry.index % keyInterval === 0 })
				} catch (err) {
					throw failure ?? encodeFailed(err)
				} finally {
					frame.close()
				}
				return backpressure()
			},
			onProgress
		)

		await adds
		check()
		await enc.flush().catch((err: unknown) => {
			throw failure ?? encodeFailed(err)
		})
		await adds
		check()
		await output.finalize().catch((err: unknown) => {
			throw encodeFailed(err)
		})
		await writer?.close()
		enc.close()
	} catch (err) {
		if (encoder && encoder.state !== 'closed') encoder.close()
		await output.cancel().catch(() => {})
		await writer?.abort(err).catch(() => {})
		throw err
	} finally {
		encoder?.removeEventListener('dequeue', wakeUp)
		signal?.removeEventListener('abort', wakeUp)
	}

	return {
		blob: buffer?.buffer ? new Blob([buffer.buffer], { type: 'video/mp4' }) : null,
		mimeType: 'video/mp4',
		width: valid.width,
		height: valid.height,
		fps: valid.fps,
		frames: valid.frames,
		duration: valid.frames / valid.fps,
		codec: support.codec,
	}
}
