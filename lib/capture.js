/**
 * Recording & screenshot helpers using async PNG frame capture.
 *
 * Each frame is copied to an offscreen 2D canvas (sync, fast) then encoded
 * as PNG via toBlob (async, non-blocking). On save, frames are sent to the
 * Vite dev server for automatic MP4 conversion via scripts/convert.sh.
 */

export class SketchCapture {
	constructor(canvas, options = {}) {
		this.canvas = canvas
		this.framerate = options.framerate || 60
		this.recording = false
		this._frames = []
		this._pending = 0
		this._total = 0
		this._buffer = null
		this._bufferCtx = null
		this._indicator = null
	}

	start() {
		if (this.recording) return
		this._frames = []
		this._pending = 0
		this._total = 0
		this._buffer = document.createElement('canvas')
		this._buffer.width = this.canvas.width
		this._buffer.height = this.canvas.height
		this._bufferCtx = this._buffer.getContext('2d')
		this.recording = true
		this._showIndicator()
		console.log('[capture] Recording started')
	}

	capture() {
		if (!this.recording) return
		this._bufferCtx.drawImage(this.canvas, 0, 0)
		const idx = this._total++
		this._pending++
		this._buffer.toBlob((blob) => {
			this._frames[idx] = blob
			this._pending--
		}, 'image/png')
	}

	stop() {
		if (!this.recording) return
		this.recording = false
		this._hideIndicator()
		console.log('[capture] Recording stopped — saving…')
		this._save()
	}

	async _save() {
		while (this._pending > 0) {
			await new Promise((r) => setTimeout(r, 100))
		}

		const count = this._total
		const buffers = await Promise.all(this._frames.map((b) => b.arrayBuffer()))
		const tar = buildTar(buffers, count)
		const name = localTimestamp()

		// Try sending to dev server for auto-conversion, fall back to download
		const url = `/api/capture/convert?fps=${this.framerate}&name=${name}`
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-tar' },
				body: tar,
			})
			const result = await res.json()
			if (result.ok) {
				console.log(`[capture] Saved ${count} frames → ${result.mp4}`)
			} else {
				throw new Error(result.error)
			}
		} catch (err) {
			console.warn('[capture] Dev server unavailable, downloading .tar', err)
			const blob = new Blob([tar], { type: 'application/x-tar' })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `${name}.tar`
			a.click()
			URL.revokeObjectURL(url)
		}

		this._frames = []
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

// ---------------------------------------------------------------------------
// Minimal tar builder — produces a valid POSIX tar archive from PNG blobs
// ---------------------------------------------------------------------------

function buildTar(buffers, count) {
	let totalSize = 0
	for (const buf of buffers) {
		totalSize += 512 + Math.ceil(buf.byteLength / 512) * 512
	}
	totalSize += 1024 // end-of-archive marker

	const tar = new Uint8Array(totalSize)
	let offset = 0

	for (let i = 0; i < count; i++) {
		const data = new Uint8Array(buffers[i])
		const name = String(i).padStart(7, '0') + '.png'
		const header = tarHeader(name, data.byteLength)
		tar.set(header, offset)
		offset += 512
		tar.set(data, offset)
		offset += Math.ceil(data.byteLength / 512) * 512
	}

	return tar
}

function tarHeader(name, size) {
	const h = new Uint8Array(512)
	writeStr(h, 0, name, 100)
	writeStr(h, 100, '0000644\0', 8)
	writeStr(h, 108, '0000000\0', 8)
	writeStr(h, 116, '0000000\0', 8)
	writeStr(h, 124, size.toString(8).padStart(11, '0') + '\0', 12)
	const mtime = Math.floor(Date.now() / 1000)
	writeStr(h, 136, mtime.toString(8).padStart(11, '0') + '\0', 12)
	writeStr(h, 148, '        ', 8) // checksum placeholder
	h[156] = 0x30 // regular file

	let sum = 0
	for (let i = 0; i < 512; i++) sum += h[i]
	writeStr(h, 148, sum.toString(8).padStart(6, '0') + '\0 ', 8)

	return h
}

function writeStr(buf, off, str, len) {
	for (let i = 0; i < len && i < str.length; i++) {
		buf[off + i] = str.charCodeAt(i)
	}
}
