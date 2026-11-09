// The stage viewport: where the output canvas sits in the stage, and how big. View state only,
// never in the document. Stage px are CSS px from the stage's top-left corner; output px here are
// measured from the canvas's top-left corner. No DOM, no Svelte.
import type { Size, Vec2 } from './geometry'

export interface View {
	/** Stage px per output px. */
	readonly scale: number
	/** The canvas's top-left corner, in stage px. */
	readonly x: number
	readonly y: number
	/** Whether the view is the fit; a fitted view refits when the stage resizes. */
	readonly fitted: boolean
}

export const MIN_VIEW_SCALE = 0.05
export const MAX_VIEW_SCALE = 16
/** Space kept around the fitted canvas on each side, in stage px. */
export const FIT_PADDING = 16

function clampScale(scale: number): number {
	return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale))
}

/** A view at `scale` with the canvas centred in the stage. */
function centred(stage: Size, output: Size, scale: number, fitted: boolean): View {
	return {
		scale,
		x: (stage.width - output.width * scale) / 2,
		y: (stage.height - output.height * scale) / 2,
		fitted,
	}
}

/** The largest scale that fits the output inside the stage with 16 px padding, centred. */
export function fitView(stage: Size, output: Size): View {
	const scale = Math.min(
		(stage.width - 2 * FIT_PADDING) / output.width,
		(stage.height - 2 * FIT_PADDING) / output.height
	)
	return centred(stage, output, clampScale(scale), true)
}

/** Scale 1 (one stage px per output px), centred on the canvas centre. */
export function actualSize(stage: Size, output: Size): View {
	return centred(stage, output, 1, false)
}

/** Multiplies the scale by `factor`, clamped, keeping the output px under `stagePoint` fixed. */
export function zoomViewAt(view: View, factor: number, stagePoint: Vec2): View {
	const scale = clampScale(view.scale * factor)
	const [ox, oy] = stageToCanvas(view, stagePoint)
	return { scale, x: stagePoint[0] - ox * scale, y: stagePoint[1] - oy * scale, fitted: false }
}

/** Moves the canvas by `dx`, `dy` stage px. */
export function panView(view: View, dx: number, dy: number): View {
	return { ...view, x: view.x + dx, y: view.y + dy, fitted: false }
}

/** Stage px to output px from the canvas's top-left corner. */
export function stageToCanvas(view: View, [x, y]: Vec2): Vec2 {
	return [(x - view.x) / view.scale, (y - view.y) / view.scale]
}

/** Output px from the canvas's top-left corner to stage px. */
export function canvasToStage(view: View, [x, y]: Vec2): Vec2 {
	return [view.x + x * view.scale, view.y + y * view.scale]
}
