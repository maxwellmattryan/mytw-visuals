import type { EffectInstance, RenderFrame, RenderLayer, Rgba } from './types'

/** A symbolic output-size buffer slot, or the canvas. */
export type PassTarget = { kind: 'buffer'; slot: number } | { kind: 'canvas' }

export type Pass =
	/** Clears a slot to an opaque colour. */
	| { kind: 'clear'; target: PassTarget; color: Rgba }
	/**
	 * Draws a layer's transformed, feathered image. `direct` passes also apply the
	 * mask, opacity and blend onto the accumulation buffer. Otherwise the target
	 * is cleared transparent and drawn with blending off.
	 */
	| { kind: 'layer'; layer: number; target: PassTarget; direct: boolean }
	/** Runs `effects[effect]` of a layer, or of the frame when `layer` is `null`. */
	| { kind: 'effect'; layer: number | null; effect: number; input: number; target: PassTarget }
	/** Draws a layer's processed temp onto the accumulation buffer with mask, opacity and blend. */
	| { kind: 'composite'; layer: number; input: number; target: PassTarget }
	/** Draws the final accumulation slot to the canvas, flipping Y. */
	| { kind: 'present'; input: number; target: PassTarget }

export interface FramePlan {
	passes: Pass[]
	/** The number of buffer slots the passes use, `0..buffers-1`. */
	buffers: number
}

const DEFAULT_BACKGROUND: Rgba = [0, 0, 0, 1]
const CANVAS: PassTarget = { kind: 'canvas' }

export function isDrawable(layer: RenderLayer): boolean {
	return layer.visible !== false && (layer.opacity ?? 1) > 0
}

export function isEnabled(effect: EffectInstance): boolean {
	return effect.enabled !== false
}

function buffer(slot: number): PassTarget {
	return { kind: 'buffer', slot }
}

/**
 * Plans the passes for a frame. Pure: no GL. Slot 0 accumulates. Slots 1 and 2
 * are a layer's ping-pong temps, and global effects ping-pong between 0 and 1,
 * so a frame never needs more than 3 slots.
 */
export function planFrame(frame: RenderFrame): FramePlan {
	const bg = frame.background ?? DEFAULT_BACKGROUND
	const passes: Pass[] = [{ kind: 'clear', target: buffer(0), color: [bg[0], bg[1], bg[2], 1] }]
	let buffers = 1

	frame.layers.forEach((layer, index) => {
		if (!isDrawable(layer)) return
		const effects = layer.effects ?? []
		if (!effects.some(isEnabled)) {
			passes.push({ kind: 'layer', layer: index, target: buffer(0), direct: true })
			return
		}
		let current = 1
		passes.push({ kind: 'layer', layer: index, target: buffer(current), direct: false })
		effects.forEach((effect, e) => {
			if (!isEnabled(effect)) return
			const next = current === 1 ? 2 : 1
			passes.push({ kind: 'effect', layer: index, effect: e, input: current, target: buffer(next) })
			current = next
			buffers = Math.max(buffers, 3)
		})
		buffers = Math.max(buffers, 2)
		passes.push({ kind: 'composite', layer: index, input: current, target: buffer(0) })
	})

	let current = 0
	;(frame.effects ?? []).forEach((effect, e) => {
		if (!isEnabled(effect)) return
		const next = current === 0 ? 1 : 0
		passes.push({ kind: 'effect', layer: null, effect: e, input: current, target: buffer(next) })
		current = next
		buffers = Math.max(buffers, 2)
	})

	passes.push({ kind: 'present', input: current, target: CANVAS })
	return { passes, buffers }
}
