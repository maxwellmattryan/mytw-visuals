import { describe, expect, it } from '@jest/globals'

import { hashBytes } from '@mytw/assets'

import { verifyAsset } from '../src/assets'

const bytes = new TextEncoder().encode('mytw editor asset')

describe('verifyAsset', () => {
	it('accepts bytes that match the hash', async () => {
		const hash = `sha256:${await hashBytes(bytes)}`
		await expect(verifyAsset(hash, 'base.png', bytes)).resolves.toBeUndefined()
	})

	it("rejects bytes that don't match the hash", async () => {
		const hash = `sha256:${await hashBytes(bytes)}`
		const tampered = bytes.slice()
		tampered[0] ^= 1
		await expect(verifyAsset(hash, 'mytw-002_base.png', tampered)).rejects.toThrow(
			'Asset hash mismatch for mytw-002_base.png'
		)
	})

	it('rejects a hash without the sha256: prefix', async () => {
		const bare = await hashBytes(bytes)
		await expect(verifyAsset(bare, 'base.png', bytes)).rejects.toThrow(
			'Asset hash mismatch for base.png'
		)
	})
})
