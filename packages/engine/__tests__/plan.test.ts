import { describe, expect, it } from '@jest/globals'

import { planFrame } from '@mytw/engine'
import type { EffectInstance, Pass, RenderFrame, RenderLayer } from '@mytw/engine'

/** A pass as a short label: kind, plus its target for layer passes. */
function label(pass: Pass): string {
	if (pass.kind === 'layer') return pass.direct ? 'layer' : 'layer→temp'
	return pass.kind
}

const fx = (effect: string, enabled?: boolean): EffectInstance => ({ effect, enabled })

const base: RenderLayer = { id: 'base', image: 'img' }
const ghost: RenderLayer = {
	id: 'ghost',
	image: 'img',
	transform: { mirrorX: true, zoom: 1.7 },
	blend: 'multiply',
	mask: { kind: 'linear', from: [0.5, 0], to: [0.5, 1] },
}

describe('planFrame', () => {
	const cases: [string, RenderFrame, string[], (buffers: number) => boolean][] = [
		[
			'understory: two layers on one image, two global effects',
			{ layers: [base, ghost], effects: [fx('vignette'), fx('hue')] },
			['clear', 'layer', 'layer', 'effect', 'effect', 'present'],
			(b) => b === 2,
		],
		[
			'layer with two enabled effects and one disabled',
			{ layers: [{ ...base, effects: [fx('a'), fx('b', false), fx('c')] }] },
			['clear', 'layer→temp', 'effect', 'effect', 'composite', 'present'],
			(b) => b <= 4,
		],
		[
			'hidden and zero-opacity layers',
			{
				layers: [
					{ ...base, visible: false },
					{ ...ghost, opacity: 0 },
				],
			},
			['clear', 'present'],
			(b) => b === 1,
		],
		[
			'twenty layers with two effects each',
			{
				layers: Array.from({ length: 20 }, (_, i) => ({
					...base,
					id: `l${i}`,
					effects: [fx('a'), fx('b')],
				})),
			},
			[
				'clear',
				...Array.from({ length: 20 }, () => ['layer→temp', 'effect', 'effect', 'composite']).flat(),
				'present',
			],
			(b) => b <= 4,
		],
		['empty frame', { layers: [] }, ['clear', 'present'], (b) => b === 1],
	]

	it.each(cases)('%s', (_name, frame, expected, buffersOk) => {
		const plan = planFrame(frame)
		expect(plan.passes.map(label)).toEqual(expected)
		expect(buffersOk(plan.buffers)).toBe(true)
	})

	it('ping-pongs effects between distinct slots and presents the last one', () => {
		const plan = planFrame({
			layers: [{ ...base, effects: [fx('a'), fx('b')] }],
			effects: [fx('g1'), fx('g2'), fx('g3')],
		})
		for (const pass of plan.passes) {
			if (pass.kind === 'effect' && pass.target.kind === 'buffer') {
				expect(pass.input).not.toBe(pass.target.slot)
			}
		}
		const last = plan.passes[plan.passes.length - 2]
		const present = plan.passes[plan.passes.length - 1]
		expect(present.kind).toBe('present')
		expect(last.target).toEqual({
			kind: 'buffer',
			slot: present.kind === 'present' ? present.input : -1,
		})
		expect(present.target).toEqual({ kind: 'canvas' })
	})

	it('clears with the background and forces alpha to 1', () => {
		const [clear] = planFrame({ background: [0.1, 0.2, 0.3, 0], layers: [] }).passes
		expect(clear).toEqual({
			kind: 'clear',
			target: { kind: 'buffer', slot: 0 },
			color: [0.1, 0.2, 0.3, 1],
		})
	})
})
