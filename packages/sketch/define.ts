import type { ParamDefs } from '@mytw/schema'
import type { SketchDefinition, SketchInput } from './types'

/** The same pattern as project effect and sketch names. */
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Thrown by `defineSketch` when a definition is invalid. */
export class SketchDefinitionError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SketchDefinitionError'
	}
}

/**
 * Validates a sketch and returns it frozen. Throws `SketchDefinitionError` naming the sketch and
 * the problem.
 */
export function defineSketch<P extends ParamDefs>(input: SketchInput<P>): SketchDefinition<P> {
	const fail = (problem: string): never => {
		throw new SketchDefinitionError(`Sketch "${String(input.id)}": ${problem}`)
	}

	if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id))
		fail('id must be kebab-case, such as "basic-orbits"')
	if (!Number.isInteger(input.version) || input.version < 1)
		fail(`version (${String(input.version)}) must be an integer >= 1`)
	if (typeof input.draw !== 'function') fail('draw must be a function')
	if (input.setup !== undefined && typeof input.setup !== 'function')
		fail('setup must be a function when given')

	return Object.freeze({
		id: input.id,
		version: input.version,
		name: input.name,
		params: input.params,
		setup: input.setup,
		draw: input.draw,
	})
}
