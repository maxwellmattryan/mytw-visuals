import p5 from 'p5'
import { SIZES, createWebGLCanvas, centerCanvas } from '@lib/layout.js'
import { compileFilterShader } from '@lib/shaders.js'
import { createCapture } from '@lib/capture.js'
import { coverImage } from '@lib/image.js'

// ---------------------------------------------------------------------------
// CONFIG — tweak these values to adjust the effect
// ---------------------------------------------------------------------------
const CONFIG = {
	// Wave displacement (irrational ratios = organic, non-repeating motion)
	primaryFreq: 3.0, // sine wave cycles across image
	primarySpeed: 0.8, // drift speed
	primaryAmplitude: 0.018, // UV displacement amount (0.01–0.03 range)
	secondaryFreq: 2.0,
	secondarySpeed: 0.5, // different rate prevents mechanical feel
	secondaryAmplitude: 0.01,

	// Vertical pulse — displacement is stronger at bottom, travels upward
	verticalPulseSpeed: 1.2, // upward wave travel speed
	verticalPulseFreq: 5.0, // wave density along vertical axis
	verticalPulseDepth: 0.6, // 0 = no pulse, 1 = full bottom-up modulation

	// Hue shift — subtle color drift on its own cycle
	hueShiftAmount: 0.6, // max hue rotation in radians (~8°)
	hueShiftSpeed: 0.13, // deliberately slow, avoids all other rates

	// Chromatic aberration
	chromaticAmount: 0.006, // base RGB offset amount
	chromaticPulseSpeed: 0.4, // independent pulse speed
	chromaticPulseDepth: 0.85, // 0 = steady, 1 = pulses to zero

	// Recording
	recordFrames: 1440, // 30s at 48fps
	fps: 48,
}

// ---------------------------------------------------------------------------
// Fragment shader — sine wave UV displacement + pulsing chromatic aberration
// ---------------------------------------------------------------------------
const FRAG_WAVE_DISPLACEMENT = `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uPrimaryFreq;
uniform float uPrimarySpeed;
uniform float uPrimaryAmplitude;
uniform float uSecondaryFreq;
uniform float uSecondarySpeed;
uniform float uSecondaryAmplitude;
uniform float uChromaticAmount;
uniform float uVerticalPulseSpeed;
uniform float uVerticalPulseFreq;
uniform float uVerticalPulseDepth;
uniform float uHueShift;

// Hue rotation via Rodrigues' formula around the (1,1,1) luma axis
vec3 hueRotate(vec3 col, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  // rotation around normalized (1,1,1): R = c*I + (1-c)*kkT + s*K
  vec3 k = vec3(0.57735); // 1/sqrt(3)
  return col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
}

void main() {
  vec2 uv = vTexCoord;

  // Vertical pulse: stronger at bottom (uv.y=1), traveling upward
  float bottomBias = uv.y; // 0 at top, 1 at bottom
  float upwardWave = 0.5 + 0.5 * sin(uv.y * uVerticalPulseFreq + uTime * uVerticalPulseSpeed);
  float pulse = mix(1.0, bottomBias * (0.4 + 0.6 * upwardWave), uVerticalPulseDepth);

  // Primary wave: displace x based on y position
  uv.x += sin(uv.y * uPrimaryFreq + uTime * uPrimarySpeed) * uPrimaryAmplitude * pulse;

  // Secondary wave: displace y based on x position
  uv.y += sin(uv.x * uSecondaryFreq + uTime * uSecondarySpeed) * uSecondaryAmplitude * pulse;

  // Displacement magnitude drives chromatic aberration intensity
  float displaceX = sin(uv.y * uPrimaryFreq + uTime * uPrimarySpeed) * uPrimaryAmplitude * pulse;
  float displaceY = sin(uv.x * uSecondaryFreq + uTime * uSecondarySpeed) * uSecondaryAmplitude * pulse;
  float displaceMag = length(vec2(displaceX, displaceY));

  // Chromatic aberration: offset R/B channels, modulated by displacement
  vec2 chromOffset = vec2(uChromaticAmount) * (1.0 + displaceMag * 10.0);
  float r = texture2D(uTexture, uv + chromOffset).r;
  float g = texture2D(uTexture, uv).g;
  float b = texture2D(uTexture, uv - chromOffset).b;
  float a = texture2D(uTexture, uv).a;

  vec3 rgb = hueRotate(vec3(r, g, b), uHueShift);
  gl_FragColor = vec4(rgb, a);
}
`

// ---------------------------------------------------------------------------
// Sketch
// ---------------------------------------------------------------------------
const sketch = (p) => {
	let cnv
	let cap
	let gfx
	let shd
	let img
	let recordStartFrame = -1

	p.preload = () => {
		img = p.loadImage('/images/mytw-001.png')
	}

	p.setup = () => {
		cnv = createWebGLCanvas(p, SIZES.STORY)
		p.frameRate(CONFIG.fps)

		gfx = p.createGraphics(SIZES.STORY.width, SIZES.STORY.height)
		shd = compileFilterShader(p, FRAG_WAVE_DISPLACEMENT)

		cap = createCapture(cnv.elt, { framerate: CONFIG.fps })
		cap.bindKeys(p)

		// Wrap keyPressed to track recording start frame for auto-stop
		const existingKeyPressed = p.keyPressed
		p.keyPressed = () => {
			if ((p.key === 'r' || p.key === 'R') && !cap.recording) {
				recordStartFrame = p.frameCount
			}
			existingKeyPressed()
		}
	}

	p.draw = () => {
		// Continuous time in seconds — no looping, organic drift
		const time = p.frameCount / CONFIG.fps

		// Hue shift drifts on its own slow cycle
		const hueShift = Math.sin(time * CONFIG.hueShiftSpeed) * CONFIG.hueShiftAmount

		// Chromatic aberration pulses independently
		const chromPulse =
			1.0 - CONFIG.chromaticPulseDepth * (0.5 + 0.5 * Math.sin(time * CONFIG.chromaticPulseSpeed))
		const chromAmount = CONFIG.chromaticAmount * chromPulse

		// Draw image to offscreen 2D buffer (flipY corrects WebGL texture coords)
		gfx.background(0)
		coverImage(gfx, img, { flipY: true })

		// Apply shader
		p.shader(shd)
		shd.setUniform('uTexture', gfx)
		shd.setUniform('uTime', time)
		shd.setUniform('uPrimaryFreq', CONFIG.primaryFreq)
		shd.setUniform('uPrimarySpeed', CONFIG.primarySpeed)
		shd.setUniform('uPrimaryAmplitude', CONFIG.primaryAmplitude)
		shd.setUniform('uSecondaryFreq', CONFIG.secondaryFreq)
		shd.setUniform('uSecondarySpeed', CONFIG.secondarySpeed)
		shd.setUniform('uSecondaryAmplitude', CONFIG.secondaryAmplitude)
		shd.setUniform('uVerticalPulseSpeed', CONFIG.verticalPulseSpeed)
		shd.setUniform('uVerticalPulseFreq', CONFIG.verticalPulseFreq)
		shd.setUniform('uVerticalPulseDepth', CONFIG.verticalPulseDepth)
		shd.setUniform('uHueShift', hueShift)
		shd.setUniform('uChromaticAmount', chromAmount)
		p.rect(0, 0, p.width, p.height)

		// Auto-stop recording after configured duration
		if (cap.recording && recordStartFrame >= 0) {
			if (p.frameCount - recordStartFrame >= CONFIG.recordFrames) {
				cap.stop()
				recordStartFrame = -1
			}
		}

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
