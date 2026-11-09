import type { DecodedImage } from './decode'

/**
 * The texture coordinate convention for image textures: (0, 0) is the image's top-left
 * corner and v grows downward, the same as image space. Uploads never flip Y, so a shader
 * samples `texture(image, uv)` with `uv` in image space and needs no Y-flip workaround.
 */
export const IMAGE_TEXTURE_ORIGIN = 'top-left' as const

const MAX_ANISOTROPY = 8
const PLACEHOLDER_SIZE = 64
const PLACEHOLDER_SQUARE = 8

/** Runs `upload` with a fresh texture bound, then restores the caller's binding. */
function withNewTexture(gl: WebGL2RenderingContext, upload: () => void): WebGLTexture {
	const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
	const texture = gl.createTexture()
	gl.bindTexture(gl.TEXTURE_2D, texture)
	try {
		upload()
	} catch (error) {
		gl.deleteTexture(texture)
		throw error
	} finally {
		gl.bindTexture(gl.TEXTURE_2D, previous)
	}
	return texture
}

/**
 * Uploads `image` at its own size as a premultiplied `RGBA8` texture with a full mip chain,
 * linear magnification, trilinear minification, edge clamping and up to 8× anisotropy.
 */
export function uploadImageTexture(gl: WebGL2RenderingContext, image: DecodedImage): WebGLTexture {
	return withNewTexture(gl, () => {
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image.source)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic')
		if (anisotropic) {
			const max = gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number
			gl.texParameterf(
				gl.TEXTURE_2D,
				anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
				Math.min(MAX_ANISOTROPY, max)
			)
		}
		gl.generateMipmap(gl.TEXTURE_2D)
	})
}

/** A 64×64 magenta and black checker (8 px squares) with nearest filtering and no mipmaps. */
export function createPlaceholderTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const pixels = new Uint8Array(PLACEHOLDER_SIZE * PLACEHOLDER_SIZE * 4)
	for (let y = 0; y < PLACEHOLDER_SIZE; y++) {
		for (let x = 0; x < PLACEHOLDER_SIZE; x++) {
			const magenta =
				(Math.floor(x / PLACEHOLDER_SQUARE) + Math.floor(y / PLACEHOLDER_SQUARE)) % 2 === 0
			const i = (y * PLACEHOLDER_SIZE + x) * 4
			pixels[i] = magenta ? 255 : 0
			pixels[i + 1] = 0
			pixels[i + 2] = magenta ? 255 : 0
			pixels[i + 3] = 255
		}
	}
	return withNewTexture(gl, () => {
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			PLACEHOLDER_SIZE,
			PLACEHOLDER_SIZE,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			pixels
		)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	})
}
