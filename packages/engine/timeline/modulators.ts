import { clamp, fbm, valueNoise2 } from '@lib/math'
import type { NoiseFn } from '@lib/math'

const TAU = Math.PI * 2
/** The largest sum 4 octaves of fbm can reach with noise in [0, 1). */
const FBM_MAX = 0.9375

/** Sine LFO in [-1, 1]: 0 at x = 0, 1 at x = 0.25. */
export function sineOut(x: number): number {
	return Math.sin(TAU * x)
}

/** Triangle LFO in [-1, 1], in step with sine: 0 at x = 0, 1 at x = 0.25, -1 at x = 0.75. */
export function triangleOut(x: number): number {
	const y = x + 0.25
	return 1 - 4 * Math.abs(y - Math.floor(y) - 0.5)
}

/**
 * Noise LFO in [-1, 1]: fbm sampled on a closed circle of `radius` in 2D noise space, so
 * x and x + 1 land on the same point and the loop is seamless.
 */
export function noiseOut(noise: NoiseFn, radius: number, x: number): number {
	const a = TAU * x
	const v = fbm(noise, radius * Math.cos(a), radius * Math.sin(a), 4)
	return clamp((2 * v) / FBM_MAX - 1, -1, 1)
}

/** Bind `valueNoise2` to a seed, once per modulator at compile time. */
export function seededNoise(seed: number): NoiseFn {
	return (x, y) => valueNoise2(x, y, seed)
}
