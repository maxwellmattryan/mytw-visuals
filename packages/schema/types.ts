/** Fields every parameter definition shares. */
interface BaseParam<T> {
	readonly label: string
	readonly default: T
	readonly unit?: string
	readonly group?: string
	/** Plain-text help shown under the control. */
	readonly help?: string
}

/** Optional inclusive range. `step` is a UI hint only and never snaps values. */
interface RangeFields {
	readonly min?: number
	readonly max?: number
	readonly step?: number
}

export interface NumberParam extends BaseParam<number>, RangeFields {
	readonly kind: 'number'
	/** Safe for loop phase (such as a cycle count), so the value must be an integer. */
	readonly loopSafe?: boolean
}

export interface IntegerParam extends BaseParam<number>, RangeFields {
	readonly kind: 'integer'
	readonly loopSafe?: boolean
}

export interface BooleanParam extends BaseParam<boolean> {
	readonly kind: 'boolean'
}

export interface EnumParam<O extends string = string> extends BaseParam<O> {
	readonly kind: 'enum'
	readonly options: readonly O[]
}

/** A `#rrggbb` color string. */
export interface ColorParam extends BaseParam<string> {
	readonly kind: 'color'
}

/** A 2D vector. `min`, `max` and `step` apply to both components. */
export interface Vec2Param extends BaseParam<readonly [number, number]>, RangeFields {
	readonly kind: 'vec2'
}

export type ParamDef =
	| NumberParam
	| IntegerParam
	| BooleanParam
	| EnumParam
	| ColorParam
	| Vec2Param

export type ParamKind = ParamDef['kind']

export type ParamDefs = Record<string, ParamDef>

/** The value type a single definition holds. */
export type ValueOf<D> = D extends { kind: 'vec2' }
	? [number, number]
	: D extends { kind: 'enum'; options: readonly (infer O)[] }
		? O
		: D extends { kind: 'boolean' }
			? boolean
			: D extends { kind: 'number' | 'integer' }
				? number
				: D extends { kind: 'color' }
					? string
					: never

type ParamsOf<T> = T extends { params: infer P extends ParamDefs; constraints: readonly unknown[] }
	? P
	: T

/** Maps a schema, or its params record, to its value object. */
export type ParamValues<T> = {
	-readonly [K in keyof ParamsOf<T>]: ValueOf<ParamsOf<T>[K]>
}

/** A cross-parameter rule. `params` names the parameters involved so a panel can highlight them. */
export interface Constraint<V> {
	readonly id: string
	readonly message: string
	readonly params: readonly (keyof V & string)[]
	readonly check: (values: V) => boolean
}

export interface Schema<P extends ParamDefs> {
	readonly params: P
	readonly constraints: readonly Constraint<ParamValues<P>>[]
}

export type ParamIssueCode =
	| 'missing'
	| 'unknown'
	| 'type'
	| 'range'
	| 'integer'
	| 'option'
	| 'format'

export type ValidationIssue =
	| { kind: 'param'; param: string; code: ParamIssueCode; message: string }
	| { kind: 'constraint'; constraint: string; params: readonly string[]; message: string }

export type ValidationResult<P extends ParamDefs> =
	| { ok: true; values: ParamValues<P> }
	| { ok: false; issues: ValidationIssue[] }
