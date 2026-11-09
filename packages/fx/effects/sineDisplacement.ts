import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '../effect'

/** Ripples the image with sine waves that travel a whole number of cycles per loop. */
export const sineDisplacement = defineEffect({
	id: 'sine-displacement',
	version: 1,
	name: 'Sine displacement',
	params: defineSchema({
		amplitude: param.number({ label: 'Amplitude', default: 0.01, min: 0, max: 0.2, step: 0.001 }),
		frequency: param.number({ label: 'Frequency', default: 10, min: 0, max: 100, step: 0.5 }),
		cycles: param.integer({
			label: 'Cycles',
			default: 1,
			min: -8,
			max: 8,
			loopSafe: true,
			help: 'Wave cycles per loop. Negative values travel the other way.',
		}),
	}),
	chunks: ['math'],
	glsl: `vec4 effect(vec2 uv) {
  float t = uPhase * TAU * float(uCycles);
  vec2 p = uv;
  p.x += sin(p.y * uFrequency + t) * uAmplitude;
  p.y += cos(p.x * uFrequency + t) * uAmplitude;
  return texture(uInput, p);
}`,
})
