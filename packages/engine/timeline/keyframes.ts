import {
	easeInCubic,
	easeInOutCubic,
	easeInOutExpo,
	easeInOutQuad,
	easeOutCubic,
	easeOutExpo,
} from '@lib/math'

import type { EaseName } from './types'

export type EaseFn = (u: number) => number

const linear: EaseFn = (u) => u
/** `hold` keeps the segment's start value until the next key. */
const hold: EaseFn = () => 0

export const EASES: Readonly<Record<EaseName, EaseFn>> = {
	linear,
	hold,
	easeInOutQuad,
	easeOutCubic,
	easeInCubic,
	easeInOutCubic,
	easeOutExpo,
	easeInOutExpo,
}

export function isEaseName(name: unknown): name is EaseName {
	return typeof name === 'string' && Object.hasOwn(EASES, name)
}

/** One numeric channel's keyframes: strictly ascending times, values and per-segment eases. */
export interface Track {
	times: Float64Array
	values: Float64Array
	eases: readonly EaseFn[]
}

/**
 * Sample a track at phase `t`. Holds the first value before the first key and the last
 * value after the last key. Uses a linear scan: tracks are short in v1, so a binary
 * search would not pay for itself yet.
 */
export function sampleTrack(track: Track, t: number): number {
	const { times, values, eases } = track
	const last = times.length - 1
	if (t <= times[0]) return values[0]
	if (t >= times[last]) return values[last]
	let i = 0
	while (t >= times[i + 1]) i++
	const u = (t - times[i]) / (times[i + 1] - times[i])
	const v0 = values[i]
	return v0 + (values[i + 1] - v0) * eases[i](u)
}
