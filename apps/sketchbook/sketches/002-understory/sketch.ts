import p5 from 'p5'
import { SIZES, createWebGLCanvas, centerCanvas } from '@lib/layout'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'
import { LOOP_TARGETS, LoopClock } from '@lib/loop'
import { mountPanel, mountTransport } from '@mytw/panel'
import type { Panel } from '@mytw/panel'
import { understorySchema } from './params'
import { createUnderstoryRenderer } from './render'
import type { UnderstoryRenderer } from './render'

// Understory — the knobs live in ./params.ts and are tuned live in the panel. The
// look itself (shader, transforms, uniforms) lives in ./render.ts, which
// 006-understory-compare shares.

// ---------------------------------------------------------------------------
// Sketch
// ---------------------------------------------------------------------------
const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let img: p5.Image
	let renderer: UnderstoryRenderer
	let panel: Panel<typeof understorySchema.params>
	let clock: LoopClock

	p.preload = () => {
		img = p.loadImage('/images/mytw-002_base.png')
	}

	p.setup = () => {
		cnv = createWebGLCanvas(p, SIZES.STORY)

		renderer = createUnderstoryRenderer(p, img)

		cap = createCapture(cnv.elt)
		cap.bindKeys(p)

		panel = mountPanel(understorySchema)
		const applyFps = (fps: number) => {
			p.frameRate(fps)
			cap.framerate = fps
		}
		applyFps(panel.values.fps)

		// The clock owns the loop phase. The transport pauses, steps and scrubs it,
		// and its Record loop button records exactly one loop from phase 0.
		clock = new LoopClock({ loopFrames: panel.values.loopFrames, fps: panel.values.fps })
		panel.onChange((v, key) => {
			if (key === 'fps' || key === null) {
				applyFps(v.fps)
				clock.setFps(v.fps)
			}
			if (key === 'loopFrames' || key === null) clock.setLoopFrames(v.loopFrames)
		})
		mountTransport(clock, cap, {
			redraw: () => p.redraw(),
			target: LOOP_TARGETS.spotifyCanvas,
		})
	}

	p.draw = () => {
		renderer.draw(panel.values, clock.next())

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
