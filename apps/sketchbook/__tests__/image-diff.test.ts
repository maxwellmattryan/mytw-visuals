import { describe, expect, it } from '@jest/globals'

import {
	diffImages,
	heatmap,
	meetsThreshold,
	THRESHOLD,
} from '../sketches/006-understory-compare/diff'
import type { DiffStats } from '../sketches/006-understory-compare/diff'

/** A width × 1 image from per-pixel [r, g, b, a] values. */
function image(pixels: number[][]): Uint8ClampedArray {
	return new Uint8ClampedArray(pixels.flat())
}

describe('image diff', () => {
	it('diffImages metrics', () => {
		const a = image([
			[10, 20, 30, 255],
			[100, 100, 100, 255],
			[0, 0, 0, 255],
			[255, 255, 255, 0],
		])
		const b = image([
			[10, 20, 30, 0], // alpha differs only: ignored
			[110, 90, 100, 255], // 10 + 10 + 0, max 10
			[0, 0, 17, 255], // max 17 > 16
			[255, 255, 239, 255], // max 16, not over
		])
		const stats = diffImages(a, b, 4, 1)
		expect(stats.meanAbs).toBeCloseTo((20 + 17 + 16) / 12, 12)
		expect(stats.maxAbs).toBe(17)
		expect(stats.fractionOver).toBe(0.25)
		expect(diffImages(a, b, 2, 2, 5).fractionOver).toBe(0.75)
		expect(diffImages(a, a, 4, 1)).toEqual({ meanAbs: 0, maxAbs: 0, fractionOver: 0 })
		expect(() => diffImages(a, b, 3, 1)).toThrow(RangeError)

		const map = heatmap(a, b, 4, 1)
		expect(map).toHaveLength(16)
		expect([map[0], map[1], map[2], map[3]]).toEqual([24, 24, 24, 255])
		expect(map[8]).toBeGreaterThan(127) // over tolerance: red
		expect([map[9], map[10]]).toEqual([0, 0])
		expect(map[12]).toBe(map[13]) // at tolerance: still grey
	})

	const boundaries: [string, DiffStats, boolean][] = [
		['both at the limit', { meanAbs: 2, maxAbs: 255, fractionOver: 0.01 }, true],
		['identical', { meanAbs: 0, maxAbs: 0, fractionOver: 0 }, true],
		['mean just over', { meanAbs: 2.0001, maxAbs: 10, fractionOver: 0 }, false],
		['fraction just over', { meanAbs: 0.5, maxAbs: 200, fractionOver: 0.0101 }, false],
		['both over', { meanAbs: 3, maxAbs: 200, fractionOver: 0.5 }, false],
	]

	it.each(boundaries)('meetsThreshold boundaries: %s', (_, stats, pass) => {
		expect(meetsThreshold(stats)).toBe(pass)
	})

	it('uses the decided threshold', () => {
		expect(THRESHOLD).toEqual({ maxMeanAbs: 2, tolerance: 16, maxFractionOver: 0.01 })
	})
})
