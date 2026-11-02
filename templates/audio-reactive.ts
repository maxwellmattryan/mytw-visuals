import p5 from 'p5'
import 'p5/lib/addons/p5.sound'
import { SIZES, createCanvas, centerCanvas } from '@lib/layout'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'

const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let mic: p5.AudioIn
	let fft: p5.FFT

	p.setup = () => {
		cnv = createCanvas(p, SIZES.SQUARE)
		cap = createCapture(cnv.elt)
		cap.bindKeys(p)

		mic = new p5.AudioIn()
		mic.start()
		fft = new p5.FFT(0.8, 1024)
		fft.setInput(mic)

		p.background(0)
	}

	p.draw = () => {
		p.background(0)

		const spectrum = fft.analyze()
		const waveform = fft.waveform()

		// --- use spectrum / waveform here ---
		void spectrum
		void waveform

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
