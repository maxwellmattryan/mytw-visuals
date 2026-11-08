import { describe, expect, it, jest } from '@jest/globals'

import { defineSchema, param } from '@mytw/schema'
import type { ParamDef } from '@mytw/schema'

import {
	createPanelState,
	describedBy,
	groupParams,
	isToggleKey,
	NOT_A_NUMBER,
	parseNumberInput,
	sliderFor,
	stepValue,
} from '../state'

function makeSchema() {
	return defineSchema(
		{
			speed: param.number({ label: 'Speed', default: 1, min: 0, max: 4 }),
			count: param.integer({ label: 'Count', default: 3, min: 1, max: 12 }),
			shape: param.enum({
				label: 'Shape',
				options: ['circle', 'square'],
				default: 'circle',
				group: 'Shape',
			}),
			fill: param.color({ label: 'Fill', default: '#ff8800', group: 'Color' }),
			size: param.number({ label: 'Size', default: 100, min: 10, max: 300, group: 'Shape' }),
			cycles: param.number({ label: 'Cycles', default: 2, min: 1, max: 8, loopSafe: true }),
			offset: param.vec2({ label: 'Offset', default: [0, 0], min: -200, max: 200 }),
			jitter: param.number({ label: 'Jitter', default: 0.5 }),
		},
		{
			constraints: [
				{
					id: 'size-fits',
					message: 'size × count must be at most 1200',
					params: ['size', 'count'],
					check: (v) => v.size * v.count <= 1200,
				},
			],
		}
	)
}

describe('createPanelState', () => {
	it('applies a valid value in place and notifies listeners', () => {
		const state = createPanelState(makeSchema())
		const values = state.values
		const listener = jest.fn()
		const unsubscribe = state.onChange(listener)

		expect(state.set('speed', 2.5)).toEqual({ ok: true })
		expect(state.values).toBe(values)
		expect(values.speed).toBe(2.5)
		expect(listener).toHaveBeenCalledWith(values, 'speed')

		expect(state.setText('offset', ' 12.5 ', 1)).toEqual({ ok: true })
		expect(values.offset).toEqual([0, 12.5])
		expect(listener).toHaveBeenLastCalledWith(values, 'offset')

		const pair: [number, number] = [5, 6]
		state.set('offset', pair)
		pair[0] = 99
		expect(values.offset).toEqual([5, 6])

		unsubscribe()
		state.set('speed', 3)
		expect(listener).toHaveBeenCalledTimes(3)
	})

	it.each<[string, 'speed' | 'count' | 'cycles' | 'offset', string, string]>([
		['number text that does not parse', 'speed', 'abc', 'Enter a number'],
		['empty number text', 'speed', '  ', 'Enter a number'],
		['an out-of-range number', 'speed', '9', '"speed": 9 is outside [0, 4]'],
		['a non-integer for an integer', 'count', '2.5', '"count": expected an integer, got 2.5'],
		[
			'a non-integer for a loop-safe number',
			'cycles',
			'1.5',
			'"cycles": expected an integer, got 1.5',
		],
		[
			'an out-of-range vec2 component',
			'offset',
			'500',
			'"offset": [500, 0] is outside [-200, 200]',
		],
	])('rejects invalid input with a message: %s', (_name, key, text, message) => {
		const state = createPanelState(makeSchema())
		const before = structuredClone(state.values)
		const listener = jest.fn()
		state.onChange(listener)

		expect(state.setText(key, text, 0)).toEqual({ ok: false, message })
		expect(state.values).toEqual(before)
		expect(state.errors[key]).toBe(message)
		expect(listener).not.toHaveBeenCalled()

		state.clearError(key)
		expect(state.errors[key]).toBeUndefined()
	})

	it('rejects invalid input with a message: a bad hex color', () => {
		const state = createPanelState(makeSchema())
		const result = state.set('fill', '#12345')
		expect(result).toEqual({ ok: false, message: '"fill": "#12345" is not a #rrggbb color' })
		expect(state.values.fill).toBe('#ff8800')
		expect(state.errors.fill).toBe('"fill": "#12345" is not a #rrggbb color')

		state.set('fill', '#00ff00')
		expect(state.values.fill).toBe('#00ff00')
		expect(state.errors.fill).toBeUndefined()
	})

	it('applies values that break a constraint and reports it', () => {
		const state = createPanelState(makeSchema())
		expect(state.constraintIssues).toEqual([])

		expect(state.set('size', 300)).toEqual({ ok: true })
		expect(state.set('count', 12)).toEqual({ ok: true })
		expect(state.values.count).toBe(12)
		expect(state.constraintIssues).toEqual([
			{
				kind: 'constraint',
				constraint: 'size-fits',
				message: 'size × count must be at most 1200',
				params: ['size', 'count'],
			},
		])

		state.set('count', 4)
		expect(state.constraintIssues).toEqual([])
	})

	it('resets one param and all params', () => {
		const state = createPanelState(makeSchema())
		const values = state.values
		const listener = jest.fn()
		state.onChange(listener)

		state.set('speed', 3)
		state.set('offset', [10, 20])
		state.setText('speed', 'abc')
		state.set('size', 300)
		state.set('count', 12)
		state.setText('count', '99')
		expect(state.constraintIssues).toHaveLength(1)

		state.reset('speed')
		expect(values.speed).toBe(1)
		expect(state.errors.speed).toBeUndefined()
		expect(state.errors.count).toBe('"count": 99 is outside [1, 12]')
		expect(listener).toHaveBeenLastCalledWith(values, 'speed')

		state.reset('count')
		expect(values.count).toBe(3)
		expect(state.constraintIssues).toEqual([])

		state.set('count', 12)
		state.setText('jitter', 'x')
		state.resetAll()
		expect(state.values).toBe(values)
		expect(values).toEqual({
			speed: 1,
			count: 3,
			shape: 'circle',
			fill: '#ff8800',
			size: 100,
			cycles: 2,
			offset: [0, 0],
			jitter: 0.5,
		})
		expect(state.errors).toEqual({})
		expect(state.constraintIssues).toEqual([])
		expect(listener).toHaveBeenLastCalledWith(values, null)
	})

	it('replaceAll applies values in place with one change event', () => {
		const state = createPanelState(makeSchema())
		const values = state.values
		const listener = jest.fn()
		state.onChange(listener)
		state.setText('speed', 'abc')
		expect(state.errors.speed).toBe(NOT_A_NUMBER)

		const next = {
			speed: 2,
			count: 12,
			shape: 'square' as const,
			fill: '#000000',
			size: 300,
			cycles: 4,
			offset: [5, 6] as [number, number],
			jitter: 1,
		}
		state.replaceAll(next)

		expect(state.values).toBe(values)
		expect(values).toEqual(next)
		expect(values.offset).not.toBe(next.offset)
		expect(state.errors).toEqual({})
		expect(state.constraintIssues.map((issue) => issue.constraint)).toEqual(['size-fits'])
		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener).toHaveBeenCalledWith(values, null)
	})

	it('notifies subscribers of rejected entries but not change listeners', () => {
		const state = createPanelState(makeSchema())
		const subscriber = jest.fn()
		const listener = jest.fn()
		state.onChange(listener)
		const unsubscribe = state.subscribe(subscriber)

		state.setText('speed', 'abc')
		state.set('speed', 2)
		expect(subscriber).toHaveBeenCalledTimes(2)
		expect(listener).toHaveBeenCalledTimes(1)

		unsubscribe()
		state.set('speed', 3)
		expect(subscriber).toHaveBeenCalledTimes(2)
	})
})

describe('groupParams', () => {
	it('groups params in schema order', () => {
		expect(groupParams(makeSchema())).toEqual([
			{ group: null, keys: ['speed', 'count', 'cycles', 'offset', 'jitter'] },
			{ group: 'Shape', keys: ['shape', 'size'] },
			{ group: 'Color', keys: ['fill'] },
		])
	})

	it('omits the ungrouped section when every param has a group', () => {
		const schema = defineSchema({
			a: param.boolean({ label: 'A', default: true, group: 'G' }),
		})
		expect(groupParams(schema)).toEqual([{ group: 'G', keys: ['a'] }])
	})
})

describe('sliderFor', () => {
	it.each<[string, ParamDef, ReturnType<typeof sliderFor>]>([
		[
			'an explicit step',
			param.number({ label: 'A', default: 1, min: 0, max: 2, step: 0.5 }),
			{ min: 0, max: 2, step: 0.5 },
		],
		[
			'an integer',
			param.integer({ label: 'A', default: 1, min: 1, max: 12 }),
			{ min: 1, max: 12, step: 1 },
		],
		[
			'a loop-safe number',
			param.number({ label: 'A', default: 1, min: 1, max: 8, loopSafe: true }),
			{ min: 1, max: 8, step: 1 },
		],
		[
			'a plain number',
			param.number({ label: 'A', default: 1, min: 0, max: 4 }),
			{ min: 0, max: 4, step: 0.004 },
		],
		[
			'a vec2',
			param.vec2({ label: 'A', default: [0, 0], min: -200, max: 200 }),
			{ min: -200, max: 200, step: 0.4 },
		],
		['a number without max', param.number({ label: 'A', default: 1, min: 0 }), null],
		['a number without min', param.number({ label: 'A', default: 1, max: 4 }), null],
		['a number without a range', param.number({ label: 'A', default: 1 }), null],
		['a boolean', param.boolean({ label: 'A', default: true }), null],
	])('derives slider settings: %s', (_name, def, expected) => {
		expect(sliderFor(def)).toEqual(expected)
	})

	it.each<[string, Parameters<typeof stepValue>, number]>([
		['steps up', [param.number({ label: 'A', default: 1, min: 0, max: 4 }), 1, 1, false], 1.004],
		[
			'steps ten with Shift',
			[param.integer({ label: 'A', default: 1, min: 1, max: 12 }), 3, -1, true],
			1,
		],
		[
			'stays below max',
			[param.number({ label: 'A', default: 1, min: 0, max: 1, step: 0.3 }), 0.9, 1, false],
			1,
		],
		[
			'rounds float noise',
			[param.number({ label: 'A', default: 0, step: 0.1 }), 0.2, 1, false],
			0.3,
		],
		['uses 0.01 without a range', [param.number({ label: 'A', default: 0 }), 0, 1, false], 0.01],
	])('derives arrow-key steps: %s', (_name, args, expected) => {
		expect(stepValue(...args)).toBe(expected)
	})
})

describe('parseNumberInput', () => {
	it.each([
		['1.5', 1.5],
		[' -2 ', -2],
		['1e3', 1000],
		['', null],
		['abc', null],
		['Infinity', null],
		['NaN', null],
	])('parses %p as %p', (text, expected) => {
		expect(parseNumberInput(text)).toBe(expected)
	})
})

describe('describedBy', () => {
	it.each([
		['help and error', ['a-help', 'a-error'], 'a-help a-error'],
		['help only', ['a-help', undefined], 'a-help'],
		['error only', [undefined, 'a-error'], 'a-error'],
		['neither', [undefined, undefined], undefined],
	])('joins the ids that exist: %s', (_name, ids, expected) => {
		expect(describedBy(...ids)).toBe(expected)
	})
})

describe('isToggleKey', () => {
	const key = (
		k: string,
		mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}
	) => ({
		key: k,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...mods,
	})

	it.each([
		['h', key('h'), { tagName: 'BODY' }, true],
		['H', key('H'), { tagName: 'CANVAS' }, true],
		['h with no active element', key('h'), null, true],
		['another key', key('j'), { tagName: 'BODY' }, false],
		['Ctrl+H', key('h', { ctrlKey: true }), { tagName: 'BODY' }, false],
		['Meta+H', key('h', { metaKey: true }), { tagName: 'BODY' }, false],
		['Alt+H', key('h', { altKey: true }), { tagName: 'BODY' }, false],
		['h in an input', key('h'), { tagName: 'INPUT' }, false],
		['h in a textarea', key('h'), { tagName: 'TEXTAREA' }, false],
		['h in a select', key('h'), { tagName: 'SELECT' }, false],
		['h in a contenteditable', key('h'), { tagName: 'DIV', isContentEditable: true }, false],
	])('recognises the toggle key: %s', (_name, event, active, expected) => {
		expect(isToggleKey(event, active)).toBe(expected)
	})
})
