/**
 * A loop clock: the frame index and play state of a looping sketch.
 *
 * A sketch calls `next()` once at the top of `draw()` and draws the phase it
 * returns. The clock never reads `p.frameCount`, so pausing, stepping and
 * seeking work, and a recording can start exactly at phase 0.
 */

export interface LoopClockOptions {
	/** Frames in one loop. Rounded to an integer of at least 1. */
	loopFrames: number
	/** Frames per second, used for the loop length in seconds. */
	fps: number
	/** Defaults to `true`. */
	playing?: boolean
}

export class LoopClock {
	private _loopFrames: number
	private _fps: number
	private _frame = 0
	private _playing: boolean
	/** Whether the current frame has been drawn. `next()` advances only after it has. */
	private _drawn = false
	private _listeners = new Set<() => void>()

	constructor({ loopFrames, fps, playing = true }: LoopClockOptions) {
		this._loopFrames = toFrameCount(loopFrames)
		this._fps = isValidFps(fps) ? fps : 60
		this._playing = playing
	}

	get loopFrames(): number {
		return this._loopFrames
	}

	get fps(): number {
		return this._fps
	}

	/** The 0-based index of the current frame. */
	get frame(): number {
		return this._frame
	}

	get playing(): boolean {
		return this._playing
	}

	/** The current frame's loop phase, in [0, 1). */
	get phase(): number {
		return this._frame / this._loopFrames
	}

	/** The loop length in seconds. */
	get seconds(): number {
		return this._loopFrames / this._fps
	}

	/**
	 * Returns the phase of the frame to draw now. While playing, it advances one
	 * frame from the last drawn one. Paused, or right after a seek or step, it
	 * returns the current frame.
	 */
	next(): number {
		if (this._playing && this._drawn) this._frame = (this._frame + 1) % this._loopFrames
		this._drawn = true
		return this.phase
	}

	play(): void {
		if (this._playing) return
		this._playing = true
		this._emit()
	}

	pause(): void {
		if (!this._playing) return
		this._playing = false
		this._emit()
	}

	toggle(): void {
		if (this._playing) this.pause()
		else this.play()
	}

	/** Pauses and moves `delta` frames, wrapping at both ends. */
	step(delta = 1): void {
		this._playing = false
		this._seekFrame(this._frame + Math.round(delta))
	}

	/** Moves to a frame, rounded and wrapped into the loop. The next `next()` returns it. */
	seek(frame: number): void {
		this._seekFrame(Math.round(frame))
	}

	/** Moves to the frame nearest a phase in [0, 1). */
	seekPhase(phase: number): void {
		this.seek(Math.round(phase * this._loopFrames))
	}

	/** Changes the loop length and keeps the phase, so frame 100 of 200 becomes 50 of 100. */
	setLoopFrames(n: number): void {
		const frames = toFrameCount(n)
		// The same length again (a panel reset or snapshot load) must not repeat a frame.
		if (frames === this._loopFrames) return
		this._frame = Math.round(this.phase * frames) % frames
		this._loopFrames = frames
		this._drawn = false
		this._emit()
	}

	/** Ignores values that are not finite or not above 0. */
	setFps(fps: number): void {
		if (!isValidFps(fps)) return
		this._fps = fps
		this._emit()
	}

	/** Listens for play, pause, seek, step and set calls. Returns a function that stops listening. */
	onChange(fn: () => void): () => void {
		this._listeners.add(fn)
		return () => {
			this._listeners.delete(fn)
		}
	}

	private _seekFrame(frame: number): void {
		const n = this._loopFrames
		this._frame = Number.isFinite(frame) ? ((frame % n) + n) % n : 0
		this._drawn = false
		this._emit()
	}

	private _emit(): void {
		for (const fn of [...this._listeners]) fn()
	}
}

function toFrameCount(n: number): number {
	return Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1
}

function isValidFps(fps: number): boolean {
	return Number.isFinite(fps) && fps > 0
}
