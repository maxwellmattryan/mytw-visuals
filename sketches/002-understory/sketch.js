import p5 from 'p5'
import { SIZES, createWebGLCanvas, centerCanvas } from '@lib/layout.js'
import { compileFilterShader } from '@lib/shaders.js'
import { createCapture } from '@lib/capture.js'
import { coverImage } from '@lib/image.js'
import { loopValue } from '@lib/math.js'

const TAU = Math.PI * 2

// ---------------------------------------------------------------------------
// CONFIG — the whole sketch distilled to knobs.
//
// A readable BASE composition multiplied by a single mirrored "ghost" of the
// same image:   composite = base * ghost
//
// The ghost is mirrored on X. Because the photo's bright rose cluster sits
// left-of-center, the X-flip lands it on the OTHER side of the base's cluster,
// so the result doesn't read as the same image overlaid on itself.
//
// UNISON MOTION: one shared `motion` morphs both layers together — same drift
// direction, shared breathe, shared caustic warp — so they move in unison. The
// ghost travels a bit less (motion.ghostScale < 1) for a subtle parallax lag and
// adds its own gentle wobble. (Set motion.ghostContrary: true to make it oppose.)
//
// NO HARD EDGES: a layer only shows its rectangular window if it samples past
// the image. For drift keep zoom >= 1 / (1 - 2 * driftAmp); the ghost's larger
// zoom leaves plenty of margin.
//
// Loop-ability: every *Cycles is an INTEGER, so each sinusoid completes whole
// cycles over the loop and the last frame equals the first — seamless.
// loopFrames is the master speed (longer loop = slower motion at the same fps).
// ---------------------------------------------------------------------------
const CONFIG = {
	// Loop / recording — seamless, 7.5s clip (9:16). Just under Spotify Canvas's 8s
	// ceiling so its re-encode can't trim the loop-critical final frame.
	fps: 30,
	loopFrames: 225, // 7.5s loop at 30fps — MASTER SPEED (higher = slower)

	// Shared motion. Both layers morph in UNISON: same drift direction, shared
	// breathe, shared caustic warp. The ghost just travels a bit less (ghostScale)
	// for a subtle parallax lag. Set ghostContrary: true to make it oppose instead.
	motion: {
		driftAmp: 0.012, // travel radius (UV) — smaller = slower / less distance
		ghostScale: 0.8, // ghost travels this fraction of the base's distance
		ghostContrary: false, // false = ghost drifts WITH the base (unison); true = opposite
		driftCyclesX: 1, // x oscillations per loop (integer)
		driftCyclesY: 1, // y oscillations per loop (integer); != X => figure-8
		driftPhase: 0.0,
		spin: 0, // rotation off
		wobbleAmp: 0.0,
		wobbleCycles: 1,
		wobblePhase: 0.0,
		breatheAmp: 0.022, // shared in/out scale pulse — both layers breathe together
		breatheCycles: 1, // breaths per loop (integer = seamless)
		breathePhase: 0.0,
	},

	// Base layer — framing only. Travels along the +motion path. Reframed off the
	// central rose and onto the LOWER buds/pods via centerX/Y. Zoomed in so that
	// near-edge focal point stays edge-free under drift + breathe.
	// NOTE: the buffer is drawn with a Y-flip — if this frames the wrong half
	// vertically, use centerY = 1 - value (i.e. 0.34 instead of 0.66).
	base: {
		zoom: 2, // tighter crop on the lower blooms; keeps drift + breathe edge-free
		centerX: 0.5,
		centerY: 0.72, // toward the lower portion of the photo (buds/pods)
		mirrorX: false,
		mirrorY: false,
		tilt: 0.0,
	},

	// Ghost — a single mirrored copy. Travels contrary to the base, and rotates
	// cleanly about the center. Reframed onto a DIFFERENT bloom than the base: the
	// smaller rose just right of the central cluster. It's well inside the frame,
	// so a gentle zoom keeps it edge-free. Mirrored on X, it renders left-of-center,
	// balancing the base's lower-right buds.
	// NOTE: same Y-flip caveat as the base — if vertical is inverted, use
	// centerY = 1 - value (i.e. 0.60 instead of 0.40).
	//
	// Two seamless ways to rotate the ghost (the base never rotates):
	//  - spin: WHOLE turns per loop (integer). 0 = off. The only seamless way to
	//    spin continuously in one direction; the slowest non-zero option is 1.
	//  - wobble: a sine SWAY back-and-forth. Any amplitude loops cleanly, so this
	//    gives a slow rocking rotation without committing to a full turn.
	ghost: {
		zoom: 3.4, // gentle crop on the interior rose; keeps the focal edge-free
		centerX: 0.2,
		centerY: 0.25, // just right-of and above center (the smaller rose)
		mirrorX: true,
		mirrorY: false,
		tilt: 0.0,
		spin: 0, // whole turns per loop (integer = seamless); 0 = no continuous spin
		wobbleAmp: 0.03, // rotational sway in radians (~2°); any amount stays seamless
		wobbleCycles: 1, // sways per loop (integer = seamless)
		wobblePhase: 0.0,

		// Vertical visibility gradient (screen-space Y in [0,1]): the ghost is fully
		// visible at `fadeStart` and fades to invisible (contributes white = no
		// darkening) by `fadeEnd`. Default: visible from the midpoint up, gone by the
		// bottom. If it fades the wrong end, swap the two values (e.g. end: 0.0).
		fadeStart: 0.0, // fully visible from here toward the top
		fadeEnd: 1.0, // fully faded out by here (the bottom)
	},

	// Look
	intensity: 1.0, // multiply strength (0 = base only, 1 = full)
	vignette: 0.2, // 0 = off, 1 = strong edge darkening
	feather: 0.06, // soft layer-edge falloff (UV)
	hueShift: -15, // degrees of hue rotation; negative = toward green, positive = toward blue

	// Caustic shimmer — domain-warped wobble that perturbs BOTH layers together,
	// like the flowers seen through moving water / heat haze. Seamless: the noise
	// field is sampled along a circular path so phase 0 == phase 1.
	caustic: {
		amp: 0.005, // UV displacement amount (0 = off)
		scale: 2.0, // noise frequency (higher = finer ripples)
		loopRadius: 0.8, // radius of the noise's circular loop path
	},

	// Chromatic aberration — very subtle radial RGB split, growing toward the
	// edges (zero at center). Lens-like fringe; keep it tiny. PULSES over the loop:
	// the split swells from `base` up to `base + pulseAmp` and back, seamlessly.
	aberration: {
		base: 0.001, // constant split floor (UV offset at the edge)
		pulseAmp: 0.01, // extra split added at each pulse peak
		pulseCycles: 1, // pulses per loop (integer = seamless)
		pulsePhase: 0.0,
	},
}

// Evaluate a transform at loop phase t in [0,1). The factor scales the motion:
// +1 for the base; a negative value for the ghost so it moves contrary, and
// abs(factor) < 1 makes it travel slower (less) than the base.
// Every *Cycles is an integer, so it returns to its t=0 value at t=1 -> seamless.
function evalTransform(t, framing, motion, factor) {
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
function setLayerUniforms(shd, prefix, framing, tf) {
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
const sketch = (p) => {
	let cnv
	let cap
	let shd
	let img
	let gfx
	let recordStartFrame = -1

	p.preload = () => {
		img = p.loadImage('/images/mytw-002_base.png')
	}

	p.setup = () => {
		cnv = createWebGLCanvas(p, SIZES.STORY)
		p.frameRate(CONFIG.fps)

		// Pre-render the base to an offscreen 2D buffer at the image's NATIVE
		// resolution (1688x3000), not the canvas size — so zooming the shader's
		// UVs samples real detail instead of upscaled canvas pixels (no pixelation).
		gfx = p.createGraphics(img.width, img.height)
		gfx.background(0)
		coverImage(gfx, img, { flipY: true })

		shd = compileFilterShader(p, FRAG_UNDERSTORY)

		cap = createCapture(cnv.elt, { framerate: CONFIG.fps })
		cap.bindKeys(p)
	}

	p.draw = () => {
		// Anchor the loop origin to the FIRST recorded frame, so the captured clip
		// begins exactly at phase 0. (cap.bindKeys flips cap.recording on a frame
		// that has already been drawn; anchoring here — not in keyPressed — keeps
		// that phase-0 frame, which was previously lost, making clips one short.)
		if (cap.recording) {
			if (recordStartFrame < 0) recordStartFrame = p.frameCount
		} else if (recordStartFrame >= 0) {
			recordStartFrame = -1 // recording ended/cancelled — resume free-running preview
		}

		const origin = recordStartFrame >= 0 ? recordStartFrame : 0
		const offset = p.frameCount - origin
		const phase = loopValue(offset, CONFIG.loopFrames)

		// Base travels +motion; the ghost travels WITH it (unison) a bit slower,
		// unless ghostContrary flips it to oppose.
		const ghostDir = CONFIG.motion.ghostContrary ? -1 : 1
		const ghostFactor = ghostDir * CONFIG.motion.ghostScale
		const baseTf = evalTransform(phase, CONFIG.base, CONFIG.motion, 1)
		const ghostTf = evalTransform(phase, CONFIG.ghost, CONFIG.motion, ghostFactor)
		// Ghost-only rotation (the base never rotates): a whole-turn spin and/or a
		// seamless back-and-forth wobble. Both return to 0 at phase 1.
		ghostTf.angle += CONFIG.ghost.spin * phase * TAU
		ghostTf.angle +=
			CONFIG.ghost.wobbleAmp *
			Math.sin(CONFIG.ghost.wobbleCycles * phase * TAU + CONFIG.ghost.wobblePhase)

		p.shader(shd)
		shd.setUniform('uTex', gfx)
		setLayerUniforms(shd, 'uBase', CONFIG.base, baseTf)
		setLayerUniforms(shd, 'uG', CONFIG.ghost, ghostTf)
		shd.setUniform('uIntensity', CONFIG.intensity)
		shd.setUniform('uVignette', CONFIG.vignette)
		shd.setUniform('uFeather', CONFIG.feather)

		// Animated effects — all driven by the shared loop phase to stay seamless.
		shd.setUniform('uPhase', phase)

		shd.setUniform('uCausticAmp', CONFIG.caustic.amp)
		shd.setUniform('uCausticScale', CONFIG.caustic.scale)
		shd.setUniform('uCausticRadius', CONFIG.caustic.loopRadius)

		// Pulsing chromatic aberration: swell from base up to base+pulseAmp and back.
		// (0.5 - 0.5*cos) rises from 0 at phase 0; integer pulseCycles => seamless.
		const ab = CONFIG.aberration
		const aberration =
			ab.base + ab.pulseAmp * (0.5 - 0.5 * Math.cos(ab.pulseCycles * phase * TAU + ab.pulsePhase))
		shd.setUniform('uAberration', aberration)

		shd.setUniform('uGhostFadeStart', CONFIG.ghost.fadeStart)
		shd.setUniform('uGhostFadeEnd', CONFIG.ghost.fadeEnd)

		shd.setUniform('uHueShift', (CONFIG.hueShift * Math.PI) / 180)

		p.rect(0, 0, p.width, p.height)

		// Auto-stop after exactly one loop. Stop BEFORE capturing the wrap frame
		// (offset == loopFrames is phase 0 again), keeping exactly loopFrames frames:
		// offsets 0 .. loopFrames-1, i.e. phases 0 .. (loopFrames-1)/loopFrames.
		if (cap.recording && offset >= CONFIG.loopFrames) {
			cap.stop()
			recordStartFrame = -1
		}

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
