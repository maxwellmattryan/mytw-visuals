import { defineSchema } from '@mytw/schema'
import type { ParamDef } from '@mytw/schema'
import { isChunkId } from './chunks'
import { defineEffect } from './effect'
import { getEffect } from './effects'
import type { CustomEffectResult, EffectError } from './types'

const KINDS: readonly string[] = ['number', 'integer', 'boolean', 'enum', 'color', 'vec2']

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Checks the shape of an untrusted param definition. `defineSchema` checks its values. */
function paramShapeProblem(raw: unknown): string | null {
	if (!isRecord(raw)) return 'must be an object'
	if (typeof raw.kind !== 'string' || !KINDS.includes(raw.kind))
		return `kind must be one of ${KINDS.join(', ')}`
	if (typeof raw.label !== 'string') return 'label must be a string'
	if (!Object.hasOwn(raw, 'default')) return 'default is missing'
	for (const field of ['min', 'max', 'step'])
		if (raw[field] !== undefined && typeof raw[field] !== 'number')
			return `${field} must be a number`
	if (raw.kind === 'enum' && !isStringArray(raw.options))
		return 'options must be an array of strings'
	return null
}

/** A frozen copy, so later edits to the project data can't change the effect. */
function copyDef(def: ParamDef): ParamDef {
	if (def.kind === 'enum')
		return Object.freeze({ ...def, options: Object.freeze([...def.options]) })
	if (def.kind === 'vec2' && Array.isArray(def.default)) {
		const value = Object.freeze<[number, number]>([def.default[0], def.default[1]])
		return Object.freeze({ ...def, default: value })
	}
	return Object.freeze({ ...def })
}

/**
 * Builds an effect from project-level data (custom GLSL). Never throws: every problem, including
 * `EffectDefinitionError` and `SchemaDefinitionError`, comes back as an error with `line: null`.
 */
export function createCustomEffect(input: unknown): CustomEffectResult {
	const fail = (...messages: string[]): CustomEffectResult => ({
		ok: false,
		errors: messages.map((message): EffectError => ({ line: null, message })),
	})
	if (!isRecord(input)) return fail('Custom effect must be an object')

	const problems: string[] = []
	const { id, version, name, glsl, params, textures, chunks } = input
	if (typeof id !== 'string') problems.push('id must be a string')
	else if (getEffect(id)) problems.push(`id "${id}" is used by a built-in effect`)
	if (typeof version !== 'number') problems.push('version must be a number')
	if (typeof name !== 'string') problems.push('name must be a string')
	if (typeof glsl !== 'string') problems.push('glsl must be a string')
	const defs: Record<string, ParamDef> = {}
	if (!isRecord(params)) problems.push('params must be an object')
	else
		for (const [key, def] of Object.entries(params)) {
			const problem = paramShapeProblem(def)
			if (problem) problems.push(`Param "${key}": ${problem}`)
			// The shape is checked above, and defineSchema checks every default and range.
			else defs[key] = copyDef(def as ParamDef)
		}
	if (textures !== undefined && !isStringArray(textures))
		problems.push('textures must be an array of strings')
	if (chunks !== undefined && !isStringArray(chunks))
		problems.push('chunks must be an array of strings')
	else
		for (const chunk of chunks ?? [])
			if (!isChunkId(chunk)) problems.push(`unknown chunk "${String(chunk)}"`)

	if (problems.length > 0) return fail(...problems)

	try {
		const effect = defineEffect({
			id: String(id),
			version: Number(version),
			name: String(name),
			glsl: String(glsl),
			params: defineSchema(defs),
			textures: isStringArray(textures) ? textures : [],
			chunks: isStringArray(chunks) ? chunks.filter(isChunkId) : [],
		})
		return { ok: true, effect }
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error))
	}
}
