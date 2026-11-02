/**
 * Interpolation and range utilities for animation and generative art.
 */

export function mapRange(
	value: number,
	inMin: number,
	inMax: number,
	outMin: number,
	outMax: number
): number {
	return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin
}

export function loopValue(frame: number, period: number): number {
	return (frame % period) / period
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
	return t * t * (3 - 2 * t)
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max)
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

/** Sine normalized to 0–1 range. */
export function sinN(t: number): number {
	return (Math.sin(t) + 1) / 2
}

/** Cosine normalized to 0–1 range. */
export function cosN(t: number): number {
	return (Math.cos(t) + 1) / 2
}
