import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '../effect'

/**
 * A shimmering noise warp. The noise is sampled along a circle of `loopRadius` driven by the loop
 * phase, so it loops. The noise field is laid out y-up (`uv.y` flipped), the way Understory's p5
 * original drew it, so the same params give the same shimmer in the engine's y-down output UV.
 */
export const causticWarp = defineEffect({
	id: 'caustic-warp',
	version: 1,
	name: 'Caustic warp',
	params: defineSchema({
		amount: param.number({ label: 'Amount', default: 0.005, min: 0, max: 0.05, step: 0.0005 }),
		scale: param.number({ label: 'Scale', default: 2, min: 0.1, max: 10, step: 0.1 }),
		loopRadius: param.number({
			label: 'Loop radius',
			default: 0.8,
			min: 0,
			max: 4,
			step: 0.05,
			help: 'How far the noise travels over one loop.',
		}),
	}),
	chunks: ['math', 'noise'],
	glsl: `vec4 effect(vec2 uv) {
  vec2 loopOff = uLoopRadius * vec2(cos(uPhase * TAU), sin(uPhase * TAU));
  vec2 up = vec2(uv.x, 1.0 - uv.y);
  vec2 np = up * uScale + loopOff;
  vec2 warp = (vec2(fbm(np), fbm(np + vec2(31.7, 17.3))) - 0.5) * 2.0 * uAmount;
  return texture(uInput, uv + vec2(warp.x, -warp.y));
}`,
})
