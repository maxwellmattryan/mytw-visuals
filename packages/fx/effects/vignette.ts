import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '../effect'

/** Darkens toward the edges, from `inner` (untouched) to `outer` (fully darkened). */
export const vignette = defineEffect({
	id: 'vignette',
	version: 1,
	name: 'Vignette',
	params: defineSchema(
		{
			amount: param.number({ label: 'Amount', default: 0.2, min: 0, max: 1, step: 0.01 }),
			inner: param.number({ label: 'Inner', default: 0.35, min: 0, max: 1.5, step: 0.01 }),
			outer: param.number({ label: 'Outer', default: 0.95, min: 0, max: 1.5, step: 0.01 }),
		},
		{
			constraints: [
				{
					id: 'inner-below-outer',
					message: 'Inner must be less than outer',
					params: ['inner', 'outer'],
					check: (v) => v.inner < v.outer,
				},
			],
		}
	),
	glsl: `vec4 effect(vec2 uv) {
  vec4 color = texture(uInput, uv);
  float d = distance(uv, vec2(0.5));
  color.rgb *= mix(1.0, smoothstep(uOuter, uInner, d), uAmount);
  return color;
}`,
})
