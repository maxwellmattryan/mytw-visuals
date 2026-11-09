import type { Quality } from './types'

/** The exporter waits for a `dequeue` event while the encoder holds this many frames. */
export const MAX_ENCODE_QUEUE = 4

/** Bits per pixel per frame for each quality. */
export const QUALITY_BPP: Readonly<Record<Quality, number>> = {
	low: 0.05,
	medium: 0.1,
	high: 0.15,
	'very-high': 0.25,
}

export type AvcProfile = 'high' | 'main' | 'baseline'

/** `profile_idc` and constraint flags as hex. Baseline is Constrained Baseline. */
const PROFILES: Readonly<Record<AvcProfile, string>> = {
	high: '6400',
	main: '4D00',
	baseline: '42E0',
}

/** H.264 levels from Table A-1: max macroblocks per frame and per second. */
const LEVELS: readonly { idc: string; maxFs: number; maxMbps: number }[] = [
	{ idc: '1F', maxFs: 3600, maxMbps: 108000 }, // 3.1
	{ idc: '28', maxFs: 8192, maxMbps: 245760 }, // 4.0
	{ idc: '2A', maxFs: 8704, maxMbps: 522240 }, // 4.2
	{ idc: '33', maxFs: 36864, maxMbps: 983040 }, // 5.1
	{ idc: '34', maxFs: 36864, maxMbps: 2073600 }, // 5.2
	{ idc: '3C', maxFs: 139264, maxMbps: 4177920 }, // 6.0
]

/** Level 6.2, used when nothing lower fits. */
const TOP_LEVEL = '3E'

/**
 * The `avc1` codec string for the lowest level whose frame size and macroblock
 * rate fit `width`x`height` at `fps`: `avcCodecString(1080, 1920, 30)` is `'avc1.640028'`.
 */
export function avcCodecString(
	width: number,
	height: number,
	fps: number,
	profile: AvcProfile = 'high'
): string {
	const frameSize = Math.ceil(width / 16) * Math.ceil(height / 16)
	const rate = frameSize * fps
	const level = LEVELS.find((l) => frameSize <= l.maxFs && rate <= l.maxMbps)?.idc ?? TOP_LEVEL
	return `avc1.${PROFILES[profile]}${level}`
}

export interface BitrateOptions {
	width: number
	height: number
	fps: number
	bitrate?: number
	quality?: Quality
}

/** `bitrate` when given, else `round(width * height * fps * bpp)` for `quality` (default `'high'`). */
export function resolveBitrate({
	width,
	height,
	fps,
	bitrate,
	quality = 'high',
}: BitrateOptions): number {
	return bitrate ?? Math.round(width * height * fps * QUALITY_BPP[quality])
}
