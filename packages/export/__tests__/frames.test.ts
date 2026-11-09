import { describe, expect, it } from '@jest/globals'

import {
	EXPORT_PRESETS,
	ExportError,
	framePlan,
	presetIssues,
	stepFrames,
	validateOptions,
	validateStill,
} from '@mytw/export'
import type { ExportErrorCode, ExportPreset, VideoOptions } from '@mytw/export'

import { RecordingSource } from '../testing/fake-canvas'

function caught(fn: () => unknown): unknown {
	try {
		fn()
	} catch (err) {
		return err
	}
	return null
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise
	} catch (err) {
		return err
	}
	return null
}

function expectExportError(err: unknown, code: ExportErrorCode, fragment: string): void {
	expect(err).toBeInstanceOf(ExportError)
	if (!(err instanceof ExportError)) return
	expect(err.code).toBe(code)
	expect(err.message).toContain(fragment)
}

describe('framePlan', () => {
	it.each([
		[225, 225, 30],
		[240, 240, 23.976],
		[450, 225, 30],
		[1, 1, 60],
	])('framePlan phases and timestamps: %i frames, loop %i @ %d fps', (frames, loopFrames, fps) => {
		const plan = framePlan(frames, loopFrames, fps)
		expect(plan).toHaveLength(frames)
		expect(plan[0].timestamp).toBe(0)
		plan.forEach((entry, i) => {
			expect(entry.index).toBe(i)
			expect(entry.phase).toBe((i % loopFrames) / loopFrames)
			expect(entry.phase).toBeLessThan(1)
			expect(entry.timestamp).toBe(Math.round((i * 1e6) / fps))
			const next = i + 1 < frames ? plan[i + 1].timestamp : Math.round((frames * 1e6) / fps)
			expect(entry.timestamp + entry.duration).toBe(next)
			expect(entry.duration).toBeGreaterThan(0)
			if (i % loopFrames === loopFrames - 1) {
				expect(entry.phase).toBe((loopFrames - 1) / loopFrames)
			}
		})
	})
})

describe('validateOptions', () => {
	const base: VideoOptions = { width: 1080, height: 1920, fps: 30, frames: 225 }

	it.each<[string, Partial<VideoOptions>, 'video' | 'png', string]>([
		['odd video width', { width: 1081 }, 'video', 'width'],
		['odd video height', { height: 1919 }, 'video', 'height'],
		['zero width', { width: 0 }, 'png', 'width'],
		['fractional height', { height: 10.5 }, 'png', 'height'],
		['non-integer frames', { frames: 2.5 }, 'png', 'frames'],
		['zero frames', { frames: 0 }, 'video', 'frames'],
		['non-integer loopFrames', { loopFrames: 1.5 }, 'video', 'loopFrames'],
		['zero fps', { fps: 0 }, 'video', 'fps'],
		['negative fps', { fps: -30 }, 'png', 'fps'],
		['fps over 240', { fps: 240.5 }, 'video', 'fps'],
		['NaN fps', { fps: NaN }, 'video', 'fps'],
		['infinite fps', { fps: Infinity }, 'png', 'fps'],
		[
			'bitrate and quality',
			{ bitrate: 8_000_000, quality: 'high' },
			'video',
			'bitrate and quality',
		],
		['fractional bitrate', { bitrate: 1.5 }, 'video', 'bitrate'],
	])('validateOptions rejects %s', (_name, patch, kind, field) => {
		expectExportError(
			caught(() => validateOptions({ ...base, ...patch }, kind)),
			'invalid-options',
			field
		)
	})

	it('accepts odd sizes for PNG and fills in loopFrames', () => {
		expect(validateOptions({ ...base, width: 1081 }, 'png')).toEqual({
			width: 1081,
			height: 1920,
			fps: 30,
			frames: 225,
			loopFrames: 225,
		})
		expect(validateOptions({ ...base, fps: 240, loopFrames: 75 }, 'video').loopFrames).toBe(75)
	})

	it('rejects a still phase outside [0, 1)', () => {
		expectExportError(
			caught(() => validateStill({ width: 10, height: 10, phase: 1 })),
			'invalid-options',
			'phase'
		)
	})

	it('rejects a canvas the wrong size after begin, then still calls end', async () => {
		const source = new RecordingSource({ sizeAfterBegin: () => ({ width: 300, height: 150 }) })
		const plan = framePlan(3, 3, 30)
		const err = await rejection(
			stepFrames(source, plan, { width: 1080, height: 1920 }, undefined, () => {})
		)
		expectExportError(err, 'invalid-options', 'width and height')
		expect(source.count('draw')).toBe(0)
		expect(source.count('end')).toBe(1)
	})
})

describe('presetIssues', () => {
	const { spotifyCanvas, instagramReel } = EXPORT_PRESETS

	it.each<[string, ExportPreset, number, number, string[]]>([
		['Canvas 7.5 s', spotifyCanvas, 225, 30, []],
		['Canvas 8 s', spotifyCanvas, 240, 30, []],
		['Canvas 9 s', spotifyCanvas, 270, 30, ['Loop is 9.00 s, over the 8 s Spotify Canvas limit.']],
		[
			'Canvas 2 s',
			spotifyCanvas,
			60,
			30,
			['Loop is 2.00 s, under the 3 s Spotify Canvas minimum.'],
		],
		['Canvas at 24 fps', spotifyCanvas, 180, 24, ['Spotify Canvas expects 30 fps, got 24 fps.']],
		['Reel 90 s', instagramReel, 2700, 30, []],
		[
			'Reel 91 s',
			instagramReel,
			2730,
			30,
			['Loop is 91.00 s, over the 90 s Instagram Reel limit.'],
		],
	])('presetIssues: %s', (_name, preset, frames, fps, expected) => {
		expect(presetIssues(preset, { frames, fps })).toEqual(expected)
	})
})
