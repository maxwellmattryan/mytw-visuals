import { describe, expect, it } from '@jest/globals'

import { layerToSourceMatrix } from '@mytw/engine'

import {
	angleDelta,
	angleFromUp,
	canvasToSource,
	layerQuad,
	panTransform,
	rotateByScreenAngle,
	screenAngle,
	sourceToCanvas,
	zoomTransformAbout,
} from '../geometry'
import type { BaseTransform, Vec2 } from '../geometry'

const OUTPUT = { width: 1080, height: 1920 }
const SOURCE = { width: 1688, height: 3000 }
const WIDE = { width: 4000, height: 1500 }

const NEUTRAL: BaseTransform = {
	centerX: 0.5,
	centerY: 0.5,
	zoom: 1,
	rotation: 0,
	mirrorX: false,
	mirrorY: false,
}

const CASES: Record<string, BaseTransform> = {
	neutral: NEUTRAL,
	rotated: { ...NEUTRAL, centerX: 0.4, centerY: 0.6, rotation: 0.7 },
	zoomed: { ...NEUTRAL, centerX: 0.3, centerY: 0.28, zoom: 2.5 },
	mirrorX: { ...NEUTRAL, centerX: 0.2, centerY: 0.75, zoom: 3.4, rotation: -0.4, mirrorX: true },
	mirrorY: { ...NEUTRAL, centerX: 0.6, zoom: 1.3, rotation: 1.1, mirrorY: true },
	bothMirrors: { ...NEUTRAL, centerY: 0.4, zoom: 0.8, rotation: 2.2, mirrorX: true, mirrorY: true },
}

const POINTS: Vec2[] = [
	[0, 0],
	[123, -456],
	[-540, 960],
	[300.5, 77.25],
]

/** The engine's source UV for canvas point `p`, mapped the way the scene maps a format layer. */
function engineUv(t: BaseTransform, output: typeof OUTPUT, source: typeof SOURCE, p: Vec2): Vec2 {
	const m = layerToSourceMatrix(
		{
			center: [t.centerX, t.centerY],
			zoom: t.zoom,
			rotation: t.mirrorX !== t.mirrorY ? -t.rotation : t.rotation,
			mirrorX: t.mirrorX,
			mirrorY: t.mirrorY,
			fit: 'cover',
		},
		output,
		source,
		new Float64Array(9)
	)
	const u = p[0] / output.width + 0.5
	const v = p[1] / output.height + 0.5
	return [m[0] * u + m[3] * v + m[6], m[1] * u + m[4] * v + m[7]]
}

function expectVec(actual: Vec2, expected: Vec2, digits = 9) {
	expect(actual[0]).toBeCloseTo(expected[0], digits)
	expect(actual[1]).toBeCloseTo(expected[1], digits)
}

describe('canvasToSource', () => {
	for (const [name, t] of Object.entries(CASES)) {
		for (const source of [SOURCE, WIDE]) {
			it(`matches layerToSourceMatrix for ${name} on a ${source.width}x${source.height} source`, () => {
				for (const p of POINTS) {
					const ours = canvasToSource(t, OUTPUT, source, p)
					const engine = engineUv(t, OUTPUT, source, p)
					expect(Math.abs(ours[0] - engine[0])).toBeLessThan(1e-9)
					expect(Math.abs(ours[1] - engine[1])).toBeLessThan(1e-9)
				}
			})
		}
	}

	it('is the inverse of sourceToCanvas', () => {
		for (const t of Object.values(CASES)) {
			for (const p of POINTS) {
				expectVec(sourceToCanvas(t, OUTPUT, SOURCE, canvasToSource(t, OUTPUT, SOURCE, p)), p, 6)
			}
		}
	})
})

describe('layerQuad', () => {
	it('returns the canvas corners for the neutral transform on a source matching the output', () => {
		const quad = layerQuad(NEUTRAL, OUTPUT, OUTPUT)
		const expected: Vec2[] = [
			[-540, -960],
			[540, -960],
			[540, 960],
			[-540, 960],
		]
		quad.forEach((corner, i) => expectVec(corner, expected[i]))
	})

	it('maps each corner back to its source UV corner', () => {
		const uvs: Vec2[] = [
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
		]
		for (const t of Object.values(CASES)) {
			layerQuad(t, OUTPUT, SOURCE).forEach((corner, i) =>
				expectVec(canvasToSource(t, OUTPUT, SOURCE, corner), uvs[i])
			)
		}
	})
})

describe('panTransform', () => {
	it('keeps the source point under the pointer', () => {
		const delta: Vec2 = [37, -112]
		for (const t of Object.values(CASES)) {
			const moved = panTransform(t, OUTPUT, SOURCE, delta)
			expect(moved.zoom).toBe(t.zoom)
			expect(moved.rotation).toBe(t.rotation)
			for (const p of POINTS) {
				const after = canvasToSource(moved, OUTPUT, SOURCE, [p[0] + delta[0], p[1] + delta[1]])
				expectVec(after, canvasToSource(t, OUTPUT, SOURCE, p))
			}
		}
	})
})

describe('zoomTransformAbout', () => {
	it('keeps the anchor’s source point fixed', () => {
		const anchor: Vec2 = [-200, 350]
		for (const t of Object.values(CASES)) {
			const zoomed = zoomTransformAbout(t, OUTPUT, SOURCE, 1.7, anchor)
			expect(zoomed.zoom).toBeCloseTo(t.zoom * 1.7, 12)
			expectVec(
				canvasToSource(zoomed, OUTPUT, SOURCE, anchor),
				canvasToSource(t, OUTPUT, SOURCE, anchor)
			)
		}
	})

	it('leaves the centre alone when anchored at the canvas centre', () => {
		const t = CASES.mirrorX
		const zoomed = zoomTransformAbout(t, OUTPUT, SOURCE, 0.5, [0, 0])
		expect(zoomed.centerX).toBeCloseTo(t.centerX, 12)
		expect(zoomed.centerY).toBeCloseTo(t.centerY, 12)
	})

	it('clamps zoom to [0.01, 100]', () => {
		expect(zoomTransformAbout(NEUTRAL, OUTPUT, SOURCE, 1e6, [10, 10]).zoom).toBe(100)
		expect(zoomTransformAbout(NEUTRAL, OUTPUT, SOURCE, 1e-6, [10, 10]).zoom).toBe(0.01)
	})
})

describe('rotation handle', () => {
	it('gives φ = θ with no or both mirrors and φ = −θ with one', () => {
		expect(screenAngle(CASES.rotated)).toBe(0.7)
		expect(screenAngle(CASES.bothMirrors)).toBe(2.2)
		expect(screenAngle(CASES.mirrorX)).toBe(0.4)
		expect(screenAngle(CASES.mirrorY)).toBe(-1.1)
	})

	it('changes the on-screen angle by exactly the delta', () => {
		for (const t of Object.values(CASES)) {
			const turned = rotateByScreenAngle(t, 0.25)
			expect(screenAngle(turned)).toBeCloseTo(screenAngle(t) + 0.25, 12)
			expect(turned.centerX).toBe(t.centerX)
			expect(turned.zoom).toBe(t.zoom)
		}
	})

	it('turns a canvas point clockwise on screen by the delta', () => {
		// A source point right of the centre should move to below-right after a clockwise turn.
		for (const t of Object.values(CASES)) {
			const turned = rotateByScreenAngle(t, Math.PI / 2)
			const u = canvasToSource(t, OUTPUT, SOURCE, [100, 0])
			expectVec(sourceToCanvas(turned, OUTPUT, SOURCE, u), [0, 100], 6)
		}
	})

	it('measures angles clockwise from up and unwraps deltas across ±π', () => {
		expect(angleFromUp([0, -1])).toBeCloseTo(0, 12)
		expect(angleFromUp([1, 0])).toBeCloseTo(Math.PI / 2, 12)
		expect(angleFromUp([0, 1])).toBeCloseTo(Math.PI, 12)
		expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(0.2, 12)
		expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 12)
	})
})
