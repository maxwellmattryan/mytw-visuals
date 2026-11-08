/** The seam counts as a jump when it differs more than this many times a normal step. */
export const SEAM_RATIO = 2
/** Differences up to this (0–255) always count as seamless, so a still loop never fails. */
export const SEAM_FLOOR = 1

export interface SeamFrames {
	/** Frame N-2. */
	beforeLast: Uint8ClampedArray
	/** Frame N-1. */
	last: Uint8ClampedArray
	/** Frame 0. */
	first: Uint8ClampedArray
	/** Frame 1. */
	second: Uint8ClampedArray
}

export interface SeamResult {
	/** Mean difference between the last frame and the first. */
	seam: number
	/** Mean of the differences across the two steps next to the seam. */
	step: number
	verdict: 'seamless' | 'seam'
}

/**
 * The mean absolute difference (0–255) over the R, G and B channels of two
 * RGBA pixel arrays of the same length. Alpha is ignored.
 */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	if (a.length !== b.length) {
		throw new RangeError(`Frames differ in size: ${a.length} and ${b.length} bytes`)
	}
	const pixels = Math.floor(a.length / 4)
	if (pixels === 0) return 0
	let sum = 0
	for (let i = 0; i < pixels * 4; i += 4) {
		sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
	}
	return sum / (pixels * 3)
}

/** Compares the jump at the seam with the steps on either side of it. */
export function measureSeam({ beforeLast, last, first, second }: SeamFrames): SeamResult {
	const seam = frameDifference(last, first)
	const step = (frameDifference(beforeLast, last) + frameDifference(first, second)) / 2
	const verdict = seam > Math.max(SEAM_RATIO * step, SEAM_FLOOR) ? 'seam' : 'seamless'
	return { seam, step, verdict }
}
