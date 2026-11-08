// A small runtime codec library for the project format. A codec checks a value at a path, pushes
// issues into a shared array and returns whether the value is valid. It never copies or coerces.
// Document types are inferred from codecs with `Infer`, so the checks and the types can't drift.
import { isFiniteNumber, isRecord } from './rules'

export type ProjectIssueCode =
	| 'json'
	| 'format'
	| 'newer-version'
	| 'migration'
	| 'missing'
	| 'unknown'
	| 'type'
	| 'range'
	| 'integer'
	| 'pattern'
	| 'option'
	| 'length'
	| 'reference'
	| 'duplicate'
	| 'timeline'
	| 'order'
	| 'seam'

export interface ProjectIssue {
	/** `tracks[0].clips[0].layers[1].transform.zoom.value`, `modulators["drift-x"].cycles`, or `''` for the root. */
	path: string
	code: ProjectIssueCode
	/** `${path || 'document'}: ${detail}` */
	message: string
}

export interface Codec<T> {
	check(value: unknown, path: string, issues: ProjectIssue[]): value is T
}

export type Infer<C> = C extends Codec<infer T> ? T : never

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Extension values nest at most this deep, which also bounds recursion on hostile input. */
export const JSON_MAX_DEPTH = 64

export function issue(path: string, code: ProjectIssueCode, detail: string): ProjectIssue {
	return { path, code, message: `${path || 'document'}: ${detail}` }
}

export function childPath(path: string, key: string): string {
	return path ? `${path}.${key}` : key
}

export function indexPath(path: string, index: number): string {
	return `${path}[${index}]`
}

export function recordPath(path: string, key: string): string {
	return `${path}[${JSON.stringify(key)}]`
}

const QUOTE_LIMIT = 64

/** Quotes a string for a message, shortening long values. */
export function quote(value: string): string {
	return JSON.stringify(value.length > QUOTE_LIMIT ? `${value.slice(0, QUOTE_LIMIT)}…` : value)
}

function codec<T>(
	check: (value: unknown, path: string, issues: ProjectIssue[]) => boolean
): Codec<T> {
	return { check: (value, path, issues): value is T => check(value, path, issues) }
}

export function literal<const V extends string | number>(expected: V): Codec<V> {
	return codec((value, path, issues) => {
		if (value === expected) return true
		if (typeof value !== typeof expected) {
			issues.push(
				issue(path, 'type', `expected the ${typeof expected} ${JSON.stringify(expected)}`)
			)
		} else {
			const shown = typeof value === 'string' ? quote(value) : String(value)
			issues.push(issue(path, 'option', `${shown} is not one of ${expected}`))
		}
		return false
	})
}

export function boolean(): Codec<boolean> {
	return codec((value, path, issues) => {
		if (typeof value === 'boolean') return true
		issues.push(issue(path, 'type', 'expected a boolean'))
		return false
	})
}

export interface StringOptions {
	min?: number
	max?: number
	pattern?: RegExp
	/** Completes `"<v>" is not <description>` for a pattern issue. */
	description?: string
}

export function string(options: StringOptions = {}): Codec<string> {
	const { min, max, pattern, description = `matching ${pattern}` } = options
	return codec((value, path, issues) => {
		if (typeof value !== 'string') {
			issues.push(issue(path, 'type', 'expected a string'))
			return false
		}
		if ((min !== undefined && value.length < min) || (max !== undefined && value.length > max)) {
			const expected =
				max === undefined
					? `at least ${min}`
					: min === undefined
						? `at most ${max}`
						: `${min} to ${max}`
			issues.push(issue(path, 'length', `has ${value.length} characters, expected ${expected}`))
			return false
		}
		if (pattern && !pattern.test(value)) {
			issues.push(issue(path, 'pattern', `${quote(value)} is not ${description}`))
			return false
		}
		return true
	})
}

export interface NumberOptions {
	min?: number
	max?: number
	/** Makes `min` exclusive. */
	exclusiveMin?: boolean
	/** Makes `max` exclusive. */
	exclusiveMax?: boolean
	integer?: boolean
}

function rangeText({ min, max, exclusiveMin, exclusiveMax }: NumberOptions): string {
	return `${exclusiveMin ? '(' : '['}${min ?? '-Infinity'}, ${max ?? 'Infinity'}${exclusiveMax ? ')' : ']'}`
}

function inRange({ min, max, exclusiveMin, exclusiveMax }: NumberOptions, value: number): boolean {
	const aboveMin = min === undefined || (exclusiveMin ? value > min : value >= min)
	const belowMax = max === undefined || (exclusiveMax ? value < max : value <= max)
	return aboveMin && belowMax
}

/** The first issue with a number, checked in the order type, integer, range. */
function numberIssue(
	value: unknown,
	path: string,
	options: NumberOptions
): ProjectIssue | undefined {
	if (!isFiniteNumber(value)) return issue(path, 'type', 'expected a finite number')
	if (options.integer && !Number.isInteger(value))
		return issue(path, 'integer', `expected an integer, got ${value}`)
	if (!inRange(options, value))
		return issue(path, 'range', `${value} is outside ${rangeText(options)}`)
	return undefined
}

export function number(options: NumberOptions = {}): Codec<number> {
	return codec((value, path, issues) => {
		const found = numberIssue(value, path, options)
		if (found) issues.push(found)
		return found === undefined
	})
}

export function oneOf<const O extends readonly string[]>(options: O): Codec<O[number]> {
	return codec((value, path, issues) => {
		if (typeof value !== 'string') {
			issues.push(issue(path, 'type', 'expected a string'))
			return false
		}
		if (options.includes(value)) return true
		issues.push(issue(path, 'option', `${quote(value)} is not one of ${options.join(', ')}`))
		return false
	})
}

export function array<T>(item: Codec<T>, options: { min?: number } = {}): Codec<T[]> {
	const { min } = options
	return codec((value, path, issues) => {
		if (!Array.isArray(value)) {
			issues.push(issue(path, 'type', 'expected an array'))
			return false
		}
		if (min !== undefined && value.length < min) {
			issues.push(issue(path, 'length', `has ${value.length} items, expected at least ${min}`))
			return false
		}
		let ok = true
		// An index loop, not forEach, so a hole in a sparse array is checked as `undefined`.
		for (let index = 0; index < value.length; index++) {
			if (!item.check(value[index], indexPath(path, index), issues)) ok = false
		}
		return ok
	})
}

export function tuple2(item: Codec<number>): Codec<[number, number]> {
	return codec((value, path, issues) => {
		if (!Array.isArray(value) || value.length !== 2) {
			issues.push(issue(path, 'type', 'expected an array of 2 numbers'))
			return false
		}
		const first = item.check(value[0], indexPath(path, 0), issues)
		const second = item.check(value[1], indexPath(path, 1), issues)
		return first && second
	})
}

export function record<V>(
	keyPattern: RegExp,
	keyDescription: string,
	value: Codec<V>
): Codec<Record<string, V>> {
	return codec((input, path, issues) => {
		if (!isRecord(input)) {
			issues.push(issue(path, 'type', 'expected an object'))
			return false
		}
		let ok = true
		for (const key of Object.keys(input)) {
			const at = recordPath(path, key)
			if (!keyPattern.test(key)) {
				issues.push(issue(at, 'pattern', `${quote(key)} is not ${keyDescription}`))
				ok = false
			} else if (!value.check(input[key], at, issues)) {
				ok = false
			}
		}
		return ok
	})
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false
	const proto: unknown = Object.getPrototypeOf(value)
	return proto === Object.prototype || proto === null
}

function checkJson(value: unknown, path: string, issues: ProjectIssue[], depth: number): boolean {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return true
		issues.push(issue(path, 'type', `expected a JSON value, got ${value}`))
		return false
	}
	const isArray = Array.isArray(value)
	if (!isArray && !isPlainObject(value)) {
		issues.push(issue(path, 'type', `expected a JSON value, got ${typeof value}`))
		return false
	}
	if (depth >= JSON_MAX_DEPTH) {
		issues.push(issue(path, 'type', `expected JSON nested at most ${JSON_MAX_DEPTH} levels deep`))
		return false
	}
	let ok = true
	if (isArray) {
		for (let index = 0; index < value.length; index++) {
			if (!checkJson(value[index], indexPath(path, index), issues, depth + 1)) ok = false
		}
	} else {
		for (const key of Object.keys(value)) {
			if (!checkJson(value[key], recordPath(path, key), issues, depth + 1)) ok = false
		}
	}
	return ok
}

/** Any JSON value: null, boolean, finite number, string, array or plain object, checked recursively. */
export function json(): Codec<Json> {
	return codec((value, path, issues) => checkJson(value, path, issues, 0))
}

/** Copies stop this deep and keep the original below, which the depth-limited checks reject. */
const CLONE_MAX_DEPTH = 128

/**
 * Deep-copies arrays and plain objects, building objects with `Object.fromEntries` so a
 * `__proto__` key stays an own key. Anything else is kept as is, so a later check still sees
 * exactly what the input held: a copied project shares no object with its input once it validates.
 */
export function cloneData(value: unknown, depth = 0): unknown {
	if (depth >= CLONE_MAX_DEPTH) return value
	// Array.from turns holes into `undefined`, which the checks then reject.
	if (Array.isArray(value))
		return Array.from(value, (element: unknown) => cloneData(element, depth + 1))
	if (!isPlainObject(value)) return value
	return Object.fromEntries(
		Object.keys(value).map((key) => [key, cloneData(value[key], depth + 1)])
	)
}

/** The optional `extensions` object: any non-empty keys, JSON values, never read by the format. */
const extensionsCodec = record(/^[\s\S]+$/, 'a non-empty key', json())

type Shape = Record<string, Codec<unknown>>

type Simplify<T> = { [K in keyof T]: T[K] }

export type ObjectOf<R extends Shape, O extends Shape, X extends boolean> = Simplify<
	{ [K in keyof R]: Infer<R[K]> } & { [K in keyof O]?: Infer<O[K]> } & (X extends true
			? { extensions?: Record<string, Json> }
			: unknown)
>

/**
 * A strict object. Keys outside `required` and `optional` are `unknown` issues, except
 * `extensions` when the option allows it. An optional key holding `undefined` counts as absent.
 */
export function object<
	R extends Shape,
	O extends Shape = Record<never, never>,
	X extends boolean = false,
>(required: R, optional?: O, options?: { extensions?: X }): Codec<ObjectOf<R, O, X>> {
	const optionalShape: Shape = { ...optional }
	if (options?.extensions) optionalShape.extensions = extensionsCodec
	return codec((value, path, issues) => {
		if (!isRecord(value)) {
			issues.push(issue(path, 'type', 'expected an object'))
			return false
		}
		let ok = true
		for (const key of Object.keys(value)) {
			const at = childPath(path, key)
			const isRequired = Object.hasOwn(required, key)
			const field = isRequired
				? required[key]
				: Object.hasOwn(optionalShape, key)
					? optionalShape[key]
					: undefined
			const fieldValue = value[key]
			if (field === undefined) {
				issues.push(issue(at, 'unknown', 'is not a known field'))
				ok = false
			} else if (fieldValue === undefined) {
				if (isRequired) {
					issues.push(issue(at, 'missing', 'is missing'))
					ok = false
				}
			} else if (!field.check(fieldValue, at, issues)) {
				ok = false
			}
		}
		for (const key of Object.keys(required)) {
			if (!Object.hasOwn(value, key)) {
				issues.push(issue(childPath(path, key), 'missing', 'is missing'))
				ok = false
			}
		}
		return ok
	})
}

/** Picks an object codec by the string at `discriminant`, such as `kind` or `shape`. */
export function tagged<M extends Record<string, Codec<unknown>>>(
	discriminant: string,
	variants: M
): Codec<Infer<M[keyof M]>> {
	const tags = Object.keys(variants)
	return codec((value, path, issues) => {
		if (!isRecord(value)) {
			issues.push(issue(path, 'type', 'expected an object'))
			return false
		}
		const at = childPath(path, discriminant)
		if (!Object.hasOwn(value, discriminant)) {
			issues.push(issue(at, 'missing', 'is missing'))
			return false
		}
		const tag = value[discriminant]
		if (typeof tag !== 'string') {
			issues.push(issue(at, 'type', 'expected a string'))
			return false
		}
		if (!Object.hasOwn(variants, tag)) {
			issues.push(issue(at, 'option', `${quote(tag)} is not one of ${tags.join(', ')}`))
			return false
		}
		return variants[tag].check(value, path, issues)
	})
}

/**
 * A bare finite number, or `{ value, mod }` where `mod` is a list of bindings. Range rules apply to
 * the number or to `value` only. The binding codec is passed in so this module stays format-free.
 */
export function animatableNumber<B>(
	options: NumberOptions,
	binding: Codec<B>
): Codec<number | { value: number; mod: B[] }> {
	const plain = number(options)
	const bound = object({ value: plain, mod: array(binding) })
	return codec((value, path, issues) => {
		if (typeof value === 'number') return plain.check(value, path, issues)
		if (isRecord(value)) return bound.check(value, path, issues)
		issues.push(issue(path, 'type', 'expected a number or an object with value and mod'))
		return false
	})
}
