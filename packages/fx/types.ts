import type { ParamDefs, ParamValues, Schema } from '@mytw/schema'
import type { ChunkId } from './chunks'

/** What an author passes to `defineEffect`. */
export interface EffectInput<P extends ParamDefs = ParamDefs> {
	/** Kebab-case id, unique among effects. */
	readonly id: string
	/** Integer >= 1. Bump it when params change meaning, so saved instances can be migrated. */
	readonly version: number
	readonly name: string
	/** GLSL ES 3.00 that defines `vec4 effect(vec2 uv)`. */
	readonly glsl: string
	readonly params: Schema<P>
	/** Extra `sampler2D` inputs, such as `previous` (`uPrevious`). */
	readonly textures?: readonly string[]
	/** Shared helpers to include before the effect's GLSL. */
	readonly chunks?: readonly ChunkId[]
}

/** A validated, frozen effect. */
export interface EffectDefinition {
	readonly id: string
	readonly version: number
	readonly name: string
	readonly glsl: string
	readonly params: Schema<ParamDefs>
	readonly textures: readonly string[]
	readonly chunks: readonly ChunkId[]
}

/** A compile or definition problem. `line` is relative to the effect's own `glsl`, when known. */
export interface EffectError {
	readonly line: number | null
	readonly message: string
}

/** One effect in a stack. Plain, JSON-serializable data. */
export interface EffectInstance {
	/** Instance id, unique within its stack. */
	readonly id: string
	/** The `EffectDefinition` id. */
	readonly effect: string
	readonly version: number
	readonly enabled: boolean
	readonly params: ParamValues<ParamDefs>
}

export type EffectStack = readonly EffectInstance[]

/** A value ready for `gl.uniform*`: a float or int, a bool, or a vector. */
export type UniformValue = number | boolean | number[]

export type CompileResult =
	| { ok: true; program: WebGLProgram }
	| { ok: false; errors: EffectError[] }

export type CustomEffectResult =
	| { ok: true; effect: EffectDefinition }
	| { ok: false; errors: EffectError[] }
