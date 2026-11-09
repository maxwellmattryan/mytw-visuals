/** A 2D value, such as an offset or a position. */
export type Vec2 = readonly [number, number]

/** Easing applied to the segment from one keyframe to the next. */
export type EaseName =
	| 'linear'
	| 'hold'
	| 'easeInOutQuad'
	| 'easeOutCubic'
	| 'easeInCubic'
	| 'easeInOutCubic'
	| 'easeOutExpo'
	| 'easeInOutExpo'

/** A keyframe at loop phase `t`. `ease` shapes the segment to the next key (default linear). */
export interface Keyframe<T> {
	t: number
	value: T
	ease?: EaseName
}

/** One parameter. Only `number` and `vec2` can have keyframes or be modulated. */
export type TimelineParam =
	| {
			kind: 'number'
			value: number
			min?: number
			max?: number
			keys?: readonly Keyframe<number>[]
	  }
	| {
			kind: 'vec2'
			value: Vec2
			min?: number
			max?: number
			keys?: readonly Keyframe<Vec2>[]
	  }
	| { kind: 'integer'; value: number }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'enum'; value: string }
	| { kind: 'color'; value: string }

/** Where a modulator adds its output. `component` is required for vec2 params and forbidden otherwise. */
export interface ModTarget {
	param: string
	amount: number
	component?: 0 | 1
}

/** A loop-locked LFO whose output in [-1, 1] is scaled per target. */
export interface Modulator {
	shape: 'sine' | 'triangle' | 'noise'
	/** Whole cycles per loop. Must be a positive integer so the loop is seamless. */
	cycles: number
	/** Offset as a fraction of one cycle. Default 0. */
	phase?: number
	/** Noise only: integer seed. Default 0. */
	seed?: number
	/** Noise only: radius of the closed path in noise space. Default 1. */
	radius?: number
	targets: readonly ModTarget[]
}

/**
 * The timeline input to the engine: flat param ids (such as `base.zoom`) plus shared
 * modulators, each driving any number of params with its own amount per target. It is
 * plain serializable data and is treated as immutable. This is deliberately the minimal
 * structural shape the evaluator needs, not the editor's project format (#11): that format
 * either uses this shape directly for its params and modulators, or a small adapter flattens
 * its layer params into these ids. That keeps the engine independent of how the editor
 * stores documents.
 */
export interface TimelineDocument {
	params: Readonly<Record<string, TimelineParam>>
	modulators: Readonly<Record<string, Modulator>>
}

/** The resolved value of every param for one frame. */
export type FrameState = Record<string, number | boolean | string | [number, number]>

/** A keyframe track whose value at phase 0 differs from its value at phase 1. */
export interface LoopIssue {
	param: string
	message: string
}
