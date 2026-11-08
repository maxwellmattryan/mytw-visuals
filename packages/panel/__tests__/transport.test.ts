import { describe, expect, it, jest } from '@jest/globals'

import { LOOP_TARGETS, LoopClock } from '@lib/loop'

import {
	createTransport,
	CUSTOM_SECONDS_ERROR,
	RECORD_CANCELLED,
	RECORD_FAILED,
} from '../transport'
import type { TransportCapture } from '../transport'

/** A capture that records only in memory. `startOk` decides whether `start` succeeds. */
function fakeCapture(startOk = true) {
	const capture = {
		recording: false,
		framesCaptured: 0,
		start: jest.fn(async (_options?: { frameLimit?: number }) => {
			if (!startOk) return
			capture.recording = true
			capture.framesCaptured = 0
		}),
		stop: jest.fn(() => {
			capture.recording = false
		}),
	}
	return capture satisfies TransportCapture
}

/** Pixels whose every channel is `value`. */
function frameOf(value: number): Uint8ClampedArray {
	return new Uint8ClampedArray([value, value, value, 255, value, value, value, 255])
}

/**
 * A sketch that draws through the clock as `p.redraw()` would. `pixel(frame)` sets what
 * each frame looks like, and `drawn` lists the frames drawn.
 */
function fakeSketch(clock: LoopClock, pixel: (frame: number) => number) {
	const drawn: number[] = []
	let current = frameOf(0)
	const redraw = jest.fn(() => {
		clock.next()
		drawn.push(clock.frame)
		current = frameOf(pixel(clock.frame))
	})
	const grab = jest.fn(() => current)
	return { drawn, redraw, grab, log: jest.fn((_message: string) => {}) }
}

function setup(options: { loopFrames?: number; startOk?: boolean } = {}) {
	const clock = new LoopClock({ loopFrames: options.loopFrames ?? 10, fps: 30 })
	const capture = fakeCapture(options.startOk)
	const sketch = fakeSketch(clock, (frame) => frame * 2)
	const transport = createTransport(clock, capture, sketch, null)
	return { clock, capture, sketch, transport }
}

describe('createTransport recordLoop', () => {
	it('starts capture with one loop of frames, then seeks to 0 and plays', async () => {
		const { clock, capture, transport } = setup()
		clock.seek(6)
		clock.pause()
		let frameWhenStarted = -1
		capture.start.mockImplementation(async () => {
			frameWhenStarted = clock.frame
			capture.recording = true
		})

		await transport.recordLoop()

		expect(capture.start).toHaveBeenCalledWith({ frameLimit: 10 })
		expect(frameWhenStarted).toBe(6)
		expect(clock.frame).toBe(0)
		expect(clock.playing).toBe(true)
		expect(clock.next()).toBe(0)
		expect(transport.loopRecording).toBe(true)
		expect(transport.status).toEqual({ text: 'Recording 0 / 10', tone: 'info' })
	})

	it('reports progress and the end of the recording from poll()', async () => {
		const { capture, transport } = setup()
		const listener = jest.fn()
		transport.subscribe(listener)
		await transport.recordLoop()
		transport.poll()

		// Nothing changed since the last poll.
		listener.mockClear()
		transport.poll()
		expect(listener).not.toHaveBeenCalled()

		capture.framesCaptured = 4
		transport.poll()
		expect(transport.status?.text).toBe('Recording 4 / 10')
		expect(listener).toHaveBeenCalledTimes(1)

		capture.framesCaptured = 10
		capture.recording = false
		transport.poll()
		expect(transport.status).toEqual({
			text: 'Recorded 10 frames. See the console for the folder.',
			tone: 'info',
		})
		expect(transport.loopRecording).toBe(false)
	})

	it('leaves the clock alone and reports an error when capture fails to start', async () => {
		const { clock, capture, transport } = setup({ startOk: false })
		clock.seek(6)
		clock.pause()
		const onChange = jest.fn()
		clock.onChange(onChange)

		await transport.recordLoop()

		expect(capture.start).toHaveBeenCalledTimes(1)
		expect(onChange).not.toHaveBeenCalled()
		expect(clock.frame).toBe(6)
		expect(clock.playing).toBe(false)
		expect(transport.status).toEqual({ text: RECORD_FAILED, tone: 'error' })
		expect(transport.loopRecording).toBe(false)
	})

	it.each([
		['loop length', (clock: LoopClock) => clock.setLoopFrames(20)],
		['FPS', (clock: LoopClock) => clock.setFps(24)],
	])('stops capture when the %s changes during a recording', async (_name, change) => {
		const { clock, capture, transport } = setup()
		await transport.recordLoop()

		change(clock)

		expect(capture.stop).toHaveBeenCalledTimes(1)
		expect(transport.status).toEqual({ text: RECORD_CANCELLED, tone: 'warn' })
		expect(transport.loopRecording).toBe(false)
		transport.poll()
		expect(transport.status?.text).toBe(RECORD_CANCELLED)
	})

	it('stops capture when the loop changes while the session is starting', async () => {
		const { clock, capture, transport } = setup()
		const recording = transport.recordLoop()
		clock.setLoopFrames(20)
		await recording

		expect(capture.recording).toBe(false)
		expect(capture.stop).toHaveBeenCalled()
		expect(transport.status?.text).toBe(RECORD_CANCELLED)
	})

	it('ignores play, step and scrub and a second start while recording', async () => {
		const { clock, capture, transport } = setup()
		await transport.recordLoop()

		transport.togglePlay()
		transport.step(1)
		transport.scrub(5)
		await transport.recordLoop()

		expect(clock.playing).toBe(true)
		expect(clock.frame).toBe(0)
		expect(capture.start).toHaveBeenCalledTimes(1)
	})

	it('does not start while a hold-R recording runs', async () => {
		const { capture, transport } = setup()
		capture.recording = true
		await transport.recordLoop()
		expect(capture.start).not.toHaveBeenCalled()
	})
})

describe('createTransport checkSeam', () => {
	it('redraws frames N-2, N-1, 0 and 1, then restores the frame and play state', () => {
		const { clock, sketch, transport } = setup()
		clock.seek(4)
		clock.next()

		const result = transport.checkSeam()

		expect(sketch.drawn).toEqual([8, 9, 0, 1, 4])
		expect(clock.frame).toBe(4)
		expect(clock.playing).toBe(true)
		// Pixels are frame * 2: the seam jumps 18, each step is 2.
		expect(result).toEqual({ seam: 18, step: 2, verdict: 'seam' })
		expect(transport.status).toEqual({
			text: 'Seam 18.0 vs step 2.0: the loop jumps at the seam.',
			tone: 'warn',
		})
		expect(sketch.log).toHaveBeenCalledWith('[transport] seam 18.0 vs step 2.0: seam')
	})

	it('reports a seamless loop and keeps a paused clock paused', () => {
		const clock = new LoopClock({ loopFrames: 4, fps: 30 })
		const sketch = fakeSketch(clock, (frame) => [100, 101, 101, 100][frame])
		const transport = createTransport(clock, fakeCapture(), sketch, null)
		clock.seek(2)
		clock.pause()

		const result = transport.checkSeam()

		expect(sketch.drawn).toEqual([2, 3, 0, 1, 2])
		expect(clock.playing).toBe(false)
		expect(result?.verdict).toBe('seamless')
		expect(transport.status).toEqual({ text: 'Seam 0.0 vs step 1.0: seamless.', tone: 'info' })
	})

	it('does nothing while capture is recording', () => {
		const { clock, capture, sketch, transport } = setup()
		clock.seek(3)
		capture.recording = true

		expect(transport.checkSeam()).toBeNull()
		expect(sketch.redraw).not.toHaveBeenCalled()
		expect(clock.frame).toBe(3)
		expect(transport.status).toBeNull()
	})
})

describe('createTransport target', () => {
	it('warns when the loop leaves the target range and updates on loop changes', () => {
		const clock = new LoopClock({ loopFrames: 225, fps: 30 })
		const transport = createTransport(
			clock,
			fakeCapture(),
			fakeSketch(clock, () => 0),
			LOOP_TARGETS.spotifyCanvas
		)
		expect(transport.loopLabel).toBe('225 frames · 7.50 s at 30 fps')
		expect(transport.targetWarning).toBeNull()

		clock.setLoopFrames(300)
		expect(transport.targetWarning).toBe('Loop is 10.00 s, over the 8 s Spotify Canvas limit.')

		transport.setTarget(null)
		expect(transport.targetWarning).toBeNull()
	})

	it('validates Custom seconds and shows no warning until they are valid', () => {
		const { transport } = setup({ loopFrames: 360 })
		expect(transport.setCustomSeconds('abc')).toBe(CUSTOM_SECONDS_ERROR)
		expect(transport.setCustomSeconds('0')).toBe(CUSTOM_SECONDS_ERROR)
		expect(transport.setCustomSeconds('')).toBe(CUSTOM_SECONDS_ERROR)
		expect(transport.customError).toBe(CUSTOM_SECONDS_ERROR)
		expect(transport.targetWarning).toBeNull()

		expect(transport.setCustomSeconds('10')).toBeNull()
		expect(transport.customError).toBeNull()
		expect(transport.targetWarning).toBe('Loop is 12.00 s, over the 10 s target.')
	})
})

describe('createTransport labels and controls', () => {
	it('labels the frame 0-based and pauses on scrub', () => {
		const { clock, transport } = setup({ loopFrames: 225 })
		transport.scrub(224)
		expect(clock.playing).toBe(false)
		expect(transport.frameLabel).toBe('Frame 224 / 225')
		expect(transport.frameValueText).toBe('Frame 224 of 225')
	})

	it('notifies on clock changes and stops after destroy', () => {
		const { clock, transport } = setup()
		const listener = jest.fn()
		transport.subscribe(listener)
		transport.step(-1)
		expect(clock.frame).toBe(9)
		expect(listener).toHaveBeenCalledTimes(1)

		transport.destroy()
		clock.play()
		transport.poll()
		expect(listener).toHaveBeenCalledTimes(1)
	})
})
