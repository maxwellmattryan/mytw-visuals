import { describe, expect, it, jest } from '@jest/globals'

import { clamp, fbm, valueNoise2 } from '@lib/math'
import { compileTimeline, evaluate, loopIssues, TimelineError } from '@mytw/engine'
import type { FrameState, Modulator, TimelineDocument, TimelineParam } from '@mytw/engine'

const TAU = Math.PI * 2

function num(state: FrameState, id: string): number {
	const v = state[id]
	if (typeof v !== 'number') throw new Error(`${id} is not a number`)
	return v
}

function vec(state: FrameState, id: string): [number, number] {
	const v = state[id]
	if (!Array.isArray(v)) throw new Error(`${id} is not a vec2`)
	return v
}

/** The noise modulator output computed straight from the spec's formula. */
function noiseAt(seed: number, radius: number, x: number): number {
	const a = TAU * x
	const v = fbm((nx, ny) => valueNoise2(nx, ny, seed), radius * Math.cos(a), radius * Math.sin(a))
	return clamp((2 * v) / 0.9375 - 1, -1, 1)
}

function doc(
	params: Record<string, TimelineParam>,
	modulators: Record<string, Modulator> = {}
): TimelineDocument {
	return { params, modulators }
}

/**
 * Motion modelled on 002-understory's evalTransform and caustic loopOff: sine drift on
 * vec2 x/y, a breathe, a triangle wobble, a noise caustic offset shared by two layers and
 * a keyframe track whose ends match.
 */
function understory(): TimelineDocument {
	return doc(
		{
			'base.offset': { kind: 'vec2', value: [0, 0] },
			'ghost.offset': { kind: 'vec2', value: [0.01, -0.02] },
			'base.scale': { kind: 'number', value: 1, min: 0.5, max: 2 },
			'ghost.angle': { kind: 'number', value: 0.1 },
			'base.caustic': { kind: 'vec2', value: [0, 0] },
			'ghost.caustic': { kind: 'vec2', value: [0, 0] },
			'ghost.opacity': {
				kind: 'number',
				value: 0.5,
				min: 0,
				max: 1,
				keys: [
					{ t: 0, value: 0.4, ease: 'easeInOutQuad' },
					{ t: 0.5, value: 0.8, ease: 'easeInOutCubic' },
					{ t: 1, value: 0.4 },
				],
			},
			'ghost.mirror': { kind: 'boolean', value: true },
		},
		{
			driftX: {
				shape: 'sine',
				cycles: 1,
				targets: [
					{ param: 'base.offset', component: 0, amount: 0.05 },
					{ param: 'ghost.offset', component: 0, amount: -0.03 },
				],
			},
			driftY: {
				shape: 'sine',
				cycles: 2,
				phase: 0.25,
				targets: [
					{ param: 'base.offset', component: 1, amount: 0.05 },
					{ param: 'ghost.offset', component: 1, amount: -0.03 },
				],
			},
			breathe: {
				shape: 'sine',
				cycles: 2,
				phase: 0.1,
				targets: [{ param: 'base.scale', amount: 0.04 }],
			},
			wobble: {
				shape: 'triangle',
				cycles: 3,
				phase: 0.35,
				targets: [{ param: 'ghost.angle', amount: 0.2 }],
			},
			causticX: {
				shape: 'noise',
				cycles: 1,
				seed: 3,
				radius: 1.5,
				targets: [
					{ param: 'base.caustic', component: 0, amount: 0.02 },
					{ param: 'ghost.caustic', component: 0, amount: 0.02 },
				],
			},
			causticY: {
				shape: 'noise',
				cycles: 1,
				seed: 4,
				radius: 1.5,
				targets: [
					{ param: 'base.caustic', component: 1, amount: 0.02 },
					{ param: 'ghost.caustic', component: 1, amount: 0.02 },
				],
			},
		}
	)
}

function expectStatesClose(a: FrameState, b: FrameState, digits = 9) {
	expect(Object.keys(a)).toEqual(Object.keys(b))
	for (const id of Object.keys(a)) {
		const va = a[id]
		const vb = b[id]
		if (Array.isArray(va)) {
			const wb = vec(b, id)
			expect(va[0]).toBeCloseTo(wb[0], digits)
			expect(va[1]).toBeCloseTo(wb[1], digits)
		} else if (typeof va === 'number') {
			expect(va).toBeCloseTo(num(b, id), digits)
		} else {
			expect(va).toBe(vb)
		}
	}
}

describe('timeline', () => {
	it('resolves static params of every kind', () => {
		const d = doc({
			n: { kind: 'number', value: 1.5, min: 0, max: 2 },
			v: { kind: 'vec2', value: [3, -4] },
			i: { kind: 'integer', value: 7 },
			b: { kind: 'boolean', value: false },
			e: { kind: 'enum', value: 'screen' },
			c: { kind: 'color', value: '#ff8800' },
		})
		const before = structuredClone(d)
		const state = evaluate(d, 0.37)
		expect(state).toEqual({
			n: 1.5,
			v: [3, -4],
			i: 7,
			b: false,
			e: 'screen',
			c: '#ff8800',
		})
		expect(d).toEqual(before)
		expect(compileTimeline(d).paramIds).toEqual(['n', 'v', 'i', 'b', 'e', 'c'])
	})

	it('evaluates an empty document to an empty state', () => {
		expect(evaluate({ params: {}, modulators: {} }, 0)).toEqual({})
	})

	it('ignores a modulator with no targets', () => {
		const d = doc(
			{ n: { kind: 'number', value: 2 } },
			{ idle: { shape: 'sine', cycles: 1, targets: [] } }
		)
		expect(evaluate(d, 0.25)).toEqual({ n: 2 })
	})

	describe('applies modulators with per-target amounts', () => {
		const shapes: [string, Omit<Modulator, 'targets'>, number, number][] = [
			['sine at x = 0.25 gives +1', { shape: 'sine', cycles: 1 }, 0.25, 1],
			['sine at x = 0.75 gives -1', { shape: 'sine', cycles: 1 }, 0.75, -1],
			[
				'sine with 2 cycles and phase 0.25 gives +1 at t = 0',
				{ shape: 'sine', cycles: 2, phase: 0.25 },
				0,
				1,
			],
			['triangle at x = 0 gives 0', { shape: 'triangle', cycles: 1 }, 0, 0],
			['triangle at x = 0.25 gives +1', { shape: 'triangle', cycles: 1 }, 0.25, 1],
			['triangle at x = 0.5 gives 0', { shape: 'triangle', cycles: 1 }, 0.5, 0],
			['triangle at x = 0.75 gives -1', { shape: 'triangle', cycles: 1 }, 0.75, -1],
			['triangle at x = 0.125 gives 0.5', { shape: 'triangle', cycles: 1 }, 0.125, 0.5],
			['noise seed 5 at x = 0.3', { shape: 'noise', cycles: 1, seed: 5 }, 0.3, noiseAt(5, 1, 0.3)],
			[
				'noise with radius 2, 2 cycles and phase 0.1',
				{ shape: 'noise', cycles: 2, phase: 0.1, radius: 2 },
				0.2,
				noiseAt(0, 2, 0.5),
			],
		]

		it.each(shapes)('%s', (_name, mod, phase, out) => {
			const d = doc(
				{
					a: { kind: 'number', value: 10 },
					b: { kind: 'vec2', value: [1, 2] },
				},
				{
					m: {
						...mod,
						targets: [
							{ param: 'a', amount: 2 },
							{ param: 'b', component: 1, amount: -3 },
						],
					},
				}
			)
			const state = evaluate(d, phase)
			expect(num(state, 'a')).toBeCloseTo(10 + 2 * out, 12)
			expect(vec(state, 'b')[0]).toBe(1)
			expect(vec(state, 'b')[1]).toBeCloseTo(2 - 3 * out, 12)
		})

		it('sums several modulators on one channel', () => {
			const d = doc(
				{ a: { kind: 'number', value: 0 } },
				{
					s: { shape: 'sine', cycles: 1, targets: [{ param: 'a', amount: 1 }] },
					t: { shape: 'triangle', cycles: 1, targets: [{ param: 'a', amount: 0.5 }] },
				}
			)
			expect(num(evaluate(d, 0.25), 'a')).toBeCloseTo(1.5, 12)
		})

		it('clamps to min and max after modulation', () => {
			const d = doc(
				{
					a: { kind: 'number', value: 0.9, min: 0, max: 1 },
					b: { kind: 'vec2', value: [0.1, 0.5], min: 0, max: 1 },
				},
				{
					s: {
						shape: 'sine',
						cycles: 1,
						targets: [
							{ param: 'a', amount: 0.5 },
							{ param: 'b', component: 0, amount: -0.5 },
						],
					},
				}
			)
			expect(evaluate(d, 0.25)).toEqual({ a: 1, b: [0, 0.5] })
		})
	})

	it('noise modulators loop on a closed path', () => {
		const make = (seed: number, cycles = 1) =>
			doc(
				{ a: { kind: 'number', value: 0 } },
				{ n: { shape: 'noise', cycles, seed, radius: 1.5, targets: [{ param: 'a', amount: 0.7 }] } }
			)
		const same1 = make(1)
		const same2 = make(1)
		const other = make(2)
		const looped = make(1, 3)
		let differing = 0
		for (let i = 0; i < 100; i++) {
			const t = i / 100
			const v = num(evaluate(same1, t), 'a')
			expect(num(evaluate(same2, t), 'a')).toBe(v)
			if (num(evaluate(other, t), 'a') !== v) differing++
			expect(v).toBeGreaterThanOrEqual(-0.7)
			expect(v).toBeLessThanOrEqual(0.7)
			expect(num(evaluate(same1, t + 1), 'a')).toBeCloseTo(v, 9)
			expect(num(evaluate(looped, t + 1 / 3), 'a')).toBeCloseTo(num(evaluate(looped, t), 'a'), 9)
		}
		expect(differing).toBeGreaterThan(90)
	})

	it('interpolates keyframes with easing', () => {
		const d = doc({
			cubic: {
				kind: 'number',
				value: 0,
				keys: [
					{ t: 0, value: 10, ease: 'easeInCubic' },
					{ t: 1, value: 20 },
				],
			},
			lin: {
				kind: 'number',
				value: 0,
				keys: [
					{ t: 0.2, value: 0 },
					{ t: 0.6, value: 4 },
				],
			},
			step: {
				kind: 'number',
				value: 0,
				keys: [
					{ t: 0.2, value: 1, ease: 'hold' },
					{ t: 0.6, value: 5 },
				],
			},
			pos: {
				kind: 'vec2',
				value: [0, 0],
				keys: [
					{ t: 0, value: [0, 100], ease: 'easeOutCubic' },
					{ t: 0.5, value: [8, 50] },
				],
			},
		})
		// easeInCubic(0.5) = 0.125
		expect(num(evaluate(d, 0.5), 'cubic')).toBeCloseTo(11.25, 12)
		// linear is the default
		expect(num(evaluate(d, 0.3), 'lin')).toBeCloseTo(1, 12)
		// before the first key and after the last key hold
		expect(num(evaluate(d, 0), 'lin')).toBe(0)
		expect(num(evaluate(d, 0.9), 'lin')).toBe(4)
		expect(num(evaluate(d, -2), 'cubic')).toBe(10)
		expect(num(evaluate(d, 3), 'cubic')).toBe(20)
		// hold steps at the next key
		expect(num(evaluate(d, 0.1), 'step')).toBe(1)
		expect(num(evaluate(d, 0.59), 'step')).toBe(1)
		expect(num(evaluate(d, 0.6), 'step')).toBe(5)
		// vec2 eases each component with the same u: easeOutCubic(0.5) = 0.875
		const [x, y] = vec(evaluate(d, 0.25), 'pos')
		expect(x).toBeCloseTo(7, 12)
		expect(y).toBeCloseTo(100 - 50 * 0.875, 12)
		expect(evaluate(d, 0.75).pos).toEqual([8, 50])
	})

	it('adds modulation on top of a keyframe track', () => {
		const d = doc(
			{
				a: {
					kind: 'number',
					value: 0,
					keys: [
						{ t: 0, value: 0 },
						{ t: 1, value: 1 },
					],
				},
			},
			{ s: { shape: 'sine', cycles: 1, targets: [{ param: 'a', amount: 0.1 }] } }
		)
		expect(num(evaluate(d, 0.25), 'a')).toBeCloseTo(0.35, 12)
	})

	describe('phase 1 equals phase 0 for loop-safe documents', () => {
		it('resolves every value at phase 1 to its phase 0 value', () => {
			const d = understory()
			const start = evaluate(d, 0)
			const end = evaluate(d, 1)
			expectStatesClose(end, start, 9)
			// The fixture really moves: every animated param differs mid-loop.
			const mid = evaluate(d, 0.3)
			for (const id of Object.keys(start)) {
				if (id === 'ghost.mirror') continue
				expect(mid[id]).not.toEqual(start[id])
			}
			expect(loopIssues(d)).toEqual([])
		})

		it('reports keyframe tracks whose ends differ', () => {
			const d = doc({
				ok: {
					kind: 'number',
					value: 0,
					keys: [
						{ t: 0.1, value: 1 },
						{ t: 0.9, value: 1 },
					],
				},
				fade: {
					kind: 'number',
					value: 0,
					keys: [
						{ t: 0, value: 0 },
						{ t: 1, value: 1 },
					],
				},
				pan: {
					kind: 'vec2',
					value: [0, 0],
					keys: [
						{ t: 0, value: [0, 0] },
						{ t: 0.5, value: [1, 1] },
						{ t: 1, value: [0, 2] },
					],
				},
			})
			const issues = loopIssues(d)
			expect(issues.map((i) => i.param)).toEqual(['fade', 'pan'])
			for (const issue of issues) expect(issue.message.length).toBeGreaterThan(0)
		})
	})

	describe('rejects invalid documents', () => {
		const valid = (): TimelineDocument =>
			doc(
				{
					n: {
						kind: 'number',
						value: 1,
						keys: [
							{ t: 0, value: 0 },
							{ t: 1, value: 1 },
						],
					},
					v: { kind: 'vec2', value: [0, 0] },
					mode: { kind: 'enum', value: 'add' },
				},
				{
					m: { shape: 'sine', cycles: 1, targets: [{ param: 'n', amount: 1 }] },
				}
			)
		type Mutable = {
			params: Record<string, Record<string, unknown>>
			modulators: Record<string, Record<string, unknown>>
		}
		const rows: [string, (d: Mutable) => void, string][] = [
			[
				'unknown target param',
				(d) => (d.modulators.m.targets = [{ param: 'nope', amount: 1 }]),
				'modulators.m.targets[0].param',
			],
			[
				'non-animatable target',
				(d) => (d.modulators.m.targets = [{ param: 'mode', amount: 1 }]),
				'modulators.m.targets[0].param',
			],
			[
				'vec2 target without component',
				(d) => (d.modulators.m.targets = [{ param: 'v', amount: 1 }]),
				'modulators.m.targets[0].component',
			],
			[
				'number target with component',
				(d) => (d.modulators.m.targets = [{ param: 'n', amount: 1, component: 0 }]),
				'modulators.m.targets[0].component',
			],
			['fractional cycles', (d) => (d.modulators.m.cycles = 1.5), 'modulators.m.cycles'],
			['zero cycles', (d) => (d.modulators.m.cycles = 0), 'modulators.m.cycles'],
			['negative cycles', (d) => (d.modulators.m.cycles = -2), 'modulators.m.cycles'],
			[
				'descending keyframes',
				(d) =>
					(d.params.n.keys = [
						{ t: 0.5, value: 0 },
						{ t: 0.2, value: 1 },
					]),
				'params.n.keys[1].t',
			],
			[
				'duplicate keyframe times',
				(d) =>
					(d.params.n.keys = [
						{ t: 0.5, value: 0 },
						{ t: 0.5, value: 1 },
					]),
				'params.n.keys[1].t',
			],
			[
				'non-finite keyframe value',
				(d) => (d.params.n.keys = [{ t: 0, value: NaN }]),
				'params.n.keys[0].value',
			],
			[
				'non-finite vec2 keyframe value',
				(d) =>
					(d.params.v.keys = [
						{ t: 0, value: [0, 0] },
						{ t: 1, value: [Infinity, 0] },
					]),
				'params.v.keys[1].value',
			],
			[
				'non-finite keyframe time',
				(d) => (d.params.n.keys = [{ t: Infinity, value: 0 }]),
				'params.n.keys[0].t',
			],
			['non-finite value', (d) => (d.params.n.value = NaN), 'params.n.value'],
			['non-finite vec2 value', (d) => (d.params.v.value = [0, -Infinity]), 'params.v.value'],
			[
				'non-finite target amount',
				(d) => (d.modulators.m.targets = [{ param: 'n', amount: NaN }]),
				'modulators.m.targets[0].amount',
			],
			[
				'unknown ease',
				(d) =>
					(d.params.n.keys = [
						{ t: 0, value: 0, ease: 'bounce' },
						{ t: 1, value: 1 },
					]),
				'params.n.keys[0].ease',
			],
		]

		it.each(rows)('%s', (_name, mutate, path) => {
			const d = valid()
			mutate(d as unknown as Mutable)
			let caught: unknown
			try {
				compileTimeline(d)
			} catch (err) {
				caught = err
			}
			expect(caught).toBeInstanceOf(TimelineError)
			expect(caught).toBeInstanceOf(Error)
			expect((caught as TimelineError).path).toBe(path)
			expect(() => evaluate(d, 0)).toThrow(TimelineError)
		})

		it.each([NaN, Infinity, -Infinity])('throws RangeError for phase %p', (phase) => {
			const d = valid()
			expect(() => evaluate(d, phase)).toThrow(RangeError)
			expect(() => compileTimeline(d).evaluate(phase)).toThrow(RangeError)
		})
	})

	it('is pure', () => {
		const random = jest.spyOn(Math, 'random')
		const dateNow = jest.spyOn(Date, 'now')
		const perfNow = jest.spyOn(performance, 'now')
		const phases = Array.from({ length: 240 }, (_, i) => i / 240)
		const inOrder = phases.map((t) => evaluate(understory(), t))
		const d = understory()
		const shuffled = phases.map((_, i) => phases[(i * 97) % phases.length])
		const outOfOrder = new Map(shuffled.map((t) => [t, evaluate(d, t)]))
		const calls = [random.mock.calls.length, dateNow.mock.calls.length, perfNow.mock.calls.length]
		random.mockRestore()
		dateNow.mockRestore()
		perfNow.mockRestore()

		expect(calls).toEqual([0, 0, 0])
		expect(outOfOrder.size).toBe(phases.length)
		phases.forEach((t, i) => expect(outOfOrder.get(t)).toEqual(inOrder[i]))
	})

	describe('reuses the output object', () => {
		it('writes into out and keeps vec2 arrays', () => {
			const timeline = compileTimeline(understory())
			const out: FrameState = {}
			expect(timeline.evaluate(0.1, out)).toBe(out)
			const offset = out['base.offset']
			const caustic = out['ghost.caustic']
			const before = [...vec(out, 'base.offset')]
			expect(timeline.evaluate(0.6, out)).toBe(out)
			expect(out['base.offset']).toBe(offset)
			expect(out['ghost.caustic']).toBe(caustic)
			expect(out['base.offset']).not.toEqual(before)
			expect(out).toEqual(timeline.evaluate(0.6))
		})

		it('replaces an out entry that is not a 2-element array', () => {
			const out: FrameState = { 'base.offset': 3 }
			evaluate(understory(), 0.2, out)
			expect(vec(out, 'base.offset')).toHaveLength(2)
		})

		it('compiles each document object once', () => {
			const d = understory()
			const params = d.params
			let reads = 0
			const counted: TimelineDocument = {
				get params() {
					reads++
					return params
				},
				modulators: d.modulators,
			}
			evaluate(counted, 0)
			const afterFirst = reads
			expect(afterFirst).toBeGreaterThan(0)
			evaluate(counted, 0.5)
			evaluate(counted, 0.75, {})
			expect(reads).toBe(afterFirst)
		})
	})
})
