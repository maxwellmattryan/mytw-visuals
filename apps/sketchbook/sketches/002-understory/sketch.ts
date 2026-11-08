import p5 from 'p5'
import { SIZES, createWebGLCanvas, centerCanvas } from '@lib/layout'
import { compileFilterShader } from '@lib/shaders'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'
import { coverImage } from '@lib/image'
import { LOOP_TARGETS, LoopClock } from '@lib/loop'
import { mountPanel, mountTransport } from '@mytw/panel'
import type { Panel } from '@mytw/panel'
import type { ParamValues } from '@mytw/schema'
import { understorySchema } from './params'

const TAU = Math.PI * 2

// ---------------------------------------------------------------------------
// Understory — the knobs live in ./params.ts and are tuned live in the panel.
//
// A readable BASE composition multiplied by a single mirrored "ghost" of the
// same image:   composite = base * ghost
//
// The ghost is mirrored on X. Because the photo's bright rose cluster sits
// left-of-center, the X-flip lands it on the OTHER side of the base's cluster,
// so the result doesn't read as the same image overlaid on itself.
//
// UNISON MOTION: one shared motion morphs both layers together — same drift
// direction, shared breathe, shared caustic warp — so they move in unison. The
// ghost travels a bit less (ghostScale < 1) for a subtle parallax lag and adds
// its own gentle wobble. (Turn on ghostContrary to make it oppose.)
//
// NO HARD EDGES: a layer only shows its rectangular window if it samples past
// the image. For drift keep zoom >= 1 / (1 - 2 * driftAmp); the schema checks
// this for both layers, and the ghost's larger zoom leaves plenty of margin.
//
// Loop-ability: every *Cycles is an INTEGER (enforced by the schema), so each
// sinusoid completes whole cycles over the loop and the last frame equals the
// first — seamless. loopFrames is the master speed (longer loop = slower
// motion at the same fps).
// ---------------------------------------------------------------------------
type Values = ParamValues<typeof understorySchema>

interface LayerFraming {
	zoom: number
	centerX: number
	centerY: number
	mirrorX: boolean
	mirrorY: boolean
	tilt: number
}

interface LayerMotion {
	driftAmp: number
	driftCyclesX: number
	driftCyclesY: number
	driftPhase: number
	spin: number
	wobbleAmp: number
	wobbleCycles: number
	wobblePhase: number
	breatheAmp: number
	breatheCycles: number
	breathePhase: number
}

function baseFraming(v: Values): LayerFraming {
	return {
		zoom: v.baseZoom,
		centerX: v.baseCenterX,
		centerY: v.baseCenterY,
		mirrorX: v.baseMirrorX,
		mirrorY: v.baseMirrorY,
		tilt: v.baseTilt,
	}
}

function ghostFraming(v: Values): LayerFraming {
	return {
		zoom: v.ghostZoom,
		centerX: v.ghostCenterX,
		centerY: v.ghostCenterY,
		mirrorX: v.ghostMirrorX,
		mirrorY: v.ghostMirrorY,
		tilt: v.ghostTilt,
	}
}

function motionOf(v: Values): LayerMotion {
	return {
		driftAmp: v.driftAmp,
		driftCyclesX: v.driftCyclesX,
		driftCyclesY: v.driftCyclesY,
		driftPhase: v.driftPhase,
		spin: v.spin,
		wobbleAmp: v.wobbleAmp,
		wobbleCycles: v.wobbleCycles,
		wobblePhase: v.wobblePhase,
		breatheAmp: v.breatheAmp,
		breatheCycles: v.breatheCycles,
		breathePhase: v.breathePhase,
	}
}

type LayerTransform = ReturnType<typeof evalTransform>

// Evaluate a transform at loop phase t in [0,1). The factor scales the motion:
// +1 for the base; a negative value for the ghost so it moves contrary, and
// abs(factor) < 1 makes it travel slower (less) than the base.
// Every *Cycles is an integer, so it returns to its t=0 value at t=1 -> seamless.
function evalTransform(t: number, framing: LayerFraming, motion: LayerMotion, factor: number) {
	const a = t * TAU
	const spin =
		motion.spin * a + motion.wobbleAmp * Math.sin(motion.wobbleCycles * a + motion.wobblePhase)
	const angle = framing.tilt + factor * spin
	const scale = 1 + motion.breatheAmp * Math.sin(motion.breatheCycles * a + motion.breathePhase)
	const ox = factor * motion.driftAmp * Math.sin(motion.driftCyclesX * a + motion.driftPhase)
	const oy = factor * motion.driftAmp * Math.cos(motion.driftCyclesY * a + motion.driftPhase)
	return { angle, scale, ox, oy }
}

// Push one layer's uniforms under a name prefix (e.g. 'uBase', 'uG').
function setLayerUniforms(
	shd: p5.Shader,
	prefix: string,
	framing: LayerFraming,
	tf: LayerTransform
) {
	shd.setUniform(prefix + 'Zoom', framing.zoom)
	shd.setUniform(prefix + 'Mir', [framing.mirrorX ? -1 : 1, framing.mirrorY ? -1 : 1])
	shd.setUniform(prefix + 'Angle', tf.angle)
	shd.setUniform(prefix + 'Scale', tf.scale)
	shd.setUniform(prefix + 'Offset', [tf.ox, tf.oy])
	shd.setUniform(prefix + 'Center', [framing.centerX, framing.centerY])
}

// ---------------------------------------------------------------------------
// Fragment shader — base * mirrored ghost (MULTIPLY)
// ---------------------------------------------------------------------------
const FRAG_UNDERSTORY = `
precision mediump float;
varying vec2 vTexCoord;

const float TAU = 6.28318530718;

uniform sampler2D uTex;

uniform float uBaseZoom;
uniform vec2  uBaseMir;
uniform float uBaseAngle;
uniform float uBaseScale;
uniform vec2  uBaseOffset;
uniform vec2  uBaseCenter;

uniform float uGZoom;
uniform vec2  uGMir;
uniform float uGAngle;
uniform float uGScale;
uniform vec2  uGOffset;
uniform vec2  uGCenter;

uniform float uIntensity;
uniform float uVignette;
uniform float uFeather;

// loop phase in [0,1) — drives every animated effect; integer cycles => seamless
uniform float uPhase;

// caustic shimmer
uniform float uCausticAmp;
uniform float uCausticScale;
uniform float uCausticRadius;

// chromatic aberration
uniform float uAberration;

// ghost vertical visibility gradient (screen-space Y)
uniform float uGhostFadeStart;
uniform float uGhostFadeEnd;

// hue rotation (radians) applied to the final composite
uniform float uHueShift;

vec2 rot(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c) * p;
}

// rotate hue about the gray (1,1,1) axis — preserves luminance, no clipping
vec3 hueRotate(vec3 col, float angle) {
  vec3 k = vec3(0.57735);
  float c = cos(angle);
  return col * c + cross(k, col) * sin(angle) + k * dot(k, col) * (1.0 - c);
}

// --- value-noise fbm (for caustic warp) ---
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// 1.0 inside [0,1]^2, feathering to 0.0 at the borders
float edgeMask(vec2 uv, float f) {
  vec2 w = smoothstep(vec2(0.0), vec2(f), uv) * smoothstep(vec2(1.0), vec2(1.0) - f, uv);
  return w.x * w.y;
}

// frame on a center point, zoom, mirror (per-axis sign), rotate, scale, drift
vec2 layerUv(vec2 uv, float zoom, vec2 mir, float angle, float scale, vec2 offset, vec2 center) {
  vec2 c = (uv - 0.5) / zoom;
  c *= mir;
  c = rot(c, angle);
  c /= scale;
  c += offset;
  return c + center;
}

// a multiply "ghost": outside its bounds it is white (no darkening)
vec3 ghost(vec2 uv, float zoom, vec2 mir, float angle, float scale, vec2 offset, vec2 center) {
  vec2 g = layerUv(uv, zoom, mir, angle, scale, offset, center);
  return mix(vec3(1.0), texture2D(uTex, g).rgb, edgeMask(g, uFeather));
}

// Full composite (caustic warp -> base * ghost -> vignette) at a given screen UV.
// Sampled once per RGB channel for chromatic aberration.
vec3 compose(vec2 uv0) {
  vec2 uv = uv0;

  // CAUSTIC WARP — perturb BOTH layers together so the whole frame shimmers
  // coherently. The noise is sampled along a circle in (phase) so it loops.
  vec2 loopOff = uCausticRadius * vec2(cos(uPhase * TAU), sin(uPhase * TAU));
  vec2 np = uv0 * uCausticScale + loopOff;
  vec2 warp = (vec2(fbm(np), fbm(np + vec2(31.7, 17.3))) - 0.5) * 2.0 * uCausticAmp;
  uv += warp;

  // base (outside its bounds -> black)
  vec2 bUv = layerUv(uv, uBaseZoom, uBaseMir, uBaseAngle, uBaseScale, uBaseOffset, uBaseCenter);
  vec3 base = texture2D(uTex, bUv).rgb * edgeMask(bUv, uFeather);

  // single mirrored ghost, travelling with the base
  vec3 g = ghost(uv, uGZoom, uGMir, uGAngle, uGScale, uGOffset, uGCenter);
  g = mix(vec3(1.0), g, uIntensity); // dial strength toward white

  // vertical visibility gradient: fade the ghost toward white (invisible in a
  // multiply) from fadeStart down to fadeEnd. Works for either Y ordering.
  float gt = clamp((uv0.y - uGhostFadeStart) / (uGhostFadeEnd - uGhostFadeStart), 0.0, 1.0);
  float gVis = 1.0 - smoothstep(0.0, 1.0, gt);
  g = mix(vec3(1.0), g, gVis);

  // MULTIPLY blend
  vec3 outc = base * g;

  // gentle vignette
  float d = distance(uv0, vec2(0.5));
  outc *= mix(1.0, smoothstep(0.95, 0.35, d), uVignette);

  return outc;
}

void main() {
  vec2 uv0 = vTexCoord;

  // CHROMATIC ABERRATION — split the channels along the radial direction,
  // scaled by distance from center (zero at center, max at the edges).
  vec2 dir = uv0 - 0.5;
  vec2 off = dir * uAberration;

  vec3 outc;
  outc.r = compose(uv0 + off).r;
  outc.g = compose(uv0).g;
  outc.b = compose(uv0 - off).b;

  outc = hueRotate(outc, uHueShift); // nudge the overall hue (greener / bluer)

  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`

// ---------------------------------------------------------------------------
// Sketch
// ---------------------------------------------------------------------------
const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let shd: p5.Shader
	let img: p5.Image
	let gfx: p5.Graphics
	let panel: Panel<typeof understorySchema.params>
	let clock: LoopClock

	p.preload = () => {
		img = p.loadImage('/images/mytw-002_base.png')
	}

	p.setup = () => {
		cnv = createWebGLCanvas(p, SIZES.STORY)

		// Pre-render the base to an offscreen 2D buffer at the image's NATIVE
		// resolution (1688x3000), not the canvas size — so zooming the shader's
		// UVs samples real detail instead of upscaled canvas pixels (no pixelation).
		gfx = p.createGraphics(img.width, img.height)
		gfx.background(0)
		coverImage(gfx, img, { flipY: true })

		shd = compileFilterShader(p, FRAG_UNDERSTORY)

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
		const v = panel.values
		const phase = clock.next()

		// Base travels +motion; the ghost travels WITH it (unison) a bit slower,
		// unless ghostContrary flips it to oppose.
		const base = baseFraming(v)
		const ghost = ghostFraming(v)
		const motion = motionOf(v)
		const ghostDir = v.ghostContrary ? -1 : 1
		const ghostFactor = ghostDir * v.ghostScale
		const baseTf = evalTransform(phase, base, motion, 1)
		const ghostTf = evalTransform(phase, ghost, motion, ghostFactor)
		// Ghost-only rotation (the base never rotates): a whole-turn spin and/or a
		// seamless back-and-forth wobble. Both return to 0 at phase 1.
		ghostTf.angle += v.ghostSpin * phase * TAU
		ghostTf.angle +=
			v.ghostWobbleAmp * Math.sin(v.ghostWobbleCycles * phase * TAU + v.ghostWobblePhase)

		p.shader(shd)
		shd.setUniform('uTex', gfx)
		setLayerUniforms(shd, 'uBase', base, baseTf)
		setLayerUniforms(shd, 'uG', ghost, ghostTf)
		shd.setUniform('uIntensity', v.intensity)
		shd.setUniform('uVignette', v.vignette)
		shd.setUniform('uFeather', v.feather)

		// Animated effects — all driven by the shared loop phase to stay seamless.
		shd.setUniform('uPhase', phase)

		shd.setUniform('uCausticAmp', v.causticAmp)
		shd.setUniform('uCausticScale', v.causticScale)
		shd.setUniform('uCausticRadius', v.causticLoopRadius)

		// Pulsing chromatic aberration: swell from base up to base+pulseAmp and back.
		// (0.5 - 0.5*cos) rises from 0 at phase 0; integer pulseCycles => seamless.
		const aberration =
			v.aberrationBase +
			v.aberrationPulseAmp *
				(0.5 - 0.5 * Math.cos(v.aberrationPulseCycles * phase * TAU + v.aberrationPulsePhase))
		shd.setUniform('uAberration', aberration)

		shd.setUniform('uGhostFadeStart', v.ghostFadeStart)
		shd.setUniform('uGhostFadeEnd', v.ghostFadeEnd)

		shd.setUniform('uHueShift', (v.hueShift * Math.PI) / 180)

		p.rect(0, 0, p.width, p.height)

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
