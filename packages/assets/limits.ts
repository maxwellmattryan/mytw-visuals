/** The largest image, in pixels, that `ImageAssets` will decode by default. */
export const DEFAULT_MAX_PIXELS = 100_000_000

/** A size that fits a texture limit, and its ratio to the original size. */
export interface FittedSize {
	width: number
	height: number
	scale: number
}

/**
 * Fits `width` × `height` within `maxSide` on both axes, keeping the aspect ratio. A size
 * within the limit is returned unchanged with `scale` 1. Otherwise the longest side becomes
 * `maxSide`, and each side is rounded and kept at least 1 px.
 */
export function fitToLimit(width: number, height: number, maxSide: number): FittedSize {
	const longest = Math.max(width, height)
	if (longest <= maxSide) return { width, height, scale: 1 }
	const scale = maxSide / longest
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		scale,
	}
}
