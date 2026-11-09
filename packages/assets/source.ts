import { hashBytes } from './hash'

/**
 * Where asset bytes come from, addressed by content hash. `read` resolves to `null` when
 * the source has no such asset, and rejects when the source itself fails.
 */
export interface AssetSource {
	read(hash: string): Promise<Uint8Array | null>
}

/** An in-memory `AssetSource`. Later sources (IndexedDB, OPFS, cloud) implement the same interface. */
export class MemoryAssetSource implements AssetSource {
	private readonly entries = new Map<string, Uint8Array>()

	/** Stores `bytes` and resolves to their content hash. */
	async add(bytes: Uint8Array): Promise<string> {
		const hash = await hashBytes(bytes)
		this.entries.set(hash, bytes)
		return hash
	}

	async read(hash: string): Promise<Uint8Array | null> {
		return this.entries.get(hash) ?? null
	}
}
