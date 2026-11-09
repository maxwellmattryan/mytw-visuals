import { hashBytes } from '@mytw/assets'

/** Throws unless `bytes` hash to `hash` (`sha256:<hex>`, the project's asset key). */
export async function verifyAsset(hash: string, name: string, bytes: Uint8Array): Promise<void> {
	const actual = `sha256:${await hashBytes(bytes)}`
	if (actual !== hash) throw new Error(`Asset hash mismatch for ${name}`)
}

/** Fetches an image asset, checks its bytes against `hash`, then decodes it. */
export async function loadImageAsset(
	hash: string,
	url: string,
	name: string
): Promise<ImageBitmap> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`)
	const bytes = new Uint8Array(await response.arrayBuffer())
	await verifyAsset(hash, name, bytes)
	return createImageBitmap(new Blob([bytes]))
}
