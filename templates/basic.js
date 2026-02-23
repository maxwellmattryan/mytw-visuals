import p5 from 'p5'
import { SIZES, createCanvas, centerCanvas } from '@lib/layout.js'
import { createCapture } from '@lib/capture.js'

const sketch = (p) => {
	let cnv
	let cap

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
