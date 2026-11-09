/** Pixel comparison for the Understory proof. Pure: RGBA byte arrays in, numbers out. */

/** RGBA bytes, 4 per pixel, row by row, as in `ImageData.data`. */
export type Pixels = ArrayLike<number>

export interface DiffStats {
	/** Mean absolute difference over R, G and B of every pixel, 0–255. */
	meanAbs: number
	/** The largest single-channel difference, 0–255. */
	maxAbs: number
	/** The fraction of pixels whose largest channel difference exceeds the tolerance. */
	fractionOver: number
}

export interface Threshold {
	maxMeanAbs: number
	tolerance: number
	maxFractionOver: number
}

/** The decided pass threshold. Don't loosen it to make a frame pass. */
export const THRESHOLD: Readonly<Threshold> = Object.freeze({
	maxMeanAbs: 2,
	tolerance: 16,
	maxFractionOver: 0.01,
})

/** The frames Compare renders: both ends of the loop and four between. */
export const COMPARE_FRAMES: readonly number[] = Object.freeze([0, 45, 90, 135, 180, 224])

function checkSize(a: Pixels, b: Pixels, width: number, height: number): number {
	const n = width * height
	if (a.length !== n * 4 || b.length !== n * 4)
		throw new RangeError(
			`expected ${n * 4} bytes for ${width}×${height}, got ${a.length} and ${b.length}`
		)
	return n
}

/** Compares two images of the same size, ignoring alpha. */
export function diffImages(
	a: Pixels,
	b: Pixels,
	width: number,
	height: number,
	tolerance: number = THRESHOLD.tolerance
): DiffStats {
	const n = checkSize(a, b, width, height)
	let sum = 0
	let maxAbs = 0
	let over = 0
	for (let i = 0; i < n * 4; i += 4) {
		const dr = Math.abs(a[i] - b[i])
		const dg = Math.abs(a[i + 1] - b[i + 1])
		const db = Math.abs(a[i + 2] - b[i + 2])
		sum += dr + dg + db
		const d = Math.max(dr, dg, db)
		if (d > maxAbs) maxAbs = d
		if (d > tolerance) over++
	}
	return {
		meanAbs: n === 0 ? 0 : sum / (n * 3),
		maxAbs,
		fractionOver: n === 0 ? 0 : over / n,
	}
}

/**
 * A difference image: grey that brightens with the difference up to the tolerance, then a red
 * ramp above it. Opaque RGBA, ready for `new ImageData(out, width, height)`.
 */
export function heatmap(
	a: Pixels,
	b: Pixels,
	width: number,
	height: number,
	tolerance: number = THRESHOLD.tolerance
): Uint8ClampedArray<ArrayBuffer> {
	const n = checkSize(a, b, width, height)
	const out = new Uint8ClampedArray(n * 4)
	for (let i = 0; i < n * 4; i += 4) {
		const d = Math.max(
			Math.abs(a[i] - b[i]),
			Math.abs(a[i + 1] - b[i + 1]),
			Math.abs(a[i + 2] - b[i + 2])
		)
		if (d <= tolerance) {
			const grey = 24 + (tolerance > 0 ? (d / tolerance) * 72 : 0)
			out[i] = out[i + 1] = out[i + 2] = grey
		} else {
			out[i] = 128 + (127 * (d - tolerance)) / Math.max(1, 255 - tolerance)
			out[i + 1] = 0
			out[i + 2] = 0
		}
		out[i + 3] = 255
	}
	return out
}

/** Whether a frame passes: mean difference and the fraction over tolerance are both in bounds. */
export function meetsThreshold(stats: DiffStats, threshold: Threshold = THRESHOLD): boolean {
	return stats.meanAbs <= threshold.maxMeanAbs && stats.fractionOver <= threshold.maxFractionOver
}
