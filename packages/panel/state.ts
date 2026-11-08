// Panel logic with no DOM or Svelte imports, so it runs (and is tested) in plain Node.
import { isTypingTarget } from '@lib/capture'
import { defaults, validate } from '@mytw/schema'
import type { ParamDef, ParamDefs, ParamValues, Schema, ValidationIssue } from '@mytw/schema'

export type ParamKey<P> = keyof P & string

export type ConstraintIssue = Extract<ValidationIssue, { kind: 'constraint' }>

export type SetResult = { ok: true } | { ok: false; message: string }

/** Called after every applied change, with the key that changed, or `null` for reset all. */
export type ChangeListener<P extends ParamDefs> = (
	values: ParamValues<P>,
	key: ParamKey<P> | null
) => void

export interface PanelState<P extends ParamDefs> {
	readonly schema: Schema<P>
	/** A plain object, updated in place. Its identity never changes. */
	readonly values: ParamValues<P>
	/** The message for each param whose last entry was rejected. */
	readonly errors: Partial<Record<ParamKey<P>, string>>
	/** Constraints the current values fail. */
	readonly constraintIssues: readonly ConstraintIssue[]
	/** Validates and applies a value. A rejected value leaves `values` unchanged. */
	set(key: ParamKey<P>, value: unknown): SetResult
	/** Parses a number field's text, then applies it. `component` picks a vec2 component. */
	setText(key: ParamKey<P>, text: string, component?: 0 | 1): SetResult
	/** Clears a param's error without changing its value. */
	clearError(key: ParamKey<P>): void
	reset(key: ParamKey<P>): void
	resetAll(): void
	/**
	 * Applies a full value object in place, as a loaded snapshot or pasted values do. Clears every
	 * field error and fires one change event with `key = null`.
	 */
	replaceAll(values: ParamValues<P>): void
	onChange(fn: ChangeListener<P>): () => void
	/** Called after any change to values, errors or constraint issues, for the UI to re-render. */
	subscribe(fn: () => void): () => void
}

/**
 * The untyped view of a `PanelState` that the components use. Every `PanelState<P>` is one, which
 * lets the components stay non-generic while sketches keep their typed `values`.
 */
export interface PanelModel {
	readonly schema: { readonly params: ParamDefs }
	readonly values: Readonly<Record<string, unknown>>
	readonly errors: Readonly<Partial<Record<string, string>>>
	readonly constraintIssues: readonly ConstraintIssue[]
	set(key: string, value: unknown): SetResult
	setText(key: string, text: string, component?: 0 | 1): SetResult
	clearError(key: string): void
	reset(key: string): void
	resetAll(): void
	replaceAll(values: Readonly<Record<string, unknown>>): void
	subscribe(fn: () => void): () => void
}

export const NOT_A_NUMBER = 'Enter a number'

/** Returns the number a text field holds, or `null` when it is empty or not a finite number. */
export function parseNumberInput(text: string): number | null {
	const trimmed = text.trim()
	if (trimmed === '') return null
	const value = Number(trimmed)
	return Number.isFinite(value) ? value : null
}

function copyValue(value: unknown): unknown {
	return Array.isArray(value) ? [...value] : value
}

function constraintIssuesOf(result: ReturnType<typeof validate>): ConstraintIssue[] {
	if (result.ok) return []
	return result.issues.filter((issue): issue is ConstraintIssue => issue.kind === 'constraint')
}

export function createPanelState<P extends ParamDefs>(schema: Schema<P>): PanelState<P> {
	const values = defaults(schema)
	// The same object as `values`, viewed by string key for writes.
	const record: Record<string, unknown> = values
	const errors: Partial<Record<ParamKey<P>, string>> = {}
	let constraintIssues = constraintIssuesOf(validate(schema, record))
	const listeners = new Set<ChangeListener<P>>()
	const subscribers = new Set<() => void>()

	const render = () => {
		for (const fn of subscribers) fn()
	}

	const changed = (key: ParamKey<P> | null) => {
		for (const fn of listeners) fn(values, key)
		render()
	}

	const fail = (key: ParamKey<P>, message: string): SetResult => {
		errors[key] = message
		render()
		return { ok: false, message }
	}

	const set = (key: ParamKey<P>, value: unknown): SetResult => {
		const result = validate(schema, { ...record, [key]: value })
		if (!result.ok) {
			const issue = result.issues.find((i) => i.kind === 'param' && i.param === key)
			if (issue) return fail(key, issue.message)
		}
		record[key] = copyValue(value)
		constraintIssues = constraintIssuesOf(result)
		delete errors[key]
		changed(key)
		return { ok: true }
	}

	return {
		schema,
		values,
		errors,
		get constraintIssues() {
			return constraintIssues
		},
		set,
		setText(key, text, component) {
			const parsed = parseNumberInput(text)
			if (parsed === null) return fail(key, NOT_A_NUMBER)
			if (schema.params[key]?.kind !== 'vec2') return set(key, parsed)
			const current = record[key] as [number, number]
			const pair: [number, number] = [current[0], current[1]]
			pair[component ?? 0] = parsed
			return set(key, pair)
		},
		clearError(key) {
			if (!(key in errors)) return
			delete errors[key]
			render()
		},
		reset(key) {
			const fresh: Record<string, unknown> = defaults(schema)
			record[key] = fresh[key]
			delete errors[key]
			constraintIssues = constraintIssuesOf(validate(schema, record))
			changed(key)
		},
		resetAll() {
			Object.assign(values, defaults(schema))
			for (const key of Object.keys(errors)) delete errors[key as ParamKey<P>]
			constraintIssues = constraintIssuesOf(validate(schema, record))
			changed(null)
		},
		replaceAll(next) {
			const source: Readonly<Record<string, unknown>> = next
			for (const key of Object.keys(schema.params)) record[key] = copyValue(source[key])
			for (const key of Object.keys(errors)) delete errors[key as ParamKey<P>]
			constraintIssues = constraintIssuesOf(validate(schema, record))
			changed(null)
		},
		onChange(fn) {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		subscribe(fn) {
			subscribers.add(fn)
			return () => {
				subscribers.delete(fn)
			}
		},
	}
}

export interface ParamSection<K extends string = string> {
	group: string | null
	keys: K[]
}

/** Ungrouped params first, then one section per group in first-appearance order, each in key order. */
export function groupParams<P extends ParamDefs>(schema: {
	readonly params: P
}): ParamSection<ParamKey<P>>[] {
	type K = ParamKey<P>
	const ungrouped: K[] = []
	const groups = new Map<string, K[]>()
	for (const key of Object.keys(schema.params) as K[]) {
		const def = schema.params[key]
		if (def.group === undefined) {
			ungrouped.push(key)
			continue
		}
		const keys = groups.get(def.group)
		if (keys) keys.push(key)
		else groups.set(def.group, [key])
	}
	const sections: ParamSection<K>[] = [...groups].map(([group, keys]) => ({ group, keys }))
	return ungrouped.length > 0 ? [{ group: null, keys: ungrouped }, ...sections] : sections
}

export type RangedParam = Extract<ParamDef, { kind: 'number' | 'integer' | 'vec2' }>

/** Integer params and loop-safe numbers only hold integers. */
export function wantsInteger(def: ParamDef): boolean {
	return def.kind === 'integer' || (def.kind === 'number' && def.loopSafe === true)
}

/** Step for a param without a full range and without its own `step`. */
const OPEN_RANGE_STEP = 0.01

/**
 * Step for sliders and arrow keys: `def.step`, else 1 for integer-valued params, else a thousandth
 * of the range (or 0.01 when the range is open or empty).
 */
export function stepFor(def: RangedParam): number {
	if (def.step !== undefined) return def.step
	if (wantsInteger(def)) return 1
	if (def.min === undefined || def.max === undefined || def.max === def.min) return OPEN_RANGE_STEP
	return (def.max - def.min) / 1000
}

/** Slider settings, or `null` when the param has no full range and so gets no slider. */
export function sliderFor(def: ParamDef): { min: number; max: number; step: number } | null {
	if (def.kind !== 'number' && def.kind !== 'integer' && def.kind !== 'vec2') return null
	if (def.min === undefined || def.max === undefined) return null
	return { min: def.min, max: def.max, step: stepFor(def) }
}

/** Rounds away float noise such as 0.30000000000000004, for display and stepping. */
export function roundNumber(value: number): number {
	return Number(value.toPrecision(12))
}

/** The value an arrow key gives: one step (ten with Shift) up or down, kept inside the range. */
export function stepValue(
	def: RangedParam,
	value: number,
	direction: 1 | -1,
	big: boolean
): number {
	let next = roundNumber(value + direction * stepFor(def) * (big ? 10 : 1))
	if (def.min !== undefined) next = Math.max(next, def.min)
	if (def.max !== undefined) next = Math.min(next, def.max)
	return next
}

/** An `aria-describedby` value from the ids that exist, or `undefined` when none do. */
export function describedBy(...ids: (string | undefined)[]): string | undefined {
	const present = ids.filter((id): id is string => id !== undefined)
	return present.length > 0 ? present.join(' ') : undefined
}

/** Whether an element takes typed input, so single-key shortcuts must ignore it. */
export { isTypingTarget as isEditableTarget }

export interface KeyLike {
	key: string
	ctrlKey: boolean
	metaKey: boolean
	altKey: boolean
}

/** Whether a key press toggles the panel: `h` or `H`, unmodified, outside editable elements. */
export function isToggleKey(event: KeyLike, active: unknown): boolean {
	if (event.key !== 'h' && event.key !== 'H') return false
	if (event.ctrlKey || event.metaKey || event.altKey) return false
	return !isTypingTarget(active)
}

/** Whether a key press swaps A and B during a compare: `b` or `B`, unmodified, outside editable elements. */
export function isCompareKey(event: KeyLike, active: unknown): boolean {
	if (event.key !== 'b' && event.key !== 'B') return false
	if (event.ctrlKey || event.metaKey || event.altKey) return false
	return !isTypingTarget(active)
}
