/**
 * Easing utilities for animation and generative art.
 */

export function easeInOutQuad(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3)
}

export function easeInCubic(t: number): number {
	return t * t * t
}

export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutExpo(t: number): number {
	return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

export function easeInOutExpo(t: number): number {
	if (t === 0 || t === 1) return t
	return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2
}
