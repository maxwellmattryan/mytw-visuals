import p5 from 'p5'
import { SIZES, createCanvas, centerCanvas } from '@lib/layout'
import { fitImage } from '@lib/image'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'
import { mountPanel } from '@mytw/panel'
import type { Panel } from '@mytw/panel'
import { defineSchema, param } from '@mytw/schema'

// Add params here; read them from panel.values in draw().
const schema = defineSchema({
	background: param.color({ label: 'Background', default: '#000000' }),
})

const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let img: p5.Image
	let panel: Panel<typeof schema.params>

	p.preload = () => {
		img = p.loadImage('/images/sample.png')
	}

	p.setup = () => {
		cnv = createCanvas(p, SIZES.SQUARE)
		cap = createCapture(cnv.elt)
		cap.bindKeys(p)
		panel = mountPanel(schema)
	}

	p.draw = () => {
		p.background(panel.values.background)
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
