import { hexToVec } from '@lib/colors'
import { EASES, noiseOut, seededNoise, sineOut, triangleOut } from '@mytw/engine'
import type {
	EffectInstance as RenderEffect,
	EffectProgram,
	LayerTransform as RenderTransform,
	Mask,
	RenderFrame,
	RenderLayer,
	Rgba,
} from '@mytw/engine'
import { assembleFragment, getEffect, uniformValues } from '@mytw/fx'
import type { EffectDefinition } from '@mytw/fx'
import type {
	AnimatableNumber,
	EffectInstance,
	Modulator,
	Project,
	ProjectClip,
	ProjectLayer,
} from '@mytw/schema'

/** The radius of the circle a noise modulator samples, in noise space. */
const NOISE_RADIUS = 1

/** Thrown by `compileScene` for a project the engine can't render. `path` points into the project. */
export class SceneError extends Error {
	readonly path: string

	constructor(path: string, message: string) {
		super(`${path}: ${message}`)
		this.name = 'SceneError'
		this.path = path
	}
}

/** A compiled project: everything the renderer needs up front, and a frame for any frame index. */
export interface Scene {
	/** `project.timeline.frames`. */
	readonly frames: number
	readonly width: number
	readonly height: number
	readonly fps: number
	/** Asset hashes used by visible layers. A layer's renderer image id is its asset hash. */
	readonly images: readonly string[]
	/** One program per effect definition the project uses, to pass to `registerEffect`. */
	readonly effects: readonly EffectProgram[]
	/** The render frame at integer frame `frame` in `[0, frames)`. Throws `RangeError` otherwise. */
	frameAt(frame: number): RenderFrame
}

/** Modulator outputs at one phase, by modulator id. */
type ModValues = ReadonlyMap<string, number>
type NumberFn = (mods: ModValues) => number
type ParamFn = (mods: ModValues) => unknown

interface CompiledEffect {
	readonly id: string
	readonly enabled: boolean
	readonly definition: EffectDefinition
	readonly params: readonly (readonly [string, ParamFn])[]
}

interface CompiledLayer {
	readonly source: ProjectLayer
	readonly centerX: NumberFn
	readonly centerY: NumberFn
	readonly zoom: NumberFn
	readonly rotation: NumberFn
	readonly opacity: NumberFn
	readonly mask: Mask | undefined
	readonly effects: readonly CompiledEffect[]
}

interface CompiledClip {
	readonly source: ProjectClip
	readonly layers: readonly CompiledLayer[]
}

/**
 * Compiles a parsed project for the engine. Checks every effect against the effect bank and every
 * binding against the modulators, and precomputes each value's evaluator. Throws `SceneError`.
 */
export function compileScene(project: Project): Scene {
	const definitions = new Map<string, EffectDefinition>()
	const modulators = new Map(
		Object.entries(project.modulators).map(([id, modulator]) => [id, modulatorFn(modulator)])
	)

	const number = (value: AnimatableNumber, path: string): NumberFn => {
		if (typeof value === 'number') return () => value
		const base = value.value
		const bindings = value.mod.map((binding, index) => {
			if (!modulators.has(binding.modulator))
				throw new SceneError(
					`${path}.mod[${index}].modulator`,
					`no modulator ${JSON.stringify(binding.modulator)}`
				)
			return binding
		})
		return (mods) => {
			let v = base
			for (const { modulator, amount, mode } of bindings) {
				const m = mods.get(modulator) ?? 0
				v = mode === 'add' ? v + amount * m : v * (1 + amount * m)
			}
			return v
		}
	}

	const effectChain = (list: readonly EffectInstance[], path: string): CompiledEffect[] =>
		list.map((instance, index) => {
			const at = `${path}[${index}]`
			const definition = getEffect(instance.effect)
			if (!definition)
				throw new SceneError(`${at}.effect`, `unknown effect ${JSON.stringify(instance.effect)}`)
			if (definition.version !== instance.version)
				throw new SceneError(
					`${at}.version`,
					`effect ${JSON.stringify(instance.effect)} is version ${definition.version}, not ${instance.version}`
				)
			definitions.set(definition.id, definition)
			const params = Object.entries(instance.params).map(([key, value]): [string, ParamFn] => {
				if (typeof value === 'number' || (typeof value === 'object' && !Array.isArray(value)))
					return [key, number(value, `${at}.params.${key}`)]
				return [key, () => value]
			})
			return { id: instance.id, enabled: instance.enabled, definition, params }
		})

	const tracks: CompiledClip[][] = project.tracks.map((track, t) =>
		track.clips.map((clip, c) => {
			const clipPath = `tracks[${t}].clips[${c}]`
			return {
				source: clip,
				layers: clip.layers.map((layer, l) => {
					const at = `${clipPath}.layers[${l}]`
					const tf = layer.transform
					return {
						source: layer,
						centerX: number(tf.centerX, `${at}.transform.centerX`),
						centerY: number(tf.centerY, `${at}.transform.centerY`),
						zoom: number(tf.zoom, `${at}.transform.zoom`),
						rotation: number(tf.rotation, `${at}.transform.rotation`),
						opacity: number(layer.opacity, `${at}.opacity`),
						mask: layer.mask && {
							kind: 'linear',
							from: [layer.mask.from[0], layer.mask.from[1]],
							to: [layer.mask.to[0], layer.mask.to[1]],
						},
						effects: effectChain(layer.effects, `${at}.effects`),
					}
				}),
			}
		})
	)
	const globalEffects = effectChain(project.effects, 'effects')

	const images = new Set<string>()
	for (const clips of tracks)
		for (const clip of clips)
			for (const layer of clip.layers) if (layer.source.visible) images.add(layer.source.asset)

	const effects: EffectProgram[] = [...definitions.values()].map((definition) => ({
		id: definition.id,
		fragment: assembleFragment(definition).source,
	}))

	const [r, g, b] = hexToVec(project.output.background)
	const background: Rgba = [r, g, b, 1]
	const frames = project.timeline.frames

	const frameAt = (frame: number): RenderFrame => {
		if (!Number.isInteger(frame) || frame < 0 || frame >= frames)
			throw new RangeError(`frame must be an integer in [0, ${frames}), got ${frame}`)
		const t = frame / frames
		const mods = new Map<string, number>()
		for (const [id, fn] of modulators) mods.set(id, fn(t))

		const layers: RenderLayer[] = []
		for (const clips of tracks) {
			const active = clips.find(
				({ source }) => source.start <= frame && frame < source.start + source.frames
			)
			if (!active) continue
			const fade = clipFade(active.source, frame - active.source.start)
			for (const layer of active.layers) layers.push(renderLayer(layer, mods, t, fade))
		}
		return { background, layers, effects: renderEffects(globalEffects, mods, t) }
	}

	return Object.freeze({
		frames,
		width: project.output.width,
		height: project.output.height,
		fps: project.output.fps,
		images: Object.freeze([...images]),
		effects: Object.freeze(effects),
		frameAt,
	})
}

function renderLayer(layer: CompiledLayer, mods: ModValues, t: number, fade: number): RenderLayer {
	const { source } = layer
	const { mirrorX, mirrorY } = source.transform
	const rotation = layer.rotation(mods)
	const transform: RenderTransform = {
		center: [layer.centerX(mods), layer.centerY(mods)],
		zoom: layer.zoom(mods),
		// The format mirrors before it rotates and the engine rotates before it mirrors. A
		// single-axis mirror M gives M·R(θ) = R(−θ)·M, so the angle flips sign.
		rotation: mirrorX !== mirrorY ? -rotation : rotation,
		mirrorX,
		mirrorY,
		fit: 'cover',
	}
	const out: RenderLayer = {
		id: source.id,
		image: source.asset,
		visible: source.visible,
		opacity: clamp01(layer.opacity(mods)) * fade,
		blend: source.blend,
		edgeFeather: source.feather,
		transform,
		effects: renderEffects(layer.effects, mods, t),
	}
	if (layer.mask) out.mask = layer.mask
	return out
}

function renderEffects(
	effects: readonly CompiledEffect[],
	mods: ModValues,
	t: number
): RenderEffect[] {
	return effects.map(({ definition, enabled, params }) => {
		const values: Record<string, unknown> = {}
		for (const [key, fn] of params) values[key] = fn(mods)
		return {
			effect: definition.id,
			enabled,
			uniforms: { ...uniformValues(definition, values), uPhase: t },
		}
	})
}

/** § Clips: ramps over `fadeIn` and `fadeOut`, leaving out a zero-length fade. */
function clipFade(clip: ProjectClip, local: number): number {
	let fade = 1
	if (clip.fadeIn > 0) fade = Math.min(fade, local / clip.fadeIn)
	if (clip.fadeOut > 0) fade = Math.min(fade, (clip.frames - local) / clip.fadeOut)
	return fade
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v
}

/** A modulator's output as a function of loop phase `t`, per § Periodic modulators and § Keyframes. */
function modulatorFn(modulator: Modulator): (t: number) => number {
	switch (modulator.shape) {
		case 'sine': {
			const { cycles, phase } = modulator
			return (t) => sineOut(cycles * t + phase)
		}
		case 'triangle': {
			const { cycles, phase } = modulator
			return (t) => triangleOut(cycles * t + phase)
		}
		case 'noise': {
			const { cycles, phase } = modulator
			const noise = seededNoise(modulator.seed)
			return (t) => noiseOut(noise, NOISE_RADIUS, cycles * t + phase)
		}
		case 'keyframes': {
			const keys = modulator.keys.map((key) => ({ ...key, ease: EASES[key.easing] }))
			const last = keys.length - 1
			return (t) => {
				if (t <= keys[0].at) return keys[0].value
				if (t >= keys[last].at) return keys[last].value
				let i = 0
				while (t >= keys[i + 1].at) i++
				const a = keys[i]
				const b = keys[i + 1]
				return a.value + (b.value - a.value) * a.ease((t - a.at) / (b.at - a.at))
			}
		}
	}
}
