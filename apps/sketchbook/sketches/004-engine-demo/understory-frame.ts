import type { BlendMode, Mask, LayerTransform, RenderFrame, Renderer } from '@mytw/engine'

// ---------------------------------------------------------------------------
// Understory's base x mirrored ghost as engine frames, shared by the engine
// demo (004) and the export check (006). The vignette, hue shift and tint
// shaders are throwaway demo effects.
// ---------------------------------------------------------------------------

/** The source image, served from the sketchbook's assets. */
export const UNDERSTORY_IMAGE = '/images/mytw-002_base.png'
/** The image id the frames use; pass it to `renderer.setImage`. */
export const UNDERSTORY_IMAGE_ID = 'base'

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

/** Compiles the three demo effects the frames use. */
export function registerUnderstoryEffects(renderer: Renderer): void {
	renderer.registerEffect({ id: 'vignette', fragment: VIGNETTE })
	renderer.registerEffect({ id: 'hue', fragment: HUE_SHIFT })
	renderer.registerEffect({ id: 'tint', fragment: TINT })
}

/** The ghost mask the demo starts with. */
export const UNDERSTORY_MASK: Mask = { kind: 'linear', from: [0.5, 0], to: [0.5, 1] }

export interface UnderstoryLook {
	/** Ghost blend. Default `'multiply'`. */
	blend?: BlendMode
	/** Ghost mask, `null` for none. Default `UNDERSTORY_MASK`. */
	mask?: Mask | null
	/** Tints the ghost. Default `false`. */
	tint?: boolean
}

/** Understory at loop phase `phase` (0 to 1). */
export function understoryFrame(
	phase: number,
	{ blend = 'multiply', mask = UNDERSTORY_MASK, tint = false }: UnderstoryLook = {}
): RenderFrame {
	const a = phase * TAU
	const ghostAngle = U.ghostWobbleAmp * Math.sin(a)
	return {
		background: [0, 0, 0, 1],
		layers: [
			{
				id: 'base',
				image: UNDERSTORY_IMAGE_ID,
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
				image: UNDERSTORY_IMAGE_ID,
				transform: framing(phase, {
					zoom: 3.4,
					center: [0.2, 0.25],
					mirrorX: true,
					factor: U.ghostScale,
					angle: ghostAngle,
				}),
				edgeFeather: U.feather,
				blend,
				mask: mask ?? undefined,
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
