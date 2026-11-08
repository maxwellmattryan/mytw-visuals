import { clampValue, isRecord, mapParams } from './rules'
import type { ParamDefs, ParamValues, Schema } from './types'

/**
 * Coerces untrusted values (a loaded preset, slider input) into a full, valid value object. Never
 * throws. Missing or invalid values use the default, numbers are rounded when they must be integers
 * and clamped to their range, and unknown keys are dropped. Cross-parameter constraints are not
 * repaired, so run `validate` to detect them.
 */
export function clampValues<P extends ParamDefs>(
	schema: Schema<P>,
	values: Record<string, unknown>
): ParamValues<P> {
	const input = isRecord(values) ? values : {}
	return mapParams(schema.params, (def, key) =>
		clampValue(def, Object.hasOwn(input, key) ? input[key] : undefined)
	)
}
