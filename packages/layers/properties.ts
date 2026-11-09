// The properties panel's model: a `PanelModel` over the selected layer, so `@mytw/panel`'s rows
// render it. Every edit is a store command. No DOM or Svelte.
import type { ApplyOptions, Command, JsonValue, Path } from '@mytw/document'
import { defineSchema, param, validate } from '@mytw/schema'
import type { ParamDef, ParamDefs, ProjectLayer } from '@mytw/schema'
// The module, not the `@mytw/panel` barrel: the barrel exports Svelte components, which Jest
// (and so this module's tests) can't load.
import { NOT_A_NUMBER, parseNumberInput } from '../panel/state'
import type { ConstraintIssue, PanelModel, SetResult } from '../panel/state'
import {
	addMask,
	animatableValue,
	DEFAULT_MASK,
	layerPath,
	NEUTRAL,
	removeMask,
	setAnimatable,
	setField,
} from './commands'
import type { LayersController } from './controller'

const STEP = 0.01

export const MASK_DIFFERS_MESSAGE = 'Mask From and To must differ'

export const MODULATED_HELP = 'Modulated: this edits the base value.'

export const LAYER_SCHEMA = defineSchema(
	{
		opacity: param.number({
			label: 'Opacity',
			default: NEUTRAL.opacity,
			min: 0,
			max: 1,
			step: STEP,
			group: 'Layer',
		}),
		blend: param.enum({
			label: 'Blend',
			options: ['normal', 'multiply', 'screen', 'add'],
			default: NEUTRAL.blend,
			group: 'Layer',
		}),
		feather: param.number({
			label: 'Feather',
			default: NEUTRAL.feather,
			min: 0,
			max: 0.5,
			step: STEP,
			group: 'Layer',
		}),
		centerX: param.number({
			label: 'Center X',
			default: NEUTRAL.centerX,
			step: STEP,
			group: 'Framing',
		}),
		centerY: param.number({
			label: 'Center Y',
			default: NEUTRAL.centerY,
			step: STEP,
			group: 'Framing',
		}),
		zoom: param.number({
			label: 'Zoom',
			default: NEUTRAL.zoom,
			min: 0.01,
			max: 100,
			step: STEP,
			group: 'Framing',
		}),
		rotation: param.number({
			label: 'Rotation',
			default: NEUTRAL.rotation,
			unit: 'rad',
			step: STEP,
			group: 'Framing',
		}),
		mirrorX: param.boolean({ label: 'Mirror X', default: NEUTRAL.mirrorX, group: 'Framing' }),
		mirrorY: param.boolean({ label: 'Mirror Y', default: NEUTRAL.mirrorY, group: 'Framing' }),
		maskFrom: param.vec2({
			label: 'From',
			default: DEFAULT_MASK.from,
			step: STEP,
			group: 'Mask',
		}),
		maskTo: param.vec2({ label: 'To', default: DEFAULT_MASK.to, step: STEP, group: 'Mask' }),
	},
	{
		constraints: [
			{
				id: 'mask-differs',
				message: MASK_DIFFERS_MESSAGE,
				params: ['maskFrom', 'maskTo'],
				check: (v) => v.maskFrom[0] !== v.maskTo[0] || v.maskFrom[1] !== v.maskTo[1],
			},
		],
	}
)

export type LayerParam = keyof typeof LAYER_SCHEMA.params & string

type FieldKind = 'animatable' | 'plain'

/** Where each param lives in a layer, and whether it is an animatable number. */
const FIELDS: Record<LayerParam, { path: readonly string[]; kind: FieldKind }> = {
	opacity: { path: ['opacity'], kind: 'animatable' },
	blend: { path: ['blend'], kind: 'plain' },
	feather: { path: ['feather'], kind: 'plain' },
	centerX: { path: ['transform', 'centerX'], kind: 'animatable' },
	centerY: { path: ['transform', 'centerY'], kind: 'animatable' },
	zoom: { path: ['transform', 'zoom'], kind: 'animatable' },
	rotation: { path: ['transform', 'rotation'], kind: 'animatable' },
	mirrorX: { path: ['transform', 'mirrorX'], kind: 'plain' },
	mirrorY: { path: ['transform', 'mirrorY'], kind: 'plain' },
	maskFrom: { path: ['mask', 'from'], kind: 'plain' },
	maskTo: { path: ['mask', 'to'], kind: 'plain' },
}

const PARAM_KEYS = Object.keys(LAYER_SCHEMA.params) as LayerParam[]
const MASK_KEYS: ReadonlySet<string> = new Set<LayerParam>(['maskFrom', 'maskTo'])
/** The params Reset all resets: every Layer and Framing field, not the mask. */
const RESET_ALL_KEYS = PARAM_KEYS.filter((key) => !MASK_KEYS.has(key))

function isLayerParam(key: string): key is LayerParam {
	return Object.hasOwn(LAYER_SCHEMA.params, key)
}

function neutralOf(key: LayerParam): unknown {
	const def: ParamDef = LAYER_SCHEMA.params[key]
	return Array.isArray(def.default) ? [...def.default] : def.default
}

function read(layer: ProjectLayer, path: readonly string[]): unknown {
	let node: unknown = layer
	for (const segment of path) {
		if (typeof node !== 'object' || node === null) return undefined
		node = (node as Record<string, unknown>)[segment]
	}
	return node
}

function sameValue(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((x, i) => x === b[i])
	return a === b
}

export interface LayerModel extends PanelModel {
	/** The selected layer, or `null`. */
	readonly layer: ProjectLayer | null
	readonly hasMask: boolean
	/** Animatable params whose stored value is `{ value, mod }`. */
	readonly modulated: ReadonlySet<string>
	addMask(): void
	removeMask(): void
	destroy(): void
}

/** A `PanelModel` over the controller's selected layer. */
export function createLayerModel(controller: LayersController): LayerModel {
	const { store } = controller
	const values: Record<string, unknown> = {}
	const errors: Partial<Record<string, string>> = {}
	let constraintIssues: ConstraintIssue[] = []
	let layer: ProjectLayer | null = null
	let index = -1
	let modulated: ReadonlySet<string> = new Set()
	let modulatedKey = ''
	let schema: { readonly params: ParamDefs } = LAYER_SCHEMA
	let selectedId: string | null = null
	const subscribers = new Set<() => void>()

	const render = () => {
		for (const fn of [...subscribers]) fn()
	}

	const clearErrors = () => {
		for (const key of Object.keys(errors)) delete errors[key]
	}

	const refresh = () => {
		const id = controller.selectedId
		index = id === null ? -1 : controller.layers.findIndex((l) => l.id === id)
		layer = index === -1 ? null : controller.layers[index]
		if (id !== selectedId) {
			selectedId = id
			clearErrors()
		}
		const nextModulated = new Set<string>()
		for (const key of PARAM_KEYS) {
			const field = FIELDS[key]
			const stored = layer === null ? undefined : read(layer, field.path)
			if (field.kind === 'animatable') {
				if (typeof stored === 'object' && stored !== null) nextModulated.add(key)
				values[key] = animatableValue(stored) ?? neutralOf(key)
			} else if (MASK_KEYS.has(key)) {
				values[key] = Array.isArray(stored) ? [...stored] : neutralOf(key)
			} else {
				values[key] = stored ?? neutralOf(key)
			}
		}
		const key = [...nextModulated].join(',')
		if (key !== modulatedKey) {
			modulatedKey = key
			modulated = nextModulated
			const params: Record<string, ParamDef> = { ...LAYER_SCHEMA.params }
			for (const name of nextModulated) params[name] = { ...params[name], help: MODULATED_HELP }
			schema = { params }
		}
		const result = validate(LAYER_SCHEMA, values)
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

	const pathOf = (key: LayerParam): Path => [
		...layerPath(controller.ref, index),
		...FIELDS[key].path,
	]

	const commandFor = (key: LayerParam, value: unknown): Command | null => {
		if (sameValue(values[key], value)) return null
		const path = pathOf(key)
		if (FIELDS[key].kind === 'animatable') return setAnimatable(store.document, path, Number(value))
		return setField(path, (Array.isArray(value) ? [...value] : value) as JsonValue)
	}

	/** Applies through the store. A rejection becomes the field's error. */
	const apply = (key: string, command: Command | null, options?: ApplyOptions): SetResult => {
		if (command !== null) {
			const result = store.apply(command, options)
			if (!result.ok) return fail(key, result.error.message)
			controller.setError(null)
		}
		if (key in errors) {
			delete errors[key]
			render()
		}
		return { ok: true }
	}

	const set = (key: string, value: unknown): SetResult => {
		if (!isLayerParam(key)) return { ok: false, message: `"${key}" is not a param` }
		if (layer === null) return { ok: false, message: 'No layer selected' }
		if (MASK_KEYS.has(key) && layer.mask === undefined) return { ok: false, message: 'No mask' }
		const result = validate(LAYER_SCHEMA, { ...values, [key]: value })
		if (!result.ok) {
			const issue = result.issues.find(
				(i) =>
					(i.kind === 'param' && i.param === key) ||
					(i.kind === 'constraint' && MASK_KEYS.has(key) && i.params.includes(key))
			)
			if (issue) return fail(key, issue.message)
		}
		return apply(key, commandFor(key, value), { mergeKey: `${layer.id}:${key}` })
	}

	/** One batch for several params, as one undo step. */
	const applyAll = (entries: readonly [LayerParam, unknown][]) => {
		if (layer === null) return
		const commands = entries
			.map(([key, value]) => commandFor(key, value))
			.filter((command): command is Command => command !== null)
		clearErrors()
		if (commands.length > 0) {
			const result = store.apply({ op: 'batch', commands })
			if (!result.ok) controller.setError(result.error.message)
			else controller.setError(null)
		}
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
		get layer() {
			return layer
		},
		get hasMask() {
			return layer?.mask !== undefined
		},
		get modulated() {
			return modulated
		},
		set,
		setText(key, text, component) {
			const parsed = parseNumberInput(text)
			if (parsed === null) return fail(key, NOT_A_NUMBER)
			if (!isLayerParam(key) || LAYER_SCHEMA.params[key].kind !== 'vec2') return set(key, parsed)
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
			if (!isLayerParam(key) || layer === null) return
			if (MASK_KEYS.has(key) && layer.mask === undefined) return
			apply(key, commandFor(key, neutralOf(key)))
		},
		resetAll() {
			applyAll(RESET_ALL_KEYS.map((key) => [key, neutralOf(key)]))
		},
		replaceAll(next) {
			const keys = layer?.mask === undefined ? RESET_ALL_KEYS : PARAM_KEYS
			const entries = keys
				.filter((key) => Object.hasOwn(next, key))
				.map((key): [LayerParam, unknown] => [key, next[key]])
			const result = validate(LAYER_SCHEMA, { ...values, ...Object.fromEntries(entries) })
			if (!result.ok) return
			applyAll(entries)
		},
		addMask() {
			if (layer === null || layer.mask !== undefined) return
			apply('maskFrom', addMask(controller.ref, index))
		},
		removeMask() {
			if (layer === null || layer.mask === undefined) return
			clearErrors()
			apply('maskFrom', removeMask(controller.ref, index))
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
