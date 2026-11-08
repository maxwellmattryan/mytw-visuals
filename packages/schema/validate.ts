import { checkValue, isRecord, mapParams } from './rules'
import type { ParamDefs, Schema, ValidationIssue, ValidationResult } from './types'

function copyValue(value: unknown): unknown {
	return Array.isArray(value) ? [...value] : value
}

/**
 * Checks values against a schema without changing them. Each param reports at most one issue.
 * Constraints run only when every param holds a well-typed value. Issues are ordered by schema key,
 * then constraint, then unknown keys. Never throws.
 */
export function validate<P extends ParamDefs>(
	schema: Schema<P>,
	values: Record<string, unknown>
): ValidationResult<P> {
	const input = isRecord(values) ? values : {}
	const issues: ValidationIssue[] = []

	for (const key of Object.keys(schema.params)) {
		if (!Object.hasOwn(input, key)) {
			issues.push({ kind: 'param', param: key, code: 'missing', message: `"${key}" is missing` })
			continue
		}
		const issue = checkValue(schema.params[key], input[key])
		if (issue)
			issues.push({ kind: 'param', param: key, ...issue, message: `"${key}": ${issue.message}` })
	}

	if (issues.length === 0) {
		const checked = mapParams(schema.params, (_def, key) => copyValue(input[key]))
		for (const constraint of schema.constraints) {
			let passed: boolean
			try {
				passed = constraint.check(checked)
			} catch {
				passed = false
			}
			if (!passed)
				issues.push({
					kind: 'constraint',
					constraint: constraint.id,
					params: constraint.params,
					message: constraint.message,
				})
		}
	}

	for (const key of Object.keys(input)) {
		if (!Object.hasOwn(schema.params, key))
			issues.push({
				kind: 'param',
				param: key,
				code: 'unknown',
				message: `"${key}" is not a param`,
			})
	}

	if (issues.length > 0) return { ok: false, issues }
	return { ok: true, values: mapParams(schema.params, (_def, key) => copyValue(input[key])) }
}
