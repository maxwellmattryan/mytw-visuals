// Panel sizing for the editor layout: a left and right column around the stage, and a timeline
// under all three. Pure, so the rules are unit-tested apart from the pointer and key handling.

export type PanelId = 'left' | 'right' | 'timeline'

export type PanelSizes = Readonly<Record<PanelId, number>>

/** The window size in CSS px, and the header bar's height above the panels. */
export interface Viewport {
	readonly width: number
	readonly height: number
	readonly header: number
}

export const PANEL_DEFAULTS: PanelSizes = { left: 240, right: 280, timeline: 160 }
export const PANEL_MIN: PanelSizes = { left: 160, right: 200, timeline: 96 }
export const STAGE_MIN = { width: 240, height: 160 } as const

/** How far one arrow-key press on a focused splitter moves it, in CSS px. */
export const SPLITTER_STEP = 16

/** The largest size `id` can take without shrinking the stage below `STAGE_MIN`. */
export function panelMax(sizes: PanelSizes, id: PanelId, viewport: Viewport): number {
	const max =
		id === 'timeline'
			? viewport.height - viewport.header - STAGE_MIN.height
			: viewport.width - (id === 'left' ? sizes.right : sizes.left) - STAGE_MIN.width
	return Math.max(PANEL_MIN[id], max)
}

/**
 * Grows panel `id` by `delta` px (negative shrinks it). It stops at its minimum, and at the size
 * that would shrink the stage below `STAGE_MIN`.
 */
export function resizePanel(
	sizes: PanelSizes,
	id: PanelId,
	delta: number,
	viewport: Viewport
): PanelSizes {
	const next = Math.min(panelMax(sizes, id, viewport), sizes[id] + delta)
	return { ...sizes, [id]: Math.max(PANEL_MIN[id], Math.round(next)) }
}

/**
 * Fits the panels to the viewport, keeping the stage at least `STAGE_MIN`. The right panel gives
 * way first, then the left, then the timeline, and none goes below its minimum.
 */
export function clampPanels(sizes: PanelSizes, viewport: Viewport): PanelSizes {
	let right = Math.max(PANEL_MIN.right, sizes.right)
	let left = Math.max(PANEL_MIN.left, sizes.left)
	let timeline = Math.max(PANEL_MIN.timeline, sizes.timeline)

	let excess = left + right + STAGE_MIN.width - viewport.width
	if (excess > 0) {
		const fromRight = Math.min(excess, right - PANEL_MIN.right)
		right -= fromRight
		excess -= fromRight
		left -= Math.min(excess, left - PANEL_MIN.left)
	}
	const tall = viewport.header + timeline + STAGE_MIN.height - viewport.height
	if (tall > 0) timeline -= Math.min(tall, timeline - PANEL_MIN.timeline)

	return { left, right, timeline }
}
