/**
 * Easing & math utilities for animation and generative art.
 */

export function easeInOutQuad(t) {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export function easeOutCubic(t) {
	return 1 - Math.pow(1 - t, 3)
}

export function easeInCubic(t) {
	return t * t * t
}

export function easeInOutCubic(t) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutExpo(t) {
	return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

export function easeInOutExpo(t) {
	if (t === 0 || t === 1) return t
	return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2
}

export function mapRange(value, inMin, inMax, outMin, outMax) {
	return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin
}

export function loopValue(frame, period) {
	return (frame % period) / period
}

export function smoothstep(edge0, edge1, x) {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
	return t * t * (3 - 2 * t)
}

export function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max)
}

export function lerp(a, b, t) {
	return a + (b - a) * t
}

/** Sine normalized to 0–1 range. */
export function sinN(t) {
	return (Math.sin(t) + 1) / 2
}

/** Cosine normalized to 0–1 range. */
export function cosN(t) {
	return (Math.cos(t) + 1) / 2
}

/**
 * Attempt fractal Brownian motion using p5's noise().
 * Call from within a p5 instance (pass p.noise as noiseFn).
 */
export function fbm(noiseFn, x, y, octaves = 4) {
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
