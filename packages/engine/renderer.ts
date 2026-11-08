import { BLEND_STATES } from './blend'
import { compileProgram, EngineError } from './gl'
import type { CanvasLike, EngineGL } from './gl'
import { isDrawable, isEnabled, planFrame } from './plan'
import type { Pass, PassTarget } from './plan'
import { FramebufferPool } from './pool'
import { COMPOSITE_FRAGMENT, LAYER_FRAGMENT, MASK_KIND, PRESENT_FRAGMENT, VERTEX } from './shaders'
import { layerToSourceMatrix } from './transform'
import type { Size } from './transform'
import type {
	BlendMode,
	EffectInstance,
	EffectProgram,
	Mask,
	RenderFrame,
	Renderer,
	RendererOptions,
	UniformValue,
} from './types'

interface MaskLocations {
	kind: WebGLUniformLocation | null
	params: WebGLUniformLocation | null
	invert: WebGLUniformLocation | null
	channel: WebGLUniformLocation | null
	aspect: WebGLUniformLocation | null
}

interface Builtins {
	layer: {
		program: WebGLProgram
		srcMatrix: WebGLUniformLocation | null
		feather: WebGLUniformLocation | null
		opacity: WebGLUniformLocation | null
		applyMask: WebGLUniformLocation | null
		mask: MaskLocations
	}
	composite: {
		program: WebGLProgram
		opacity: WebGLUniformLocation | null
		mask: MaskLocations
	}
	present: WebGLProgram
	quad: WebGLBuffer
	vao: WebGLVertexArrayObject
}

interface UniformInfo {
	location: WebGLUniformLocation
	type: number
	size: number
}

interface CompiledEffect {
	program: WebGLProgram
	/** Active uniforms by name, with any `[0]` array suffix removed. */
	uniforms: Map<string, UniformInfo>
	resolution: WebGLUniformLocation | null
}

interface EffectEntry {
	fragment: string
	/** `null` while registered during a context loss, until the restore compiles it. */
	compiled: CompiledEffect | null
}

interface ImageEntry extends Size {
	source: TexImageSource
	/** `null` until uploaded, and while the context is lost. */
	texture: WebGLTexture | null
}

function contextAttributes(options: RendererOptions): WebGLContextAttributes {
	return {
		alpha: false,
		premultipliedAlpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
	}
}

/**
 * Creates a renderer drawing into `canvas` at a fixed output resolution. Throws
 * `EngineError('webgl2-unavailable')` without WebGL2.
 */
export function createRenderer(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	options: RendererOptions
): Renderer {
	const target: CanvasLike = canvas
	const gl = target.getContext('webgl2', contextAttributes(options))
	if (!gl) throw new EngineError('webgl2-unavailable', 'WebGL2 is not available')
	return createRendererFromContext(target, gl, options)
}

function checkSize(width: number, height: number): void {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
		throw new EngineError(
			'invalid-size',
			`Output size must be positive integers, got ${width}x${height}`
		)
	}
}

/** The pixel size of an image source, used for its aspect ratio. */
function sourceSize(source: TexImageSource): Size {
	if ('naturalWidth' in source) return { width: source.naturalWidth, height: source.naturalHeight }
	if ('videoWidth' in source) return { width: source.videoWidth, height: source.videoHeight }
	if ('displayWidth' in source) return { width: source.displayWidth, height: source.displayHeight }
	return { width: source.width, height: source.height }
}

function componentCount(gl: EngineGL, type: number): number {
	switch (type) {
		case gl.FLOAT:
		case gl.INT:
		case gl.BOOL:
			return 1
		case gl.FLOAT_VEC2:
			return 2
		case gl.FLOAT_VEC3:
			return 3
		case gl.FLOAT_VEC4:
			return 4
		default:
			return 0
	}
}

function valueLength(value: UniformValue): number {
	return typeof value === 'number' || typeof value === 'boolean' ? 1 : value.length
}

function scalar(value: UniformValue): number {
	if (typeof value === 'number') return value
	if (typeof value === 'boolean') return value ? 1 : 0
	return value[0] ?? 0
}

function buildMaskLocations(gl: EngineGL, program: WebGLProgram): MaskLocations {
	return {
		kind: gl.getUniformLocation(program, 'uMaskKind'),
		params: gl.getUniformLocation(program, 'uMaskParams'),
		invert: gl.getUniformLocation(program, 'uMaskInvert'),
		channel: gl.getUniformLocation(program, 'uMaskChannel'),
		aspect: gl.getUniformLocation(program, 'uAspect'),
	}
}

function buildBuiltins(gl: EngineGL): Builtins {
	const quad = gl.createBuffer()
	gl.bindBuffer(gl.ARRAY_BUFFER, quad)
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
	const vao = gl.createVertexArray()
	gl.bindVertexArray(vao)
	gl.enableVertexAttribArray(0)
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
	gl.bindVertexArray(null)

	const layer = compileProgram(gl, VERTEX, LAYER_FRAGMENT)
	gl.useProgram(layer)
	gl.uniform1i(gl.getUniformLocation(layer, 'uImage'), 0)
	gl.uniform1i(gl.getUniformLocation(layer, 'uMaskImage'), 1)

	const composite = compileProgram(gl, VERTEX, COMPOSITE_FRAGMENT)
	gl.useProgram(composite)
	gl.uniform1i(gl.getUniformLocation(composite, 'uInput'), 0)
	gl.uniform1i(gl.getUniformLocation(composite, 'uMaskImage'), 1)

	const present = compileProgram(gl, VERTEX, PRESENT_FRAGMENT)
	gl.useProgram(present)
	gl.uniform1i(gl.getUniformLocation(present, 'uInput'), 0)
	gl.uniform1f(gl.getUniformLocation(present, 'uFlipY'), 1)

	return {
		layer: {
			program: layer,
			srcMatrix: gl.getUniformLocation(layer, 'uSrcMatrix'),
			feather: gl.getUniformLocation(layer, 'uFeather'),
			opacity: gl.getUniformLocation(layer, 'uOpacity'),
			applyMask: gl.getUniformLocation(layer, 'uApplyMask'),
			mask: buildMaskLocations(gl, layer),
		},
		composite: {
			program: composite,
			opacity: gl.getUniformLocation(composite, 'uOpacity'),
			mask: buildMaskLocations(gl, composite),
		},
		present,
		quad,
		vao,
	}
}

function compileEffect(gl: EngineGL, fragment: string): CompiledEffect {
	const program = compileProgram(gl, VERTEX, fragment)
	const uniforms = new Map<string, UniformInfo>()
	const count: number = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
	for (let i = 0; i < count; i++) {
		const info = gl.getActiveUniform(program, i)
		if (!info) continue
		const location = gl.getUniformLocation(program, info.name)
		if (!location) continue
		uniforms.set(info.name.replace(/\[0\]$/, ''), { location, type: info.type, size: info.size })
	}
	gl.useProgram(program)
	const input = uniforms.get('uInput')
	if (input) gl.uniform1i(input.location, 0)
	return { program, uniforms, resolution: uniforms.get('uResolution')?.location ?? null }
}

/**
 * Creates a renderer from a canvas and a context already obtained from it.
 * `createRenderer` calls this; tests call it with a fake context.
 */
export function createRendererFromContext(
	canvas: CanvasLike,
	initialGl: EngineGL,
	options: RendererOptions
): Renderer {
	const attributes = contextAttributes(options)
	let gl = initialGl
	checkSize(options.width, options.height)
	let width = options.width
	let height = options.height
	canvas.width = width
	canvas.height = height

	let lost = false
	let disposed = false
	const images = new Map<string, ImageEntry>()
	const effects = new Map<string, EffectEntry>()
	const restoredListeners = new Set<() => void>()
	const pool = new FramebufferPool(gl)
	let builtins = buildBuiltins(gl)

	// Scratch storage reused every frame.
	const matrix = new Float32Array(9)
	const floatScratch = new Map<number, Float32Array>()
	const intScratch = new Map<number, Int32Array>()

	function floats(value: UniformValue, length: number): Float32Array {
		let out = floatScratch.get(length)
		if (!out) {
			out = new Float32Array(length)
			floatScratch.set(length, out)
		}
		if (typeof value === 'number' || typeof value === 'boolean') out[0] = scalar(value)
		else for (let i = 0; i < length; i++) out[i] = value[i] ?? 0
		return out
	}

	function ints(value: UniformValue, length: number): Int32Array {
		let out = intScratch.get(length)
		if (!out) {
			out = new Int32Array(length)
			intScratch.set(length, out)
		}
		if (typeof value === 'number' || typeof value === 'boolean') out[0] = scalar(value)
		else for (let i = 0; i < length; i++) out[i] = value[i] ?? 0
		return out
	}

	function assertLive(operation: string): void {
		if (disposed) throw new EngineError('disposed', `${operation} called after dispose`)
	}

	function upload(entry: ImageEntry): void {
		if (!entry.texture) {
			entry.texture = gl.createTexture()
			gl.bindTexture(gl.TEXTURE_2D, entry.texture)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		} else {
			gl.bindTexture(gl.TEXTURE_2D, entry.texture)
		}
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.source)
	}

	function imageTexture(id: string, where: string): WebGLTexture {
		const texture = images.get(id)?.texture
		if (!texture) throw new EngineError('unknown-image', `${where}: unknown image "${id}"`)
		return texture
	}

	function compiledEffect(id: string, where: string): CompiledEffect {
		const compiled = effects.get(id)?.compiled
		if (!compiled) throw new EngineError('unknown-effect', `${where}: unknown effect "${id}"`)
		return compiled
	}

	// --- validation (runs before any draw call) ------------------------------

	function validateEffect(instance: EffectInstance, where: string): void {
		const compiled = compiledEffect(instance.effect, where)
		const uniforms = instance.uniforms
		for (const name in uniforms) {
			const info = compiled.uniforms.get(name)
			if (!info) continue
			const expected = componentCount(gl, info.type) * info.size
			const actual = valueLength(uniforms[name])
			if (expected === 0) {
				throw new EngineError('uniform-type', `${where}: uniform "${name}" has an unsupported type`)
			}
			if (actual !== expected) {
				throw new EngineError(
					'uniform-type',
					`${where}: uniform "${name}" needs ${expected} value(s), got ${actual}`
				)
			}
		}
		const textures = instance.textures
		for (const name in textures) imageTexture(textures[name], `${where} texture "${name}"`)
	}

	function validate(frame: RenderFrame): void {
		for (let i = 0; i < frame.layers.length; i++) {
			const layer = frame.layers[i]
			if (!isDrawable(layer)) continue
			const where = `layer ${i} ("${layer.id}")`
			imageTexture(layer.image, where)
			if (layer.mask?.kind === 'image') imageTexture(layer.mask.image, `${where} mask`)
			const layerEffects = layer.effects ?? []
			for (let e = 0; e < layerEffects.length; e++) {
				if (isEnabled(layerEffects[e])) validateEffect(layerEffects[e], `${where} effect ${e}`)
			}
		}
		const globalEffects = frame.effects ?? []
		for (let e = 0; e < globalEffects.length; e++) {
			if (isEnabled(globalEffects[e])) validateEffect(globalEffects[e], `global effect ${e}`)
		}
	}

	// --- passes --------------------------------------------------------------

	function bindTarget(target: PassTarget): void {
		const framebuffer =
			target.kind === 'canvas' ? null : pool.acquire(target.slot, width, height).framebuffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
	}

	function bindInput(slot: number): void {
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D, pool.acquire(slot, width, height).texture)
	}

	function setBlend(mode: BlendMode | null): void {
		if (mode === null) {
			gl.disable(gl.BLEND)
			return
		}
		const state = BLEND_STATES[mode]
		gl.enable(gl.BLEND)
		gl.blendEquation(gl.FUNC_ADD)
		gl.blendFunc(gl[state.src], gl[state.dst])
	}

	function setMask(locations: MaskLocations, mask: Mask | undefined): void {
		if (!mask) {
			gl.uniform1i(locations.kind, MASK_KIND.none)
			return
		}
		gl.uniform1i(locations.kind, MASK_KIND[mask.kind])
		gl.uniform1f(locations.invert, mask.invert ? 1 : 0)
		switch (mask.kind) {
			case 'linear':
				gl.uniform4f(locations.params, mask.from[0], mask.from[1], mask.to[0], mask.to[1])
				break
			case 'radial':
				gl.uniform1f(locations.aspect, width / height)
				gl.uniform4f(locations.params, mask.center[0], mask.center[1], mask.inner, mask.outer)
				break
			case 'image':
				gl.activeTexture(gl.TEXTURE0 + 1)
				gl.bindTexture(gl.TEXTURE_2D, imageTexture(mask.image, 'mask'))
				gl.uniform1i(locations.channel, mask.channel === 'alpha' ? 1 : 0)
				break
		}
	}

	function opacityOf(value: number | undefined): number {
		return Math.min(1, Math.max(0, value ?? 1))
	}

	function setEffectUniforms(compiled: CompiledEffect, instance: EffectInstance): void {
		if (compiled.resolution) gl.uniform2f(compiled.resolution, width, height)
		const uniforms = instance.uniforms
		for (const name in uniforms) {
			const info = compiled.uniforms.get(name)
			if (!info) continue
			const value = uniforms[name]
			const length = componentCount(gl, info.type) * info.size
			switch (info.type) {
				case gl.INT:
				case gl.BOOL:
					if (info.size === 1) gl.uniform1i(info.location, scalar(value))
					else gl.uniform1iv(info.location, ints(value, length))
					break
				case gl.FLOAT:
					if (info.size === 1) gl.uniform1f(info.location, scalar(value))
					else gl.uniform1fv(info.location, floats(value, length))
					break
				case gl.FLOAT_VEC2:
					gl.uniform2fv(info.location, floats(value, length))
					break
				case gl.FLOAT_VEC3:
					gl.uniform3fv(info.location, floats(value, length))
					break
				case gl.FLOAT_VEC4:
					gl.uniform4fv(info.location, floats(value, length))
					break
			}
		}
		const textures = instance.textures
		let unit = 1
		for (const name in textures) {
			const info = compiled.uniforms.get(name)
			if (!info || info.type !== gl.SAMPLER_2D) continue
			gl.activeTexture(gl.TEXTURE0 + unit)
			gl.bindTexture(gl.TEXTURE_2D, imageTexture(textures[name], name))
			gl.uniform1i(info.location, unit)
			unit++
		}
	}

	function draw(): void {
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
	}

	function runPass(pass: Pass, frame: RenderFrame): void {
		switch (pass.kind) {
			case 'clear': {
				bindTarget(pass.target)
				gl.clearColor(pass.color[0], pass.color[1], pass.color[2], pass.color[3])
				gl.clear(gl.COLOR_BUFFER_BIT)
				return
			}
			case 'layer': {
				const layer = frame.layers[pass.layer]
				const image = images.get(layer.image)
				if (!image) return
				const program = builtins.layer
				bindTarget(pass.target)
				if (pass.direct) {
					setBlend(layer.blend ?? 'normal')
				} else {
					gl.clearColor(0, 0, 0, 0)
					gl.clear(gl.COLOR_BUFFER_BIT)
					setBlend(null)
				}
				gl.useProgram(program.program)
				gl.activeTexture(gl.TEXTURE0)
				gl.bindTexture(gl.TEXTURE_2D, image.texture)
				layerToSourceMatrix(layer.transform, { width, height }, image, matrix)
				gl.uniformMatrix3fv(program.srcMatrix, false, matrix)
				gl.uniform1f(program.feather, layer.edgeFeather ?? 0)
				gl.uniform1f(program.applyMask, pass.direct ? 1 : 0)
				if (pass.direct) {
					gl.uniform1f(program.opacity, opacityOf(layer.opacity))
					setMask(program.mask, layer.mask)
				}
				draw()
				return
			}
			case 'effect': {
				const list = pass.layer === null ? frame.effects : frame.layers[pass.layer].effects
				const instance = list?.[pass.effect]
				if (!instance) return
				const compiled = compiledEffect(instance.effect, 'effect')
				bindTarget(pass.target)
				setBlend(null)
				gl.useProgram(compiled.program)
				bindInput(pass.input)
				setEffectUniforms(compiled, instance)
				draw()
				return
			}
			case 'composite': {
				const layer = frame.layers[pass.layer]
				const program = builtins.composite
				bindTarget(pass.target)
				setBlend(layer.blend ?? 'normal')
				gl.useProgram(program.program)
				bindInput(pass.input)
				gl.uniform1f(program.opacity, opacityOf(layer.opacity))
				setMask(program.mask, layer.mask)
				draw()
				return
			}
			case 'present': {
				bindTarget(pass.target)
				setBlend(null)
				gl.useProgram(builtins.present)
				bindInput(pass.input)
				draw()
				return
			}
		}
	}

	// --- context loss --------------------------------------------------------

	const onContextLost = (event: Event): void => {
		event.preventDefault()
		lost = true
		for (const entry of images.values()) entry.texture = null
		for (const entry of effects.values()) entry.compiled = null
	}

	const onContextRestored = (): void => {
		gl = canvas.getContext('webgl2', attributes) ?? gl
		// The old handles died with the context, so drop them without deleting.
		pool.reset(gl)
		builtins = buildBuiltins(gl)
		for (const entry of images.values()) {
			entry.texture = null
			upload(entry)
		}
		for (const [id, entry] of effects) {
			try {
				entry.compiled = compileEffect(gl, entry.fragment)
			} catch (err) {
				effects.delete(id)
				console.error(`@mytw/engine: effect "${id}" failed to compile after restore`, err)
			}
		}
		lost = false
		for (const listener of [...restoredListeners]) listener()
	}

	canvas.addEventListener('webglcontextlost', onContextLost)
	canvas.addEventListener('webglcontextrestored', onContextRestored)

	return {
		get width() {
			return width
		},
		get height() {
			return height
		},
		get contextLost() {
			return lost
		},

		setSize(w, h) {
			assertLive('setSize')
			checkSize(w, h)
			width = w
			height = h
			canvas.width = w
			canvas.height = h
			if (!lost) pool.resize(w, h)
		},

		setImage(id, source) {
			assertLive('setImage')
			const size = sourceSize(source)
			const entry = images.get(id) ?? { source, width: 1, height: 1, texture: null }
			entry.source = source
			entry.width = size.width || 1
			entry.height = size.height || 1
			images.set(id, entry)
			if (!lost) upload(entry)
		},

		deleteImage(id) {
			const entry = images.get(id)
			if (!entry) return
			if (entry.texture && !lost && !disposed) gl.deleteTexture(entry.texture)
			images.delete(id)
		},

		registerEffect({ id, fragment }: EffectProgram) {
			assertLive('registerEffect')
			if (lost) {
				effects.set(id, { fragment, compiled: null })
				return
			}
			const compiled = compileEffect(gl, fragment)
			const previous = effects.get(id)?.compiled
			if (previous) gl.deleteProgram(previous.program)
			effects.set(id, { fragment, compiled })
		},

		render(frame) {
			assertLive('render')
			// The driver reports a loss at once; the event that sets `lost` comes later.
			if (lost || gl.isContextLost()) return false
			validate(frame)
			const plan = planFrame(frame)
			for (let slot = 0; slot < plan.buffers; slot++) pool.acquire(slot, width, height)
			gl.viewport(0, 0, width, height)
			gl.bindVertexArray(builtins.vao)
			for (const pass of plan.passes) runPass(pass, frame)
			gl.bindVertexArray(null)
			return true
		},

		onRestored(cb) {
			restoredListeners.add(cb)
			return () => {
				restoredListeners.delete(cb)
			}
		},

		dispose() {
			if (disposed) return
			disposed = true
			canvas.removeEventListener('webglcontextlost', onContextLost)
			canvas.removeEventListener('webglcontextrestored', onContextRestored)
			if (!lost) {
				for (const entry of images.values()) if (entry.texture) gl.deleteTexture(entry.texture)
				for (const entry of effects.values()) {
					if (entry.compiled) gl.deleteProgram(entry.compiled.program)
				}
				gl.deleteProgram(builtins.layer.program)
				gl.deleteProgram(builtins.composite.program)
				gl.deleteProgram(builtins.present)
				gl.deleteBuffer(builtins.quad)
				gl.deleteVertexArray(builtins.vao)
				pool.dispose()
			}
			images.clear()
			effects.clear()
			restoredListeners.clear()
		},
	}
}
