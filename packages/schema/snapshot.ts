import { clampValues } from './clamp'
import { isRecord } from './rules'
import type { ParamDefs, ParamValues, Schema, ValidationIssue } from './types'
import { validate } from './validate'

/**
 * The parameter values envelope: `{ "format": "mytw-params", "version": 1, "values": { ... } }`.
 * A later project format embeds this object as is. Any change to its shape bumps
 * `PARAMS_FORMAT_VERSION` and adds a migration step to `parseValues`, so older documents keep
 * opening.
 */
export const PARAMS_FORMAT = 'mytw-params'
export const PARAMS_FORMAT_VERSION = 1

export type ParseValuesResult<P extends ParamDefs> =
	| {
			ok: true
			values: ParamValues<P>
			/** Param issues `clampValues` repaired, excluding `missing`. */
			adjusted: ValidationIssue[]
	  }
	| { ok: false; message: string }

/** Serializes values as the envelope, pretty-printed with tabs. */
export function serializeValues(values: Record<string, unknown>): string {
	return JSON.stringify(
		{ format: PARAMS_FORMAT, version: PARAMS_FORMAT_VERSION, values },
		null,
		'\t'
	)
}

function readJson(text: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(text) }
	} catch {
		return { ok: false }
	}
}

/**
 * Reads values from the envelope or a bare values object, given as JSON text or an already parsed
 * value. Accepted values are coerced with `clampValues`, and the issues that changed are reported.
 * Never throws.
 */
export function parseValues<P extends ParamDefs>(
	schema: Schema<P>,
	input: unknown
): ParseValuesResult<P> {
	let data = input
	if (typeof input === 'string') {
		const parsed = readJson(input)
		if (!parsed.ok) return { ok: false, message: 'Not valid JSON' }
		data = parsed.value
	}
	if (!isRecord(data)) return { ok: false, message: 'Expected a JSON object' }

	let values: unknown = data
	if (Object.hasOwn(data, 'format')) {
		const { version } = data
		if (data.format !== PARAMS_FORMAT || typeof version !== 'number' || !Number.isInteger(version))
			return { ok: false, message: 'Not a mytw-params document' }
		if (version > PARAMS_FORMAT_VERSION)
			return { ok: false, message: `Saved by a newer version (v${version})` }
		if (version < 1) return { ok: false, message: 'Not a mytw-params document' }
		values = Object.hasOwn(data, 'values') ? data.values : undefined
	}
	if (!isRecord(values)) return { ok: false, message: 'Expected a JSON object' }

	if (!Object.keys(values).some((key) => Object.hasOwn(schema.params, key)))
		return { ok: false, message: 'None of these values belong to this sketch' }

	const result = validate(schema, values)
	const adjusted = result.ok
		? []
		: result.issues.filter((issue) => issue.kind === 'param' && issue.code !== 'missing')
	return { ok: true, values: clampValues(schema, values), adjusted }
}
