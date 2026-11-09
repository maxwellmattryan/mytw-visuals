import { sniffImage } from '@mytw/assets'
import type { ImageFormat } from '@mytw/assets'
import type { ProjectAsset } from '@mytw/schema'

/** An image read from a file, ready to become an asset entry and a layer. */
export interface ImportedImage {
	/** `sha256:<hex>`, the asset's key in `assets`. */
	readonly hash: string
	readonly asset: ProjectAsset
	/** The file name without its last extension, when that isn't empty. */
	readonly layerName?: string
}

/** Where imported bytes are kept. `add` resolves to the bare hex hash, as `MemoryAssetSource` does. */
export interface AssetStore {
	add(bytes: Uint8Array): Promise<string>
}

/** The part of a `File` the import reads. */
export interface ImageFile {
	readonly name: string
	arrayBuffer(): Promise<ArrayBuffer>
}

export interface ImportResult {
	readonly images: ImportedImage[]
	readonly errors: string[]
}

const MIME_TYPES: Record<ImageFormat, 'image/png' | 'image/jpeg' | 'image/webp'> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
}

/** The accept list for the file picker. */
export const IMAGE_ACCEPT = Object.values(MIME_TYPES).join(',')

/** The format's rule for an asset `name`: 1–255 characters with no `/` or `\`. */
function assetName(name: string): string | undefined {
	return name.length >= 1 && name.length <= 255 && !/[/\\]/.test(name) ? name : undefined
}

/** The file name without its last extension. */
function stem(name: string): string {
	const base = name.split(/[/\\]/).pop() ?? ''
	const dot = base.lastIndexOf('.')
	return (dot > 0 ? base.slice(0, dot) : base).trim()
}

export function notAnImageMessage(name: string): string {
	return `"${name}" is not a PNG, JPEG or WebP image`
}

/**
 * Reads each file, keeps the PNG, JPEG and WebP ones and passes their bytes to `assetStore`. A file
 * of any other type becomes an error message, and the rest are still imported. Results keep file
 * order.
 */
export async function importImageFiles(
	files: readonly ImageFile[],
	assetStore: AssetStore
): Promise<ImportResult> {
	const images: ImportedImage[] = []
	const errors: string[] = []
	for (const file of files) {
		const bytes = new Uint8Array(await file.arrayBuffer())
		const header = sniffImage(bytes)
		if (!header) {
			errors.push(notAnImageMessage(file.name))
			continue
		}
		const hash = `sha256:${await assetStore.add(bytes)}`
		const name = assetName(file.name)
		const asset: ProjectAsset = {
			kind: 'image',
			mimeType: MIME_TYPES[header.format],
			width: header.width,
			height: header.height,
			...(name !== undefined ? { name } : {}),
		}
		const layerName = stem(file.name)
		images.push(layerName !== '' ? { hash, asset, layerName } : { hash, asset })
	}
	return { images, errors }
}
