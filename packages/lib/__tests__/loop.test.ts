import { describe, expect, it, jest } from '@jest/globals'

import {
	checkLoopTarget,
	customTarget,
	formatSeconds,
	frameDifference,
	LOOP_TARGETS,
	LoopClock,
	measureSeam,
} from '@lib/loop'
import type { LoopTarget } from '@lib/loop'

/** Calls `next()` `count` times and returns the frame after each call. */
function draw(clock: LoopClock, count: number): number[] {
	return Array.from({ length: count }, () => {
		clock.next()
		return clock.frame
	})
}

describe('LoopClock', () => {
	it('starts at frame 0, advances once per call and wraps after the last frame', () => {
		const clock = new LoopClock({ loopFrames: 3, fps: 30 })
		expect(clock.next()).toBe(0)
		expect(draw(clock, 5)).toEqual([1, 2, 0, 1, 2])
	})

	it('returns phases in [0, 1)', () => {
		const clock = new LoopClock({ loopFrames: 4, fps: 30 })
		expect([clock.next(), clock.next(), clock.next(), clock.next(), clock.next()]).toEqual([
			0, 0.25, 0.5, 0.75, 0,
		])
	})

	it('repeats the current frame while paused', () => {
		const clock = new LoopClock({ loopFrames: 10, fps: 30 })
		draw(clock, 3)
		clock.pause()
		expect(draw(clock, 3)).toEqual([2, 2, 2])
		clock.play()
		expect(draw(clock, 2)).toEqual([3, 4])
	})

	it('starts paused when asked', () => {
		const clock = new LoopClock({ loopFrames: 10, fps: 30, playing: false })
		expect(draw(clock, 3)).toEqual([0, 0, 0])
	})

	it('returns the sought frame on the next call without advancing', () => {
		const clock = new LoopClock({ loopFrames: 10, fps: 30 })
		draw(clock, 4)
		clock.seek(7)
		expect(draw(clock, 3)).toEqual([7, 8, 9])
	})

	it('rounds and wraps seek targets', () => {
		const clock = new LoopClock({ loopFrames: 10, fps: 30 })
		clock.seek(12.4)
		expect(clock.frame).toBe(2)
		clock.seek(-1)
		expect(clock.frame).toBe(9)
		clock.seek(Number.NaN)
		expect(clock.frame).toBe(0)
	})

	it('pauses on step and wraps both ways', () => {
		const clock = new LoopClock({ loopFrames: 5, fps: 30 })
		clock.next()
		clock.step(-1)
		expect(clock.playing).toBe(false)
		expect(clock.frame).toBe(4)
		expect(draw(clock, 2)).toEqual([4, 4])
		clock.step()
		expect(clock.frame).toBe(0)
		clock.step(1)
		expect(clock.next()).toBe(0.2)
	})

	it('seeks a phase to the nearest frame', () => {
		const clock = new LoopClock({ loopFrames: 225, fps: 30 })
		clock.seekPhase(0.5)
		expect(clock.frame).toBe(113)
		expect(clock.next()).toBeCloseTo(113 / 225)
	})

	it('toggles between playing and paused', () => {
		const clock = new LoopClock({ loopFrames: 5, fps: 30 })
		clock.toggle()
		expect(clock.playing).toBe(false)
		clock.toggle()
		expect(clock.playing).toBe(true)
	})

	it('reports the loop length in seconds', () => {
		const clock = new LoopClock({ loopFrames: 225, fps: 30 })
		expect(clock.seconds).toBe(7.5)
	})

	it('keeps the phase when the loop length changes', () => {
		const clock = new LoopClock({ loopFrames: 200, fps: 30 })
		clock.seek(100)
		clock.setLoopFrames(100)
		expect(clock.loopFrames).toBe(100)
		expect(clock.frame).toBe(50)
		expect(clock.next()).toBe(0.5)
	})

	it.each([
		[99.6, 100],
		[0, 1],
		[-5, 1],
		[Number.NaN, 1],
	])('rounds setLoopFrames(%p) to %p', (input, expected) => {
		const clock = new LoopClock({ loopFrames: 10, fps: 30 })
		clock.setLoopFrames(input)
		expect(clock.loopFrames).toBe(expected)
		expect(clock.frame).toBeLessThan(expected)
	})

	it('ignores FPS values that are not finite or not above 0', () => {
		const clock = new LoopClock({ loopFrames: 10, fps: 30 })
		for (const fps of [0, -24, Number.NaN, Infinity]) clock.setFps(fps)
		expect(clock.fps).toBe(30)
		clock.setFps(24)
		expect(clock.fps).toBe(24)
	})

	it('notifies listeners for play, pause, seek, step and set calls, not for next()', () => {
		const clock = new LoopClock({ loopFrames: 10, fps: 30 })
		const listener = jest.fn()
		const stop = clock.onChange(listener)

		clock.next()
		clock.next()
		expect(listener).not.toHaveBeenCalled()

		clock.pause()
		clock.play()
		clock.seek(3)
		clock.seekPhase(0.5)
		clock.step(1)
		clock.setLoopFrames(20)
		clock.setFps(24)
		expect(listener).toHaveBeenCalledTimes(7)

		stop()
		clock.toggle()
		expect(listener).toHaveBeenCalledTimes(7)
	})
})

describe('checkLoopTarget', () => {
	const custom = customTarget(10)

	it.each<[string, number, LoopTarget | null, string | null]>([
		['no target', 60, null, null],
		['Canvas inside', 7.5, LOOP_TARGETS.spotifyCanvas, null],
		['Canvas at the max', 8, LOOP_TARGETS.spotifyCanvas, null],
		['Canvas at the min', 3, LOOP_TARGETS.spotifyCanvas, null],
		[
			'Canvas over',
			9,
			LOOP_TARGETS.spotifyCanvas,
			'Loop is 9.00 s, over the 8 s Spotify Canvas limit.',
		],
		[
			'Canvas under',
			2,
			LOOP_TARGETS.spotifyCanvas,
			'Loop is 2.00 s, under the 3 s Spotify Canvas minimum.',
		],
		['Custom at the max', 10, custom, null],
		['Custom short', 0.5, custom, null],
		['Custom over', 12, custom, 'Loop is 12.00 s, over the 10 s target.'],
		['Custom fractional', 8, customTarget(7.5), 'Loop is 8.00 s, over the 7.5 s target.'],
	])('%s', (_name, seconds, target, expected) => {
		expect(checkLoopTarget(seconds, target)).toBe(expected)
	})

	it('treats 240 frames at 30 fps as exactly 8 s', () => {
		expect(checkLoopTarget(240 / 30, LOOP_TARGETS.spotifyCanvas)).toBeNull()
	})
})

describe('formatSeconds', () => {
	it.each([
		[225, 30, '7.50'],
		[300, 30, '10.00'],
		[1, 3, '0.33'],
	])('formats %p frames at %p fps as %p', (frames, fps, expected) => {
		expect(formatSeconds(frames, fps)).toBe(expected)
	})
})

/** An RGBA frame of `pixels` pixels, every pixel the same. */
function solid(pixels: number, rgb: [number, number, number], alpha = 255): Uint8ClampedArray {
	const data = new Uint8ClampedArray(pixels * 4)
	for (let i = 0; i < data.length; i += 4) data.set([...rgb, alpha], i)
	return data
}

describe('frameDifference', () => {
	it('is the mean absolute RGB difference and ignores alpha', () => {
		expect(frameDifference(solid(4, [10, 20, 30], 255), solid(4, [13, 14, 30], 0))).toBe(3)
		expect(frameDifference(solid(2, [0, 0, 0]), solid(2, [255, 255, 255]))).toBe(255)
	})

	it('averages over pixels', () => {
		const a = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
		const b = new Uint8ClampedArray([30, 30, 30, 255, 0, 0, 0, 255])
		expect(frameDifference(a, b)).toBe(15)
	})

	it('is 0 for empty frames and throws for frames of different sizes', () => {
		expect(frameDifference(new Uint8ClampedArray(0), new Uint8ClampedArray(0))).toBe(0)
		expect(() => frameDifference(solid(1, [0, 0, 0]), solid(2, [0, 0, 0]))).toThrow(RangeError)
	})
})

describe('measureSeam', () => {
	const frame = (v: number) => solid(4, [v, v, v])

	it.each<[string, [number, number, number, number], number, number, 'seamless' | 'seam']>([
		['a still loop', [50, 50, 50, 50], 0, 0, 'seamless'],
		['a smooth loop', [98, 99, 100, 101], 1, 1, 'seamless'],
		['a seam at exactly twice the step', [90, 95, 105, 110], 10, 5, 'seamless'],
		['a seam over twice the step', [90, 95, 106, 111], 11, 5, 'seam'],
		['a small seam under the floor', [50, 50, 51, 51], 1, 0, 'seamless'],
		['a seam over the floor', [50, 50, 52, 52], 2, 0, 'seam'],
	])('%s', (_name, [beforeLast, last, first, second], seam, step, verdict) => {
		const result = measureSeam({
			beforeLast: frame(beforeLast),
			last: frame(last),
			first: frame(first),
			second: frame(second),
		})
		expect(result).toEqual({ seam, step, verdict })
	})
})
