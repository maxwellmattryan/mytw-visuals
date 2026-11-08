export type NoiseFn = (x: number, y: number) => number

/**
 * Attempt fractal Brownian motion using p5's noise().
 * Call from within a p5 instance (pass p.noise as noiseFn).
 */
export function fbm(noiseFn: NoiseFn, x: number, y: number, octaves = 4): number {
	let value = 0
	let amplitude = 0.5
	let frequency = 1
	for (let i = 0; i < octaves; i++) {
		value += amplitude * noiseFn(x * frequency, y * frequency)
		amplitude *= 0.5
		frequency *= 2
	}
	return value
}

/** Integer hash of a lattice point and seed, mapped to [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
	let h = Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1)
	h = Math.imul(h ^ ix, 0x27d4eb2d)
	h = Math.imul(h ^ (h >>> 15) ^ iy, 0x165667b1)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	h ^= h >>> 16
	return (h >>> 0) / 4294967296
}

/**
 * Deterministic 2D value noise in [0, 1) with smoothstep interpolation. A port of
 * the GLSL `vnoise` in 002-understory, hashing integer lattice coordinates and an
 * integer `seed` so results do not depend on float hashing. Pair with `fbm` for octaves.
 */
export function valueNoise2(x: number, y: number, seed = 0): number {
	const fx = Math.floor(x)
	const fy = Math.floor(y)
	const ix = fx | 0
	const iy = fy | 0
	const s = seed | 0
	const tx = x - fx
	const ty = y - fy
	const ux = tx * tx * (3 - 2 * tx)
	const uy = ty * ty * (3 - 2 * ty)
	const a = hash2(ix, iy, s)
	const b = hash2(ix + 1, iy, s)
	const c = hash2(ix, iy + 1, s)
	const d = hash2(ix + 1, iy + 1, s)
	const top = a + (b - a) * ux
	const bottom = c + (d - c) * ux
	return top + (bottom - top) * uy
}
