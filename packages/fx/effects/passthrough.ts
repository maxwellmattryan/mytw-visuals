import { defineSchema } from '@mytw/schema'
import { defineEffect } from '../effect'

/** Outputs the input unchanged. */
export const passthrough = defineEffect({
	id: 'passthrough',
	version: 1,
	name: 'Passthrough',
	params: defineSchema({}),
	glsl: `vec4 effect(vec2 uv) {
  return texture(uInput, uv);
}`,
})
