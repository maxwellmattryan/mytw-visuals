import { createRenderer } from '@mytw/engine'
import type { BlendMode, Mask, Renderer } from '@mytw/engine'
import { LoopClock } from '@lib/loop'

import {
	registerUnderstoryEffects,
	UNDERSTORY_IMAGE,
	UNDERSTORY_IMAGE_ID,
	UNDERSTORY_MASK,
	understoryFrame,
} from './understory-frame'

// ---------------------------------------------------------------------------
// Engine demo: Understory's base x mirrored ghost, drawn by @mytw/engine with
// no p5. Keys: B cycles the ghost blend, M the ghost mask, E toggles a tint
// effect on the ghost, L loses the WebGL context and restores it 1 s later.
// Add ?offscreen to render into an OffscreenCanvas.
//
// The frames and demo effects live in understory-frame.ts.
// ---------------------------------------------------------------------------

const WIDTH = 1080
const HEIGHT = 1920
const BLENDS: BlendMode[] = ['multiply', 'screen', 'add', 'normal']
const MASKS: (Mask | null)[] = [
	UNDERSTORY_MASK,
	{ kind: 'radial', center: [0.5, 0.45], inner: 0.1, outer: 0.55 },
	{ kind: 'image', image: UNDERSTORY_IMAGE_ID, channel: 'luminance' },
	null,
]

interface Target {
	mode: 'HTMLCanvasElement' | 'OffscreenCanvas'
	renderer: Renderer
	/** For the L key. */
	loseContext: WEBGL_lose_context | null
	/** Copies an offscreen frame to the visible canvas. */
	present(): void
}

function createTarget(visible: HTMLCanvasElement, offscreen: boolean): Target {
	if (!offscreen) {
		const renderer = createRenderer(visible, { width: WIDTH, height: HEIGHT })
		return {
			mode: 'HTMLCanvasElement',
			renderer,
			loseContext: visible.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null,
			present: () => {},
		}
	}
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
	const renderer = createRenderer(canvas, { width: WIDTH, height: HEIGHT })
	visible.width = WIDTH
	visible.height = HEIGHT
	const bitmap = visible.getContext('bitmaprenderer')
	return {
		mode: 'OffscreenCanvas',
		renderer,
		loseContext: canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null,
		present: () => bitmap?.transferFromImageBitmap(canvas.transferToImageBitmap()),
	}
}

async function main(): Promise<void> {
	const overlay = document.getElementById('overlay')
	const visible = document.createElement('canvas')
	document.body.appendChild(visible)

	const image = new Image()
	image.src = UNDERSTORY_IMAGE
	await image.decode()

	const target = createTarget(visible, new URLSearchParams(location.search).has('offscreen'))
	const { renderer } = target
	renderer.setImage(UNDERSTORY_IMAGE_ID, image)
	registerUnderstoryEffects(renderer)

	const clock = new LoopClock({ loopFrames: 225, fps: 30 })
	let blend = 0
	let mask = 0
	let tint = false

	window.addEventListener('keydown', (e) => {
		const key = e.key.toLowerCase()
		if (key === 'b') blend = (blend + 1) % BLENDS.length
		if (key === 'm') mask = (mask + 1) % MASKS.length
		if (key === 'e') tint = !tint
		if (key === 'l' && target.loseContext && !renderer.contextLost) {
			const ext = target.loseContext
			ext.loseContext()
			setTimeout(() => ext.restoreContext(), 1000)
		}
	})

	const frameTimes: number[] = []
	const renderTimes: number[] = []
	const start = performance.now()

	function average(values: number[]): number {
		return values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length)
	}

	function tick(now: number): void {
		// Schedule first, so one failed frame does not stop the loop.
		requestAnimationFrame(tick)
		clock.seek(Math.floor(((now - start) / 1000) * clock.fps))
		const frame = understoryFrame(clock.next(), {
			blend: BLENDS[blend],
			mask: MASKS[mask],
			tint,
		})

		const t0 = performance.now()
		const drawn = renderer.render(frame)
		if (drawn) target.present()
		renderTimes.push(performance.now() - t0)
		frameTimes.push(now)
		if (renderTimes.length > 60) renderTimes.shift()
		if (frameTimes.length > 61) frameTimes.shift()

		const span = frameTimes[frameTimes.length - 1] - frameTimes[0]
		const fps = span > 0 ? ((frameTimes.length - 1) * 1000) / span : 0
		if (overlay) {
			overlay.textContent = [
				`${target.mode} ${renderer.width}x${renderer.height}`,
				renderer.contextLost ? 'context lost' : 'context ok',
				`fps ${fps.toFixed(1)}  render ${average(renderTimes).toFixed(2)} ms`,
				`blend ${BLENDS[blend]}  mask ${MASKS[mask]?.kind ?? 'none'}  tint ${tint ? 'on' : 'off'}`,
				'B blend · M mask · E tint · L lose context',
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
