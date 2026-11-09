import { describe, expect, it } from '@jest/globals'

import { defineSchema, param } from '@mytw/schema'
import { defineSketch, SketchDefinitionError } from '@mytw/sketch'
import type { SketchInput } from '@mytw/sketch'

const params = defineSchema({
	count: param.integer({ label: 'Count', min: 1, max: 8, default: 3 }),
})

function input(patch: Record<string, unknown> = {}): SketchInput<typeof params.params> {
	return { id: 'orbits', version: 1, name: 'Orbits', params, draw: () => {}, ...patch }
}

describe('defineSketch', () => {
	it('validates definitions', () => {
		const definition = defineSketch(input())
		expect(Object.isFrozen(definition)).toBe(true)
		expect(definition).toEqual(expect.objectContaining({ id: 'orbits', version: 1, params }))
		expect(defineSketch(input({ id: 'basic-orbits-2', version: 3 })).id).toBe('basic-orbits-2')

		const rejected: [patch: Record<string, unknown>, message: string][] = [
			[{ id: 'Orbits' }, 'Sketch "Orbits": id must be kebab-case'],
			[{ id: 'orbits_' }, 'Sketch "orbits_": id must be kebab-case'],
			[{ id: '-orbits' }, 'Sketch "-orbits": id must be kebab-case'],
			[{ id: 7 }, 'Sketch "7": id must be kebab-case'],
			[{ version: 0 }, 'Sketch "orbits": version (0) must be an integer >= 1'],
			[{ version: 1.5 }, 'Sketch "orbits": version (1.5) must be an integer >= 1'],
			[{ draw: undefined }, 'Sketch "orbits": draw must be a function'],
			[{ draw: 'circle' }, 'Sketch "orbits": draw must be a function'],
			[{ setup: 1 }, 'Sketch "orbits": setup must be a function'],
		]
		for (const [patch, message] of rejected) {
			const attempt = () => defineSketch(input(patch))
			expect(attempt).toThrow(SketchDefinitionError)
			expect(attempt).toThrow(message)
		}
	})
})
