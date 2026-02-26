/**
 * Recording & screenshot helpers using streamed PNG frame capture.
 *
 * Each frame is copied to an offscreen 2D canvas (sync, fast) then encoded
 * as PNG via toBlob (async, non-blocking). The blob is immediately POSTed
 * to the Vite dev server and discarded — browser memory stays constant
 * regardless of recording length.
 */

export class SketchCapture {
	constructor(canvas, options = {}) {
		this.canvas = canvas
		this.framerate = options.framerate || 60
		this.recording = false
		this._session = null
		this._pending = 0
		this._total = 0
		this._buffer = null
		this._bufferCtx = null
		this._indicator = null
	}

	async start() {
		if (this.recording) return
		this._session = localTimestamp()
		this._pending = 0
		this._total = 0
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
			this._session = null
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
		this._bufferCtx.drawImage(this.canvas, 0, 0)
		const frame = this._total++
		this._pending++
		this._buffer.toBlob((blob) => {
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
	}

	stop() {
		if (!this.recording) return
		this.recording = false
		this._hideIndicator()
		console.log('[capture] Recording stopped — flushing frames…')
		this._finish()
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
				console.log(`[capture] Convert with: ./scripts/convert.sh "${result.dir}"`)
			} else {
				console.error('[capture] Stop failed:', result.error)
			}
		} catch (err) {
			console.error('[capture] Failed to finalize session', err)
		}

		this._session = null
		this._total = 0
		this._buffer = null
		this._bufferCtx = null
	}

	screenshot(p) {
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
	 */
	bindKeys(p) {
		const existingPressed = p.keyPressed ? p.keyPressed.bind(p) : null
		p.keyPressed = () => {
			if (p.key === 'r' || p.key === 'R') this.start()
			if (p.key === 's' || p.key === 'S') this.screenshot(p)
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
export function createCapture(canvas, options = {}) {
	return new SketchCapture(canvas, options)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localTimestamp() {
	const d = new Date()
	const pad = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}
