/**
 * Recording & screenshot helpers using streamed PNG frame capture.
 *
 * Each frame is copied to an offscreen 2D canvas (sync, fast) then encoded
 * as PNG via toBlob (async, non-blocking). The blob is immediately POSTed
 * to the Vite dev server and discarded — browser memory stays constant
 * regardless of recording length.
 */

import type p5 from 'p5'

export interface CaptureOptions {
	framerate?: number
}

export interface StartOptions {
	/** Stop on its own after this many frames. Omit it to record until `stop()`. */
	frameLimit?: number
}

export class SketchCapture {
	canvas: HTMLCanvasElement
	framerate: number
	recording: boolean
	/** Why the last `start()` failed, or `null` when it succeeded or hasn't run. */
	startError: string | null
	private _session: string | null
	private _pending: number
	private _total: number
	private _frameLimit: number | null
	private _buffer: HTMLCanvasElement | null
	private _bufferCtx: CanvasRenderingContext2D | null
	private _indicator: HTMLDivElement | null
	private _flushing: Promise<void> | null

	constructor(canvas: HTMLCanvasElement, options: CaptureOptions = {}) {
		this.canvas = canvas
		this.framerate = options.framerate || 60
		this.recording = false
		this.startError = null
		this._session = null
		this._pending = 0
		this._total = 0
		this._frameLimit = null
		this._buffer = null
		this._bufferCtx = null
		this._indicator = null
		this._flushing = null
	}

	/** Frames captured by the current recording, or by the last one until the next `start()`. */
	get framesCaptured(): number {
		return this._total
	}

	/** The current recording's frame limit, or `null` when it runs until `stop()`. */
	get frameLimit(): number | null {
		return this._frameLimit
	}

	/** Resolves once the last recording's frames are uploaded and its session is closed. */
	flushed(): Promise<void> {
		return this._flushing ?? Promise.resolve()
	}

	async start(options: StartOptions = {}) {
		if (this.recording) return
		// The previous session's flush still uses the shared session state, so let it finish first.
		await this.flushed()
		if (this.recording) return
		this._session = localTimestamp()
		this.startError = null
		this._pending = 0
		this._total = 0
		const limit = options.frameLimit
		this._frameLimit =
			limit !== undefined && Number.isFinite(limit) ? Math.max(1, Math.round(limit)) : null
		this._buffer = document.createElement('canvas')
		this._buffer.width = this.canvas.width
		this._buffer.height = this.canvas.height
		this._bufferCtx = this._buffer.getContext('2d')

		try {
			const url = `/api/capture/start?session=${this._session}&fps=${this.framerate}`
			const res = await fetch(url, { method: 'POST' })
			const result = await res.json()
			if (!result.ok) throw new Error(result.error)
		} catch (err) {
			console.error('[capture] Failed to start session — is the dev server running?', err)
			const reason = err instanceof Error ? err.message : String(err)
			this.startError = `Failed to start session — is the dev server running? (${reason})`
			this._session = null
			this._frameLimit = null
			this._buffer = null
			this._bufferCtx = null
			return
		}

		this.recording = true
		this._showIndicator()
		console.log(`[capture] Recording started (session: ${this._session})`)
	}

	capture() {
		if (!this.recording) return
		// Both are set whenever recording is true.
		this._bufferCtx!.drawImage(this.canvas, 0, 0)
		const frame = this._total++
		this._pending++
		this._buffer!.toBlob((blob) => {
			const url = `/api/capture/frame?session=${this._session}&frame=${frame}`
			fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'image/png' },
				body: blob,
			})
				.then((res) => {
					if (!res.ok) console.warn(`[capture] Frame ${frame} upload failed`)
				})
				.catch((err) => {
					console.warn(`[capture] Frame ${frame} upload error`, err)
				})
				.finally(() => {
					this._pending--
				})
		}, 'image/png')
		if (this._frameLimit !== null && this._total >= this._frameLimit) this.stop()
	}

	stop() {
		if (!this.recording) return
		this.recording = false
		this._frameLimit = null
		this._hideIndicator()
		console.log('[capture] Recording stopped — flushing frames…')
		const flushing = this._finish().finally(() => {
			if (this._flushing === flushing) this._flushing = null
		})
		this._flushing = flushing
	}

	async _finish() {
		while (this._pending > 0) {
			await new Promise((r) => setTimeout(r, 100))
		}

		try {
			const url = `/api/capture/stop?session=${this._session}`
			const res = await fetch(url, { method: 'POST' })
			const result = await res.json()
			if (result.ok) {
				console.log(`[capture] ${this._total} frames saved to ${result.dir}`)
				console.log(`[capture] Convert with: yarn convert "${result.dir}"`)
			} else {
				console.error('[capture] Stop failed:', result.error)
			}
		} catch (err) {
			console.error('[capture] Failed to finalize session', err)
		}

		this._session = null
		this._frameLimit = null
		this._buffer = null
		this._bufferCtx = null
	}

	screenshot(p: p5) {
		p.saveCanvas('screenshot', 'png')
		console.log('[capture] Screenshot saved')
	}

	_showIndicator() {
		if (this._indicator) return
		const dot = document.createElement('div')
		dot.id = 'capture-indicator'
		dot.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 9999;
      width: 16px; height: 16px; border-radius: 50%;
      background: #ff0000; animation: capture-pulse 1s ease-in-out infinite;
    `
		const style = document.createElement('style')
		style.textContent = `
      @keyframes capture-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `
		document.head.appendChild(style)
		document.body.appendChild(dot)
		this._indicator = dot
	}

	_hideIndicator() {
		if (this._indicator) {
			this._indicator.remove()
			this._indicator = null
		}
	}

	/**
	 * Bind keyboard shortcuts: hold R = record, S = screenshot.
	 * Wraps existing p.keyPressed/p.keyReleased rather than replacing them.
	 * R and S are ignored while focus is in an editable element, such as a panel text field.
	 */
	bindKeys(p: p5) {
		const existingPressed = p.keyPressed ? p.keyPressed.bind(p) : null
		p.keyPressed = () => {
			if (!isTypingTarget(globalThis.document?.activeElement)) {
				if (p.key === 'r' || p.key === 'R') this.start()
				if (p.key === 's' || p.key === 'S') this.screenshot(p)
			}
			if (existingPressed) existingPressed()
		}

		const existingReleased = p.keyReleased ? p.keyReleased.bind(p) : null
		p.keyReleased = () => {
			if (p.key === 'r' || p.key === 'R') this.stop()
			if (existingReleased) existingReleased()
		}
	}
}

/** Factory function for creating a capture instance. */
export function createCapture(
	canvas: HTMLCanvasElement,
	options: CaptureOptions = {}
): SketchCapture {
	return new SketchCapture(canvas, options)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Whether an element takes typed input: an input, textarea, select or contenteditable element.
 * Duck-typed so it runs without a DOM.
 */
export function isTypingTarget(el: unknown): boolean {
	if (typeof el !== 'object' || el === null) return false
	const { tagName, isContentEditable } = el as { tagName?: unknown; isContentEditable?: unknown }
	return (
		(typeof tagName === 'string' && TYPING_TAGS.has(tagName.toUpperCase())) ||
		isContentEditable === true
	)
}

export function localTimestamp() {
	const d = new Date()
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}
