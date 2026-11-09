/**
 * The editor's transport: which frame is showing and whether it advances. Time is wall-clock
 * (the `now` passed in, a rAF timestamp in ms), so a project plays at its own fps on any display.
 * View state only: it is never part of the document and never undoable.
 */
export interface Playback {
	readonly frames: number
	readonly fps: number
	/** The 0-based frame showing, in `[0, frames − 1]`. */
	readonly frame: number
	readonly playing: boolean
	readonly loop: boolean
	/** Starts from the current frame. From the last frame with loop off, restarts at 0. */
	play(now: number): void
	/** Holds the current frame. */
	pause(): void
	toggle(now: number): void
	/** Pauses and shows `frame`, rounded and clamped. A non-finite frame becomes 0. */
	seek(frame: number): void
	setLoop(on: boolean): void
	/** Advances to the frame for `now`. Returns whether `frame` changed. */
	tick(now: number): boolean
}

export interface PlaybackOptions {
	readonly frames: number
	readonly fps: number
	/** Default `true`. */
	readonly loop?: boolean
	/** Default `false`. Starts at the first `tick`, or the first `play`. */
	readonly playing?: boolean
}

/** Absorbs float error, so `now − frame·1000/fps` maps back to `frame` exactly. */
const EPSILON = 1e-6

export function createPlayback(options: PlaybackOptions): Playback {
	const { frames, fps } = options
	if (!Number.isInteger(frames) || frames < 1)
		throw new RangeError(`frames must be a positive integer, got ${frames}`)
	if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`fps must be positive, got ${fps}`)

	const msPerFrame = 1000 / fps
	let frame = 0
	let playing = options.playing ?? false
	let loop = options.loop ?? true
	// The time at which frame 0 would have shown. `null` until the first tick or play anchors it.
	let anchor: number | null = null

	const play = (now: number) => {
		if (playing && anchor !== null) return
		if (!loop && frame >= frames - 1) frame = 0
		anchor = now - frame * msPerFrame
		playing = true
	}

	const pause = () => {
		playing = false
		anchor = null
	}

	return {
		frames,
		fps,
		get frame() {
			return frame
		},
		get playing() {
			return playing
		},
		get loop() {
			return loop
		},
		play,
		pause,
		toggle(now) {
			if (playing) pause()
			else play(now)
		},
		seek(target) {
			pause()
			frame = Number.isFinite(target) ? Math.min(frames - 1, Math.max(0, Math.round(target))) : 0
		},
		setLoop(on) {
			loop = on
		},
		tick(now) {
			if (!playing) return false
			if (anchor === null) {
				anchor = now - frame * msPerFrame
				return false
			}
			const before = frame
			const f = Math.max(0, Math.floor(((now - anchor) * fps) / 1000 + EPSILON))
			if (loop) {
				const wraps = Math.floor(f / frames)
				// Keep the anchor within one loop, so turning loop off mid-play continues to the end.
				if (wraps > 0) anchor += wraps * frames * msPerFrame
				frame = f % frames
			} else if (f >= frames - 1) {
				frame = frames - 1
				pause()
			} else {
				frame = f
			}
			return frame !== before
		},
	}
}
