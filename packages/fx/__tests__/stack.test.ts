import { describe, expect, it } from '@jest/globals'

import { activeEffects, createInstance, getEffect, moveEffect, setEnabled } from '@mytw/fx'
import type { EffectDefinition, EffectStack } from '@mytw/fx'

function effect(id: string): EffectDefinition {
	const found = getEffect(id)
	if (!found) throw new Error(`missing ${id}`)
	return found
}

function makeStack(): EffectStack {
	return Object.freeze([
		createInstance(effect('vignette'), 'a'),
		createInstance(effect('hue-shift'), 'b'),
		createInstance(effect('scanlines'), 'c'),
	])
}

const ids = (stack: EffectStack) => stack.map((instance) => instance.id)

describe('createInstance', () => {
	it('is enabled with the schema defaults', () => {
		expect(createInstance(effect('vignette'), 'v1')).toEqual({
			id: 'v1',
			effect: 'vignette',
			version: 1,
			enabled: true,
			params: { amount: 0.2, inner: 0.35, outer: 0.95 },
		})
	})
})

describe('moveEffect', () => {
	it.each<[string, string, number, string[]]>([
		['forward', 'a', 2, ['b', 'c', 'a']],
		['backward', 'c', 0, ['c', 'a', 'b']],
		['to the middle', 'a', 1, ['b', 'a', 'c']],
		['to its own index', 'b', 1, ['a', 'b', 'c']],
		['past the end (clamped)', 'a', 10, ['b', 'c', 'a']],
		['before the start (clamped)', 'c', -5, ['c', 'a', 'b']],
	])('moves %s', (_name, id, toIndex, expected) => {
		const stack = makeStack()
		const next = moveEffect(stack, id, toIndex)
		expect(ids(next)).toEqual(expected)
		expect(next).not.toBe(stack)
		expect(ids(stack)).toEqual(['a', 'b', 'c'])
	})

	it('returns the same stack for an unknown id', () => {
		const stack = makeStack()
		expect(moveEffect(stack, 'zzz', 0)).toBe(stack)
	})
})

describe('setEnabled', () => {
	it('bypasses one instance without touching the input', () => {
		const stack = makeStack()
		const next = setEnabled(stack, 'b', false)
		expect(next.map((instance) => instance.enabled)).toEqual([true, false, true])
		expect(stack[1].enabled).toBe(true)
		expect(next[0]).toBe(stack[0])
	})

	it('re-enables a bypassed instance', () => {
		const next = setEnabled(setEnabled(makeStack(), 'b', false), 'b', true)
		expect(next.every((instance) => instance.enabled)).toBe(true)
	})

	it('returns the same stack for an unknown id', () => {
		const stack = makeStack()
		expect(setEnabled(stack, 'zzz', false)).toBe(stack)
	})
})

describe('activeEffects', () => {
	it('skips bypassed instances and keeps order', () => {
		const stack = moveEffect(setEnabled(makeStack(), 'b', false), 'c', 0)
		expect(ids(activeEffects(stack))).toEqual(['c', 'a'])
	})

	it('is empty for an empty stack', () => {
		expect(activeEffects([])).toEqual([])
	})

	it('is empty for a fully bypassed stack', () => {
		const stack = ['a', 'b', 'c'].reduce((s, id) => setEnabled(s, id, false), makeStack())
		expect(activeEffects(stack)).toEqual([])
	})
})

describe('serialization', () => {
	it('round-trips through JSON unchanged', () => {
		const stack = setEnabled(moveEffect(makeStack(), 'a', 2), 'c', false)
		expect(JSON.parse(JSON.stringify(stack))).toEqual(stack)
	})
})
