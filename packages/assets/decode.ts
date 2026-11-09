import type { ImageFormat } from './sniff'

/** A decoded, upright image ready for upload. Call `close` once it is no longer needed. */
export interface DecodedImage {
	width: number
	height: number
	source: TexImageSource
	close(): void
}

/** Turns image bytes into pixels. `bitmapDecoder` is the browser implementation. */
export interface ImageDecoder {
	decode(bytes: Uint8Array, format: ImageFormat): Promise<DecodedImage>
	/** Returns a resized copy. The caller still owns, and closes, `image`. */
	resize(image: DecodedImage, width: number, height: number): Promise<DecodedImage>
}

const MIME_TYPES: Record<ImageFormat, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
}

function fromBitmap(bitmap: ImageBitmap): DecodedImage {
	return {
		width: bitmap.width,
		height: bitmap.height,
		source: bitmap,
		close: () => bitmap.close(),
	}
}

/**
 * Decodes with `createImageBitmap`, applying EXIF orientation so the result is upright, and
 * premultiplying alpha so mipmaps don't bleed colour from transparent pixels.
 */
export const bitmapDecoder: ImageDecoder = {
	async decode(bytes, format) {
		const blob = new Blob([new Uint8Array(bytes)], { type: MIME_TYPES[format] })
		const bitmap = await createImageBitmap(blob, {
			imageOrientation: 'from-image',
			premultiplyAlpha: 'premultiply',
		})
		return fromBitmap(bitmap)
	},
	async resize(image, width, height) {
		// Resizes the already-upright image, so the target size never accounts for rotation.
		const bitmap = await createImageBitmap(image.source as ImageBitmapSource, {
			resizeWidth: width,
			resizeHeight: height,
			resizeQuality: 'high',
			premultiplyAlpha: 'premultiply',
		})
		return fromBitmap(bitmap)
	},
}
