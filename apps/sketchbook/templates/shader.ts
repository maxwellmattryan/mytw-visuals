import p5 from 'p5'
import { SIZES, createWebGLCanvas, centerCanvas } from '@lib/layout'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { VERT_DEFAULT, compileFilterShader } from '@lib/shaders'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'
import { mountPanel } from '@mytw/panel'
import type { Panel } from '@mytw/panel'
import { defineSchema, param } from '@mytw/schema'

// Passthrough fragment shader (GLSL ES 1.00, as p5 expects). Edit it to add an effect.
const FRAG = `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;

void main() {
  gl_FragColor = texture2D(uTexture, vTexCoord);
}
`

// Add params here; read them from panel.values in draw().
const schema = defineSchema({
	background: param.color({ label: 'Background', default: '#000000' }),
})

const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let gfx: p5.Graphics
	let shd: p5.Shader
	let panel: Panel<typeof schema.params>

	p.setup = () => {
		cnv = createWebGLCanvas(p, SIZES.SQUARE)
		cap = createCapture(cnv.elt)
		cap.bindKeys(p)
		panel = mountPanel(schema)

		gfx = p.createGraphics(SIZES.SQUARE.width, SIZES.SQUARE.height)
		shd = compileFilterShader(p, FRAG)
	}

	p.draw = () => {
		// Draw scene to offscreen buffer
		gfx.background(panel.values.background)

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
