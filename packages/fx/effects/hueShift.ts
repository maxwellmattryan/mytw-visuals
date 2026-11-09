import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '../effect'

/** Rotates hue about the gray axis, which keeps luminance. */
export const hueShift = defineEffect({
	id: 'hue-shift',
	version: 1,
	name: 'Hue shift',
	params: defineSchema({
		degrees: param.number({
			label: 'Degrees',
			default: 0,
			min: -180,
			max: 180,
			step: 1,
			unit: '°',
		}),
	}),
	chunks: ['color'],
	glsl: `vec4 effect(vec2 uv) {
  vec4 color = texture(uInput, uv);
  return vec4(clamp(hueRotate(color.rgb, radians(uDegrees)), 0.0, 1.0), color.a);
}`,
})
