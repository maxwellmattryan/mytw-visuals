import type { SketchCapture } from '@lib/capture'
import { checkLoopTarget, customTarget, formatSeconds, measureSeam } from '@lib/loop'
import type { LoopClock, LoopTarget, SeamResult } from '@lib/loop'

export type { SeamResult }

/** The parts of `SketchCapture` the transport uses. */
export type TransportCapture = Pick<
	SketchCapture,
	'recording' | 'start' | 'stop' | 'framesCaptured'
>

export interface TransportDeps {
	/** Draws one frame now, so `grab()` can read it. */
	redraw: () => void
	/** Returns the canvas pixels as RGBA, at the same size on every call. */
	grab: () => Uint8ClampedArray
	/** Defaults to `console.log`. */
	log?: (message: string) => void
}

export interface TransportStatus {
	text: string
	tone: 'info' | 'warn' | 'error'
}

export interface TransportController {
	readonly clock: LoopClock
	/** The last result of Record loop or Check seam. */
	readonly status: TransportStatus | null
	/** The current target, or `null` for none or an invalid Custom value. */
	readonly target: LoopTarget | null
	/** Why the Custom value is invalid, or `null`. */
	readonly customError: string | null
	/** A warning when the loop length is outside the target. */
	readonly targetWarning: string | null
	/** Whether a Record loop recording is starting or running. */
	readonly loopRecording: boolean
	/** Whether any recording (Record loop or hold-R) is starting or running. */
	readonly recording: boolean
	/** `Frame 12 / 225`, 0-based. */
	readonly frameLabel: string
	/** `Frame 12 of 225`, for the scrub's `aria-valuetext`. */
	readonly frameValueText: string
	/** `225 frames · 7.50 s at 30 fps`. */
	readonly loopLabel: string
	togglePlay(): void
	/** Pauses and moves one frame. Does nothing while recording. */
	step(delta: number): void
	/** Pauses and seeks. Does nothing while recording. */
	scrub(frame: number): void
	/** Records exactly one loop from frame 0. */
	recordLoop(): Promise<void>
	/** Compares the seam with the steps next to it. Returns `null` while recording. */
	checkSeam(): SeamResult | null
	setTarget(target: LoopTarget | null): void
	/** Sets a Custom max length from typed text. Returns the error text, or `null` when valid. */
	setCustomSeconds(text: string): string | null
	/** Call once per animation frame. Notifies only when the frame or the recording changed. */
	poll(): void
	/** Listens for changes. Returns a function that stops listening. */
	subscribe(fn: () => void): () => void
	destroy(): void
}

export const RECORD_FAILED = "Couldn't start recording. Is yarn dev running?"
export const RECORD_CANCELLED = 'Recording stopped: loop length or FPS changed.'
export const CUSTOM_SECONDS_ERROR = 'Enter a number above 0'

type Phase = 'idle' | 'starting' | 'recording'

/** The logic behind the transport bar, with no DOM, so it can be tested with fakes. */
export function createTransport(
	clock: LoopClock,
	capture: TransportCapture,
	deps: TransportDeps,
	initialTarget: LoopTarget | null
): TransportController {
	const log = deps.log ?? ((message: string) => console.log(message))
	const listeners = new Set<() => void>()
	let status: TransportStatus | null = null
	let target = initialTarget
	let customError: string | null = null
	let phase: Phase = 'idle'
	/** The loop length and FPS a Record loop started with. */
	let recordedLoop = { frames: 0, fps: 0 }
	let destroyed = false
	let seen = { frame: clock.frame, recording: capture.recording, captured: capture.framesCaptured }

	const notify = () => {
		if (destroyed) return
		for (const fn of [...listeners]) fn()
	}

	const busy = () => capture.recording || phase !== 'idle'

	const recordingStatus = (): TransportStatus => ({
		text: `Recording ${capture.framesCaptured} / ${recordedLoop.frames}`,
		tone: 'info',
	})

	const stopClock = clock.onChange(() => {
		if (
			phase !== 'idle' &&
			(clock.loopFrames !== recordedLoop.frames || clock.fps !== recordedLoop.fps)
		) {
			phase = 'idle'
			capture.stop()
			status = { text: RECORD_CANCELLED, tone: 'warn' }
		}
		notify()
	})

	return {
		clock,
		get status() {
			return status
		},
		get target() {
			return target
		},
		get customError() {
			return customError
		},
		get targetWarning() {
			return customError === null ? checkLoopTarget(clock.seconds, target) : null
		},
		get loopRecording() {
			return phase !== 'idle'
		},
		get recording() {
			return busy()
		},
		get frameLabel() {
			return `Frame ${clock.frame} / ${clock.loopFrames}`
		},
		get frameValueText() {
			return `Frame ${clock.frame} of ${clock.loopFrames}`
		},
		get loopLabel() {
			const seconds = formatSeconds(clock.loopFrames, clock.fps)
			return `${clock.loopFrames} frames · ${seconds} s at ${clock.fps} fps`
		},

		togglePlay() {
			if (phase === 'idle') clock.toggle()
		},

		step(delta) {
			if (!busy()) clock.step(delta)
		},

		scrub(frame) {
			if (busy()) return
			clock.pause()
			clock.seek(frame)
		},

		async recordLoop() {
			if (destroyed || busy()) return
			recordedLoop = { frames: clock.loopFrames, fps: clock.fps }
			phase = 'starting'
			status = null
			notify()
			await capture.start({ frameLimit: recordedLoop.frames })
			if (phase !== 'starting' || destroyed) {
				// Cancelled by a loop change, or destroyed, while the session started.
				if (capture.recording) capture.stop()
				return
			}
			if (!capture.recording) {
				phase = 'idle'
				status = { text: RECORD_FAILED, tone: 'error' }
				notify()
				return
			}
			phase = 'recording'
			status = recordingStatus()
			// The first frame drawn from here is frame 0, and it is the first one captured.
			clock.seek(0)
			clock.play()
		},

		checkSeam() {
			if (destroyed || busy()) return null
			const frame = clock.frame
			const wasPlaying = clock.playing
			clock.pause()
			const n = clock.loopFrames
			const at = (f: number) => {
				clock.seek(((f % n) + n) % n)
				deps.redraw()
				return deps.grab()
			}
			const beforeLast = at(n - 2)
			const last = at(n - 1)
			const first = at(0)
			const second = at(1)
			const result = measureSeam({ beforeLast, last, first, second })

			clock.seek(frame)
			if (wasPlaying) clock.play()
			deps.redraw()

			const values = `${result.seam.toFixed(1)} vs step ${result.step.toFixed(1)}`
			const verdict = result.verdict === 'seamless' ? 'seamless.' : 'the loop jumps at the seam.'
			status = {
				text: `Seam ${values}: ${verdict}`,
				tone: result.verdict === 'seamless' ? 'info' : 'warn',
			}
			log(`[transport] seam ${values}: ${result.verdict}`)
			notify()
			return result
		},

		setTarget(next) {
			target = next
			customError = null
			notify()
		},

		setCustomSeconds(text) {
			const trimmed = text.trim()
			const value = Number(trimmed)
			if (trimmed === '' || !Number.isFinite(value) || value <= 0) {
				target = null
				customError = CUSTOM_SECONDS_ERROR
			} else {
				target = customTarget(value)
				customError = null
			}
			notify()
			return customError
		},

		poll() {
			if (destroyed) return
			if (phase === 'recording') {
				if (!capture.recording) {
					phase = 'idle'
					status = {
						text: `Recorded ${capture.framesCaptured} frames. See the console for the folder.`,
						tone: 'info',
					}
				} else if (capture.framesCaptured !== seen.captured) {
					status = recordingStatus()
				}
			}
			const now = {
				frame: clock.frame,
				recording: capture.recording,
				captured: capture.framesCaptured,
			}
			const changed =
				now.frame !== seen.frame ||
				now.recording !== seen.recording ||
				now.captured !== seen.captured
			seen = now
			if (changed) notify()
		},

		subscribe(fn) {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},

		destroy() {
			if (destroyed) return
			destroyed = true
			stopClock()
			listeners.clear()
		},
	}
}
