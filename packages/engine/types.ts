/**
 * Frame data and the renderer API. A frame is plain data: the renderer reads no
 * clock and keeps no animation state, so the caller resolves every value first.
 * See README.md for the coordinate system and the blend maths.
 */

export type Vec2 = readonly [number, number]
export type Rgba = readonly [number, number, number, number]
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add'
export type Fit = 'cover' | 'contain' | 'stretch'

export interface LayerTransform {
	/** Source UV shown at the layer's anchor. Default `[0.5, 0.5]`. */
	center?: Vec2
	/** Anchor position relative to the output centre, in output UV units. Default `[0, 0]`. */
	offset?: Vec2
	/** Greater than 0. Default 1. */
	zoom?: number
	/** Radians, positive is clockwise on screen. Default 0. */
	rotation?: number
	mirrorX?: boolean
	mirrorY?: boolean
	/** Default `'cover'`. */
	fit?: Fit
}

export type Mask =
	/** 1 at `from`, 0 at `to`, in output UV. */
	| { kind: 'linear'; from: Vec2; to: Vec2; invert?: boolean }
	/** Radii in output-height units. */
	| { kind: 'radial'; center: Vec2; inner: number; outer: number; invert?: boolean }
	/** An image stretched over the output. Channel defaults to `'luminance'`. */
	| { kind: 'image'; image: string; channel?: 'alpha' | 'luminance'; invert?: boolean }

export type UniformValue = number | boolean | readonly number[]

export interface EffectInstance {
	/** The id given to `registerEffect`. */
	effect: string
	/** `false` bypasses the instance. Default `true`. */
	enabled?: boolean
	/** Values by uniform name. Names the program doesn't declare are ignored. */
	uniforms?: Readonly<Record<string, UniformValue>>
	/** Image ids by sampler uniform name. */
	textures?: Readonly<Record<string, string>>
}

export interface RenderLayer {
	id: string
	/** An image id from `setImage`. */
	image: string
	transform?: LayerTransform
	/** Source UV units. Default 0 (hard edge). */
	edgeFeather?: number
	/** 0-1. Default 1. */
	opacity?: number
	/** Default `'normal'`. */
	blend?: BlendMode
	mask?: Mask
	/** Passes run on the layer before its mask, opacity and blend. */
	effects?: readonly EffectInstance[]
	/** Default `true`. */
	visible?: boolean
}

export interface RenderFrame {
	/** RGBA 0-1. Default `[0, 0, 0, 1]`. Alpha is forced to 1. */
	background?: Rgba
	/** Bottom (index 0) to top. */
	layers: readonly RenderLayer[]
	/** Global passes run after compositing. */
	effects?: readonly EffectInstance[]
}

/** A GLSL ES 3.00 fragment shader. See README.md for the effect contract. */
export interface EffectProgram {
	id: string
	fragment: string
}

export interface RendererOptions {
	width: number
	height: number
	/** Default `false`. */
	preserveDrawingBuffer?: boolean
}

export interface Renderer {
	/** Output width in pixels. */
	readonly width: number
	/** Output height in pixels. */
	readonly height: number
	/** `true` between `webglcontextlost` and `webglcontextrestored`. */
	readonly contextLost: boolean
	/** Changes the output resolution: canvas attributes, viewport and pooled buffers. */
	setSize(width: number, height: number): void
	/** Uploads or replaces an image. The renderer keeps `source` to re-upload after context loss. */
	setImage(id: string, source: TexImageSource): void
	deleteImage(id: string): void
	/** Compiles an effect. Throws `EngineError('shader-compile')` and keeps earlier registrations. */
	registerEffect(effect: EffectProgram): void
	/** Draws a frame. Returns `false`, drawing nothing, while the context is lost. */
	render(frame: RenderFrame): boolean
	/** Calls `cb` after a context restore. Returns an unsubscribe function. */
	onRestored(cb: () => void): () => void
	/** Frees every GPU resource and listener. A second call is a no-op. */
	dispose(): void
}
