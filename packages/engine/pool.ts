import type { EngineGL } from './gl'

export interface PooledBuffer {
	texture: WebGLTexture
	framebuffer: WebGLFramebuffer
	width: number
	height: number
}

/**
 * Output-size RGBA8 render targets, one per plan slot. Slots persist across
 * frames, so rendering an unchanged frame again creates no GL objects.
 */
export class FramebufferPool {
	private slots: (PooledBuffer | undefined)[] = []

	constructor(private gl: EngineGL) {}

	/** Returns the buffer for a slot, creating or replacing it if its size differs. */
	acquire(slot: number, width: number, height: number): PooledBuffer {
		const existing = this.slots[slot]
		if (existing && existing.width === width && existing.height === height) return existing
		if (existing) this.free(existing)
		const created = this.create(width, height)
		this.slots[slot] = created
		return created
	}

	/** Frees the buffers whose size no longer matches. */
	resize(width: number, height: number): void {
		this.slots.forEach((entry, i) => {
			if (entry && (entry.width !== width || entry.height !== height)) {
				this.free(entry)
				this.slots[i] = undefined
			}
		})
	}

	/** Forgets every buffer without deleting it, for a restored context whose handles are stale. */
	reset(gl: EngineGL): void {
		this.gl = gl
		this.slots = []
	}

	dispose(): void {
		for (const entry of this.slots) if (entry) this.free(entry)
		this.slots = []
	}

	private create(width: number, height: number): PooledBuffer {
		const gl = this.gl
		const texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		const framebuffer = gl.createFramebuffer()
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
		return { texture, framebuffer, width, height }
	}

	private free(entry: PooledBuffer): void {
		this.gl.deleteFramebuffer(entry.framebuffer)
		this.gl.deleteTexture(entry.texture)
	}
}
