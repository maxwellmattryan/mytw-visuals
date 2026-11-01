import p5 from 'p5'
import { SIZES, createCanvas, centerCanvas } from '@lib/layout'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'

const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture

	p.setup = () => {
		cnv = createCanvas(p, SIZES.SQUARE)
		cap = createCapture(cnv.elt)
		cap.bindKeys(p)
		p.background(0)
	}

	p.draw = () => {
		p.background(0)

		// --- draw here ---

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
