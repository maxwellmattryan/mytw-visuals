import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '../effect'

/** Splits the red and blue channels apart, either away from the center or sideways. */
export const chromaticAberration = defineEffect({
	id: 'chromatic-aberration',
	version: 1,
	name: 'Chromatic aberration',
	params: defineSchema({
		amount: param.number({ label: 'Amount', default: 0.001, min: 0, max: 0.05, step: 0.0005 }),
		mode: param.enum({
			label: 'Mode',
			options: ['radial', 'horizontal'],
			default: 'radial',
			help: 'Radial grows toward the edges; horizontal shifts the whole frame.',
		}),
	}),
	glsl: `vec4 effect(vec2 uv) {
  // mode 0: radial (zero at the center), mode 1: horizontal
  vec2 off = uMode == 0 ? (uv - 0.5) * uAmount : vec2(uAmount, 0.0);
  vec4 center = texture(uInput, uv);
  float r = texture(uInput, uv + off).r;
  float b = texture(uInput, uv - off).b;
  return vec4(r, center.g, b, center.a);
}`,
})
