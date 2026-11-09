import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '../effect'

/** Horizontal CRT-style lines. */
export const scanlines = defineEffect({
	id: 'scanlines',
	version: 1,
	name: 'Scanlines',
	params: defineSchema({
		intensity: param.number({ label: 'Intensity', default: 0.1, min: 0, max: 1, step: 0.01 }),
		count: param.number({ label: 'Count', default: 400, min: 1, max: 2000, step: 1 }),
	}),
	chunks: ['math'],
	glsl: `vec4 effect(vec2 uv) {
  vec4 color = texture(uInput, uv);
  float line = sin(uv.y * uCount * PI) * uIntensity;
  return vec4(color.rgb - line, color.a);
}`,
})
