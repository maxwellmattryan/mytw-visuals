import { describe, expect, it } from '@jest/globals'

import type { RenderFrame } from '@mytw/engine'
import { getEffect, uniformValues } from '@mytw/fx'
import type { EffectDefinition } from '@mytw/fx'

import { applyEffectPreview } from '../preview'

function effect(id: string): EffectDefinition {
	const definition = getEffect(id)
	if (!definition) throw new Error(`no effect ${id}`)
	return definition
}

function frame(): RenderFrame {
	return {
		background: [0, 0, 0, 1],
		layers: [
			{ id: 'base', image: 'a', effects: [] },
			{ id: 'ghost', image: 'b', effects: [{ effect: 'hue-shift', uniforms: { uDegrees: 10 } }] },
		],
		effects: [{ effect: 'vignette', enabled: true }],
	}
}

describe('applyEffectPreview', () => {
	it('appends the previewed effect to the target chain', () => {
		const vignette = effect('vignette')
		const expected = {
			effect: 'vignette',
			enabled: true,
			uniforms: { ...uniformValues(vignette, {}), uPhase: 0.25 },
		}
		expect(expected.uniforms).toEqual({ uAmount: 0.2, uInner: 0.35, uOuter: 0.95, uPhase: 0.25 })

		const input = frame()
		const onGhost = applyEffectPreview(
			input,
			{ target: { kind: 'layer', layerId: 'ghost' }, definition: vignette },
			0.25
		)
		expect(onGhost.layers[1].effects).toEqual([
			{ effect: 'hue-shift', uniforms: { uDegrees: 10 } },
			expected,
		])
		expect(onGhost.layers[0]).toBe(input.layers[0])
		expect(onGhost.effects).toBe(input.effects)

		const global = applyEffectPreview(
			input,
			{ target: { kind: 'global' }, definition: vignette },
			0.25
		)
		expect(global.effects).toEqual([{ effect: 'vignette', enabled: true }, expected])
		expect(global.layers).toBe(input.layers)
		// A frame with no global chain gets one.
		const bare = applyEffectPreview(
			{ layers: [] },
			{ target: { kind: 'global' }, definition: vignette },
			0
		)
		expect(bare.effects).toEqual([{ ...expected, uniforms: { ...expected.uniforms, uPhase: 0 } }])

		// No preview, or a layer that isn't in the frame, returns the same frame.
		expect(applyEffectPreview(input, null, 0.25)).toBe(input)
		expect(
			applyEffectPreview(
				input,
				{ target: { kind: 'layer', layerId: 'nope' }, definition: vignette },
				0.25
			)
		).toBe(input)

		// The input is never mutated.
		expect(input).toEqual(frame())
	})
})
