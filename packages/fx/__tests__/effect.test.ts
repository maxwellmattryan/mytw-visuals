import { describe, expect, it } from '@jest/globals'
import { parser } from '@shaderfrog/glsl-parser'

import {
	assembleFragment,
	CHUNKS,
	createCustomEffect,
	defineEffect,
	EffectDefinitionError,
	glslChunks,
	resolveChunks,
	uniformValues,
} from '@mytw/fx'
import type { Chunk, ChunkId, EffectInput } from '@mytw/fx'
import type { ParamDefs } from '@mytw/schema'
import { defineSchema, param } from '@mytw/schema'

const GLSL = 'vec4 effect(vec2 uv) {\n  return texture(uInput, uv) * uAmount;\n}'

const amount = param.number({ label: 'Amount', default: 1, min: 0, max: 2 })

const valid = {
	id: 'my-effect',
	version: 1,
	name: 'My effect',
	glsl: GLSL,
	params: defineSchema({ amount }),
}

/** An input change. `params` is a plain record so every row shares one type. */
type Change = Omit<Partial<EffectInput>, 'params'> & { params?: ParamDefs }

// ── defineEffect ────────────────────────────────────────────────────

describe('defineEffect', () => {
	it('returns a frozen definition', () => {
		const effect = defineEffect({ ...valid, textures: ['previous'], chunks: ['noise'] })
		expect(Object.isFrozen(effect)).toBe(true)
		expect(Object.isFrozen(effect.textures)).toBe(true)
		expect(Object.isFrozen(effect.chunks)).toBe(true)
		expect(effect).toMatchObject({
			id: 'my-effect',
			version: 1,
			name: 'My effect',
			glsl: GLSL,
			textures: ['previous'],
			chunks: ['noise'],
		})
	})

	it('defaults textures and chunks to empty', () => {
		const effect = defineEffect(valid)
		expect(effect.textures).toEqual([])
		expect(effect.chunks).toEqual([])
	})

	it.each<[string, Change, RegExp]>([
		['an id with capitals', { id: 'MyEffect' }, /kebab-case/],
		['an id with a trailing dash', { id: 'my-effect-' }, /kebab-case/],
		['an id starting with a digit', { id: '1-effect' }, /kebab-case/],
		['an empty id', { id: '' }, /kebab-case/],
		['version 0', { version: 0 }, /version \(0\)/],
		['a fractional version', { version: 1.5 }, /version \(1.5\)/],
		['a param key starting with a capital', { params: { Amount: amount } }, /param "Amount"/],
		['a param key with an underscore', { params: { my_amount: amount } }, /param "my_amount"/],
		['a texture name with a dash', { textures: ['prev-frame'] }, /texture "prev-frame"/],
		['a param colliding with uInput', { params: { input: amount } }, /built-in uniform uInput/],
		['a param colliding with uPhase', { params: { phase: amount } }, /built-in uniform uPhase/],
		[
			'a texture colliding with uResolution',
			{ textures: ['resolution'] },
			/built-in uniform uResolution/,
		],
		[
			'a texture colliding with a param',
			{ textures: ['amount'] },
			/uniform uAmount, already in use/,
		],
		[
			'two equal texture names',
			{ textures: ['previous', 'previous'] },
			/uPrevious, already in use/,
		],
		['an unknown chunk', { chunks: ['sparkle' as ChunkId] }, /unknown chunk "sparkle"/],
		[
			'glsl without an effect function',
			{ glsl: 'vec4 main(vec2 uv) { return vec4(0.0); }' },
			/vec4 effect\(vec2 uv\)/,
		],
		[
			'glsl with the wrong argument type',
			{ glsl: 'vec4 effect(vec3 uv) { return vec4(0.0); }' },
			/vec4 effect\(vec2 uv\)/,
		],
	])('throws EffectDefinitionError for %s', (_name, change, message) => {
		const input = { ...valid, ...change, params: defineSchema(change.params ?? { amount }) }
		expect(() => defineEffect(input)).toThrow(EffectDefinitionError)
		expect(() => defineEffect(input)).toThrow(new RegExp(`^Effect "${input.id}": `))
		expect(() => defineEffect(input)).toThrow(message)
	})
})

// ── glslChunks ──────────────────────────────────────────────────────

describe('glslChunks', () => {
	it('returns the requested chunks in order', () => {
		expect(glslChunks(['color', 'math'])).toBe(`${CHUNKS.color.glsl}\n\n${CHUNKS.math.glsl}`)
	})

	it('emits each chunk once', () => {
		expect(glslChunks(['noise', 'noise'])).toBe(CHUNKS.noise.glsl)
	})

	it('defines the shared helpers', () => {
		const src = glslChunks(['math', 'noise', 'color', 'mask'])
		for (const name of ['PI', 'TAU', 'rot', 'hash', 'vnoise', 'fbm', 'hueRotate', 'edgeMask'])
			expect(src).toMatch(new RegExp(`\\b(float|vec2|vec3) ${name}\\b`))
	})

	it.each(Object.values(CHUNKS))('chunk $id parses as GLSL ES 1.00 and 3.00', (chunk) => {
		const src = glslChunks([chunk.id])
		expect(src).not.toMatch(/\b(texture|texture2D|in|out|varying)\b|#/)
		// The parser has no ES 1.00 built-ins, so main stays empty in both.
		const es100 = `precision mediump float;\n${src}\nvoid main() {}\n`
		const es300 = `#version 300 es\nprecision mediump float;\n${src}\nvoid main() {}\n`
		expect(() => parser.parse(es100, { failOnWarn: true })).not.toThrow()
		expect(() => parser.parse(es300, { failOnWarn: true })).not.toThrow()
	})

	it('resolves requires before the chunks that need them, once each', () => {
		type Id = 'a' | 'b' | 'c' | 'd'
		const chunk = (id: Id, requires: Id[]): Chunk<Id> => ({ id, requires, glsl: id })
		const library = {
			a: chunk('a', []),
			b: chunk('b', ['a']),
			c: chunk('c', ['b', 'a']),
			d: chunk('d', ['c']),
		}
		const ids = (list: Id[]) => resolveChunks(list, library).map((c) => c.id)
		expect(ids(['d'])).toEqual(['a', 'b', 'c', 'd'])
		expect(ids(['c', 'b', 'a'])).toEqual(['a', 'b', 'c'])
	})

	it('throws for an unknown id', () => {
		expect(() => resolveChunks(['nope' as ChunkId], CHUNKS)).toThrow('Unknown chunk "nope"')
	})
})

// ── assembleFragment ────────────────────────────────────────────────

describe('assembleFragment', () => {
	const effect = defineEffect({
		id: 'kinds',
		version: 1,
		name: 'Kinds',
		params: defineSchema({
			amount: param.number({ label: 'Amount', default: 0.5 }),
			count: param.integer({ label: 'Count', default: 2 }),
			on: param.boolean({ label: 'On', default: true }),
			mode: param.enum({ label: 'Mode', options: ['a', 'b'], default: 'a' }),
			tint: param.color({ label: 'Tint', default: '#ff8000' }),
			offset: param.vec2({ label: 'Offset', default: [0, 0] }),
		}),
		textures: ['previous'],
		chunks: ['color', 'math'],
		glsl: 'vec4 effect(vec2 uv) {\n  return vec4(uv, 0.0, 1.0);\n}',
	})
	const { source, bodyStartLine } = assembleFragment(effect)
	const lines = source.split('\n')

	it('starts with #version 300 es', () => {
		expect(lines[0]).toBe('#version 300 es')
	})

	it('declares the built-in uniforms', () => {
		expect(lines).toContain('uniform sampler2D uInput;')
		expect(lines).toContain('uniform float uPhase;')
		expect(lines).toContain('uniform vec2 uResolution;')
	})

	it.each([
		['float', 'uAmount'],
		['int', 'uCount'],
		['bool', 'uOn'],
		['int', 'uMode'],
		['vec3', 'uTint'],
		['vec2', 'uOffset'],
		['sampler2D', 'uPrevious'],
	])('declares uniform %s %s', (type, name) => {
		expect(lines.filter((line) => line === `uniform ${type} ${name};`)).toHaveLength(1)
	})

	it('includes the requested chunks once, in order', () => {
		const color = source.indexOf(CHUNKS.color.glsl)
		const math = source.indexOf(CHUNKS.math.glsl)
		expect(color).toBeGreaterThan(-1)
		expect(math).toBeGreaterThan(color)
		expect(source.split(CHUNKS.math.glsl)).toHaveLength(2)
		expect(source.indexOf(CHUNKS.noise.glsl)).toBe(-1)
	})

	it('points bodyStartLine at the first line of the effect glsl', () => {
		expect(lines[bodyStartLine - 1]).toBe('vec4 effect(vec2 uv) {')
		expect(lines[bodyStartLine]).toBe('  return vec4(uv, 0.0, 1.0);')
	})

	it('calls effect(vUv) from main', () => {
		expect(source).toMatch(/void main\(\) \{\s*\w+ = effect\(vUv\);\s*\}/)
	})

	it('parses as GLSL ES 3.00', () => {
		expect(() => parser.parse(source, { failOnWarn: true })).not.toThrow()
	})

	// ── uniformValues ───────────────────────────────────────────────

	describe('uniformValues', () => {
		it('maps every kind', () => {
			expect(
				uniformValues(effect, {
					amount: 0.25,
					count: 3,
					on: false,
					mode: 'b',
					tint: '#ff0000',
					offset: [0.5, -1],
				})
			).toEqual({
				uAmount: 0.25,
				uCount: 3,
				uOn: false,
				uMode: 1,
				uTint: [1, 0, 0],
				uOffset: [0.5, -1],
			})
		})

		it('uses defaults for missing or invalid values', () => {
			const values = uniformValues(effect, { mode: 'zzz', tint: 42 })
			expect(values).toMatchObject({ uAmount: 0.5, uCount: 2, uOn: true, uMode: 0 })
			expect(values.uTint).toEqual([1, 128 / 255, 0])
		})
	})
})

// ── createCustomEffect ──────────────────────────────────────────────

describe('createCustomEffect', () => {
	const data = {
		id: 'my-glitch',
		version: 1,
		name: 'My glitch',
		glsl: 'vec4 effect(vec2 uv) {\n  return texture(uInput, uv + fbm(uv) * uAmount);\n}',
		params: { amount: { kind: 'number', label: 'Amount', default: 0.1, min: 0, max: 1 } },
		chunks: ['noise'],
	}

	it('returns ok with a frozen effect for valid data', () => {
		const result = createCustomEffect(data)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(Object.isFrozen(result.effect)).toBe(true)
		expect(result.effect.id).toBe('my-glitch')
		expect(Object.keys(result.effect.params.params)).toEqual(['amount'])
		expect(() => assembleFragment(result.effect)).not.toThrow()
	})

	it('copies params, so later edits to the data do not change the effect', () => {
		const params = { mode: { kind: 'enum', label: 'Mode', options: ['a', 'b'], default: 'a' } }
		const result = createCustomEffect({ ...data, params })
		params.mode.options.push('c')
		expect(result.ok && result.effect.params.params.mode).toMatchObject({ options: ['a', 'b'] })
	})

	it.each<[string, unknown, RegExp]>([
		['null', null, /must be an object/],
		['a string', 'effect', /must be an object/],
		['an array', [], /must be an object/],
		['a missing id', { ...data, id: undefined }, /id must be a string/],
		['a missing glsl', { ...data, glsl: undefined }, /glsl must be a string/],
		['a wrong-typed version', { ...data, version: '1' }, /version must be a number/],
		['a missing name', { ...data, name: undefined }, /name must be a string/],
		['missing params', { ...data, params: undefined }, /params must be an object/],
		['wrong-typed textures', { ...data, textures: [1] }, /textures must be an array/],
		['wrong-typed chunks', { ...data, chunks: 'noise' }, /chunks must be an array/],
		['an id matching a built-in', { ...data, id: 'vignette' }, /built-in/],
		['an unknown chunk', { ...data, chunks: ['sparkle'] }, /unknown chunk "sparkle"/],
		[
			'a param with an unknown kind',
			{ ...data, params: { a: { kind: 'x', label: 'A', default: 1 } } },
			/Param "a": kind/,
		],
		[
			'a param that is not an object',
			{ ...data, params: { a: 3 } },
			/Param "a": must be an object/,
		],
		[
			'an enum without options',
			{ ...data, params: { a: { kind: 'enum', label: 'A', default: 'x' } } },
			/options/,
		],
		[
			'a default outside its range (SchemaDefinitionError)',
			{ ...data, params: { a: { kind: 'number', label: 'A', default: 5, max: 1 } } },
			/default is invalid/,
		],
		['a bad version (EffectDefinitionError)', { ...data, version: 0 }, /version \(0\)/],
		['a bad id (EffectDefinitionError)', { ...data, id: 'Bad Id' }, /kebab-case/],
		[
			'glsl without effect() (EffectDefinitionError)',
			{ ...data, glsl: 'void f() {}' },
			/vec4 effect/,
		],
	])('returns errors without throwing for %s', (_name, input, message) => {
		let result: ReturnType<typeof createCustomEffect> | undefined
		expect(() => {
			result = createCustomEffect(input)
		}).not.toThrow()
		expect(result?.ok).toBe(false)
		if (!result || result.ok) return
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors.every((error) => error.line === null)).toBe(true)
		expect(result.errors.map((error) => error.message).join('\n')).toMatch(message)
	})
})
