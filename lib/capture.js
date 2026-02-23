/**
 * Recording & screenshot helpers wrapping CCapture.js.
 */

import CCapture from 'ccapture.js-npmfixed'

export class SketchCapture {
	constructor(canvas, options = {}) {
		this.canvas = canvas
		this.format = options.format || 'webm'
		this.framerate = options.framerate || 60
		this.quality = options.quality || 100
		this.recording = false
		this.capturer = null
		this._indicator = null
	}

	_createCapturer() {
		this.capturer = new CCapture({
			format: this.format,
			framerate: this.framerate,
			quality: this.quality,
			verbose: false,
		})
	}

	start() {
		if (this.recording) return
		this._createCapturer()
		this.capturer.start()
		this.recording = true
		this._showIndicator()
		console.log('[capture] Recording started')
	}

	capture() {
		if (!this.recording || !this.capturer) return
		this.capturer.capture(this.canvas)
	}

	stop() {
		if (!this.recording || !this.capturer) return
		this.capturer.stop()
		this.capturer.save()
		this.recording = false
		this.capturer = null
		this._hideIndicator()
		console.log('[capture] Recording stopped — saving…')
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
	 * Bind keyboard shortcuts: R = toggle recording, S = screenshot.
	 * Wraps existing p.keyPressed rather than replacing it.
	 */
	bindKeys(p) {
		const existing = p.keyPressed ? p.keyPressed.bind(p) : null
		p.keyPressed = () => {
			if (p.key === 'r' || p.key === 'R') {
				this.recording ? this.stop() : this.start()
			}
			if (p.key === 's' || p.key === 'S') {
				this.screenshot(p)
			}
			if (existing) existing()
		}
	}
}

/** Factory function for creating a capture instance. */
export function createCapture(canvas, options = {}) {
	return new SketchCapture(canvas, options)
}
