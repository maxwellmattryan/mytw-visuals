import { describe, expect, it } from '@jest/globals'

import { hashBytes, MemoryAssetSource } from '@mytw/assets'

import { importImageFiles } from '../import'
import { fileOf, jpegBytes, pngBytes, webpBytes } from '../testing/fixtures'

describe('importImageFiles', () => {
	it('turns PNG, JPEG and WebP bytes into hashed asset entries, in file order', async () => {
		const source = new MemoryAssetSource()
		const png = pngBytes(640, 480)
		const jpeg = jpegBytes(300, 200)
		const webp = webpBytes(50, 70)
		const { images, errors } = await importImageFiles(
			[fileOf('photo.png', png), fileOf('scan.final.jpg', jpeg), fileOf('tile.webp', webp)],
			source
		)
		expect(errors).toEqual([])
		expect(images).toEqual([
			{
				hash: `sha256:${await hashBytes(png)}`,
				asset: { kind: 'image', mimeType: 'image/png', width: 640, height: 480, name: 'photo.png' },
				layerName: 'photo',
			},
			{
				hash: `sha256:${await hashBytes(jpeg)}`,
				asset: {
					kind: 'image',
					mimeType: 'image/jpeg',
					width: 300,
					height: 200,
					name: 'scan.final.jpg',
				},
				layerName: 'scan.final',
			},
			{
				hash: `sha256:${await hashBytes(webp)}`,
				asset: { kind: 'image', mimeType: 'image/webp', width: 50, height: 70, name: 'tile.webp' },
				layerName: 'tile',
			},
		])
	})

	it('passes the bytes to the asset store', async () => {
		const source = new MemoryAssetSource()
		const png = pngBytes(4, 4)
		const { images } = await importImageFiles([fileOf('a.png', png)], source)
		const stored = await source.read(images[0].hash.slice('sha256:'.length))
		expect(stored).toEqual(png)
	})

	it('skips a non-image file with a message and keeps the accepted ones', async () => {
		const source = new MemoryAssetSource()
		const { images, errors } = await importImageFiles(
			[fileOf('notes.txt', 'hello'), fileOf('a.png', pngBytes(4, 4))],
			source
		)
		expect(errors).toEqual(['"notes.txt" is not a PNG, JPEG or WebP image'])
		expect(images.map((found) => found.asset.name)).toEqual(['a.png'])
	})

	it('omits a name the format would reject, and a layer name that would be empty', async () => {
		const source = new MemoryAssetSource()
		const { images } = await importImageFiles(
			[fileOf('', pngBytes(4, 4)), fileOf('x'.repeat(256) + '.png', pngBytes(4, 4, 1))],
			source
		)
		expect(images[0].asset).not.toHaveProperty('name')
		expect(images[0]).not.toHaveProperty('layerName')
		expect(images[1].asset).not.toHaveProperty('name')
		expect(images[1].layerName).toBe('x'.repeat(256))
	})
})
