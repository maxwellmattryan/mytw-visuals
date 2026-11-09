/** The image formats an asset can be. */
export type ImageFormat = 'png' | 'jpeg' | 'webp'

/** The format and stored pixel size read from an image's header, before decoding. */
export interface ImageHeader {
	format: ImageFormat
	width: number
	height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Reads the format and size from an image's magic bytes and header, or `null` when the
 * bytes are not a PNG, JPEG or WebP, or the header is truncated. The bytes are untrusted,
 * so every read is bounds-checked.
 */
export function sniffImage(bytes: Uint8Array): ImageHeader | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (startsWith(bytes, PNG_SIGNATURE)) return sniffPng(view)
	if (startsWith(bytes, [0xff, 0xd8])) return sniffJpeg(view)
	if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return sniffWebp(bytes, view)
	return null
}

function sniffPng(view: DataView): ImageHeader | null {
	// The IHDR chunk always comes first: length (4), type (4), then width and height.
	if (view.byteLength < 24) return null
	return valid('png', view.getUint32(16), view.getUint32(20))
}

function sniffJpeg(view: DataView): ImageHeader | null {
	let offset = 2
	while (offset + 4 <= view.byteLength) {
		if (view.getUint8(offset) !== 0xff) return null
		const marker = view.getUint8(offset + 1)
		// Fill bytes before a marker.
		if (marker === 0xff) {
			offset += 1
			continue
		}
		const length = view.getUint16(offset + 2)
		if (length < 2 || offset + 2 + length > view.byteLength) return null
		if (isStartOfFrame(marker)) {
			if (length < 7) return null
			return valid('jpeg', view.getUint16(offset + 7), view.getUint16(offset + 5))
		}
		offset += 2 + length
	}
	return null
}

/** SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range. */
function isStartOfFrame(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function sniffWebp(bytes: Uint8Array, view: DataView): ImageHeader | null {
	if (ascii(bytes, 12, 'VP8 ')) {
		if (view.byteLength < 30) return null
		return valid('webp', view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
	}
	if (ascii(bytes, 12, 'VP8L')) {
		if (view.byteLength < 25 || view.getUint8(20) !== 0x2f) return null
		const bits = view.getUint32(21, true)
		return valid('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
	}
	if (ascii(bytes, 12, 'VP8X')) {
		if (view.byteLength < 30) return null
		return valid('webp', uint24(view, 24) + 1, uint24(view, 27) + 1)
	}
	return null
}

function uint24(view: DataView, offset: number): number {
	return (
		view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
	)
}

function valid(format: ImageFormat, width: number, height: number): ImageHeader | null {
	return width > 0 && height > 0 ? { format, width, height } : null
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
	return bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte)
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
	if (bytes.length < offset + text.length) return false
	for (let i = 0; i < text.length; i++) {
		if (bytes[offset + i] !== text.charCodeAt(i)) return false
	}
	return true
}
