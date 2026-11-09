import { describe, expect, it } from '@jest/globals'

import { hashBytes, isContentHash } from '../hash'
import { MemoryAssetSource } from '../source'

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('MemoryAssetSource', () => {
	it('hashes bytes and reads them back by hash', async () => {
		const bytes = new TextEncoder().encode('abc')
		expect(await hashBytes(bytes)).toBe(ABC_SHA256)
		expect(isContentHash(ABC_SHA256)).toBe(true)

		const source = new MemoryAssetSource()
		const hash = await source.add(bytes)
		expect(hash).toBe(ABC_SHA256)
		expect(await source.read(hash)).toEqual(bytes)
		expect(await source.read('0'.repeat(64))).toBeNull()
	})

	it('accepts only 64 lowercase hex characters as a content hash', () => {
		expect(isContentHash(ABC_SHA256.toUpperCase())).toBe(false)
		expect(isContentHash(ABC_SHA256.slice(1))).toBe(false)
		expect(isContentHash(`${ABC_SHA256.slice(1)}g`)).toBe(false)
	})
})
