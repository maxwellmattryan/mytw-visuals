import { assembleFragment, EFFECT_VERTEX } from './effect'
import type { CompileResult, EffectDefinition, EffectError } from './types'

const LOG_LINE = /^ERROR:\s*\d+:(\d+):\s*(.*)$/

/** Where the effect's own GLSL sits in the assembled source. */
export interface BodyRange {
	/** 1-based line of the source where the effect's GLSL starts. */
	readonly startLine: number
	readonly lineCount: number
}

/**
 * Parses a shader info log. `ERROR: <n>:<line>: <msg>` lines get a line relative to the effect's
 * GLSL when they fall inside `body`, and `null` otherwise. Other non-empty lines get `null`.
 */
export function parseInfoLog(log: string, body?: BodyRange): EffectError[] {
	const errors: EffectError[] = []
	for (const raw of log.replace(/\0/g, '').split('\n')) {
		const text = raw.trim()
		if (text === '') continue
		const match = LOG_LINE.exec(text)
		if (!match) {
			errors.push({ line: null, message: text })
			continue
		}
		const sourceLine = Number(match[1])
		const line = body ? sourceLine - body.startLine + 1 : 0
		errors.push({
			line: body && line >= 1 && line <= body.lineCount ? line : null,
			message: match[2],
		})
	}
	return errors
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

const UNAVAILABLE: CompileResult = {
	ok: false,
	errors: [{ line: null, message: 'WebGL context unavailable' }],
}

/**
 * Compiles and links an effect against `EFFECT_VERTEX`. Never throws. On success the caller owns
 * the program; the shader objects are already deleted. On failure everything it created is deleted.
 */
export function compileEffect(gl: WebGL2RenderingContext, effect: EffectDefinition): CompileResult {
	let vertex: WebGLShader | null = null
	let fragment: WebGLShader | null = null
	let program: WebGLProgram | null = null

	const cleanup = (): void => {
		try {
			if (program) gl.deleteProgram(program)
			if (vertex) gl.deleteShader(vertex)
			if (fragment) gl.deleteShader(fragment)
		} catch {
			// The context is gone, so there is nothing left to free.
		}
	}

	const compile = (shader: WebGLShader, source: string, body?: BodyRange): EffectError[] => {
		gl.shaderSource(shader, source)
		gl.compileShader(shader)
		if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return []
		const errors = parseInfoLog(gl.getShaderInfoLog(shader) ?? '', body)
		return errors.length > 0 ? errors : [{ line: null, message: 'Shader failed to compile' }]
	}

	try {
		const { source, bodyStartLine } = assembleFragment(effect)
		vertex = gl.createShader(gl.VERTEX_SHADER)
		fragment = gl.createShader(gl.FRAGMENT_SHADER)
		if (!vertex || !fragment) {
			cleanup()
			return UNAVAILABLE
		}

		const errors = [
			...compile(vertex, EFFECT_VERTEX),
			...compile(fragment, source, {
				startLine: bodyStartLine,
				lineCount: effect.glsl.split('\n').length,
			}),
		]
		if (errors.length > 0) {
			cleanup()
			return { ok: false, errors }
		}

		program = gl.createProgram()
		if (!program) {
			cleanup()
			return UNAVAILABLE
		}
		gl.attachShader(program, vertex)
		gl.attachShader(program, fragment)
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const log = gl.getProgramInfoLog(program)?.trim() || 'Program failed to link'
			cleanup()
			return { ok: false, errors: [{ line: null, message: log }] }
		}

		const linked = program
		program = null
		cleanup()
		return { ok: true, program: linked }
	} catch (error) {
		cleanup()
		return { ok: false, errors: [{ line: null, message: messageOf(error) }] }
	}
}
