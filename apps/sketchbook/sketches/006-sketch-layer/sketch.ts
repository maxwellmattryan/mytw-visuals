import { createRenderer } from '@mytw/engine'
import type { RenderFrame } from '@mytw/engine'
import { assembleFragment, getEffect, uniformValues } from '@mytw/fx'
import { mountPanel } from '@mytw/panel'
import { loadSketchRuntime } from '@mytw/sketch'
import { LoopClock } from '@lib/loop'
import { basicLayer } from './layer'

// ---------------------------------------------------------------------------
// Sketch layer demo: a p5 sketch drawn into its own canvas and composited by
// @mytw/engine as a screen layer over Understory's base image, with a hue
// shift on the sketch layer only. The panel drives the sketch's params.
// Keys: E toggles the hue shift, D renders frame 37 twice and compares bytes.
// ---------------------------------------------------------------------------

const WIDTH = 1080
const HEIGHT = 1920
const FRAMES = 225
const FPS = 30
const SEED = 7
const CHECK_FRAME = 37

/** Copies a canvas and returns its pixel bytes. */
function pixels(source: HTMLCanvasElement): Uint8ClampedArray {
	const copy = document.createElement('canvas')
	copy.width = source.width
	copy.height = source.height
	const ctx = copy.getContext('2d')
	if (!ctx) throw new Error('2D canvas is not available')
	ctx.drawImage(source, 0, 0)
	return ctx.getImageData(0, 0, copy.width, copy.height).data
}

function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

async function main(): Promise<void> {
	const overlay = document.getElementById('overlay')
	const visible = document.createElement('canvas')
	document.body.appendChild(visible)

	const image = new Image()
	image.src = '/images/mytw-002_base.png'
	await image.decode()

	const renderer = createRenderer(visible, { width: WIDTH, height: HEIGHT })
	renderer.setImage('base', image)

	const hueShift = getEffect('hue-shift')
	if (!hueShift) throw new Error('hue-shift is not in @mytw/fx')
	renderer.registerEffect({ id: 'hue-shift', fragment: assembleFragment(hueShift).source })
	const hueUniforms = uniformValues(hueShift, { degrees: 120 })

	const panel = mountPanel(basicLayer.params)
	const runtime = await loadSketchRuntime()
	const instance = await runtime.createSketchLayer(basicLayer, {
		width: WIDTH,
		height: HEIGHT,
		seed: SEED,
		params: panel.values,
	})
	panel.onChange((values) => instance.setParams(values))

	const clock = new LoopClock({ loopFrames: FRAMES, fps: FPS })
	let hue = true
	let deterministic = '-'

	function checkDeterminism(): void {
		const time = { frame: CHECK_FRAME, frames: FRAMES, fps: FPS }
		const first = pixels(instance.render(time))
		const second = pixels(instance.render(time))
		deterministic = sameBytes(first, second) ? 'yes' : 'no'
	}

	window.addEventListener('keydown', (e) => {
		const key = e.key.toLowerCase()
		if (key === 'e') hue = !hue
		if (key === 'd') checkDeterminism()
	})

	function frameAt(phase: number): RenderFrame {
		return {
			background: [0, 0, 0, 1],
			layers: [
				{ id: 'base', image: 'base' },
				{
					id: 'sketch',
					image: 'sketch',
					blend: 'screen',
					effects: [
						{
							effect: 'hue-shift',
							enabled: hue,
							uniforms: { ...hueUniforms, uPhase: phase },
						},
					],
				},
			],
		}
	}

	const start = performance.now()

	function tick(now: number): void {
		// Schedule first, so one failed frame does not stop the loop.
		requestAnimationFrame(tick)
		clock.seek(Math.floor(((now - start) / 1000) * clock.fps))
		const phase = clock.next()
		renderer.setImage('sketch', instance.render({ frame: clock.frame, frames: FRAMES, fps: FPS }))
		renderer.render(frameAt(phase))
		if (overlay) {
			overlay.textContent = [
				`frame ${clock.frame}/${FRAMES}  seed ${SEED}`,
				`hue shift ${hue ? 'on' : 'off'}`,
				`deterministic: ${deterministic}`,
				'E hue shift · D determinism check · H panel',
			].join('\n')
		}
	}

	requestAnimationFrame(tick)
}

main().catch((err: unknown) => {
	console.error(err)
	const overlay = document.getElementById('overlay')
	if (overlay) overlay.textContent = String(err)
})
