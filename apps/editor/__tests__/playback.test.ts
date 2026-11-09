import { describe, expect, it } from '@jest/globals'

import { createPlayback } from '../src/playback'

describe('createPlayback', () => {
	it('starts paused on frame 0 with loop on', () => {
		const p = createPlayback({ frames: 60, fps: 30 })
		expect([p.frame, p.playing, p.loop]).toEqual([0, false, true])
		expect(p.tick(1000)).toBe(false)
	})

	it('rejects a bad frame count or fps', () => {
		expect(() => createPlayback({ frames: 0, fps: 30 })).toThrow(RangeError)
		expect(() => createPlayback({ frames: 1.5, fps: 30 })).toThrow(RangeError)
		expect(() => createPlayback({ frames: 10, fps: 0 })).toThrow(RangeError)
	})

	it('advances at the project fps from wall-clock time, not per tick', () => {
		const p = createPlayback({ frames: 225, fps: 30 })
		p.play(1000)
		// A 120 Hz display ticks every 8.33 ms: four ticks per 30 fps frame.
		const changes: number[] = []
		for (let i = 1; i <= 120; i++) if (p.tick(1000 + (i * 1000) / 120)) changes.push(p.frame)
		expect(p.frame).toBe(30)
		expect(changes).toHaveLength(30)
		expect(changes.slice(0, 3)).toEqual([1, 2, 3])
	})

	it('anchors on the first tick when created playing', () => {
		const p = createPlayback({ frames: 60, fps: 30, playing: true })
		expect(p.tick(5000)).toBe(false)
		expect(p.tick(5500)).toBe(true)
		expect(p.frame).toBe(15)
	})

	it('wraps from the last frame to 0 with loop on', () => {
		const p = createPlayback({ frames: 60, fps: 30 })
		p.play(0)
		p.tick(1966.7)
		expect(p.frame).toBe(59)
		p.tick(2000)
		expect(p.frame).toBe(0)
		expect(p.playing).toBe(true)
		p.tick(2000 + 10 * 1000 + 100)
		expect(p.frame).toBe(3)
	})

	it('stops and pauses on the last frame with loop off', () => {
		const p = createPlayback({ frames: 60, fps: 30, loop: false })
		p.play(0)
		p.tick(1000)
		expect(p.frame).toBe(30)
		expect(p.tick(5000)).toBe(true)
		expect(p.frame).toBe(59)
		expect(p.playing).toBe(false)
		expect(p.tick(6000)).toBe(false)
	})

	it('continues to the end when loop turns off after wrapping', () => {
		const p = createPlayback({ frames: 60, fps: 30 })
		p.play(0)
		p.tick(4500) // 2 loops and 15 frames in
		expect(p.frame).toBe(15)
		p.setLoop(false)
		p.tick(4500 + 500)
		expect(p.frame).toBe(30)
		expect(p.playing).toBe(true)
	})

	it('restarts at 0 when played from the last frame with loop off', () => {
		const p = createPlayback({ frames: 60, fps: 30, loop: false })
		p.seek(59)
		p.play(100)
		expect(p.frame).toBe(0)
		expect(p.playing).toBe(true)
		p.tick(200)
		expect(p.frame).toBe(3)
	})

	it('holds the frame on pause and resumes from it', () => {
		const p = createPlayback({ frames: 225, fps: 30 })
		p.play(0)
		p.tick(1000)
		p.pause()
		expect(p.frame).toBe(30)
		expect(p.tick(9000)).toBe(false)
		expect(p.frame).toBe(30)
		p.toggle(10000)
		expect(p.playing).toBe(true)
		p.tick(10000)
		expect(p.frame).toBe(30)
		p.tick(10100)
		expect(p.frame).toBe(33)
		p.toggle(10200)
		expect(p.playing).toBe(false)
	})

	it.each<[number, number]>([
		[10, 10],
		[10.4, 10],
		[10.6, 11],
		[-3, 0],
		[500, 59],
		[Number.NaN, 0],
		[Number.POSITIVE_INFINITY, 0],
	])('seek(%p) pauses on frame %p', (target, expected) => {
		const p = createPlayback({ frames: 60, fps: 30 })
		p.play(0)
		p.seek(target)
		expect(p.frame).toBe(expected)
		expect(p.playing).toBe(false)
	})

	it('maps every frame boundary back exactly at odd fps', () => {
		const p = createPlayback({ frames: 1000, fps: 24 })
		p.seek(7)
		p.play(123.456)
		p.tick(123.456)
		expect(p.frame).toBe(7)
	})
})
