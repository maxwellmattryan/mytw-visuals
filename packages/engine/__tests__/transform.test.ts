import { describe, expect, it } from '@jest/globals'

import { layerToSourceMatrix } from '@mytw/engine'
import type { LayerTransform, Size, Vec2 } from '@mytw/engine'

/** Applies a column-major 3x3 affine matrix to a point. */
function apply(m: Float32Array, [x, y]: Vec2): [number, number] {
	return [m[0] * x + m[3] * y + m[6], m[1] * x + m[4] * y + m[7]]
}

const SQUARE: Size = { width: 100, height: 100 }
const WIDE: Size = { width: 200, height: 100 }

describe('layerToSourceMatrix', () => {
	const cases: [string, LayerTransform | undefined, Size, Size, Vec2, Vec2][] = [
		['identity cover, top-left', undefined, SQUARE, SQUARE, [0, 0], [0, 0]],
		['identity cover, bottom-right', undefined, SQUARE, SQUARE, [1, 1], [1, 1]],
		['zoom 2, top-left', { zoom: 2 }, SQUARE, SQUARE, [0, 0], [0.25, 0.25]],
		['zoom 2, bottom-right', { zoom: 2 }, SQUARE, SQUARE, [1, 1], [0.75, 0.75]],
		['mirrorX', { mirrorX: true }, SQUARE, SQUARE, [0, 0.5], [1, 0.5]],
		['mirrorY', { mirrorY: true }, SQUARE, SQUARE, [0.5, 0], [0.5, 1]],
		['rotation π/2', { rotation: Math.PI / 2 }, SQUARE, SQUARE, [1, 0.5], [0.5, 0]],
		['cover 2:1 on square', { fit: 'cover' }, SQUARE, WIDE, [0, 0.5], [0.25, 0.5]],
		['contain 2:1 on square, left', { fit: 'contain' }, SQUARE, WIDE, [0, 0.5], [0, 0.5]],
		['contain 2:1 on square, top', { fit: 'contain' }, SQUARE, WIDE, [0.5, 0], [0.5, -0.5]],
		['stretch 2:1 on square, top-left', { fit: 'stretch' }, SQUARE, WIDE, [0, 0], [0, 0]],
		['stretch 2:1 on square, point', { fit: 'stretch' }, SQUARE, WIDE, [0.3, 0.8], [0.3, 0.8]],
		['offset', { offset: [0.1, 0] }, SQUARE, SQUARE, [0.6, 0.5], [0.5, 0.5]],
		['center', { center: [0.2, 0.7] }, SQUARE, SQUARE, [0.5, 0.5], [0.2, 0.7]],
	]

	it.each(cases)('%s', (_name, transform, output, source, u, expected) => {
		const [x, y] = apply(layerToSourceMatrix(transform, output, source), u)
		expect(x).toBeCloseTo(expected[0], 5)
		expect(y).toBeCloseTo(expected[1], 5)
	})

	it('writes into a given array', () => {
		const out = new Float32Array(9)
		expect(layerToSourceMatrix({ zoom: 2 }, SQUARE, SQUARE, out)).toBe(out)
		expect(out[8]).toBe(1)
	})
})
