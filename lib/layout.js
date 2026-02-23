/**
 * Canvas sizing presets and layout helpers.
 */

export const SIZES = {
	SQUARE: { width: 1080, height: 1080 },
	STORY: { width: 1080, height: 1920 },
	LANDSCAPE: { width: 1920, height: 1080 },
	TWITTER: { width: 1200, height: 675 },
}

/**
 * Create a p5 canvas from a preset size object.
 * Returns the canvas element for further manipulation.
 */
export function createCanvas(p, preset = SIZES.SQUARE, pixelDensity = 1) {
	p.pixelDensity(pixelDensity)
	const cnv = p.createCanvas(preset.width, preset.height)
	centerCanvas(p, cnv)
	return cnv
}

/**
 * Create a WebGL canvas from a preset size object.
 */
export function createWebGLCanvas(p, preset = SIZES.SQUARE, pixelDensity = 1) {
	p.pixelDensity(pixelDensity)
	const cnv = p.createCanvas(preset.width, preset.height, p.WEBGL)
	centerCanvas(p, cnv)
	return cnv
}

/** Center the canvas element in the window. */
export function centerCanvas(p, cnv) {
	const x = (p.windowWidth - p.width) / 2
	const y = (p.windowHeight - p.height) / 2
	cnv.position(x, y)
}

/**
 * Scale canvas to fit within the browser window while preserving aspect ratio.
 * Returns the scale factor applied.
 */
export function fitToWindow(p, cnv, padding = 40) {
	const scaleX = (p.windowWidth - padding) / p.width
	const scaleY = (p.windowHeight - padding) / p.height
	const scale = Math.min(scaleX, scaleY, 1)
	cnv.style('transform', `scale(${scale})`)
	cnv.style('transform-origin', 'center center')
	centerCanvas(p, cnv)
	return scale
}
