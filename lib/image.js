/**
 * Image loading and pixel manipulation helpers.
 */

/** Load an image and resize it so its largest dimension is maxDim. */
export function loadAndResize(p, path, maxDim) {
	return new Promise((resolve) => {
		p.loadImage(path, (img) => {
			const scale = maxDim / Math.max(img.width, img.height)
			if (scale < 1) {
				img.resize(Math.round(img.width * scale), Math.round(img.height * scale))
			}
			resolve(img)
		})
	})
}

/** Get a grayscale displacement map from an image (returns a p5.Image). */
export function getDisplacementMap(p, img) {
	const disp = p.createImage(img.width, img.height)
	img.loadPixels()
	disp.loadPixels()
	for (let i = 0; i < img.pixels.length; i += 4) {
		const brightness = (img.pixels[i] + img.pixels[i + 1] + img.pixels[i + 2]) / 3
		disp.pixels[i] = brightness
		disp.pixels[i + 1] = brightness
		disp.pixels[i + 2] = brightness
		disp.pixels[i + 3] = 255
	}
	disp.updatePixels()
	return disp
}

/** Pixelate an image by sampling at blockSize intervals. */
export function pixelate(p, img, blockSize) {
	const out = p.createImage(img.width, img.height)
	img.loadPixels()
	out.loadPixels()
	for (let y = 0; y < img.height; y += blockSize) {
		for (let x = 0; x < img.width; x += blockSize) {
			const idx = (y * img.width + x) * 4
			const r = img.pixels[idx]
			const g = img.pixels[idx + 1]
			const b = img.pixels[idx + 2]
			for (let dy = 0; dy < blockSize && y + dy < img.height; dy++) {
				for (let dx = 0; dx < blockSize && x + dx < img.width; dx++) {
					const oi = ((y + dy) * img.width + (x + dx)) * 4
					out.pixels[oi] = r
					out.pixels[oi + 1] = g
					out.pixels[oi + 2] = b
					out.pixels[oi + 3] = 255
				}
			}
		}
	}
	out.updatePixels()
	return out
}

/** Get pixel color at (x, y) from a loaded p5.Image. Returns [r, g, b, a]. */
export function getPixelColor(img, x, y) {
	const idx = (y * img.width + x) * 4
	return [img.pixels[idx], img.pixels[idx + 1], img.pixels[idx + 2], img.pixels[idx + 3]]
}

/** Draw an image to fit the canvas, centered, preserving aspect ratio. */
export function fitImage(p, img) {
	const scale = Math.min(p.width / img.width, p.height / img.height)
	const w = img.width * scale
	const h = img.height * scale
	p.image(img, (p.width - w) / 2, (p.height - h) / 2, w, h)
}
