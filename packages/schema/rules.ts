// Internal per-parameter rules shared by defineSchema, clampValues and validate.
import type { ParamDef, ParamDefs, ParamIssueCode, ParamValues } from './types'

export const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

type RangedDef = Extract<ParamDef, { kind: 'number' | 'integer' | 'vec2' }>

export interface ValueIssue {
	code: Exclude<ParamIssueCode, 'missing' | 'unknown'>
	message: string
}

/** Integer params and loop-safe numbers only hold integers. */
export function wantsInteger(def: ParamDef): boolean {
	return def.kind === 'integer' || (def.kind === 'number' && def.loopSafe === true)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function inRange(def: RangedDef, value: number): boolean {
	return (def.min === undefined || value >= def.min) && (def.max === undefined || value <= def.max)
}

function rangeText(def: RangedDef): string {
	return `[${def.min ?? '-Infinity'}, ${def.max ?? 'Infinity'}]`
}

/** Returns the first issue with a value, checked in the order type, integer, range (option, format). */
export function checkValue(def: ParamDef, value: unknown): ValueIssue | undefined {
	switch (def.kind) {
		case 'number':
		case 'integer':
			if (!isFiniteNumber(value)) return { code: 'type', message: 'expected a finite number' }
			if (wantsInteger(def) && !Number.isInteger(value))
				return { code: 'integer', message: `expected an integer, got ${value}` }
			if (!inRange(def, value))
				return { code: 'range', message: `${value} is outside ${rangeText(def)}` }
			return undefined
		case 'boolean':
			return typeof value === 'boolean'
				? undefined
				: { code: 'type', message: 'expected a boolean' }
		case 'enum':
			if (typeof value !== 'string') return { code: 'type', message: 'expected a string' }
			if (!def.options.includes(value))
				return { code: 'option', message: `"${value}" is not one of ${def.options.join(', ')}` }
			return undefined
		case 'color':
			if (typeof value !== 'string') return { code: 'type', message: 'expected a string' }
			if (!COLOR_PATTERN.test(value))
				return { code: 'format', message: `"${value}" is not a #rrggbb color` }
			return undefined
		case 'vec2':
			if (!Array.isArray(value) || value.length !== 2 || !value.every(isFiniteNumber))
				return { code: 'type', message: 'expected an array of 2 finite numbers' }
			if (!value.every((component: number) => inRange(def, component)))
				return { code: 'range', message: `[${value.join(', ')}] is outside ${rangeText(def)}` }
			return undefined
	}
}

function clampNumber(def: RangedDef, value: number): number {
	let result = wantsInteger(def) ? Math.round(value) : value
	if (def.min !== undefined) result = Math.max(result, def.min)
	if (def.max !== undefined) result = Math.min(result, def.max)
	return result
}

/** Copies a definition's default, so callers can mutate the result. */
export function copyDefault(def: ParamDef): unknown {
	return def.kind === 'vec2' ? [def.default[0], def.default[1]] : def.default
}

/** Coerces a value into a valid one for the definition, falling back to the default. */
export function clampValue(def: ParamDef, value: unknown): unknown {
	switch (def.kind) {
		case 'number':
		case 'integer':
			return isFiniteNumber(value) ? clampNumber(def, value) : def.default
		case 'boolean':
			return typeof value === 'boolean' ? value : def.default
		case 'enum':
			return typeof value === 'string' && def.options.includes(value) ? value : def.default
		case 'color':
			return typeof value === 'string' && COLOR_PATTERN.test(value)
				? value.toLowerCase()
				: def.default
		case 'vec2': {
			if (!Array.isArray(value) || value.length !== 2) return copyDefault(def)
			const pair: unknown[] = value
			return [0, 1].map((i) => {
				const component = pair[i]
				return isFiniteNumber(component) ? clampNumber(def, component) : def.default[i]
			})
		}
	}
}

/**
 * Builds a value object by mapping every param in key order. The record it builds holds one valid
 * value per key, which is what `ParamValues<P>` describes, so the overload is the single place that
 * relates the two.
 */
export function mapParams<P extends ParamDefs>(
	params: P,
	fn: (def: ParamDef, key: string) => unknown
): ParamValues<P>
export function mapParams(
	params: ParamDefs,
	fn: (def: ParamDef, key: string) => unknown
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(params)) out[key] = fn(params[key], key)
	return out
}
