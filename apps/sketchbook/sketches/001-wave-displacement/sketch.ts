import p5 from 'p5'
import { SIZES, createWebGLCanvas, centerCanvas } from '@lib/layout'
import { compileFilterShader } from '@lib/shaders'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'
import { coverImage } from '@lib/image'
import { mountPanel } from '@mytw/panel'
import type { Panel } from '@mytw/panel'
import { loopSpeed, waveDisplacementSchema } from './params'

// The knobs live in ./params.ts and are tuned live in the panel. Every speed is
// derived from a whole number of cycles per loop, so the loop stays seamless.

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
const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let gfx: p5.Graphics
	let shd: p5.Shader
	let img: p5.Image
	let panel: Panel<typeof waveDisplacementSchema.params>
	let recordStartFrame = -1

	p.preload = () => {
		img = p.loadImage('/images/mytw-001.png')
	}

	p.setup = () => {
		cnv = createWebGLCanvas(p, SIZES.STORY)

		gfx = p.createGraphics(SIZES.STORY.width, SIZES.STORY.height)
		shd = compileFilterShader(p, FRAG_WAVE_DISPLACEMENT)

		cap = createCapture(cnv.elt)
		cap.bindKeys(p)

		panel = mountPanel(waveDisplacementSchema)
		const applyFps = (fps: number) => {
			p.frameRate(fps)
			cap.framerate = fps
		}
		applyFps(panel.values.fps)
		panel.onChange((v, key) => {
			if (key === 'fps' || key === null) applyFps(v.fps)
		})

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
		const v = panel.values

		// Looping time in seconds — wraps every loopDuration for a seamless loop.
		// A recording is exactly one loop of these frames.
		const loopFrames = v.loopDuration * v.fps
		const time = (p.frameCount % loopFrames) / v.fps

		// Hue shift drifts on its own slow cycle
		const hueShift = Math.sin(time * loopSpeed(v.hueShiftCycles, v.loopDuration)) * v.hueShiftAmount

		// Chromatic aberration pulses independently
		const chromaticPulseSpeed = loopSpeed(v.chromaticPulseCycles, v.loopDuration)
		const chromPulse =
			1.0 - v.chromaticPulseDepth * (0.5 + 0.5 * Math.sin(time * chromaticPulseSpeed))
		const chromAmount = v.chromaticAmount * chromPulse

		// Draw image to offscreen 2D buffer (flipY corrects WebGL texture coords)
		gfx.background(0)
		coverImage(gfx, img, { flipY: true })

		// Apply shader
		p.shader(shd)
		shd.setUniform('uTexture', gfx)
		shd.setUniform('uTime', time)
		shd.setUniform('uPrimaryFreq', v.primaryFreq)
		shd.setUniform('uPrimarySpeed', loopSpeed(v.primaryCycles, v.loopDuration))
		shd.setUniform('uPrimaryAmplitude', v.primaryAmplitude)
		shd.setUniform('uSecondaryFreq', v.secondaryFreq)
		shd.setUniform('uSecondarySpeed', loopSpeed(v.secondaryCycles, v.loopDuration))
		shd.setUniform('uSecondaryAmplitude', v.secondaryAmplitude)
		shd.setUniform('uVerticalPulseSpeed', loopSpeed(v.verticalPulseCycles, v.loopDuration))
		shd.setUniform('uVerticalPulseFreq', v.verticalPulseFreq)
		shd.setUniform('uVerticalPulseDepth', v.verticalPulseDepth)
		shd.setUniform('uHueShift', hueShift)
		shd.setUniform('uChromaticAmount', chromAmount)
		p.rect(0, 0, p.width, p.height)

		// Auto-stop recording after exactly one loop
		if (cap.recording && recordStartFrame >= 0) {
			if (p.frameCount - recordStartFrame >= loopFrames) {
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
