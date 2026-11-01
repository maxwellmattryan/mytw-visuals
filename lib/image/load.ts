import type p5 from 'p5'

/** Load an image and resize it so its largest dimension is maxDim. */
export function loadAndResize(p: p5, path: string, maxDim: number): Promise<p5.Image> {
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
