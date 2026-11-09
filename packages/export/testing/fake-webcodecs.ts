/**
 * A fake WebCodecs `VideoEncoder` and `VideoFrame` for Node tests. The encoder
 * has a controllable output delay, a real `encodeQueueSize` and `dequeue`
 * events, and emits chunks whose first metadata carries a valid avcC.
 */
import type { SourceCanvas } from '../types'
import type { EncoderInit, VideoDeps } from '../video'
import { FakeExportCanvas } from './fake-canvas'

/** Writes bits MSB first, with Exp-Golomb codes, for the SPS and PPS fixtures. */
class BitWriter {
	private bits: number[] = []

	u(value: number, width: number): this {
		for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1)
		return this
	}

	ue(value: number): this {
		const code = value + 1
		const width = Math.floor(Math.log2(code)) + 1
		return this.u(0, width - 1).u(code, width)
	}

	se(value: number): this {
		return this.ue(value <= 0 ? -2 * value : 2 * value - 1)
	}

	/** The RBSP with its stop bit, padded to a byte. */
	rbsp(): number[] {
		const bits = [...this.bits, 1]
		while (bits.length % 8 !== 0) bits.push(0)
		const out: number[] = []
		for (let i = 0; i < bits.length; i += 8) {
			out.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0))
		}
		return out
	}
}

/** Inserts emulation-prevention bytes and prepends the NAL header. */
function nal(header: number, rbsp: number[]): number[] {
	const out = [header]
	let zeros = 0
	for (const byte of rbsp) {
		if (zeros >= 2 && byte <= 3) {
			out.push(3)
			zeros = 0
		}
		out.push(byte)
		zeros = byte === 0 ? zeros + 1 : 0
	}
	return out
}

export const FIXTURE_WIDTH = 1080
export const FIXTURE_HEIGHT = 1920

/** High profile, level 4.0, 1080x1920 4:2:0 8-bit, no VUI. */
function sps(): number[] {
	const mbsWide = Math.ceil(FIXTURE_WIDTH / 16)
	const mbsHigh = Math.ceil(FIXTURE_HEIGHT / 16)
	const w = new BitWriter()
		.u(100, 8) // profile_idc: High
		.u(0, 8) // constraint flags
		.u(40, 8) // level_idc 4.0
		.ue(0) // seq_parameter_set_id
		.ue(1) // chroma_format_idc 4:2:0
		.ue(0) // bit_depth_luma_minus8
		.ue(0) // bit_depth_chroma_minus8
		.u(0, 1) // qpprime_y_zero_transform_bypass_flag
		.u(0, 1) // seq_scaling_matrix_present_flag
		.ue(0) // log2_max_frame_num_minus4
		.ue(2) // pic_order_cnt_type
		.ue(1) // max_num_ref_frames
		.u(0, 1) // gaps_in_frame_num_value_allowed_flag
		.ue(mbsWide - 1)
		.ue(mbsHigh - 1)
		.u(1, 1) // frame_mbs_only_flag
		.u(1, 1) // direct_8x8_inference_flag
	const cropRight = (mbsWide * 16 - FIXTURE_WIDTH) / 2
	const cropBottom = (mbsHigh * 16 - FIXTURE_HEIGHT) / 2
	if (cropRight || cropBottom) w.u(1, 1).ue(0).ue(cropRight).ue(0).ue(cropBottom)
	else w.u(0, 1)
	w.u(0, 1) // vui_parameters_present_flag
	return nal(0x67, w.rbsp())
}

function pps(): number[] {
	const w = new BitWriter()
		.ue(0) // pic_parameter_set_id
		.ue(0) // seq_parameter_set_id
		.u(1, 1) // entropy_coding_mode_flag: CABAC
		.u(0, 1) // bottom_field_pic_order_in_frame_present_flag
		.ue(0) // num_slice_groups_minus1
		.ue(0) // num_ref_idx_l0_default_active_minus1
		.ue(0) // num_ref_idx_l1_default_active_minus1
		.u(0, 1) // weighted_pred_flag
		.u(0, 2) // weighted_bipred_idc
		.se(0) // pic_init_qp_minus26
		.se(0) // pic_init_qs_minus26
		.se(0) // chroma_qp_index_offset
		.u(1, 1) // deblocking_filter_control_present_flag
		.u(0, 1) // constrained_intra_pred_flag
		.u(0, 1) // redundant_pic_cnt_present_flag
	return nal(0x68, w.rbsp())
}

function avcc(): Uint8Array<ArrayBuffer> {
	const s = sps()
	const p = pps()
	return new Uint8Array([
		1, // configurationVersion
		s[1], // AVCProfileIndication
		s[2], // profile_compatibility
		s[3], // AVCLevelIndication
		0xff, // reserved, lengthSizeMinusOne = 3
		0xe1, // reserved, numOfSequenceParameterSets = 1
		s.length >> 8,
		s.length & 0xff,
		...s,
		1, // numOfPictureParameterSets
		p.length >> 8,
		p.length & 0xff,
		...p,
	])
}

/** An AVCDecoderConfigurationRecord for the fixture size. */
export const AVCC_FIXTURE = avcc()

export interface EncodedRecord {
	timestamp: number
	duration: number | null
	keyFrame: boolean
	/** The `FakeExportCanvas` content when the frame was created (the index drawn), else -1. */
	content: number
}

export interface FakeCodecStats {
	framesCreated: number
	framesClosed: number
	/** Most `VideoFrame`s open at once. */
	maxOpenFrames: number
	/** Largest `encodeQueueSize` seen right after an `encode`. */
	maxQueue: number
	encoded: EncodedRecord[]
	configs: VideoEncoderConfig[]
	/** Codec strings passed to `isConfigSupported`. */
	queries: string[]
	/** States of every encoder created, read live. */
	encoders: { readonly state: CodecState }[]
}

export interface FakeCodecOptions {
	/** Which configs `isConfigSupported` accepts. Default all. */
	supports?: (config: VideoEncoderConfig) => boolean
	/** Milliseconds before each output. Default 0, which uses a microtask instead of a timer. */
	outputDelay?: number
	/** Calls the error callback when this frame index is encoded. */
	errorAt?: number
}

/** Fresh fake classes and the stats they record. */
export function fakeWebCodecs(options: FakeCodecOptions = {}): {
	deps: Required<VideoDeps<SourceCanvas>>
	stats: FakeCodecStats
} {
	const stats: FakeCodecStats = {
		framesCreated: 0,
		framesClosed: 0,
		maxOpenFrames: 0,
		maxQueue: 0,
		encoded: [],
		configs: [],
		queries: [],
		encoders: [],
	}

	class FakeVideoFrame {
		readonly timestamp: number
		readonly duration: number | null
		readonly content: number
		private closed = false

		constructor(source: SourceCanvas, init: VideoFrameInit) {
			this.timestamp = init.timestamp ?? 0
			this.duration = init.duration ?? null
			this.content = source instanceof FakeExportCanvas ? source.content : -1
			stats.framesCreated++
			stats.maxOpenFrames = Math.max(stats.maxOpenFrames, stats.framesCreated - stats.framesClosed)
		}

		close(): void {
			if (this.closed) return
			this.closed = true
			stats.framesClosed++
		}
	}

	const wait = (ms: number): Promise<void> =>
		ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

	class FakeVideoEncoder extends EventTarget {
		static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
			stats.queries.push(config.codec)
			return { supported: options.supports?.(config) ?? true, config }
		}

		encodeQueueSize = 0
		state: CodecState = 'unconfigured'
		private readonly init: EncoderInit
		private config: VideoEncoderConfig | null = null
		private tail: Promise<void> = Promise.resolve()
		private count = 0
		private sentConfig = false

		constructor(init: EncoderInit) {
			super()
			this.init = init
			stats.encoders.push(this)
		}

		configure(config: VideoEncoderConfig): void {
			this.config = config
			this.state = 'configured'
			stats.configs.push(config)
		}

		encode(frame: FakeVideoFrame, opts?: VideoEncoderEncodeOptions): void {
			if (this.state !== 'configured') {
				throw new DOMException('Encoder is not configured', 'InvalidStateError')
			}
			const index = this.count++
			const keyFrame = opts?.keyFrame ?? false
			const { timestamp, duration } = frame
			stats.encoded.push({ timestamp, duration, keyFrame, content: frame.content })
			this.encodeQueueSize++
			stats.maxQueue = Math.max(stats.maxQueue, this.encodeQueueSize)
			if (options.errorAt === index) {
				queueMicrotask(() => {
					if (this.state === 'closed') return
					this.state = 'closed'
					this.init.error(new DOMException('fake encoder failure', 'EncodingError'))
				})
				return
			}
			this.tail = this.tail
				.then(() => wait(options.outputDelay ?? 0))
				.then(() => this.emit(index, keyFrame, timestamp, duration))
		}

		private emit(index: number, keyFrame: boolean, timestamp: number, duration: number | null) {
			if (this.state !== 'configured' || !this.config) return
			this.encodeQueueSize--
			this.dispatchEvent(new Event('dequeue'))
			const data = new Uint8Array([0, 0, 0, 3, keyFrame ? 0x65 : 0x41, 0x88, index & 0xff])
			const chunk = {
				type: keyFrame ? ('key' as const) : ('delta' as const),
				timestamp,
				duration,
				byteLength: data.byteLength,
				copyTo: (destination: Uint8Array) => destination.set(data),
			}
			if (this.sentConfig) {
				this.init.output(chunk)
				return
			}
			this.sentConfig = true
			this.init.output(chunk, {
				decoderConfig: {
					codec: this.config.codec,
					codedWidth: this.config.width,
					codedHeight: this.config.height,
					description: AVCC_FIXTURE,
				},
			})
		}

		async flush(): Promise<void> {
			await this.tail
			if (this.state !== 'configured') {
				throw new DOMException('Encoder is closed', 'InvalidStateError')
			}
		}

		close(): void {
			if (this.state === 'closed') {
				throw new DOMException('Encoder is already closed', 'InvalidStateError')
			}
			this.state = 'closed'
		}
	}

	return { deps: { VideoEncoder: FakeVideoEncoder, VideoFrame: FakeVideoFrame }, stats }
}
