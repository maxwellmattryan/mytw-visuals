import { describe, expect, it } from '@jest/globals'
import { parser } from '@shaderfrog/glsl-parser'

import { assembleFragment, EFFECTS, getEffect, glslType, uniformName } from '@mytw/fx'
import { defaults, validate } from '@mytw/schema'

// ── Every built-in ──────────────────────────────────────────────────

describe.each(EFFECTS.map((effect) => [effect.id, effect] as const))('%s', (_id, effect) => {
	const { source } = assembleFragment(effect)

	it('parses as GLSL ES 3.00 with no undeclared identifiers', () => {
		expect(() => parser.parse(source, { failOnWarn: true })).not.toThrow()
	})

	it('declares a uniform of the mapped type for each param', () => {
		for (const [key, def] of Object.entries(effect.params.params))
			expect(source.split('\n')).toContain(`uniform ${glslType(def)} ${uniformName(key)};`)
	})

	it('has defaults that pass validate', () => {
		expect(validate(effect.params, defaults(effect.params))).toMatchObject({ ok: true })
	})

	it('is version 1 and found by getEffect', () => {
		expect(effect.version).toBe(1)
		expect(getEffect(effect.id)).toBe(effect)
	})
})

// ── The Behaviour table ─────────────────────────────────────────────

describe('EFFECTS', () => {
	const table: Record<string, { defaults: Record<string, unknown>; textures?: string[] }> = {
		passthrough: { defaults: {} },
		'chromatic-aberration': { defaults: { amount: 0.001, mode: 'radial' } },
		vignette: { defaults: { amount: 0.2, inner: 0.35, outer: 0.95 } },
		'hue-shift': { defaults: { degrees: 0 } },
		'caustic-warp': { defaults: { amount: 0.005, scale: 2, loopRadius: 0.8 } },
		'sine-displacement': { defaults: { amplitude: 0.01, frequency: 10, cycles: 1 } },
		feedback: { defaults: { decay: 0.5 }, textures: ['previous'] },
		scanlines: { defaults: { intensity: 0.1, count: 400 } },
	}

	it('holds exactly the listed effects', () => {
		expect(EFFECTS.map((effect) => effect.id).sort()).toEqual(Object.keys(table).sort())
	})

	it.each(Object.entries(table))('%s has the listed params, defaults and textures', (id, row) => {
		const effect = getEffect(id)
		expect(effect).toBeDefined()
		if (!effect) return
		expect(defaults(effect.params)).toEqual(row.defaults)
		expect(effect.textures).toEqual(row.textures ?? [])
	})

	it('maps the chromatic-aberration mode to an enum', () => {
		expect(getEffect('chromatic-aberration')?.params.params.mode).toMatchObject({
			kind: 'enum',
			options: ['radial', 'horizontal'],
		})
	})

	it('keeps sine-displacement cycles a loop-safe integer', () => {
		expect(getEffect('sine-displacement')?.params.params.cycles).toMatchObject({
			kind: 'integer',
			min: -8,
			max: 8,
			loopSafe: true,
		})
	})

	it('rejects a vignette whose inner is not below outer', () => {
		const effect = getEffect('vignette')
		if (!effect) throw new Error('missing vignette')
		const result = validate(effect.params, { amount: 0.2, inner: 1, outer: 0.5 })
		expect(result.ok).toBe(false)
	})

	it('returns undefined for an unknown id', () => {
		expect(getEffect('nope')).toBeUndefined()
	})
})
