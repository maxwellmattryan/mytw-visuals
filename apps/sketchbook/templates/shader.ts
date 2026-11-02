import p5 from 'p5'
import { SIZES, createWebGLCanvas, centerCanvas } from '@lib/layout'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { VERT_DEFAULT, FRAG_PASSTHROUGH, compileFilterShader } from '@lib/shaders'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'

const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let gfx: p5.Graphics
	let shd: p5.Shader

	p.setup = () => {
		cnv = createWebGLCanvas(p, SIZES.SQUARE)
		cap = createCapture(cnv.elt)
		cap.bindKeys(p)

		gfx = p.createGraphics(SIZES.SQUARE.width, SIZES.SQUARE.height)
		shd = compileFilterShader(p, FRAG_PASSTHROUGH())
	}

	p.draw = () => {
		// Draw scene to offscreen buffer
		gfx.background(0)

		// --- draw to gfx here ---

		// Apply shader as full-screen quad
		p.shader(shd)
		shd.setUniform('uTexture', gfx)
		// shd.setUniform('uTime', p.millis() / 1000.0);
		p.rect(0, 0, p.width, p.height)

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
