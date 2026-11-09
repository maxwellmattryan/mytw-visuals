import { bitmapDecoder } from './decode'
import type { DecodedImage, ImageDecoder } from './decode'
import { hashBytes, isContentHash } from './hash'
import { DEFAULT_MAX_PIXELS, fitToLimit } from './limits'
import { sniffImage } from './sniff'
import type { ImageFormat } from './sniff'
import type { AssetSource } from './source'
import { createPlaceholderTexture, uploadImageTexture } from './texture'

/** Why an asset fell back to the placeholder. */
export type AssetErrorCode =
	| 'invalid-hash'
	| 'not-found'
	| 'source-failed'
	| 'hash-mismatch'
	| 'unsupported-format'
	| 'too-large'
	| 'decode-failed'

/** Every issue `ImageAssets` reports. `downscaled` is the only warning. */
export type AssetIssueCode = AssetErrorCode | 'downscaled'

export interface AssetIssue {
	hash: string
	code: AssetIssueCode
	severity: 'error' | 'warning'
	message: string
}

/**
 * A loaded image. A `ready` asset's texture holds the upright image with premultiplied
 * alpha (blend with `ONE, ONE_MINUS_SRC_ALPHA`), its origin at the top-left (see
 * `IMAGE_TEXTURE_ORIGIN`). A `placeholder` asset shares the 64×64 checker texture,
 * `format` is `null` and `issue` says why.
 */
export interface ImageAsset {
	hash: string
	status: 'ready' | 'placeholder'
	texture: WebGLTexture
	/** The uploaded texture size. */
	width: number
	height: number
	/** The upright source size, before any downscale. */
	naturalWidth: number
	naturalHeight: number
	format: ImageFormat | null
	/** Uploaded size over natural size: 1 unless the image was downscaled to fit. */
	scale: number
	issue?: AssetIssue
}

export interface ImageAssetsOptions {
	/** Receives every issue. Without it, issues are logged with `console.warn`. */
	onIssue?(issue: AssetIssue): void
	decoder?: ImageDecoder
	/** A texture size limit below the GPU's own `MAX_TEXTURE_SIZE`. */
	maxTextureSize?: number
	/** Images with more pixels than this are rejected before decoding. */
	maxPixels?: number
}

const PLACEHOLDER_SIZE = 64

class AssetError extends Error {
	constructor(
		readonly code: AssetErrorCode,
		message: string
	) {
		super(message)
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * Loads images by content hash into WebGL2 textures. Loads are cached per hash and never
 * reject for asset problems: a missing or broken asset resolves to a placeholder.
 */
export class ImageAssets {
	private readonly loads = new Map<string, Promise<ImageAsset>>()
	private readonly settled = new Map<string, ImageAsset>()
	private readonly decoder: ImageDecoder
	private readonly maxTextureSize: number
	private readonly maxPixels: number
	private placeholder: WebGLTexture | null = null
	private disposed = false

	constructor(
		private readonly gl: WebGL2RenderingContext,
		private readonly source: AssetSource,
		private readonly options: ImageAssetsOptions = {}
	) {
		this.decoder = options.decoder ?? bitmapDecoder
		const glLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
		this.maxTextureSize = Math.min(glLimit, options.maxTextureSize ?? glLimit)
		this.maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS
	}

	/** Loads `hash`, sharing one promise and texture between all calls until it is released. */
	load(hash: string): Promise<ImageAsset> {
		if (this.disposed) return Promise.reject(new Error('ImageAssets is disposed'))
		const existing = this.loads.get(hash)
		if (existing) return existing
		const promise = this.loadFresh(hash).then((asset) => {
			if (this.disposed || this.loads.get(hash) !== promise) {
				this.discard(asset)
			} else {
				this.settled.set(hash, asset)
			}
			return asset
		})
		this.loads.set(hash, promise)
		return promise
	}

	/** The settled asset for `hash`, or `undefined` while it loads or when it was never loaded. */
	get(hash: string): ImageAsset | undefined {
		return this.settled.get(hash)
	}

	/** Deletes the texture for `hash` (never the shared placeholder) and forgets it. */
	release(hash: string): void {
		const asset = this.settled.get(hash)
		if (asset?.status === 'ready') this.gl.deleteTexture(asset.texture)
		this.settled.delete(hash)
		this.loads.delete(hash)
	}

	/** Deletes every texture, including the placeholder. Later `load` calls reject. */
	dispose(): void {
		this.disposed = true
		for (const asset of this.settled.values()) {
			if (asset.status === 'ready') this.gl.deleteTexture(asset.texture)
		}
		this.settled.clear()
		this.loads.clear()
		this.deletePlaceholder()
	}

	/** Cleans up after a load that settled once its hash was released or the instance disposed. */
	private discard(asset: ImageAsset): void {
		if (asset.status === 'ready') this.gl.deleteTexture(asset.texture)
		// A placeholder created after `dispose` would otherwise leak.
		else if (this.disposed) this.deletePlaceholder()
	}

	private deletePlaceholder(): void {
		if (this.placeholder) this.gl.deleteTexture(this.placeholder)
		this.placeholder = null
	}

	private async loadFresh(hash: string): Promise<ImageAsset> {
		try {
			return await this.loadImage(hash)
		} catch (error) {
			const code = error instanceof AssetError ? error.code : 'decode-failed'
			const issue = this.report(hash, code, 'error', describe(error))
			this.placeholder ??= createPlaceholderTexture(this.gl)
			return {
				hash,
				status: 'placeholder',
				texture: this.placeholder,
				width: PLACEHOLDER_SIZE,
				height: PLACEHOLDER_SIZE,
				naturalWidth: PLACEHOLDER_SIZE,
				naturalHeight: PLACEHOLDER_SIZE,
				format: null,
				scale: 1,
				issue,
			}
		}
	}

	private async loadImage(hash: string): Promise<ImageAsset> {
		if (!isContentHash(hash)) {
			throw new AssetError('invalid-hash', 'not a 64-character lowercase hex SHA-256')
		}
		let bytes: Uint8Array | null
		try {
			bytes = await this.source.read(hash)
		} catch (error) {
			throw new AssetError('source-failed', `the asset source failed: ${describe(error)}`)
		}
		if (bytes === null) throw new AssetError('not-found', 'the asset source has no such asset')
		const actual = await hashBytes(bytes)
		if (actual !== hash) throw new AssetError('hash-mismatch', `the bytes hash to ${actual}`)

		const header = sniffImage(bytes)
		if (!header) {
			throw new AssetError(
				'unsupported-format',
				'not a PNG, JPEG or WebP image, or its header is truncated'
			)
		}
		const pixels = header.width * header.height
		if (pixels > this.maxPixels) {
			throw new AssetError(
				'too-large',
				`${header.width}×${header.height} has more than ${this.maxPixels} pixels`
			)
		}

		let image: DecodedImage
		try {
			image = await this.decoder.decode(bytes, header.format)
		} catch (error) {
			throw new AssetError('decode-failed', `could not decode the image: ${describe(error)}`)
		}
		try {
			const naturalWidth = image.width
			const naturalHeight = image.height
			const fit = fitToLimit(naturalWidth, naturalHeight, this.maxTextureSize)
			let issue: AssetIssue | undefined
			if (fit.scale < 1) {
				const resized = await this.decoder.resize(image, fit.width, fit.height)
				image.close()
				image = resized
				issue = this.report(
					hash,
					'downscaled',
					'warning',
					`${naturalWidth}×${naturalHeight} was downscaled to ${fit.width}×${fit.height} to fit the ${this.maxTextureSize} px texture limit`
				)
			}
			const texture = uploadImageTexture(this.gl, image)
			return {
				hash,
				status: 'ready',
				texture,
				width: image.width,
				height: image.height,
				naturalWidth,
				naturalHeight,
				format: header.format,
				scale: fit.scale,
				...(issue ? { issue } : {}),
			}
		} finally {
			image.close()
		}
	}

	private report(
		hash: string,
		code: AssetIssueCode,
		severity: AssetIssue['severity'],
		message: string
	): AssetIssue {
		const issue: AssetIssue = { hash, code, severity, message }
		if (this.options.onIssue) this.options.onIssue(issue)
		else console.warn(`[assets] ${severity} ${code} (${hash}): ${message}`)
		return issue
	}
}
