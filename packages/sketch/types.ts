import type p5 from 'p5'
import type { ParamDefs, ParamValues, ParseValuesResult, Schema } from '@mytw/schema'

/** A p5 constructor in instance mode. The runtime takes one so tests can pass a fake. */
export type P5Constructor = new (sketch: (p: p5) => void, node?: HTMLElement) => p5

/** The time to render: frame `frame` of a loop of `frames` frames played at `fps`. */
export interface SketchTime {
	readonly frame: number
	readonly frames: number
	readonly fps: number
}

/** Canvas size in pixels. */
export interface SketchSize {
	readonly width: number
	readonly height: number
}

/**
 * Everything one draw may depend on. A sketch animates from `t` or `frame` and never reads
 * `p.frameCount`, `p.millis()`, `Date` or `Math.random`.
 */
export interface SketchFrame<P extends ParamDefs = ParamDefs> extends SketchTime, SketchSize {
	/** Loop phase, `frame / frames`, in [0, 1). */
	readonly t: number
	/** `frame / fps`. */
	readonly seconds: number
	/** The seed passed to `randomSeed` and `noiseSeed` before this draw. */
	readonly seed: number
	/** The current param values. */
	readonly params: Readonly<ParamValues<P>>
}

/** What `defineSketch` takes. */
export interface SketchInput<P extends ParamDefs> {
	/** Kebab-case, such as `basic-orbits`. Project sketch layers refer to it. */
	readonly id: string
	/** The version of the param schema, an integer >= 1. */
	readonly version: number
	readonly name: string
	readonly params: Schema<P>
	/** Runs once after the canvas exists, such as to load images. May be async. */
	readonly setup?: (p: p5, size: SketchSize) => void | Promise<void>
	/** Draws one frame. It must depend only on `frame` and what p5 seeds. */
	readonly draw: (p: p5, frame: SketchFrame<P>) => void
}

/** A validated, frozen sketch from `defineSketch`. */
export type SketchDefinition<P extends ParamDefs = ParamDefs> = Readonly<SketchInput<P>>

export interface SketchLayerOptions {
	readonly width: number
	readonly height: number
	/** Passed to `randomSeed` and `noiseSeed` before every draw. Defaults to 0. */
	readonly seed?: number
	/** A `mytw-params` envelope or a bare values object, read through `parseValues`. */
	readonly params?: unknown
}

/** A running sketch that draws into its own canvas, one requested frame at a time. */
export interface SketchInstance<P extends ParamDefs = ParamDefs> {
	readonly definition: SketchDefinition<P>
	/** The sketch's `width × height` canvas. Pass it to the engine's `setImage`. */
	readonly canvas: HTMLCanvasElement
	readonly seed: number
	/** The current param values. */
	readonly values: Readonly<ParamValues<P>>
	/** Draws one frame synchronously and returns `canvas`. */
	render(time: SketchTime): HTMLCanvasElement
	/** Reads new values through `parseValues`. Keeps the old values when the result isn't ok. */
	setParams(input: unknown): ParseValuesResult<P>
	/** Removes the p5 instance. A second call does nothing. */
	dispose(): void
}

export interface SketchRuntime {
	createSketchLayer<P extends ParamDefs>(
		definition: SketchDefinition<P>,
		options: SketchLayerOptions
	): Promise<SketchInstance<P>>
}
