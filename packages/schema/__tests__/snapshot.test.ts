import { describe, expect, it } from '@jest/globals'

import {
	defineSchema,
	param,
	PARAMS_FORMAT,
	PARAMS_FORMAT_VERSION,
	parseValues,
	serializeValues,
} from '@mytw/schema'

const schema = defineSchema({
	zoom: param.number({ label: 'Zoom', default: 1.1, min: 1, max: 4 }),
	cycles: param.number({ label: 'Cycles', default: 2, min: 1, max: 8, loopSafe: true }),
	layers: param.integer({ label: 'Layers', default: 3, min: 1, max: 6 }),
	on: param.boolean({ label: 'On', default: true }),
	blend: param.enum({ label: 'Blend', options: ['screen', 'add'], default: 'screen' }),
	tint: param.color({ label: 'Tint', default: '#aabbcc' }),
	offset: param.vec2({ label: 'Offset', default: [0.5, -0.5], min: -1, max: 1 }),
})

const valid = {
	zoom: 2.5,
	cycles: 3,
	layers: 4,
	on: false,
	blend: 'add',
	tint: '#112233',
	offset: [0.25, -0.75],
}

describe('serializeValues and parseValues', () => {
	it('round-trips every param kind', () => {
		const text = serializeValues(valid)
		expect(JSON.parse(text)).toEqual({
			format: PARAMS_FORMAT,
			version: PARAMS_FORMAT_VERSION,
			values: valid,
		})
		expect(text).toContain('\n\t"format": "mytw-params"')
		expect(parseValues(schema, text)).toEqual({ ok: true, values: valid, adjusted: [] })
	})

	it('accepts a bare values object', () => {
		expect(parseValues(schema, JSON.stringify(valid))).toEqual({
			ok: true,
			values: valid,
			adjusted: [],
		})
		const parsed = parseValues(schema, { zoom: 3 })
		expect(parsed).toEqual({
			ok: true,
			values: {
				...valid,
				zoom: 3,
				cycles: 2,
				layers: 3,
				on: true,
				blend: 'screen',
				tint: '#aabbcc',
				offset: [0.5, -0.5],
			},
			adjusted: [],
		})
	})

	it.each<[string, unknown, string]>([
		['non-JSON text', '{ zoom: 2', 'Not valid JSON'],
		['an empty string', '', 'Not valid JSON'],
		['a JSON array', '[1, 2]', 'Expected a JSON object'],
		['a JSON number', '42', 'Expected a JSON object'],
		['JSON null', 'null', 'Expected a JSON object'],
		[
			'a wrong format',
			{ format: 'other', version: 1, values: valid },
			'Not a mytw-params document',
		],
		[
			'a non-integer version',
			{ format: PARAMS_FORMAT, version: '1', values: valid },
			'Not a mytw-params document',
		],
		[
			'a newer version',
			{ format: PARAMS_FORMAT, version: 2, values: valid },
			'Saved by a newer version (v2)',
		],
		[
			'non-object values',
			{ format: PARAMS_FORMAT, version: 1, values: [1] },
			'Expected a JSON object',
		],
		['missing values', { format: PARAMS_FORMAT, version: 1 }, 'Expected a JSON object'],
		['no matching keys', { speed: 2, size: 3 }, 'None of these values belong to this sketch'],
		['an empty object', '{}', 'None of these values belong to this sketch'],
	])('rejects %s', (_name, input, message) => {
		expect(parseValues(schema, input)).toEqual({ ok: false, message })
	})

	it('coerces and reports adjusted values', () => {
		const result = parseValues(schema, {
			format: PARAMS_FORMAT,
			version: 1,
			values: { zoom: 9, cycles: 2.6, layers: 'many', on: true, offset: [5, -0.5], extra: 1 },
		})
		expect(result).toEqual({
			ok: true,
			values: {
				zoom: 4,
				cycles: 3,
				layers: 3,
				on: true,
				blend: 'screen',
				tint: '#aabbcc',
				offset: [1, -0.5],
			},
			adjusted: [
				{ kind: 'param', param: 'zoom', code: 'range', message: '"zoom": 9 is outside [1, 4]' },
				{
					kind: 'param',
					param: 'cycles',
					code: 'integer',
					message: '"cycles": expected an integer, got 2.6',
				},
				{
					kind: 'param',
					param: 'layers',
					code: 'type',
					message: '"layers": expected a finite number',
				},
				{
					kind: 'param',
					param: 'offset',
					code: 'range',
					message: '"offset": [5, -0.5] is outside [-1, 1]',
				},
				{ kind: 'param', param: 'extra', code: 'unknown', message: '"extra" is not a param' },
			],
		})
	})

	it('ignores __proto__ keys', () => {
		const result = parseValues(schema, '{ "zoom": 2, "__proto__": { "polluted": true } }')
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.values.zoom).toBe(2)
		expect(Object.keys(result.values)).not.toContain('__proto__')
		expect(Object.getPrototypeOf(result.values)).toBe(Object.prototype)
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
		expect((result.values as Record<string, unknown>).polluted).toBeUndefined()
		expect(result.adjusted.map((issue) => issue.message)).toEqual(['"__proto__" is not a param'])
	})
})
