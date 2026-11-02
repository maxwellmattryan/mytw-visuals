/**
 * Canvas creation and layout helpers.
 */

import type p5 from 'p5'
import { SIZES } from './sizes'
import type { CanvasSize } from './sizes'

/**
 * Create a p5 canvas from a preset size object.
 * Returns the canvas element for further manipulation.
 */
export function createCanvas(
	p: p5,
	preset: CanvasSize = SIZES.SQUARE,
	pixelDensity = 1
): p5.Renderer {
	p.pixelDensity(pixelDensity)
	const cnv = p.createCanvas(preset.width, preset.height)
	centerCanvas(p, cnv)
	return cnv
}

/**
 * Create a WebGL canvas from a preset size object.
 */
export function createWebGLCanvas(
	p: p5,
	preset: CanvasSize = SIZES.SQUARE,
	pixelDensity = 1
): p5.Renderer {
	p.pixelDensity(pixelDensity)
	const cnv = p.createCanvas(preset.width, preset.height, p.WEBGL)
	centerCanvas(p, cnv)
	return cnv
}

/** Center the canvas element in the window. */
export function centerCanvas(p: p5, cnv: p5.Renderer): void {
	const x = (p.windowWidth - p.width) / 2
	const y = (p.windowHeight - p.height) / 2
	cnv.position(x, y)
}

/**
 * Scale canvas to fit within the browser window while preserving aspect ratio.
 * Returns the scale factor applied.
 */
export function fitToWindow(p: p5, cnv: p5.Renderer, padding = 40): number {
	const scaleX = (p.windowWidth - padding) / p.width
	const scaleY = (p.windowHeight - padding) / p.height
	const scale = Math.min(scaleX, scaleY, 1)
	cnv.style('transform', `scale(${scale})`)
	cnv.style('transform-origin', 'center center')
	centerCanvas(p, cnv)
	return scale
}
