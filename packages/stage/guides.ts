// Safe-area and aspect-ratio guides, in output px from the canvas's top-left corner. View state
// only, never in the document. No DOM, no Svelte.
import type { Size } from './geometry'

export interface Rect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export const ASPECT_GUIDES = ['1:1', '4:5', '9:16', '16:9'] as const
export type AspectGuide = (typeof ASPECT_GUIDES)[number]

/** Action-safe and title-safe fractions of the output's width and height. */
const ACTION_SAFE = 0.9
const TITLE_SAFE = 0.8

function centredRect(output: Size, width: number, height: number): Rect {
	return { x: (output.width - width) / 2, y: (output.height - height) / 2, width, height }
}

/** The centred action-safe (90%) and title-safe (80%) rectangles. */
export function safeAreas(output: Size): { action: Rect; title: Rect } {
	return {
		action: centredRect(output, output.width * ACTION_SAFE, output.height * ACTION_SAFE),
		title: centredRect(output, output.width * TITLE_SAFE, output.height * TITLE_SAFE),
	}
}

/** The largest centred rectangle of `ratio` (width:height) inside the output. */
export function aspectRect(output: Size, ratio: AspectGuide): Rect {
	const [w, h] = ratio.split(':').map(Number)
	const aspect = w / h
	if (output.width / output.height > aspect)
		return centredRect(output, output.height * aspect, output.height)
	return centredRect(output, output.width, output.width / aspect)
}
