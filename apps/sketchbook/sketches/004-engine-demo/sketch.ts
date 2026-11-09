import { createRenderer } from '@mytw/engine'
import type { BlendMode, LayerTransform, Mask, RenderFrame, Renderer } from '@mytw/engine'
import { LoopClock } from '@lib/loop'

// ---------------------------------------------------------------------------
// Engine demo: Understory's base x mirrored ghost, drawn by @mytw/engine with
// no p5. Keys: B cycles the ghost blend, M the ghost mask, E toggles a tint
// effect on the ghost, L loses the WebGL context and restores it 1 s later.
// Add ?offscreen to render into an OffscreenCanvas.
//
// The vignette, hue shift and tint shaders below are throwaway demo effects.
// ---------------------------------------------------------------------------

const WIDTH = 1080
const HEIGHT = 1920
const TAU = Math.PI * 2

const VIGNETTE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform vec2 uResolution;
uniform float uAmount;
out vec4 outColor;
void main() {
	vec4 c = texture(uInput, vUv);
	float d = distance(vUv, vec2(0.5));
	outColor = vec4(c.rgb * mix(1.0, 1.0 - smoothstep(0.35, 0.95, d), uAmount), c.a);
}
`

const HUE_SHIFT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform float uAngle;
out vec4 outColor;
void main() {
	vec4 c = texture(uInput, vUv);
	vec3 k = vec3(0.57735);
	float co = cos(uAngle);
	vec3 rgb = c.rgb * co + cross(k, c.rgb) * sin(uAngle) + k * dot(k, c.rgb) * (1.0 - co);
	outColor = vec4(clamp(rgb, 0.0, c.a), c.a);
}
`

const TINT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform vec3 uTint;
uniform float uAmount;
out vec4 outColor;
void main() {
	vec4 c = texture(uInput, vUv);
	float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
	outColor = vec4(mix(c.rgb, uTint * l, uAmount), c.a);
}
`

const BLENDS: BlendMode[] = ['multiply', 'screen', 'add', 'normal']
const MASKS: (Mask | undefined)[] = [
	{ kind: 'linear', from: [0.5, 0], to: [0.5, 1] },
	{ kind: 'radial', center: [0.5, 0.45], inner: 0.1, outer: 0.55 },
	{ kind: 'image', image: 'base', channel: 'luminance' },
	undefined,
]

// Understory's defaults (apps/sketchbook/sketches/002-understory/params.ts).
const U = {
	driftAmp: 0.012,
	ghostScale: 0.8,
	breatheAmp: 0.022,
	ghostWobbleAmp: 0.03,
	feather: 0.06,
	vignette: 0.2,
	hueShift: -15,
}

/**
 * Understory's layer framing as an engine transform. Understory drifts in
 * source UV after the zoom, so the drift becomes an output-UV offset scaled by
 * the zoom, with the sign flipped on mirrored axes.
 */
function framing(
	phase: number,
	opts: { zoom: number; center: [number, number]; mirrorX: boolean; factor: number; angle: number }
): LayerTransform {
	const a = phase * TAU
	const scale = 1 + U.breatheAmp * Math.sin(a)
	const zoom = opts.zoom * scale
	const ox = opts.factor * U.driftAmp * Math.sin(a)
	const oy = opts.factor * U.driftAmp * Math.cos(a)
	return {
		center: opts.center,
		offset: [(opts.mirrorX ? 1 : -1) * ox * zoom, -oy * zoom],
		zoom,
		rotation: opts.angle,
		mirrorX: opts.mirrorX,
	}
}

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
	image.src = '/images/mytw-002_base.png'
	await image.decode()

	const target = createTarget(visible, new URLSearchParams(location.search).has('offscreen'))
	const { renderer } = target
	renderer.setImage('base', image)
	renderer.registerEffect({ id: 'vignette', fragment: VIGNETTE })
	renderer.registerEffect({ id: 'hue', fragment: HUE_SHIFT })
	renderer.registerEffect({ id: 'tint', fragment: TINT })

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

	function frameAt(phase: number): RenderFrame {
		const a = phase * TAU
		const ghostAngle = U.ghostWobbleAmp * Math.sin(a)
		return {
			background: [0, 0, 0, 1],
			layers: [
				{
					id: 'base',
					image: 'base',
					transform: framing(phase, {
						zoom: 2,
						center: [0.5, 0.72],
						mirrorX: false,
						factor: 1,
						angle: 0,
					}),
					edgeFeather: U.feather,
				},
				{
					id: 'ghost',
					image: 'base',
					transform: framing(phase, {
						zoom: 3.4,
						center: [0.2, 0.25],
						mirrorX: true,
						factor: U.ghostScale,
						angle: ghostAngle,
					}),
					edgeFeather: U.feather,
					blend: BLENDS[blend],
					mask: MASKS[mask],
					effects: [
						{
							effect: 'tint',
							enabled: tint,
							uniforms: { uTint: [0.35, 0.75, 1], uAmount: 0.8 },
						},
					],
				},
			],
			effects: [
				{ effect: 'vignette', uniforms: { uAmount: U.vignette } },
				{ effect: 'hue', uniforms: { uAngle: (U.hueShift * Math.PI) / 180 } },
			],
		}
	}

	function average(values: number[]): number {
		return values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length)
	}

	function tick(now: number): void {
		// Schedule first, so one failed frame does not stop the loop.
		requestAnimationFrame(tick)
		clock.seek(Math.floor(((now - start) / 1000) * clock.fps))
		const frame = frameAt(clock.next())

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
