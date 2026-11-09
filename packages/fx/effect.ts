import { hexToVec } from '@lib/colors'
import { clampValues } from '@mytw/schema'
import type { ParamDef, ParamDefs, ParamValues, Schema } from '@mytw/schema'
import { CHUNKS, isChunkId, resolveChunks } from './chunks'
import type { EffectDefinition, EffectInput, UniformValue } from './types'

/** Thrown by `defineEffect` when an effect can't be assembled into a valid shader. */
export class EffectDefinitionError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'EffectDefinitionError'
	}
}

/** Uniforms every effect gets: the input image, loop phase in [0,1) and output size in pixels. */
export const BUILTIN_UNIFORMS = Object.freeze({
	uInput: 'sampler2D',
	uPhase: 'float',
	uResolution: 'vec2',
} as const)

/** GLSL ES 3.00 vertex shader for a full-screen quad whose positions span 0–1. */
export const EFFECT_VERTEX = `#version 300 es
in vec3 aPosition;
in vec2 aTexCoord;
out vec2 vUv;

void main() {
  vUv = aTexCoord;
  gl_Position = vec4(aPosition.xy * 2.0 - 1.0, aPosition.z, 1.0);
}
`

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/
const SIGNATURE_PATTERN = /\bvec4\s+effect\s*\(\s*vec2\b/

const GLSL_TYPES: Readonly<Record<ParamDef['kind'], string>> = {
	number: 'float',
	integer: 'int',
	boolean: 'bool',
	enum: 'int',
	color: 'vec3',
	vec2: 'vec2',
}

/** `amount` becomes `uAmount`. */
export function uniformName(key: string): string {
	return 'u' + key.charAt(0).toUpperCase() + key.slice(1)
}

/** The GLSL uniform type for a param. */
export function glslType(def: ParamDef): string {
	return GLSL_TYPES[def.kind]
}

/**
 * Validates an effect and returns it frozen. Throws `EffectDefinitionError` naming the effect and
 * the problem.
 */
export function defineEffect<P extends ParamDefs>(input: EffectInput<P>): EffectDefinition {
	const fail = (problem: string): never => {
		throw new EffectDefinitionError(`Effect "${String(input.id)}": ${problem}`)
	}

	if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id))
		fail('id must be kebab-case, such as "hue-shift"')
	if (!Number.isInteger(input.version) || input.version < 1)
		fail(`version (${String(input.version)}) must be an integer >= 1`)

	const textures = [...(input.textures ?? [])]
	const chunks = [...(input.chunks ?? [])]
	const keys = Object.keys(input.params.params)

	const uniforms = new Set<string>(Object.keys(BUILTIN_UNIFORMS))
	const claim = (what: string, name: string): void => {
		if (!NAME_PATTERN.test(name))
			fail(`${what} "${name}" must start with a lowercase letter and use only letters and digits`)
		const uniform = uniformName(name)
		if (Object.hasOwn(BUILTIN_UNIFORMS, uniform))
			fail(`${what} "${name}" maps to built-in uniform ${uniform}`)
		if (uniforms.has(uniform)) fail(`${what} "${name}" maps to uniform ${uniform}, already in use`)
		uniforms.add(uniform)
	}
	for (const key of keys) claim('param', key)
	for (const name of textures) claim('texture', name)

	for (const id of chunks) if (!isChunkId(id)) fail(`unknown chunk "${String(id)}"`)

	if (typeof input.glsl !== 'string' || !SIGNATURE_PATTERN.test(input.glsl))
		fail('glsl must define vec4 effect(vec2 uv)')

	return Object.freeze({
		id: input.id,
		version: input.version,
		name: input.name,
		glsl: input.glsl,
		params: eraseSchema(input.params),
		textures: Object.freeze(textures),
		chunks: Object.freeze(chunks),
	})
}

/**
 * Widens a schema to `Schema<ParamDefs>` so effects with different params share one type.
 * Constraint checks are typed against their own params, which makes `Schema<P>` invariant; it is
 * safe here because `validate` only runs constraints on values that already match every param.
 */
function eraseSchema<P extends ParamDefs>(schema: Schema<P>): Schema<ParamDefs> {
	return schema as unknown as Schema<ParamDefs>
}

/**
 * Builds the GLSL ES 3.00 fragment shader for an effect: header, built-in uniforms, one uniform
 * per param and texture, chunks, the effect's own GLSL, then `main`. `bodyStartLine` is the
 * 1-based line of the source where the effect's GLSL starts.
 */
export function assembleFragment(effect: EffectDefinition): {
	source: string
	bodyStartLine: number
} {
	const lines = [
		'#version 300 es',
		'precision highp float;',
		'',
		'in vec2 vUv;',
		'out vec4 fxColor;',
	]
	lines.push('')
	for (const [name, type] of Object.entries(BUILTIN_UNIFORMS))
		lines.push(`uniform ${type} ${name};`)
	for (const [key, def] of Object.entries(effect.params.params))
		lines.push(`uniform ${glslType(def)} ${uniformName(key)};`)
	for (const name of effect.textures) lines.push(`uniform sampler2D ${uniformName(name)};`)

	for (const chunk of resolveChunks(effect.chunks, CHUNKS)) {
		lines.push('')
		lines.push(...chunk.glsl.split('\n'))
	}

	lines.push('')
	const bodyStartLine = lines.length + 1
	lines.push(...effect.glsl.split('\n'))
	lines.push('', 'void main() {', '  fxColor = effect(vUv);', '}', '')
	return { source: lines.join('\n'), bodyStartLine }
}

/**
 * Turns param values into uniform values keyed by uniform name. Invalid or missing values fall
 * back to the default and numbers are clamped (see `clampValues`). Enums become their option
 * index and colors 0–1 RGB.
 */
export function uniformValues(
	effect: EffectDefinition,
	values: Readonly<Record<string, unknown>>
): Record<string, UniformValue> {
	const valid: ParamValues<ParamDefs> = clampValues(effect.params, { ...values })
	const out: Record<string, UniformValue> = {}
	for (const [key, def] of Object.entries(effect.params.params)) {
		const value = valid[key]
		out[uniformName(key)] = toUniform(def, value)
	}
	return out
}

function toUniform(def: ParamDef, value: unknown): UniformValue {
	switch (def.kind) {
		case 'number':
		case 'integer':
			return typeof value === 'number' ? value : def.default
		case 'boolean':
			return typeof value === 'boolean' ? value : def.default
		case 'enum':
			return Math.max(0, def.options.indexOf(typeof value === 'string' ? value : def.default))
		case 'color':
			return hexToVec(typeof value === 'string' ? value : def.default)
		case 'vec2':
			return Array.isArray(value) ? value.map(Number) : [...def.default]
	}
}
