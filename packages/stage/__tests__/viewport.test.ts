import { describe, expect, it } from '@jest/globals'

import { actualSize, canvasToStage, fitView, panView, stageToCanvas, zoomViewAt } from '../viewport'
import type { View } from '../viewport'

const OUTPUT = { width: 1080, height: 1920 }

describe('fitView', () => {
	it.each([
		['portrait', { width: 600, height: 1000 }],
		['landscape', { width: 1600, height: 900 }],
		['square', { width: 800, height: 800 }],
	])('centres the output with 16 px padding on a %s stage', (_name, stage) => {
		const view = fitView(stage, OUTPUT)
		expect(view.fitted).toBe(true)
		expect(view.scale).toBeCloseTo(
			Math.min((stage.width - 32) / OUTPUT.width, (stage.height - 32) / OUTPUT.height),
			12
		)
		const w = OUTPUT.width * view.scale
		const h = OUTPUT.height * view.scale
		// Centred, and at least 16 px from every edge, touching it on the limiting axis.
		expect(view.x).toBeCloseTo(stage.width - w - view.x, 9)
		expect(view.y).toBeCloseTo(stage.height - h - view.y, 9)
		expect(Math.min(view.x, view.y)).toBeCloseTo(16, 9)
		expect(view.x).toBeGreaterThanOrEqual(16 - 1e-9)
		expect(view.y).toBeGreaterThanOrEqual(16 - 1e-9)
	})
})

describe('zoomViewAt', () => {
	const view: View = { scale: 0.4, x: 30, y: -12, fitted: true }

	it('keeps the output px under the anchor fixed and clears fitted', () => {
		const anchor = [210, 333] as const
		const zoomed = zoomViewAt(view, 2.5, anchor)
		expect(zoomed.scale).toBeCloseTo(1, 12)
		expect(zoomed.fitted).toBe(false)
		const before = stageToCanvas(view, anchor)
		const after = stageToCanvas(zoomed, anchor)
		expect(after[0]).toBeCloseTo(before[0], 9)
		expect(after[1]).toBeCloseTo(before[1], 9)
	})

	it('clamps scale to [0.05, 16]', () => {
		expect(zoomViewAt(view, 1000, [0, 0]).scale).toBe(16)
		expect(zoomViewAt(view, 0.001, [0, 0]).scale).toBe(0.05)
	})
})

describe('actualSize and panView', () => {
	it('shows scale 1 centred on the canvas centre', () => {
		const view = actualSize({ width: 800, height: 600 }, OUTPUT)
		expect(view).toEqual({ scale: 1, x: -140, y: -660, fitted: false })
	})

	it('moves the canvas 1:1 and clears fitted', () => {
		expect(panView({ scale: 2, x: 1, y: 2, fitted: true }, 10, -5)).toEqual({
			scale: 2,
			x: 11,
			y: -3,
			fitted: false,
		})
	})
})

describe('stageToCanvas', () => {
	it('is the inverse of canvasToStage', () => {
		const view: View = { scale: 0.37, x: -45.5, y: 120, fitted: false }
		for (const p of [
			[0, 0],
			[1080, 1920],
			[17.25, 900],
		] as const) {
			const round = stageToCanvas(view, canvasToStage(view, p))
			expect(round[0]).toBeCloseTo(p[0], 9)
			expect(round[1]).toBeCloseTo(p[1], 9)
		}
	})
})
