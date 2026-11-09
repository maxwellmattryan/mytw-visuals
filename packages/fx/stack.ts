import { defaults } from '@mytw/schema'
import type { EffectDefinition, EffectInstance, EffectStack } from './types'

// Pure helpers for an effect stack. Each returns a new array and never mutates its input.

/** A new, enabled instance of an effect with every param at its default. */
export function createInstance(effect: EffectDefinition, id: string): EffectInstance {
	return {
		id,
		effect: effect.id,
		version: effect.version,
		enabled: true,
		params: defaults(effect.params),
	}
}

/**
 * Moves an instance to `toIndex`, clamped to the stack bounds. Returns the same stack for an
 * unknown id.
 */
export function moveEffect(stack: EffectStack, id: string, toIndex: number): EffectStack {
	const from = stack.findIndex((instance) => instance.id === id)
	if (from === -1) return stack
	const to = Number.isNaN(toIndex)
		? from
		: Math.min(Math.max(Math.trunc(toIndex), 0), stack.length - 1)
	const next = [...stack]
	const [moved] = next.splice(from, 1)
	next.splice(to, 0, moved)
	return next
}

/** Enables or bypasses an instance. Returns the same stack for an unknown id. */
export function setEnabled(stack: EffectStack, id: string, enabled: boolean): EffectStack {
	if (!stack.some((instance) => instance.id === id)) return stack
	return stack.map((instance) => (instance.id === id ? { ...instance, enabled } : instance))
}

/** The enabled instances, in order. An empty result renders as passthrough. */
export function activeEffects(stack: EffectStack): EffectInstance[] {
	return stack.filter((instance) => instance.enabled)
}
