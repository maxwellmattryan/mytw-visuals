// Project document format v2. See docs/project-format.md. Every document type is inferred from
// the codecs below, so the validator and the types describe one format.
import {
	animatableNumber,
	array,
	boolean,
	type Codec,
	type Infer,
	issue,
	literal,
	number,
	type NumberOptions,
	object,
	oneOf,
	record,
	string,
	tagged,
	tuple2,
} from './codec'
import { COLOR_PATTERN } from './rules'
import { PARAMS_FORMAT, PARAMS_FORMAT_VERSION } from './snapshot'

export type { ProjectIssue, ProjectIssueCode } from './codec'

export const PROJECT_FORMAT = 'mytw-project'
export const PROJECT_SCHEMA_VERSION = 2

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const PARAM_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/
const FILE_NAME_PATTERN = /^[^/\\]*$/

const ID_DESCRIPTION = 'a valid id (a letter or digit, then up to 63 letters, digits, _ or -)'
const HASH_DESCRIPTION = 'a sha256 content hash'

export const EASINGS = [
	'linear',
	'easeInOutQuad',
	'easeOutCubic',
	'easeInCubic',
	'easeInOutCubic',
	'easeOutExpo',
	'easeInOutExpo',
] as const

const id = string({ pattern: ID_PATTERN, description: ID_DESCRIPTION })
const contentHash = string({ pattern: CONTENT_HASH_PATTERN, description: HASH_DESCRIPTION })
const integer = (options: NumberOptions = {}) => number({ ...options, integer: true })

const modBindingCodec = object({
	modulator: id,
	amount: number(),
	mode: oneOf(['add', 'multiply']),
})

const animatable = (options: NumberOptions = {}) => animatableNumber(options, modBindingCodec)

const animatableCodec = animatable()

const assetCodec = tagged('kind', {
	image: object(
		{
			kind: literal('image'),
			mimeType: oneOf(['image/png', 'image/jpeg', 'image/webp']),
			width: integer({ min: 1 }),
			height: integer({ min: 1 }),
		},
		{
			name: string({
				min: 1,
				max: 255,
				pattern: FILE_NAME_PATTERN,
				description: 'a file name without / or \\',
			}),
		},
		{ extensions: true }
	),
})

const periodic = <const S extends string>(shape: S) =>
	object(
		{
			shape: literal(shape),
			cycles: integer({ min: 0, max: 64 }),
			phase: number({ min: 0, max: 1, exclusiveMax: true }),
		},
		undefined,
		{ extensions: true }
	)

const modulatorCodec = tagged('shape', {
	sine: periodic('sine'),
	triangle: periodic('triangle'),
	noise: object(
		{
			shape: literal('noise'),
			cycles: integer({ min: 0, max: 64 }),
			phase: number({ min: 0, max: 1, exclusiveMax: true }),
			seed: integer(),
		},
		undefined,
		{ extensions: true }
	),
	keyframes: object(
		{
			shape: literal('keyframes'),
			keys: array(
				object({
					at: number({ min: 0, max: 1 }),
					value: number(),
					easing: oneOf(EASINGS),
				}),
				{ min: 1 }
			),
		},
		undefined,
		{ extensions: true }
	),
})

const vec2 = tuple2(number())

type EffectParamValue = Infer<typeof animatableCodec> | boolean | string | [number, number]

const effectParamCodec: Codec<EffectParamValue> = {
	check: (value, path, issues): value is EffectParamValue => {
		if (typeof value === 'boolean' || typeof value === 'string') return true
		if (Array.isArray(value)) return vec2.check(value, path, issues)
		if (typeof value === 'number' || (typeof value === 'object' && value !== null))
			return animatableCodec.check(value, path, issues)
		issues.push(
			issue(path, 'type', 'expected a number, boolean, string, [number, number] or { value, mod }')
		)
		return false
	},
}

const effectInstanceCodec = object(
	{
		id,
		effect: string({
			pattern: NAME_PATTERN,
			description: 'an effect name (lowercase letters and digits, joined by -)',
		}),
		version: integer({ min: 1 }),
		enabled: boolean(),
		params: record(
			PARAM_KEY_PATTERN,
			'a param name (a letter, then letters or digits)',
			effectParamCodec
		),
	},
	undefined,
	{ extensions: true }
)

const transformCodec = object({
	centerX: animatable(),
	centerY: animatable(),
	zoom: animatable({ min: 0, exclusiveMin: true }),
	rotation: animatable(),
	mirrorX: boolean(),
	mirrorY: boolean(),
})

const maskCodec = tagged('kind', {
	'linear-gradient': object({
		kind: literal('linear-gradient'),
		from: vec2,
		to: vec2,
	}),
})

type SketchParamValue = number | boolean | string | [number, number]

const finite = number()

/** A sketch param value. Unlike effect params, sketch params are not animatable. */
const sketchValueCodec: Codec<SketchParamValue> = {
	check: (value, path, issues): value is SketchParamValue => {
		if (typeof value === 'boolean' || typeof value === 'string') return true
		if (typeof value === 'number') return finite.check(value, path, issues)
		if (Array.isArray(value)) return vec2.check(value, path, issues)
		issues.push(issue(path, 'type', 'expected a number, boolean, string or [number, number]'))
		return false
	},
}

/** The parameter envelope from `serializeValues`, embedded as is. */
const sketchParamsCodec = object({
	format: literal(PARAMS_FORMAT),
	version: literal(PARAMS_FORMAT_VERSION),
	values: record(
		PARAM_KEY_PATTERN,
		'a param name (a letter, then letters or digits)',
		sketchValueCodec
	),
})

// Fields every layer kind shares. Each kind adds its source: an image asset or a sketch.
const layerFields = {
	id,
	visible: boolean(),
	opacity: animatable({ min: 0, max: 1 }),
	blend: oneOf(['normal', 'multiply', 'screen', 'add']),
	feather: number({ min: 0, max: 0.5 }),
	transform: transformCodec,
	effects: array(effectInstanceCodec),
}

const optionalLayerFields = {
	name: string({ min: 1, max: 200 }),
	mask: maskCodec,
}

const layerCodec = tagged('kind', {
	image: object(
		{ ...layerFields, kind: literal('image'), asset: contentHash },
		optionalLayerFields,
		{ extensions: true }
	),
	sketch: object(
		{
			...layerFields,
			kind: literal('sketch'),
			sketch: string({
				pattern: NAME_PATTERN,
				description: 'a sketch id (lowercase letters and digits, joined by -)',
			}),
			version: integer({ min: 1 }),
			seed: integer(),
			params: sketchParamsCodec,
		},
		optionalLayerFields,
		{ extensions: true }
	),
})

const clipCodec = object(
	{
		id,
		start: integer({ min: 0 }),
		frames: integer({ min: 1 }),
		fadeIn: integer({ min: 0 }),
		fadeOut: integer({ min: 0 }),
		layers: array(layerCodec),
	},
	undefined,
	{ extensions: true }
)

const trackCodec = tagged('kind', {
	visual: object({ id, kind: literal('visual'), clips: array(clipCodec) }, undefined, {
		extensions: true,
	}),
})

export const projectCodec = object(
	{
		format: literal(PROJECT_FORMAT),
		schemaVersion: literal(PROJECT_SCHEMA_VERSION),
		name: string({ min: 1, max: 200 }),
		output: object({
			width: integer({ min: 1, max: 8192 }),
			height: integer({ min: 1, max: 8192 }),
			fps: integer({ min: 1, max: 120 }),
			background: string({ pattern: COLOR_PATTERN, description: 'a #rrggbb color' }),
		}),
		timeline: object({
			mode: oneOf(['loop', 'sequence']),
			frames: integer({ min: 1, max: 1_000_000 }),
		}),
		assets: record(CONTENT_HASH_PATTERN, HASH_DESCRIPTION, assetCodec),
		modulators: record(ID_PATTERN, ID_DESCRIPTION, modulatorCodec),
		tracks: array(trackCodec),
		effects: array(effectInstanceCodec),
	},
	undefined,
	{ extensions: true }
)

export type Project = Infer<typeof projectCodec>
export type ProjectAsset = Infer<typeof assetCodec>
export type ProjectTrack = Infer<typeof trackCodec>
export type ProjectClip = Infer<typeof clipCodec>
export type ProjectLayer = Infer<typeof layerCodec>
export type ProjectImageLayer = Extract<ProjectLayer, { kind: 'image' }>
export type ProjectSketchLayer = Extract<ProjectLayer, { kind: 'sketch' }>
export type LayerTransform = Infer<typeof transformCodec>
export type LayerMask = Infer<typeof maskCodec>
export type AnimatableNumber = Infer<typeof animatableCodec>
export type ModBinding = Infer<typeof modBindingCodec>
export type Modulator = Infer<typeof modulatorCodec>
export type EffectInstance = Infer<typeof effectInstanceCodec>
