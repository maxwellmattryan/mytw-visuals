/**
 * Helpers that draw an image onto a canvas or graphics buffer.
 */

import type p5 from 'p5'

export type DrawTarget = p5 | p5.Graphics

export interface ImageDrawOptions {
	flipY?: boolean
}

/** Draw an image to cover the canvas (or graphics buffer), centered, cropping overflow. */
export function coverImage(
	p: DrawTarget,
	img: p5.Image,
	{ flipY = false }: ImageDrawOptions = {}
): void {
	const scale = Math.max(p.width / img.width, p.height / img.height)
	const w = img.width * scale
	const h = img.height * scale
	const x = (p.width - w) / 2
	const y = (p.height - h) / 2
	if (flipY) {
		p.push()
		p.translate(0, p.height)
		p.scale(1, -1)
		p.image(img, x, y, w, h)
		p.pop()
	} else {
		p.image(img, x, y, w, h)
	}
}

/** Draw an image to fit the canvas (or graphics buffer), centered, preserving aspect ratio. */
export function fitImage(
	p: DrawTarget,
	img: p5.Image,
	{ flipY = false }: ImageDrawOptions = {}
): void {
	const scale = Math.min(p.width / img.width, p.height / img.height)
	const w = img.width * scale
	const h = img.height * scale
	const x = (p.width - w) / 2
	const y = (p.height - h) / 2
	if (flipY) {
		p.push()
		p.translate(0, p.height)
		p.scale(1, -1)
		p.image(img, x, y, w, h)
		p.pop()
	} else {
		p.image(img, x, y, w, h)
	}
}
