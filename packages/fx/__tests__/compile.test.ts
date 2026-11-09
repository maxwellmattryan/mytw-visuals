import { describe, expect, it, jest } from '@jest/globals'

import {
	assembleFragment,
	compileEffect,
	createCustomEffect,
	EFFECT_VERTEX,
	getEffect,
	parseInfoLog,
} from '@mytw/fx'
import type { EffectDefinition } from '@mytw/fx'

const VERTEX_SHADER = 0x8b31
const FRAGMENT_SHADER = 0x8b30
const COMPILE_STATUS = 0x8b81
const LINK_STATUS = 0x8b82

interface FakeShader {
	type: number
	source: string
}

interface FakeOptions {
	fragmentLog?: string
	vertexLog?: string
	linkLog?: string
	nullShader?: boolean
	nullProgram?: boolean
	throwOn?: 'createShader' | 'compileShader' | 'linkProgram'
}

/** A jest-mocked WebGL2RenderingContext covering the calls compileEffect makes. */
function fakeGl(options: FakeOptions = {}) {
	const program = { kind: 'program' }
	const shaders: FakeShader[] = []
	const throws = (name: FakeOptions['throwOn']) => {
		if (options.throwOn === name) throw new Error('context lost')
	}
	const gl = {
		VERTEX_SHADER,
		FRAGMENT_SHADER,
		COMPILE_STATUS,
		LINK_STATUS,
		createShader: jest.fn((type: number) => {
			throws('createShader')
			if (options.nullShader) return null
			const shader = { type, source: '' }
			shaders.push(shader)
			return shader
		}),
		shaderSource: jest.fn((shader: FakeShader, source: string) => {
			shader.source = source
		}),
		compileShader: jest.fn(() => throws('compileShader')),
		getShaderParameter: jest.fn((shader: FakeShader) =>
			shader.type === VERTEX_SHADER ? !options.vertexLog : !options.fragmentLog
		),
		getShaderInfoLog: jest.fn((shader: FakeShader) =>
			shader.type === VERTEX_SHADER ? (options.vertexLog ?? '') : (options.fragmentLog ?? '')
		),
		createProgram: jest.fn(() => (options.nullProgram ? null : program)),
		attachShader: jest.fn(),
		linkProgram: jest.fn(() => throws('linkProgram')),
		getProgramParameter: jest.fn(() => options.linkLog === undefined),
		getProgramInfoLog: jest.fn(() => options.linkLog ?? ''),
		deleteShader: jest.fn(),
		deleteProgram: jest.fn(),
	}
	return { gl, program, shaders, context: gl as unknown as WebGL2RenderingContext }
}

function builtin(id: string): EffectDefinition {
	const effect = getEffect(id)
	if (!effect) throw new Error(`missing ${id}`)
	return effect
}

const vignette = builtin('vignette')
const { bodyStartLine } = assembleFragment(vignette)

describe('compileEffect', () => {
	it('returns the linked program and deletes the shader objects', () => {
		const { gl, program, shaders, context } = fakeGl()
		const result = compileEffect(context, vignette)
		expect(result).toEqual({ ok: true, program })
		expect(shaders.map((shader) => shader.source)).toEqual([
			EFFECT_VERTEX,
			assembleFragment(vignette).source,
		])
		expect(gl.attachShader).toHaveBeenCalledTimes(2)
		expect(gl.deleteShader).toHaveBeenCalledTimes(2)
		for (const shader of shaders) expect(gl.deleteShader).toHaveBeenCalledWith(shader)
		expect(gl.deleteProgram).not.toHaveBeenCalled()
	})

	it('maps a compile error in the effect glsl to its own line', () => {
		const { gl, context } = fakeGl({
			fragmentLog: `ERROR: 0:${bodyStartLine + 2}: 'foo' : undeclared identifier\n`,
		})
		const result = compileEffect(context, vignette)
		expect(result).toEqual({
			ok: false,
			errors: [{ line: 3, message: "'foo' : undeclared identifier" }],
		})
		expect(gl.deleteShader).toHaveBeenCalledTimes(2)
		expect(gl.createProgram).not.toHaveBeenCalled()
	})

	it('gives a null line for an error in generated code', () => {
		const { context } = fakeGl({ fragmentLog: "ERROR: 0:2: 'x' : syntax error" })
		expect(compileEffect(context, vignette)).toEqual({
			ok: false,
			errors: [{ line: null, message: "'x' : syntax error" }],
		})
	})

	it('gives null lines for vertex errors', () => {
		const { context } = fakeGl({ vertexLog: 'ERROR: 0:3: bad' })
		expect(compileEffect(context, vignette)).toEqual({
			ok: false,
			errors: [{ line: null, message: 'bad' }],
		})
	})

	it('reports a link failure as one error and deletes the program', () => {
		const { gl, program, context } = fakeGl({ linkLog: 'varying vUv not written' })
		expect(compileEffect(context, vignette)).toEqual({
			ok: false,
			errors: [{ line: null, message: 'varying vUv not written' }],
		})
		expect(gl.deleteProgram).toHaveBeenCalledWith(program)
		expect(gl.deleteShader).toHaveBeenCalledTimes(2)
	})

	it.each<[string, FakeOptions]>([
		['createShader returns null', { nullShader: true }],
		['createProgram returns null', { nullProgram: true }],
	])('reports an unavailable context when %s', (_name, options) => {
		const { context } = fakeGl(options)
		expect(compileEffect(context, vignette)).toEqual({
			ok: false,
			errors: [{ line: null, message: 'WebGL context unavailable' }],
		})
	})

	it.each<FakeOptions['throwOn']>(['createShader', 'compileShader', 'linkProgram'])(
		'returns the thrown message when %s throws',
		(throwOn) => {
			const { context } = fakeGl({ throwOn })
			let result: ReturnType<typeof compileEffect> | undefined
			expect(() => {
				result = compileEffect(context, vignette)
			}).not.toThrow()
			expect(result).toEqual({ ok: false, errors: [{ line: null, message: 'context lost' }] })
		}
	)

	it('reports the line of a broken custom effect', () => {
		const custom = createCustomEffect({
			id: 'broken',
			version: 1,
			name: 'Broken',
			glsl: 'vec4 effect(vec2 uv) {\n  return foo;\n}',
			params: {},
		})
		if (!custom.ok) throw new Error('expected a valid custom effect')
		const start = assembleFragment(custom.effect).bodyStartLine
		const { context } = fakeGl({
			fragmentLog: `ERROR: 0:${start + 1}: 'foo' : undeclared identifier`,
		})
		const result = compileEffect(context, custom.effect)
		expect(result.ok === false && result.errors[0].line).toBe(2)
	})
})

describe('parseInfoLog', () => {
	const body = { startLine: 10, lineCount: 3 }

	it.each<[string, number | null]>([
		['ERROR: 0:9: before', null],
		['ERROR: 0:10: first', 1],
		['ERROR: 0:12: last', 3],
		['ERROR: 0:13: after', null],
	])('maps %s', (log, line) => {
		expect(parseInfoLog(log, body)[0].line).toBe(line)
	})

	it('keeps unmatched lines with a null line and skips blank ones', () => {
		expect(parseInfoLog('WARNING: something\n\nERROR: 2 compilation errors.\0', body)).toEqual([
			{ line: null, message: 'WARNING: something' },
			{ line: null, message: 'ERROR: 2 compilation errors.' },
		])
	})

	it('gives null lines without a body range', () => {
		expect(parseInfoLog('ERROR: 0:11: oops')).toEqual([{ line: null, message: 'oops' }])
	})
})
