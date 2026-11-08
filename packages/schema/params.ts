import type {
	BooleanParam,
	ColorParam,
	EnumParam,
	IntegerParam,
	NumberParam,
	Vec2Param,
} from './types'

type Input<D> = Omit<D, 'kind'>

/** Builders for parameter definitions. Each returns a plain, frozen object. */
export const param = {
	number(def: Input<NumberParam>): NumberParam {
		return Object.freeze({ kind: 'number', ...def })
	},

	integer(def: Input<IntegerParam>): IntegerParam {
		return Object.freeze({ kind: 'integer', ...def })
	},

	boolean(def: Input<BooleanParam>): BooleanParam {
		return Object.freeze({ kind: 'boolean', ...def })
	},

	enum<const O extends string>(
		def: Omit<Input<EnumParam<O>>, 'options' | 'default'> & {
			options: readonly [O, ...O[]]
			default: NoInfer<O>
		}
	): EnumParam<O> {
		return Object.freeze({ kind: 'enum', ...def, options: Object.freeze([...def.options]) })
	},

	color(def: Input<ColorParam>): ColorParam {
		return Object.freeze({ kind: 'color', ...def })
	},

	vec2(def: Input<Vec2Param>): Vec2Param {
		const value = Object.freeze<[number, number]>([def.default[0], def.default[1]])
		return Object.freeze({ kind: 'vec2', ...def, default: value })
	},
}
