import { describe, expect, it } from '@jest/globals'

import { ASPECT_GUIDES, aspectRect, safeAreas } from '../guides'
import type { AspectGuide, Rect } from '../guides'
import type { Size } from '../geometry'

const PORTRAIT = { width: 1080, height: 1920 }
const LANDSCAPE = { width: 1920, height: 1080 }

describe('safeAreas', () => {
	it('returns the 90% and 80% centred rectangles', () => {
		const { action, title } = safeAreas(PORTRAIT)
		expect(action.x).toBeCloseTo(54, 9)
		expect(action.y).toBeCloseTo(96, 9)
		expect(action.width).toBeCloseTo(972, 9)
		expect(action.height).toBeCloseTo(1728, 9)
		expect(title.x).toBeCloseTo(108, 9)
		expect(title.y).toBeCloseTo(192, 9)
		expect(title.width).toBeCloseTo(864, 9)
		expect(title.height).toBeCloseTo(1536, 9)
	})
})

describe('aspectRect', () => {
	it.each<[Size, AspectGuide, Rect]>([
		[PORTRAIT, '1:1', { x: 0, y: 420, width: 1080, height: 1080 }],
		[PORTRAIT, '4:5', { x: 0, y: 285, width: 1080, height: 1350 }],
		[PORTRAIT, '9:16', { x: 0, y: 0, width: 1080, height: 1920 }],
		[PORTRAIT, '16:9', { x: 0, y: 656.25, width: 1080, height: 607.5 }],
		[LANDSCAPE, '1:1', { x: 420, y: 0, width: 1080, height: 1080 }],
		[LANDSCAPE, '4:5', { x: 528, y: 0, width: 864, height: 1080 }],
		[LANDSCAPE, '9:16', { x: 656.25, y: 0, width: 607.5, height: 1080 }],
		[LANDSCAPE, '16:9', { x: 0, y: 0, width: 1920, height: 1080 }],
	])('fits %o at %s', (output, ratio, expected) => {
		const rect = aspectRect(output, ratio)
		expect(rect.x).toBeCloseTo(expected.x, 9)
		expect(rect.y).toBeCloseTo(expected.y, 9)
		expect(rect.width).toBeCloseTo(expected.width, 9)
		expect(rect.height).toBeCloseTo(expected.height, 9)
	})

	it('lists the fixed ratios in toolbar order', () => {
		expect(ASPECT_GUIDES).toEqual(['1:1', '4:5', '9:16', '16:9'])
	})
})
