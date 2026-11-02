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
