import type { EffectDefinition } from '../types'
import { causticWarp } from './causticWarp'
import { chromaticAberration } from './chromaticAberration'
import { feedback } from './feedback'
import { hueShift } from './hueShift'
import { passthrough } from './passthrough'
import { scanlines } from './scanlines'
import { sineDisplacement } from './sineDisplacement'
import { vignette } from './vignette'

export {
	causticWarp,
	chromaticAberration,
	feedback,
	hueShift,
	passthrough,
	scanlines,
	sineDisplacement,
	vignette,
}

/** The built-in effects. */
export const EFFECTS: readonly EffectDefinition[] = Object.freeze([
	passthrough,
	chromaticAberration,
	vignette,
	hueShift,
	causticWarp,
	sineDisplacement,
	feedback,
	scanlines,
])

const byId = new Map(EFFECTS.map((effect) => [effect.id, effect]))

/** A built-in effect by id, or `undefined`. */
export function getEffect(id: string): EffectDefinition | undefined {
	return byId.get(id)
}
