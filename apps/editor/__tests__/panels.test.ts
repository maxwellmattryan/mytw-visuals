import { describe, expect, it } from '@jest/globals'

import { clampPanels, PANEL_DEFAULTS, PANEL_MIN, resizePanel, STAGE_MIN } from '../src/panels'
import type { PanelId, PanelSizes, Viewport } from '../src/panels'

const HEADER = 40
const vp = (width: number, height: number): Viewport => ({ width, height, header: HEADER })
const sizes = (left: number, right: number, timeline: number): PanelSizes => ({
	left,
	right,
	timeline,
})

const stage = (s: PanelSizes, v: Viewport) => ({
	width: v.width - s.left - s.right,
	height: v.height - v.header - s.timeline,
})

describe('panel constants', () => {
	it('match the layout spec', () => {
		expect(PANEL_DEFAULTS).toEqual({ left: 240, right: 280, timeline: 160 })
		expect(PANEL_MIN).toEqual({ left: 160, right: 200, timeline: 96 })
		expect(STAGE_MIN).toEqual({ width: 240, height: 160 })
	})
})

describe('resizePanel', () => {
	const wide = vp(1440, 900)

	it.each<[string, PanelSizes, PanelId, number, Viewport, PanelSizes]>([
		['grows the left panel', PANEL_DEFAULTS, 'left', 16, wide, sizes(256, 280, 160)],
		['shrinks the left panel', PANEL_DEFAULTS, 'left', -16, wide, sizes(224, 280, 160)],
		[
			'stops the left panel at its minimum',
			PANEL_DEFAULTS,
			'left',
			-500,
			wide,
			sizes(160, 280, 160),
		],
		['grows the right panel', PANEL_DEFAULTS, 'right', 40, wide, sizes(240, 320, 160)],
		[
			'stops the right panel at its minimum',
			PANEL_DEFAULTS,
			'right',
			-81,
			wide,
			sizes(240, 200, 160),
		],
		['grows the timeline', PANEL_DEFAULTS, 'timeline', 16, wide, sizes(240, 280, 176)],
		[
			'stops the timeline at its minimum',
			PANEL_DEFAULTS,
			'timeline',
			-100,
			wide,
			sizes(240, 280, 96),
		],
		// 1440 − 280 − 240 = 920.
		[
			'stops the left panel at the stage width',
			PANEL_DEFAULTS,
			'left',
			5000,
			wide,
			sizes(920, 280, 160),
		],
		// 1440 − 240 − 240 = 960.
		[
			'stops the right panel at the stage width',
			PANEL_DEFAULTS,
			'right',
			5000,
			wide,
			sizes(240, 960, 160),
		],
		// 900 − 40 − 160 = 700.
		[
			'stops the timeline at the stage height',
			PANEL_DEFAULTS,
			'timeline',
			5000,
			wide,
			sizes(240, 280, 700),
		],
		[
			'keeps the minimum when the window has no room',
			sizes(160, 200, 96),
			'left',
			50,
			vp(500, 250),
			sizes(160, 200, 96),
		],
		['rounds fractional pointer deltas', PANEL_DEFAULTS, 'left', 10.6, wide, sizes(251, 280, 160)],
	])('%s', (_label, start, id, delta, viewport, expected) => {
		expect(resizePanel(start, id, delta, viewport)).toEqual(expected)
	})

	it('never shrinks the stage below its minimum when there is room', () => {
		let s: PanelSizes = PANEL_DEFAULTS
		for (const id of ['left', 'right', 'timeline'] as const) s = resizePanel(s, id, 10_000, wide)
		const st = stage(s, wide)
		expect(st.width).toBe(STAGE_MIN.width)
		expect(st.height).toBe(STAGE_MIN.height)
	})
})

describe('clampPanels', () => {
	it.each<[string, PanelSizes, Viewport, PanelSizes]>([
		['leaves panels that fit', PANEL_DEFAULTS, vp(1440, 900), PANEL_DEFAULTS],
		// 240 + 280 + 240 = 760, so 700 is 60 short: the right panel gives it.
		['takes from the right panel first', PANEL_DEFAULTS, vp(700, 900), sizes(240, 220, 160)],
		// 160 + 200 + 240 = 600 with both panels at minimum: 640 takes 80 from the right, then 40 from the left.
		['then from the left panel', PANEL_DEFAULTS, vp(640, 900), sizes(200, 200, 160)],
		['never below either minimum', PANEL_DEFAULTS, vp(400, 900), sizes(160, 200, 160)],
		// 40 + 160 + 160 = 360, so 330 is 30 short.
		['takes from the timeline when short', PANEL_DEFAULTS, vp(1440, 330), sizes(240, 280, 130)],
		['never below the timeline minimum', PANEL_DEFAULTS, vp(1440, 200), sizes(240, 280, 96)],
		['raises sizes below their minimums', sizes(10, 10, 10), vp(1440, 900), sizes(160, 200, 96)],
		['shrinks both directions at once', sizes(400, 400, 400), vp(900, 500), sizes(400, 260, 300)],
	])('%s', (_label, start, viewport, expected) => {
		expect(clampPanels(start, viewport)).toEqual(expected)
	})

	it('keeps the stage at its minimum whenever the minimums allow it', () => {
		for (const [w, h] of [
			[600, 296],
			[700, 400],
			[1024, 768],
		]) {
			const v = vp(w, h)
			const st = stage(clampPanels(sizes(800, 800, 800), v), v)
			expect(st.width).toBeGreaterThanOrEqual(STAGE_MIN.width)
			expect(st.height).toBeGreaterThanOrEqual(STAGE_MIN.height)
		}
	})
})
