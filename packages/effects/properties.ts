// The effect properties panel's model: a `PanelModel` over the selected effect instance, built from
// its definition's schema, so `@mytw/panel`'s rows render it. Every edit is a store command. No DOM
// or Svelte.
import type { ApplyOptions, Command, JsonValue, Path } from '@mytw/document'
import type { EffectDefinition } from '@mytw/fx'
import { clampValues, validate } from '@mytw/schema'
import type { EffectInstance, ParamDef, ParamDefs } from '@mytw/schema'
// The modules, not the `@mytw/panel` and `@mytw/layers` barrels: the barrels export Svelte
// components, which Jest (and so this module's tests) can't load.
import { animatableValue, setAnimatable } from '../layers/commands'
import { MODULATED_HELP } from '../layers/properties'
import { NOT_A_NUMBER, parseNumberInput } from '../panel/state'
import type { ConstraintIssue, PanelModel, SetResult } from '../panel/state'
import { selectedParamsPath } from './controller'
import type { EffectsController } from './controller'

export interface EffectModel extends PanelModel {
	/** The selected instance, or `null`. */
	readonly instance: EffectInstance | null
	/** The selected instance's definition, or `null` when nothing is selected or it doesn't resolve. */
	readonly definition: EffectDefinition | null
	/** Number params whose stored value is `{ value, mod }`. */
	readonly modulated: ReadonlySet<string>
	destroy(): void
}

const EMPTY: { readonly params: ParamDefs } = { params: {} }

function isAnimatable(def: ParamDef): boolean {
	return def.kind === 'number' || def.kind === 'integer'
}

function sameValue(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((x, i) => x === b[i])
	return a === b
}

function defaultOf(def: ParamDef): unknown {
	return Array.isArray(def.default) ? [...def.default] : def.default
}

/** A `PanelModel` over the controller's selected effect instance. */
export function createEffectModel(controller: EffectsController): EffectModel {
	const { store } = controller
	const values: Record<string, unknown> = {}
	const errors: Partial<Record<string, string>> = {}
	let constraintIssues: ConstraintIssue[] = []
	let instance: EffectInstance | null = null
	let definition: EffectDefinition | null = null
	let modulated: ReadonlySet<string> = new Set()
	// The schema object changes only with the definition or the set of modulated params, so rows
	// that key on it don't remount on every edit.
	let schemaKey = ''
	let schemaDefinition: EffectDefinition | null = null
	let schema: { readonly params: ParamDefs } = EMPTY
	let selectedId: string | null = null
	const subscribers = new Set<() => void>()

	const render = () => {
		for (const fn of [...subscribers]) fn()
	}

	const clearErrors = () => {
		for (const key of Object.keys(errors)) delete errors[key]
	}

	const refresh = () => {
		const row = controller.selected
		instance = row?.instance ?? null
		definition = row?.definition ?? null
		if (controller.selectedId !== selectedId) {
			selectedId = controller.selectedId
			clearErrors()
		}
		for (const key of Object.keys(values)) delete values[key]
		if (instance === null || definition === null) {
			modulated = new Set()
			schemaKey = ''
			schemaDefinition = null
			schema = EMPTY
			constraintIssues = []
			return
		}
		const raw: Record<string, unknown> = {}
		const nextModulated = new Set<string>()
		for (const [key, def] of Object.entries(definition.params.params)) {
			const stored: unknown = instance.params[key]
			if (isAnimatable(def)) {
				if (typeof stored === 'object' && stored !== null && !Array.isArray(stored))
					nextModulated.add(key)
				raw[key] = animatableValue(stored)
			} else {
				raw[key] = stored
			}
		}
		Object.assign(values, clampValues(definition.params, raw))
		const key = [...nextModulated].join(',')
		if (key !== schemaKey || definition !== schemaDefinition) {
			schemaKey = key
			schemaDefinition = definition
			modulated = nextModulated
			const params: Record<string, ParamDef> = { ...definition.params.params }
			for (const name of nextModulated) params[name] = { ...params[name], help: MODULATED_HELP }
			schema = nextModulated.size === 0 ? definition.params : { params }
		}
		const result = validate(definition.params, values)
		constraintIssues = result.ok
			? []
			: result.issues.filter((i): i is ConstraintIssue => i.kind === 'constraint')
	}

	refresh()
	const stop = controller.subscribe(() => {
		refresh()
		render()
	})

	const fail = (key: string, message: string): SetResult => {
		errors[key] = message
		render()
		return { ok: false, message }
	}

	const paramDef = (key: string): ParamDef | null =>
		definition !== null && Object.hasOwn(definition.params.params, key)
			? definition.params.params[key]
			: null

	const commandFor = (key: string, value: unknown): Command | null => {
		const def = paramDef(key)
		const base = selectedParamsPath(controller)
		if (def === null || base === null) return null
		const path: Path = [...base, key]
		if (isAnimatable(def)) return setAnimatable(store.document, path, Number(value))
		if (sameValue(values[key], value) && Object.hasOwn(instance?.params ?? {}, key)) return null
		return { op: 'set', path, value: (Array.isArray(value) ? [...value] : value) as JsonValue }
	}

	/** Applies through the store. A rejection becomes the field's error. */
	const apply = (key: string, command: Command | null, options?: ApplyOptions): SetResult => {
		if (command !== null) {
			const result = store.apply(command, options)
			if (!result.ok) return fail(key, result.error.message)
		}
		if (key in errors) {
			delete errors[key]
			render()
		}
		return { ok: true }
	}

	const set = (key: string, value: unknown): SetResult => {
		if (instance === null || definition === null)
			return { ok: false, message: 'No effect selected' }
		if (paramDef(key) === null) return { ok: false, message: `"${key}" is not a param` }
		const result = validate(definition.params, { ...values, [key]: value })
		if (!result.ok) {
			const issue = result.issues.find(
				(i) =>
					(i.kind === 'param' && i.param === key) ||
					(i.kind === 'constraint' && i.params.includes(key))
			)
			if (issue) return fail(key, issue.message)
		}
		return apply(key, commandFor(key, value), { mergeKey: `${instance.id}:${key}` })
	}

	/** One batch for several params, as one undo step. */
	const applyAll = (entries: readonly [string, unknown][]) => {
		if (instance === null) return
		const commands = entries
			.map(([key, value]) => commandFor(key, value))
			.filter((command): command is Command => command !== null)
		clearErrors()
		if (commands.length > 0) store.apply({ op: 'batch', commands })
		render()
	}

	return {
		get schema() {
			return schema
		},
		values,
		errors,
		get constraintIssues() {
			return constraintIssues
		},
		get instance() {
			return instance
		},
		get definition() {
			return definition
		},
		get modulated() {
			return modulated
		},
		set,
		setText(key, text, component) {
			const parsed = parseNumberInput(text)
			if (parsed === null) return fail(key, NOT_A_NUMBER)
			if (paramDef(key)?.kind !== 'vec2') return set(key, parsed)
			const current = values[key] as [number, number]
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
			const def = paramDef(key)
			if (def === null) return
			apply(key, commandFor(key, defaultOf(def)))
		},
		resetAll() {
			if (definition === null) return
			applyAll(Object.entries(definition.params.params).map(([key, def]) => [key, defaultOf(def)]))
		},
		replaceAll(next) {
			if (definition === null) return
			const entries = Object.keys(definition.params.params)
				.filter((key) => Object.hasOwn(next, key))
				.map((key): [string, unknown] => [key, next[key]])
			const result = validate(definition.params, { ...values, ...Object.fromEntries(entries) })
			if (!result.ok) return
			applyAll(entries)
		},
		subscribe(fn) {
			subscribers.add(fn)
			return () => {
				subscribers.delete(fn)
			}
		},
		destroy() {
			stop()
			subscribers.clear()
		},
	}
}
