import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '../effect'

/** Blends the input with the previous output frame, leaving trails. */
export const feedback = defineEffect({
	id: 'feedback',
	version: 1,
	name: 'Feedback',
	params: defineSchema({
		decay: param.number({
			label: 'Decay',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01,
			help: 'How much of the previous frame remains.',
		}),
	}),
	textures: ['previous'],
	glsl: `vec4 effect(vec2 uv) {
  return mix(texture(uInput, uv), texture(uPrevious, uv), uDecay);
}`,
})
