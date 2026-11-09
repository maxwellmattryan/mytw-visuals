import { describe, expect, it } from '@jest/globals'

import { avcCodecString, QUALITY_BPP, resolveBitrate } from '@mytw/export'
import type { AvcProfile, Quality } from '@mytw/export'

describe('avcCodecString', () => {
	it.each<[number, number, number, string]>([
		[640, 360, 30, 'avc1.64001F'], // 3.1
		[1280, 720, 30, 'avc1.64001F'], // 3.1 at its frame-size limit
		[1280, 720, 60, 'avc1.640028'], // 4.0
		[1080, 1920, 30, 'avc1.640028'], // 4.0
		[1920, 1080, 60, 'avc1.64002A'], // 4.2
		[2048, 2048, 30, 'avc1.640033'], // 5.1: frame size over 4.2
		[2160, 3840, 30, 'avc1.640033'], // 5.1
		[3840, 2160, 60, 'avc1.640034'], // 5.2
		[3840, 2160, 120, 'avc1.64003C'], // 6.0
		[7680, 4320, 60, 'avc1.64003E'], // over 6.0: 6.2
	])('avcCodecString levels: %ix%i @ %i', (width, height, fps, expected) => {
		expect(avcCodecString(width, height, fps)).toBe(expected)
	})

	it.each<[AvcProfile, string]>([
		['high', 'avc1.640028'],
		['main', 'avc1.4D0028'],
		['baseline', 'avc1.42E028'],
	])('avcCodecString profile %s', (profile, expected) => {
		expect(avcCodecString(1080, 1920, 30, profile)).toBe(expected)
	})
})

describe('resolveBitrate', () => {
	const size = { width: 1080, height: 1920, fps: 30 }

	it.each<[Quality, number]>([
		['low', 3_110_400],
		['medium', 6_220_800],
		['high', 9_331_200],
		['very-high', 15_552_000],
	])('resolveBitrate maps %s to round(w*h*fps*bpp)', (quality, expected) => {
		expect(resolveBitrate({ ...size, quality })).toBe(expected)
		expect(expected).toBe(Math.round(1080 * 1920 * 30 * QUALITY_BPP[quality]))
	})

	it('resolveBitrate defaults to high and prefers an explicit bitrate', () => {
		expect(resolveBitrate(size)).toBe(9_331_200)
		expect(resolveBitrate({ ...size, bitrate: 5_000_000 })).toBe(5_000_000)
		expect(resolveBitrate({ width: 640, height: 360, fps: 23.976, quality: 'low' })).toBe(
			Math.round(640 * 360 * 23.976 * 0.05)
		)
	})
})
