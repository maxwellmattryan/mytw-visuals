/**
 * IQ cosine palettes and presets.
 */

export type Vec3 = [number, number, number]

export interface CosinePalette {
	a: Vec3
	b: Vec3
	c: Vec3
	d: Vec3
}

export type PaletteName = 'cool' | 'warm' | 'neon' | 'mono'

/**
 * IQ cosine palette: attempt a + b * cos(2π(c * t + d))
 * Each param is [r, g, b] in 0–1.
 */
export function palette(t: number, a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 {
	return [
		a[0] + b[0] * Math.cos(Math.PI * 2 * (c[0] * t + d[0])),
		a[1] + b[1] * Math.cos(Math.PI * 2 * (c[1] * t + d[1])),
		a[2] + b[2] * Math.cos(Math.PI * 2 * (c[2] * t + d[2])),
	]
}

export const PALETTES: Record<PaletteName, CosinePalette> = {
	cool: {
		a: [0.5, 0.5, 0.5],
		b: [0.5, 0.5, 0.5],
		c: [1.0, 1.0, 1.0],
		d: [0.0, 0.33, 0.67],
	},
	warm: {
		a: [0.5, 0.5, 0.5],
		b: [0.5, 0.5, 0.5],
		c: [1.0, 1.0, 0.5],
		d: [0.8, 0.9, 0.3],
	},
	neon: {
		a: [0.5, 0.5, 0.5],
		b: [0.5, 0.5, 0.5],
		c: [2.0, 1.0, 0.0],
		d: [0.5, 0.2, 0.25],
	},
	mono: {
		a: [0.0, 0.0, 0.0],
		b: [1.0, 1.0, 1.0],
		c: [1.0, 1.0, 1.0],
		d: [0.0, 0.0, 0.0],
	},
}

/** Shorthand: sample a named preset palette. */
export function samplePalette(name: PaletteName, t: number): Vec3 {
	const p = PALETTES[name]
	return palette(t, p.a, p.b, p.c, p.d)
}

/** Linearly interpolate between an array of [r,g,b] colors (0–1). */
export function lerpPalette(colors: Vec3[], t: number): Vec3 {
	const n = colors.length - 1
	const i = Math.min(Math.floor(t * n), n - 1)
	const f = t * n - i
	return [
		colors[i][0] + (colors[i + 1][0] - colors[i][0]) * f,
		colors[i][1] + (colors[i + 1][1] - colors[i][1]) * f,
		colors[i][2] + (colors[i + 1][2] - colors[i][2]) * f,
	]
}
