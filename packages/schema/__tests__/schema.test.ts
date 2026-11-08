import { describe, expect, it } from '@jest/globals'

import {
	clampValues,
	defaults,
	defineSchema,
	param,
	SchemaDefinitionError,
	validate,
} from '@mytw/schema'
import type { ParamDefs, ParamKind, ParamValues } from '@mytw/schema'

const schema = defineSchema({
	zoom: param.number({ label: 'Zoom', default: 1.1, min: 1, max: 4, step: 0.01, unit: 'x' }),
	cycles: param.number({ label: 'Cycles', default: 2, min: 1, max: 8, loopSafe: true }),
	layers: param.integer({ label: 'Layers', default: 3, min: 1, max: 6, group: 'Layout' }),
	on: param.boolean({ label: 'On', default: true }),
	blend: param.enum({ label: 'Blend', options: ['screen', 'add'], default: 'screen' }),
	tint: param.color({ label: 'Tint', default: '#AABBCC' }),
	offset: param.vec2({ label: 'Offset', default: [0.5, -0.5], min: -1, max: 1 }),
})

const valid = {
	zoom: 2,
	cycles: 3,
	layers: 4,
	on: false,
	blend: 'add',
	tint: '#112233',
	offset: [0.25, 0.75],
}

// ── defaults ────────────────────────────────────────────────────────

describe('defaults', () => {
	it.each<[string, keyof typeof schema.params, ParamKind]>([
		['number', 'zoom', 'number'],
		['loop-safe number', 'cycles', 'number'],
		['integer', 'layers', 'integer'],
		['boolean', 'on', 'boolean'],
		['enum', 'blend', 'enum'],
		['color', 'tint', 'color'],
		['vec2', 'offset', 'vec2'],
	])('builds a %s definition', (_name, key, kind) => {
		expect(schema.params[key].kind).toBe(kind)
		expect(Object.isFrozen(schema.params[key])).toBe(true)
	})

	it("returns each param's default", () => {
		expect(defaults(schema)).toEqual({
			zoom: 1.1,
			cycles: 2,
			layers: 3,
			on: true,
			blend: 'screen',
			tint: '#AABBCC',
			offset: [0.5, -0.5],
		})
	})

	it('returns a fresh vec2 on every call', () => {
		const first = defaults(schema)
		first.offset[0] = 9
		expect(defaults(schema).offset).toEqual([0.5, -0.5])
		expect(schema.params.offset.default).toEqual([0.5, -0.5])
	})

	it('passes validate', () => {
		expect(validate(schema, defaults(schema)).ok).toBe(true)
	})
})

// ── clampValues ─────────────────────────────────────────────────────

describe('clampValues', () => {
	it.each<[string, Record<string, unknown>, Partial<ParamValues<typeof schema>>]>([
		['clamps a number above max', { zoom: 9 }, { zoom: 4 }],
		['clamps a number below min', { zoom: 0 }, { zoom: 1 }],
		['keeps an in-range number', { zoom: 1.5 }, { zoom: 1.5 }],
		['rounds a loop-safe number', { cycles: 2.6 }, { cycles: 3 }],
		['rounds then clamps a loop-safe number', { cycles: 20.4 }, { cycles: 8 }],
		['rounds an integer', { layers: 2.4 }, { layers: 2 }],
		['clamps an integer', { layers: -3 }, { layers: 1 }],
		['clamps each vec2 component', { offset: [-5, 5] }, { offset: [-1, 1] }],
		['uses the default for a missing value', {}, { zoom: 1.1, offset: [0.5, -0.5] }],
		['uses the default for a wrong-type number', { zoom: '2' }, { zoom: 1.1 }],
		['uses the default for NaN', { zoom: NaN }, { zoom: 1.1 }],
		['uses the default for Infinity', { layers: Infinity }, { layers: 3 }],
		['uses the default for a wrong-type boolean', { on: 1 }, { on: true }],
		['uses the default for a bad enum value', { blend: 'multiply' }, { blend: 'screen' }],
		['uses the default for a bad color', { tint: 'red' }, { tint: '#AABBCC' }],
		['uses the default for a wrong-type color', { tint: 0xffffff }, { tint: '#AABBCC' }],
		['lowercases a valid color', { tint: '#FFAA00' }, { tint: '#ffaa00' }],
		['uses the default for a non-array vec2', { offset: 1 }, { offset: [0.5, -0.5] }],
		['uses the default for a 3-element vec2', { offset: [0, 0, 0] }, { offset: [0.5, -0.5] }],
		[
			"uses a component's default for a non-finite component",
			{ offset: [NaN, 0.2] },
			{ offset: [0.5, 0.2] },
		],
	])('%s', (_name, input, expected) => {
		expect(clampValues(schema, input)).toEqual({ ...defaults(schema), ...expected })
	})

	it('drops unknown keys', () => {
		expect(clampValues(schema, { ...valid, extra: 1 })).toEqual(valid)
	})

	it('does not repair cross-parameter constraints', () => {
		const drift = defineSchema(
			{
				a: param.number({ label: 'A', default: 1 }),
				b: param.number({ label: 'B', default: 2 }),
			},
			{
				constraints: [
					{ id: 'a-lt-b', message: 'a < b', params: ['a', 'b'], check: (v) => v.a < v.b },
				],
			}
		)
		expect(clampValues(drift, { a: 5, b: 1 })).toEqual({ a: 5, b: 1 })
	})
})

// ── validate ────────────────────────────────────────────────────────

describe('validate', () => {
	it('returns ok with the values for valid input', () => {
		const input = { ...valid, offset: [0.25, 0.75] }
		const result = validate(schema, input)
		expect(result).toEqual({ ok: true, values: valid })
		if (result.ok) expect(result.values.offset).not.toBe(input.offset)
	})

	it.each([
		['missing', 'zoom', undefined],
		['type', 'zoom', '2'],
		['type', 'zoom', NaN],
		['type', 'on', 'yes'],
		['type', 'blend', 3],
		['type', 'tint', null],
		['type', 'offset', [1]],
		['type', 'offset', [1, 'a']],
		['range', 'zoom', 0.5],
		['range', 'layers', 7],
		['range', 'offset', [0, 2]],
		['integer', 'layers', 2.5],
		['integer', 'cycles', 1.5],
		['integer', 'cycles', 9.5],
		['option', 'blend', 'multiply'],
		['format', 'tint', '#abc'],
	])('reports %s for %s = %p', (code, key, value) => {
		const input: Record<string, unknown> = { ...valid }
		if (value === undefined) delete input[key]
		else input[key] = value
		const result = validate(schema, input)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.issues).toHaveLength(1)
			expect(result.issues[0]).toMatchObject({ kind: 'param', param: key, code })
		}
	})

	it('reports unknown keys', () => {
		const result = validate(schema, { ...valid, extra: 1 })
		expect(result).toMatchObject({
			ok: false,
			issues: [{ kind: 'param', param: 'extra', code: 'unknown' }],
		})
	})

	it('orders issues by schema key, then unknown keys', () => {
		const result = validate(schema, { extra: 1, ...valid, tint: 'red', zoom: 0 })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.issues.map((issue) => (issue.kind === 'param' ? issue.code : ''))).toEqual([
				'range',
				'format',
				'unknown',
			])
		}
	})

	it('does not change the input', () => {
		const input = { ...valid, zoom: 99, offset: [5, 5] }
		const snapshot = structuredClone(input)
		validate(schema, input)
		expect(input).toEqual(snapshot)
	})
})

// ── cross-parameter constraints ─────────────────────────────────────

describe('cross-parameter constraints', () => {
	const understory = defineSchema(
		{
			zoom: param.number({ label: 'Zoom', default: 1.1, min: 1, max: 2 }),
			driftAmp: param.number({ label: 'Drift amplitude', default: 0.012, min: 0, max: 0.2 }),
		},
		{
			constraints: [
				{
					id: 'drift-zoom-margin',
					message: 'Zoom must cover the drift so the edges never show',
					params: ['zoom', 'driftAmp'],
					check: (v) => v.zoom >= 1 / (1 - 2 * v.driftAmp),
				},
			],
		}
	)

	it('passes when the constraint holds', () => {
		expect(validate(understory, { zoom: 1.1, driftAmp: 0.012 })).toEqual({
			ok: true,
			values: { zoom: 1.1, driftAmp: 0.012 },
		})
	})

	it('reports one issue when the constraint fails', () => {
		const result = validate(understory, { zoom: 1, driftAmp: 0.1 })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.issues).toEqual([
				{
					kind: 'constraint',
					constraint: 'drift-zoom-margin',
					params: ['zoom', 'driftAmp'],
					message: 'Zoom must cover the drift so the edges never show',
				},
			])
		}
	})

	it('skips constraints when a param-level issue exists', () => {
		const result = validate(understory, { zoom: 1, driftAmp: 0.5 })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.issues).toEqual([expect.objectContaining({ param: 'driftAmp', code: 'range' })])
		}
	})

	it('reports constraints before unknown keys', () => {
		const result = validate(understory, { zoom: 1, driftAmp: 0.1, extra: true })
		expect(result.ok).toBe(false)
		if (!result.ok)
			expect(result.issues.map((issue) => issue.kind)).toEqual(['constraint', 'param'])
	})
})

// ── defineSchema ────────────────────────────────────────────────────

describe('defineSchema', () => {
	// Typed as the wide record so the table can hold definitions the builders' types rule out.
	const invalid: [string, ParamDefs][] = [
		['min > max', { x: param.number({ label: 'X', default: 1, min: 2, max: 0 }) }],
		['default above max', { x: param.number({ label: 'X', default: 5, min: 0, max: 1 }) }],
		['default below min', { x: param.integer({ label: 'X', default: -1, min: 0 }) }],
		['vec2 default out of range', { x: param.vec2({ label: 'X', default: [0, 3], max: 1 }) }],
		['NaN default', { x: param.number({ label: 'X', default: NaN }) }],
		['non-finite default', { x: param.number({ label: 'X', default: Infinity }) }],
		['bad color default', { x: param.color({ label: 'X', default: '#12345' }) }],
		[
			'enum default missing from options',
			{ x: { kind: 'enum', label: 'X', options: ['a'], default: 'b' } },
		],
		['non-integer integer default', { x: param.integer({ label: 'X', default: 1.5 }) }],
		[
			'non-integer loop-safe default',
			{ x: param.number({ label: 'X', default: 1.5, loopSafe: true }) },
		],
		['non-integer integer min', { x: param.integer({ label: 'X', default: 1, min: 0.5 }) }],
		[
			'non-integer loop-safe max',
			{ x: param.number({ label: 'X', default: 1, max: 2.5, loopSafe: true }) },
		],
		['empty options', { x: { kind: 'enum', label: 'X', options: [], default: 'a' } }],
		['duplicate options', { x: { kind: 'enum', label: 'X', options: ['a', 'a'], default: 'a' } }],
	]

	it.each(invalid)('throws for %s', (_name, params) => {
		expect(() => defineSchema(params)).toThrow(SchemaDefinitionError)
		expect(() => defineSchema(params)).toThrow(/"x"/)
	})

	const params: ParamDefs = {
		a: param.number({ label: 'A', default: 1 }),
		b: param.number({ label: 'B', default: 2 }),
	}

	it.each([
		[
			'duplicate constraint ids',
			[
				{ id: 'c', message: 'm', params: ['a'], check: () => true },
				{ id: 'c', message: 'm', params: ['b'], check: () => true },
			],
		],
		[
			'a constraint naming an unknown param',
			[{ id: 'c', message: 'm', params: ['z'], check: () => true }],
		],
		[
			'defaults failing a constraint',
			[{ id: 'c', message: 'm', params: ['a'], check: () => false }],
		],
	])('throws for %s', (_name, constraints) => {
		expect(() => defineSchema(params, { constraints })).toThrow(SchemaDefinitionError)
		expect(() => defineSchema(params, { constraints })).toThrow(/"c"/)
	})

	it('names the error', () => {
		try {
			defineSchema({ x: param.number({ label: 'X', default: 2, max: 1 }) })
		} catch (error) {
			expect(error).toBeInstanceOf(SchemaDefinitionError)
			expect(error).toHaveProperty('name', 'SchemaDefinitionError')
			return
		}
		throw new Error('expected defineSchema to throw')
	})

	it('accepts a valid schema', () => {
		expect(defineSchema(params).params).toBe(params)
	})
})

// ── Type inference ──────────────────────────────────────────────────

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

describe('ParamValues', () => {
	it('infers the value type of every kind', () => {
		type Expected = {
			zoom: number
			cycles: number
			layers: number
			on: boolean
			blend: 'screen' | 'add'
			tint: string
			offset: [number, number]
		}
		const fromSchema: Equal<ParamValues<typeof schema>, Expected> = true
		const fromParams: Equal<ParamValues<typeof schema.params>, Expected> = true
		expect(fromSchema).toBe(true)
		expect(fromParams).toBe(true)
	})
})
