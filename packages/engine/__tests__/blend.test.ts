import { describe, expect, it } from '@jest/globals'

import { BLEND_STATES } from '@mytw/engine'
import type { BlendFactor, BlendMode } from '@mytw/engine'

type Rgba = [number, number, number, number]

/** One blend factor per channel, from premultiplied source and destination colour. */
function factor(name: BlendFactor, s: Rgba, d: Rgba): Rgba {
	switch (name) {
		case 'ONE':
			return [1, 1, 1, 1]
		case 'ONE_MINUS_SRC_ALPHA':
			return [1 - s[3], 1 - s[3], 1 - s[3], 1 - s[3]]
		case 'DST_COLOR':
			return [d[0], d[1], d[2], d[3]]
		case 'ONE_MINUS_SRC_COLOR':
			return [1 - s[0], 1 - s[1], 1 - s[2], 1 - s[3]]
	}
}

/** `src·srcFactor + dst·dstFactor` (FUNC_ADD), clamped like an RGBA8 target. */
function blend(mode: BlendMode, s: Rgba, d: Rgba): Rgba {
	const state = BLEND_STATES[mode]
	const fs = factor(state.src, s, d)
	const fd = factor(state.dst, s, d)
	const out: Rgba = [0, 0, 0, 0]
	for (let i = 0; i < 4; i++) out[i] = Math.min(1, s[i] * fs[i] + d[i] * fd[i])
	return out
}

/** Scales a premultiplied colour by a coverage such as opacity times mask. */
function scale(c: Rgba, k: number): Rgba {
	return [c[0] * k, c[1] * k, c[2] * k, c[3] * k]
}

function mix(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

describe('blend states', () => {
	const d: Rgba = [0.6, 0.4, 0.2, 1]
	const s: Rgba = [0.3, 0.5, 0.1, 0.5] // premultiplied, alpha 0.5
	const opaque: Rgba = [0.2, 0.7, 0.9, 1]

	const cases: [BlendMode, Rgba, (s: number, d: number, a: number) => number][] = [
		['normal', s, (sc, dc, a) => sc + dc * (1 - a)],
		['multiply', s, (sc, dc, a) => sc * dc + dc * (1 - a)],
		['screen', opaque, (sc, dc) => sc + dc - sc * dc],
		['add', s, (sc, dc) => Math.min(1, sc + dc)],
	]

	it.each(cases)('%s matches its documented result', (mode, src, expected) => {
		const out = blend(mode, src, d)
		for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(expected(src[i], d[i], src[3]), 6)
		expect(out[3]).toBeCloseTo(1, 6)
	})

	it('multiply at opacity 0.5 equals mix(d, s·d, 0.5)', () => {
		const out = blend('multiply', scale(opaque, 0.5), d)
		for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(mix(d[i], opaque[i] * d[i], 0.5), 6)
	})
})
