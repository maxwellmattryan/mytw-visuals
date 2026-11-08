import { checkValue, copyDefault, mapParams, wantsInteger } from './rules'
import type { Constraint, ParamDef, ParamDefs, ParamValues, Schema } from './types'

/** Thrown by `defineSchema` when a definition can't hold a valid value. */
export class SchemaDefinitionError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SchemaDefinitionError'
	}
}

function checkParam(key: string, def: ParamDef): void {
	const fail = (reason: string): never => {
		throw new SchemaDefinitionError(`Param "${key}": ${reason}`)
	}

	if (def.kind === 'number' || def.kind === 'integer' || def.kind === 'vec2') {
		const { min, max } = def
		if (wantsInteger(def)) {
			if (min !== undefined && !Number.isInteger(min)) fail(`min (${min}) must be an integer`)
			if (max !== undefined && !Number.isInteger(max)) fail(`max (${max}) must be an integer`)
		}
		if (min !== undefined && max !== undefined && min > max)
			fail(`min (${min}) is greater than max (${max})`)
	}

	if (def.kind === 'enum') {
		if (def.options.length === 0) fail('options must not be empty')
		if (new Set(def.options).size !== def.options.length) fail('options must not repeat')
	}

	const issue = checkValue(def, def.default)
	if (issue) fail(`default is invalid: ${issue.message}`)
}

/**
 * Defines a schema from parameter definitions and optional cross-parameter constraints.
 * Throws `SchemaDefinitionError` when a definition is invalid or the defaults fail a constraint.
 */
export function defineSchema<const P extends ParamDefs>(
	params: P,
	options?: { constraints?: NoInfer<Constraint<ParamValues<P>>>[] }
): Schema<P> {
	for (const key of Object.keys(params)) checkParam(key, params[key])

	const constraints = options?.constraints ?? []
	const ids = new Set<string>()
	for (const constraint of constraints) {
		if (ids.has(constraint.id))
			throw new SchemaDefinitionError(`Constraint "${constraint.id}": id is used more than once`)
		ids.add(constraint.id)
		for (const name of constraint.params) {
			if (!Object.hasOwn(params, name))
				throw new SchemaDefinitionError(
					`Constraint "${constraint.id}": names unknown param "${name}"`
				)
		}
	}

	const schema: Schema<P> = { params, constraints: [...constraints] }
	const initial = defaults(schema)
	for (const constraint of constraints) {
		if (!constraint.check(initial))
			throw new SchemaDefinitionError(
				`Constraint "${constraint.id}": the defaults fail it (${constraint.message})`
			)
	}
	return schema
}

/** Returns a fresh value object holding every param's default. */
export function defaults<P extends ParamDefs>(schema: Schema<P>): ParamValues<P> {
	return mapParams(schema.params, copyDefault)
}
