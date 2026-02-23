import { jest } from '@jest/globals'

import {
	easeInOutQuad,
	easeOutCubic,
	easeInCubic,
	easeInOutCubic,
	easeOutExpo,
	easeInOutExpo,
	mapRange,
	loopValue,
	smoothstep,
	clamp,
	lerp,
	sinN,
	cosN,
	fbm,
} from '../math.js'

// ── Easing helpers ──────────────────────────────────────────────────

const easingFunctions = [
	['easeInOutQuad', easeInOutQuad],
	['easeOutCubic', easeOutCubic],
	['easeInCubic', easeInCubic],
	['easeInOutCubic', easeInOutCubic],
	['easeOutExpo', easeOutExpo],
	['easeInOutExpo', easeInOutExpo],
]

describe.each(easingFunctions)('%s', (_name, fn) => {
	it('returns 0 at t=0', () => {
		expect(fn(0)).toBeCloseTo(0)
	})

	it('returns 1 at t=1', () => {
		expect(fn(1)).toBeCloseTo(1)
	})

	it('returns a value between 0 and 1 at t=0.5', () => {
		const mid = fn(0.5)
		expect(mid).toBeGreaterThanOrEqual(0)
		expect(mid).toBeLessThanOrEqual(1)
	})

	it('is monotonically increasing from 0 to 1', () => {
		let prev = fn(0)
		for (let t = 0.05; t <= 1.0; t += 0.05) {
			const cur = fn(t)
			expect(cur).toBeGreaterThanOrEqual(prev - 1e-9)
			prev = cur
		}
	})
})

// ── Specific midpoint values ────────────────────────────────────────

describe('easing midpoint values', () => {
	it('easeInOutQuad(0.5) === 0.5', () => {
		expect(easeInOutQuad(0.5)).toBeCloseTo(0.5)
	})

	it('easeInOutCubic(0.5) === 0.5', () => {
		expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
	})

	it('easeInOutExpo(0.5) === 0.5', () => {
		expect(easeInOutExpo(0.5)).toBeCloseTo(0.5)
	})
})

// ── mapRange ────────────────────────────────────────────────────────

describe('mapRange', () => {
	it('maps inMin to outMin', () => {
		expect(mapRange(0, 0, 10, 100, 200)).toBeCloseTo(100)
	})

	it('maps inMax to outMax', () => {
		expect(mapRange(10, 0, 10, 100, 200)).toBeCloseTo(200)
	})

	it('maps midpoint correctly', () => {
		expect(mapRange(5, 0, 10, 100, 200)).toBeCloseTo(150)
	})

	it('works with negative ranges', () => {
		expect(mapRange(0, -10, 10, 0, 100)).toBeCloseTo(50)
	})
})

// ── loopValue ───────────────────────────────────────────────────────

describe('loopValue', () => {
	it('returns 0 at frame 0', () => {
		expect(loopValue(0, 60)).toBe(0)
	})

	it('wraps at period boundary', () => {
		expect(loopValue(60, 60)).toBeCloseTo(0)
	})

	it('returns 0.5 at midpoint', () => {
		expect(loopValue(30, 60)).toBeCloseTo(0.5)
	})
})

// ── smoothstep ──────────────────────────────────────────────────────

describe('smoothstep', () => {
	it('returns 0 below edge0', () => {
		expect(smoothstep(0, 1, -0.5)).toBe(0)
	})

	it('returns 1 above edge1', () => {
		expect(smoothstep(0, 1, 1.5)).toBe(1)
	})

	it('returns 0.5 at midpoint', () => {
		expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5)
	})
})

// ── clamp ───────────────────────────────────────────────────────────

describe('clamp', () => {
	it('clamps below min', () => {
		expect(clamp(-5, 0, 10)).toBe(0)
	})

	it('clamps above max', () => {
		expect(clamp(15, 0, 10)).toBe(10)
	})

	it('passes through values in range', () => {
		expect(clamp(5, 0, 10)).toBe(5)
	})
})

// ── lerp ────────────────────────────────────────────────────────────

describe('lerp', () => {
	it('returns a at t=0', () => {
		expect(lerp(10, 20, 0)).toBe(10)
	})

	it('returns b at t=1', () => {
		expect(lerp(10, 20, 1)).toBe(20)
	})

	it('returns midpoint at t=0.5', () => {
		expect(lerp(10, 20, 0.5)).toBeCloseTo(15)
	})
})

// ── sinN / cosN ─────────────────────────────────────────────────────

describe('sinN', () => {
	it('returns 0.5 at t=0', () => {
		expect(sinN(0)).toBeCloseTo(0.5)
	})

	it('stays in [0, 1]', () => {
		for (let t = 0; t < 2 * Math.PI; t += 0.1) {
			expect(sinN(t)).toBeGreaterThanOrEqual(0)
			expect(sinN(t)).toBeLessThanOrEqual(1)
		}
	})
})

describe('cosN', () => {
	it('returns 1 at t=0', () => {
		expect(cosN(0)).toBeCloseTo(1)
	})

	it('stays in [0, 1]', () => {
		for (let t = 0; t < 2 * Math.PI; t += 0.1) {
			expect(cosN(t)).toBeGreaterThanOrEqual(0)
			expect(cosN(t)).toBeLessThanOrEqual(1)
		}
	})
})

// ── fbm ─────────────────────────────────────────────────────────────

describe('fbm', () => {
	it('calls noiseFn once per octave', () => {
		const mock = jest.fn(() => 0.5)
		fbm(mock, 1, 2, 4)
		expect(mock).toHaveBeenCalledTimes(4)
	})

	it('calls noiseFn the default 4 times when octaves omitted', () => {
		const mock = jest.fn(() => 0.5)
		fbm(mock, 0, 0)
		expect(mock).toHaveBeenCalledTimes(4)
	})

	it('doubles frequency each octave', () => {
		const calls = []
		const mock = jest.fn((x, y) => {
			calls.push({ x, y })
			return 0.5
		})
		fbm(mock, 1, 1, 3)
		expect(calls[0]).toEqual({ x: 1, y: 1 })
		expect(calls[1]).toEqual({ x: 2, y: 2 })
		expect(calls[2]).toEqual({ x: 4, y: 4 })
	})

	it('halves amplitude each octave (constant noise → predictable sum)', () => {
		const mock = jest.fn(() => 1)
		// amplitudes: 0.5, 0.25, 0.125 → sum = 0.875
		const result = fbm(mock, 0, 0, 3)
		expect(result).toBeCloseTo(0.875)
	})
})
