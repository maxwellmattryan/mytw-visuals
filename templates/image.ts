import p5 from 'p5'
import { SIZES, createCanvas, centerCanvas } from '@lib/layout'
import { fitImage } from '@lib/image'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'

const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let img: p5.Image

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
