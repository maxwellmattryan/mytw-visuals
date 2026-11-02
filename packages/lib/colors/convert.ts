/**
 * Color conversions between hex strings and [r, g, b] vectors.
 */

import type { Vec3 } from './palette'

/** Hex string -> [r, g, b] in 0–1 range. */
export function hexToVec(hex: string): Vec3 {
	const rgb = hexToRgb(hex)
	return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]
}

/** Hex string -> [r, g, b] in 0–255 range. */
export function hexToRgb(hex: string): Vec3 {
	const h = hex.replace('#', '')
	return [
		parseInt(h.substring(0, 2), 16),
		parseInt(h.substring(2, 4), 16),
		parseInt(h.substring(4, 6), 16),
	]
}

/** [r, g, b] in 0–255 range -> hex string. */
export function rgbToHex(r: number, g: number, b: number): string {
	return (
		'#' +
		[r, g, b]
			.map((c) => {
				const hex = Math.round(c).toString(16)
				return hex.length === 1 ? '0' + hex : hex
			})
			.join('')
	)
}

/** [r, g, b] in 0–1 -> p5-compatible color array in 0–255. */
export function vecToRgb(vec: Vec3): Vec3 {
	return [vec[0] * 255, vec[1] * 255, vec[2] * 255]
}
