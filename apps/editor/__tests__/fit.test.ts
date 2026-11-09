import { describe, expect, it } from '@jest/globals'

import { fitRect } from '../src/fit'
import type { Size } from '../src/fit'

const size = (width: number, height: number): Size => ({ width, height })

describe('fitRect', () => {
	it.each<[string, Size, Size, Size]>([
		['square into a wide stage', size(1080, 1080), size(832, 432), size(400, 400)],
		['9:16 into a wide stage', size(1080, 1920), size(1000, 672), size(360, 640)],
		['16:9 into a tall stage', size(1920, 1080), size(352, 1000), size(320, 180)],
		['9:16 into a tall narrow stage', size(1080, 1920), size(232, 1000), size(200, 355)],
		['very wide', size(8192, 16), size(632, 632), size(600, 1)],
		['very tall', size(1, 8192), size(632, 632), size(1, 600)],
		['exact fit', size(100, 50), size(232, 132), size(200, 100)],
		['upscales a small output', size(10, 10), size(232, 132), size(100, 100)],
		['stage equal to the padding', size(1080, 1080), size(32, 32), size(0, 0)],
		['stage smaller than the padding', size(1080, 1920), size(20, 10), size(0, 0)],
		['zero-sized stage', size(1080, 1920), size(0, 0), size(0, 0)],
		['no output', size(0, 0), size(500, 500), size(0, 0)],
	])('%s', (_label, output, box, expected) => {
		expect(fitRect(output, box)).toEqual(expected)
	})

	it.each<[number, number]>([
		[1080, 1080],
		[1080, 1920],
		[1920, 1080],
		[8192, 7],
		[7, 8192],
	])('keeps %dx%d inside the stage at its aspect ratio', (width, height) => {
		for (const box of [size(300, 200), size(1440, 900), size(241, 999), size(1999, 161)]) {
			const fit = fitRect(size(width, height), box)
			expect(fit.width).toBeLessThanOrEqual(box.width - 32)
			expect(fit.height).toBeLessThanOrEqual(box.height - 32)
			expect(Number.isInteger(fit.width) && Number.isInteger(fit.height)).toBe(true)
			// One side fills the room, and the other is within rounding of the true ratio.
			expect(fit.width === box.width - 32 || fit.height === box.height - 32).toBe(true)
			// No distortion: rounding the other side down costs it less than 1 px.
			expect(Math.abs(fit.width * height - fit.height * width)).toBeLessThan(
				Math.max(width, height)
			)
		}
	})

	it('honours a custom padding', () => {
		expect(fitRect(size(100, 100), size(120, 120), 0)).toEqual(size(120, 120))
	})
})
