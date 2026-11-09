import { afterEach, describe, expect, it, jest } from '@jest/globals'

import type { DecodedImage, ImageDecoder } from '../decode'
import { ImageAssets } from '../image-assets'
import type { AssetErrorCode, AssetIssue, ImageAssetsOptions } from '../image-assets'
import type { ImageFormat } from '../sniff'
import { MemoryAssetSource } from '../source'
import type { AssetSource } from '../source'
import { IMAGE_TEXTURE_ORIGIN } from '../texture'

// WebGL2 constant values, so recorded calls read like real ones.
const GL = {
	TEXTURE_2D: 0x0de1,
	TEXTURE_BINDING_2D: 0x8069,
	MAX_TEXTURE_SIZE: 0x0d33,
	UNPACK_ALIGNMENT: 0x0cf5,
	UNPACK_FLIP_Y_WEBGL: 0x9240,
	UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
	RGBA: 0x1908,
	RGBA8: 0x8058,
	UNSIGNED_BYTE: 0x1401,
	TEXTURE_MAG_FILTER: 0x2800,
	TEXTURE_MIN_FILTER: 0x2801,
	TEXTURE_WRAP_S: 0x2802,
	TEXTURE_WRAP_T: 0x2803,
	NEAREST: 0x2600,
	LINEAR: 0x2601,
	LINEAR_MIPMAP_LINEAR: 0x2703,
	CLAMP_TO_EDGE: 0x812f,
}

const ANISOTROPIC = {
	TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
	MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
}

/** A `gl` that records calls. `anisotropy` is the extension's max, or `null` for no extension. */
function fakeGl(options: { maxTextureSize?: number; anisotropy?: number | null } = {}) {
	const { maxTextureSize = 4096, anisotropy = null } = options
	const engineTexture = { id: 'engine' }
	let next = 0
	let bound: object | null = engineTexture
	const gl = {
		...GL,
		engineTexture,
		getParameter: jest.fn((name: number) => {
			if (name === GL.MAX_TEXTURE_SIZE) return maxTextureSize
			if (name === GL.TEXTURE_BINDING_2D) return bound
			if (name === ANISOTROPIC.MAX_TEXTURE_MAX_ANISOTROPY_EXT) return anisotropy
			return null
		}),
		getExtension: jest.fn((name: string) =>
			name === 'EXT_texture_filter_anisotropic' && anisotropy !== null ? ANISOTROPIC : null
		),
		createTexture: jest.fn(() => ({ id: next++ })),
		deleteTexture: jest.fn((_texture: object) => {}),
		bindTexture: jest.fn((_target: number, texture: object | null) => {
			bound = texture
		}),
		pixelStorei: jest.fn((_name: number, _value: number | boolean) => {}),
		texImage2D: jest.fn((..._args: unknown[]) => {}),
		texParameteri: jest.fn((_target: number, _name: number, _value: number) => {}),
		texParameterf: jest.fn((_target: number, _name: number, _value: number) => {}),
		generateMipmap: jest.fn((_target: number) => {}),
		bound: () => bound,
	}
	return gl
}

type FakeGl = ReturnType<typeof fakeGl>

function asGl(gl: FakeGl): WebGL2RenderingContext {
	return gl as unknown as WebGL2RenderingContext
}

function fakeImage(width: number, height: number) {
	return { width, height, source: {} as TexImageSource, close: jest.fn(() => {}) }
}

/** A decoder whose images have `size` (or the requested size when resizing). */
function fakeDecoder(size: { width: number; height: number }) {
	const decoded: ReturnType<typeof fakeImage>[] = []
	const decoder = {
		decoded,
		decode: jest.fn(async (_bytes: Uint8Array, _format: ImageFormat): Promise<DecodedImage> => {
			const image = fakeImage(size.width, size.height)
			decoded.push(image)
			return image
		}),
		resize: jest.fn(
			async (_image: DecodedImage, width: number, height: number): Promise<DecodedImage> => {
				const image = fakeImage(width, height)
				decoded.push(image)
				return image
			}
		),
	}
	return decoder satisfies ImageDecoder
}

function u32be(value: number): number[] {
	return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

/** A PNG signature and IHDR chunk: enough for `sniffImage`. */
function png(width: number, height: number): Uint8Array {
	return new Uint8Array([
		0x89,
		0x50,
		0x4e,
		0x47,
		0x0d,
		0x0a,
		0x1a,
		0x0a,
		...u32be(13),
		0x49,
		0x48,
		0x44,
		0x52,
		...u32be(width),
		...u32be(height),
		8,
		6,
		0,
		0,
		0,
		...u32be(0),
	])
}

async function setup(
	options: {
		width?: number
		height?: number
		gl?: FakeGl
		assets?: Omit<ImageAssetsOptions, 'decoder' | 'onIssue'>
	} = {}
) {
	const { width = 300, height = 200 } = options
	const gl = options.gl ?? fakeGl()
	const source = new MemoryAssetSource()
	const hash = await source.add(png(width, height))
	const decoder = fakeDecoder({ width, height })
	const issues: AssetIssue[] = []
	const assets = new ImageAssets(asGl(gl), source, {
		...options.assets,
		decoder,
		onIssue: (issue) => issues.push(issue),
	})
	return { gl, source, hash, decoder, issues, assets }
}

describe('ImageAssets', () => {
	afterEach(() => {
		jest.restoreAllMocks()
		Reflect.deleteProperty(globalThis, 'createImageBitmap')
	})

	it('uploads a ready texture at native resolution', async () => {
		const { gl, hash, decoder, issues, assets } = await setup({ width: 300, height: 200 })
		const asset = await assets.load(hash)

		expect(asset).toEqual({
			hash,
			status: 'ready',
			texture: { id: 0 },
			width: 300,
			height: 200,
			naturalWidth: 300,
			naturalHeight: 200,
			format: 'png',
			scale: 1,
		})
		expect(issues).toEqual([])
		expect(decoder.resize).not.toHaveBeenCalled()
		const [image] = decoder.decoded
		expect(gl.pixelStorei).toHaveBeenCalledWith(GL.UNPACK_FLIP_Y_WEBGL, false)
		expect(gl.texImage2D).toHaveBeenCalledWith(
			GL.TEXTURE_2D,
			0,
			GL.RGBA8,
			GL.RGBA,
			GL.UNSIGNED_BYTE,
			image.source
		)
		expect(gl.texParameteri.mock.calls).toEqual(
			expect.arrayContaining([
				[GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR],
				[GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR_MIPMAP_LINEAR],
				[GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
				[GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
			])
		)
		expect(gl.generateMipmap).toHaveBeenCalledWith(GL.TEXTURE_2D)
		expect(gl.texParameterf).not.toHaveBeenCalled()
		expect(image.close).toHaveBeenCalledTimes(1)
		// The engine's binding is left as it was.
		expect(gl.bound()).toBe(gl.engineTexture)
		expect(IMAGE_TEXTURE_ORIGIN).toBe('top-left')
	})

	it.each([
		['no extension', null, null],
		['max 16, capped at 8', 16, 8],
		['max 4', 4, 4],
	])('sets anisotropy only when supported: %s', async (_name, max, expected) => {
		const gl = fakeGl({ anisotropy: max })
		const { hash, assets } = await setup({ gl })
		await assets.load(hash)
		if (expected === null) {
			expect(gl.texParameterf).not.toHaveBeenCalled()
		} else {
			expect(gl.texParameterf).toHaveBeenCalledWith(
				GL.TEXTURE_2D,
				ANISOTROPIC.TEXTURE_MAX_ANISOTROPY_EXT,
				expected
			)
		}
	})

	it('default decoder applies EXIF orientation', async () => {
		// The file stores 400×300, and its EXIF orientation makes it 300×400 upright.
		const bitmaps: { width: number; height: number; close: () => void }[] = []
		const createImageBitmap = jest.fn(
			async (_source: unknown, options: ImageBitmapOptions & { resizeWidth?: number }) => {
				const bitmap = {
					width: options.resizeWidth ?? 300,
					height: options.resizeHeight ?? 400,
					close: jest.fn(() => {}),
				}
				bitmaps.push(bitmap)
				return bitmap
			}
		)
		Object.assign(globalThis, { createImageBitmap })
		const source = new MemoryAssetSource()
		const hash = await source.add(png(400, 300))
		const gl = fakeGl({ maxTextureSize: 200 })
		const assets = new ImageAssets(asGl(gl), source, { onIssue: () => {} })

		const asset = await assets.load(hash)

		const [blob, decodeOptions] = createImageBitmap.mock.calls[0]
		expect(blob).toBeInstanceOf(Blob)
		expect((blob as Blob).type).toBe('image/png')
		expect(decodeOptions).toEqual({
			imageOrientation: 'from-image',
			premultiplyAlpha: 'premultiply',
		})
		expect(createImageBitmap.mock.calls[1]).toEqual([
			bitmaps[0],
			{
				resizeWidth: 150,
				resizeHeight: 200,
				resizeQuality: 'high',
				premultiplyAlpha: 'premultiply',
			},
		])
		expect(asset).toMatchObject({
			status: 'ready',
			naturalWidth: 300,
			naturalHeight: 400,
			width: 150,
			height: 200,
		})
		expect(bitmaps.map((bitmap) => bitmap.close)).toEqual([
			expect.objectContaining({ mock: expect.objectContaining({ calls: [[]] }) }),
			expect.objectContaining({ mock: expect.objectContaining({ calls: [[]] }) }),
		])
	})

	it.each([
		['under the limit', 800, 600, 4096, undefined, 800, 600],
		['wide', 5000, 2000, 4096, undefined, 4096, 1638],
		['tall', 1000, 3000, 2048, undefined, 683, 2048],
		['option lower than GL', 2048, 1024, 4096, 1024, 1024, 512],
		['GL lower than option', 2048, 1024, 1024, 4096, 1024, 512],
	])(
		'fits images to the texture limit: %s',
		async (_name, width, height, glMax, optionMax, fitWidth, fitHeight) => {
			const { gl, hash, decoder, issues, assets } = await setup({
				width,
				height,
				gl: fakeGl({ maxTextureSize: glMax }),
				assets: { maxTextureSize: optionMax },
			})
			const asset = await assets.load(hash)

			const downscaled = fitWidth !== width
			const scale = Math.max(fitWidth, fitHeight) / Math.max(width, height)
			expect(asset).toMatchObject({
				status: 'ready',
				width: fitWidth,
				height: fitHeight,
				naturalWidth: width,
				naturalHeight: height,
				scale,
			})
			expect(asset.scale < 1).toBe(downscaled)
			expect(issues.map(({ code, severity }) => [code, severity])).toEqual(
				downscaled ? [['downscaled', 'warning']] : []
			)
			const uploaded = decoder.decoded[decoder.decoded.length - 1]
			expect(gl.texImage2D.mock.calls[0][5]).toBe(uploaded.source)
			for (const image of decoder.decoded) expect(image.close).toHaveBeenCalledTimes(1)
			if (downscaled) {
				expect(decoder.resize).toHaveBeenCalledWith(decoder.decoded[0], fitWidth, fitHeight)
				expect(issues[0].message).toContain(`${width}×${height}`)
				expect(issues[0].message).toContain(`${fitWidth}×${fitHeight}`)
			}
		}
	)

	type FailureCase = {
		hash?: string
		bytes?: Uint8Array
		source?: AssetSource
		decodeFails?: boolean
	}

	const failures: [AssetErrorCode, FailureCase][] = [
		['invalid-hash', { hash: 'ABC' }],
		['not-found', { hash: '0'.repeat(64) }],
		['source-failed', { source: { read: () => Promise.reject(new Error('disk on fire')) } }],
		['hash-mismatch', { source: { read: async () => png(10, 10) } }],
		['unsupported-format', { bytes: new TextEncoder().encode('GIF89a not an image') }],
		['too-large', { bytes: png(20_000, 20_000) }],
		['decode-failed', { decodeFails: true }],
	]

	it.each(failures)(
		'falls back to the placeholder and reports the issue: %s',
		async (code, failure) => {
			const gl = fakeGl()
			const memory = new MemoryAssetSource()
			const added = await memory.add(failure.bytes ?? png(10, 10))
			const decoder = fakeDecoder({ width: 10, height: 10 })
			if (failure.decodeFails) decoder.decode.mockRejectedValue(new Error('corrupt data'))
			const issues: AssetIssue[] = []
			const assets = new ImageAssets(asGl(gl), failure.source ?? memory, {
				decoder,
				onIssue: (issue) => issues.push(issue),
			})
			const hash = failure.hash ?? (failure.source ? '1'.repeat(64) : added)

			const asset = await assets.load(hash)

			expect(asset).toMatchObject({
				hash,
				status: 'placeholder',
				width: 64,
				height: 64,
				naturalWidth: 64,
				naturalHeight: 64,
				format: null,
			})
			expect(issues).toHaveLength(1)
			expect(issues[0]).toMatchObject({ hash, code, severity: 'error' })
			expect(asset.issue).toEqual(issues[0])
			// The placeholder: a 64×64 checker with nearest filtering and no mipmaps.
			expect(gl.texImage2D.mock.calls[0].slice(0, 8)).toEqual([
				GL.TEXTURE_2D,
				0,
				GL.RGBA8,
				64,
				64,
				0,
				GL.RGBA,
				GL.UNSIGNED_BYTE,
			])
			expect(gl.texParameteri).toHaveBeenCalledWith(
				GL.TEXTURE_2D,
				GL.TEXTURE_MIN_FILTER,
				GL.NEAREST
			)
			expect(gl.generateMipmap).not.toHaveBeenCalled()
			if (code === 'too-large') expect(decoder.decode).not.toHaveBeenCalled()
		}
	)

	it('logs issues with console.warn when no onIssue is given', async () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
		const assets = new ImageAssets(asGl(fakeGl()), new MemoryAssetSource())
		await assets.load('0'.repeat(64))
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0][0])).toContain('error not-found')
	})

	it('caches, releases and disposes textures', async () => {
		const { gl, source, hash, decoder, assets } = await setup()
		const read = jest.spyOn(source, 'read')

		// Concurrent loads share one read, one promise and one texture.
		const [first, second] = await Promise.all([assets.load(hash), assets.load(hash)])
		expect(first).toBe(second)
		expect(read).toHaveBeenCalledTimes(1)
		expect(assets.get(hash)).toBe(first)
		expect(await assets.load(hash)).toBe(first)
		expect(read).toHaveBeenCalledTimes(1)

		// Placeholders are cached and share one texture.
		const missingA = await assets.load('a'.repeat(64))
		const missingB = await assets.load('b'.repeat(64))
		expect(missingA.texture).toBe(missingB.texture)
		expect(await assets.load('a'.repeat(64))).toBe(missingA)

		// Release deletes the texture, never the placeholder, and a later load reads again.
		assets.release(hash)
		assets.release('a'.repeat(64))
		expect(gl.deleteTexture.mock.calls).toEqual([[first.texture]])
		expect(assets.get(hash)).toBeUndefined()
		const reloaded = await assets.load(hash)
		expect(read.mock.calls.filter(([read]) => read === hash)).toHaveLength(2)
		expect(reloaded.texture).not.toBe(first.texture)

		// A load that settles after release deletes its own texture.
		let finish: (image: DecodedImage) => void = () => {}
		decoder.decode.mockImplementationOnce(
			() => new Promise<DecodedImage>((resolve) => (finish = resolve))
		)
		assets.release(hash)
		const late = assets.load(hash)
		await new Promise((resolve) => setTimeout(resolve, 0))
		assets.release(hash)
		finish(fakeImage(300, 200))
		const lateAsset = await late
		expect(gl.deleteTexture).toHaveBeenLastCalledWith(lateAsset.texture)
		expect(assets.get(hash)).toBeUndefined()

		// Dispose deletes every texture, including the placeholder, and later loads reject.
		const kept = await assets.load(hash)
		decoder.decode.mockImplementationOnce(
			() => new Promise<DecodedImage>((resolve) => (finish = resolve))
		)
		const pending = assets.load(await source.add(png(1, 1)))
		await new Promise((resolve) => setTimeout(resolve, 0))
		const pendingMissing = assets.load('c'.repeat(64))
		gl.deleteTexture.mockClear()
		assets.dispose()
		expect(gl.deleteTexture.mock.calls).toEqual(
			expect.arrayContaining([[kept.texture], [missingA.texture]])
		)
		expect(gl.deleteTexture).toHaveBeenCalledTimes(2)
		await expect(assets.load(hash)).rejects.toThrow('ImageAssets is disposed')

		// Loads settling after dispose delete their texture, including a re-created placeholder.
		finish(fakeImage(1, 1))
		const [pendingAsset, missingAsset] = await Promise.all([pending, pendingMissing])
		expect(pendingAsset.status).toBe('ready')
		expect(missingAsset.status).toBe('placeholder')
		expect(gl.deleteTexture.mock.calls.slice(2)).toEqual(
			expect.arrayContaining([[pendingAsset.texture], [missingAsset.texture]])
		)
		expect(gl.deleteTexture).toHaveBeenCalledTimes(4)
	})
})
