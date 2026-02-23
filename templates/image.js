import p5 from 'p5'
import { SIZES, createCanvas, centerCanvas } from '@lib/layout.js'
import { fitImage } from '@lib/image.js'
import { createCapture } from '@lib/capture.js'

const sketch = (p) => {
	let cnv
	let cap
	let img

	p.preload = () => {
		img = p.loadImage('/images/sample.png')
	}

	p.setup = () => {
		cnv = createCanvas(p, SIZES.SQUARE)
		cap = createCapture(cnv.elt)
		cap.bindKeys(p)
	}

	p.draw = () => {
		p.background(0)
		fitImage(p, img)

		// --- pixel manipulation here ---
		// img.loadPixels();
		// ...
		// img.updatePixels();

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
