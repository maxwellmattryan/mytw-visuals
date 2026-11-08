/**
 * The slice of WebGL2 the engine uses, so tests can supply a typed fake.
 */
export type EngineGL = Pick<
	WebGL2RenderingContext,
	// methods
	| 'activeTexture'
	| 'attachShader'
	| 'bindBuffer'
	| 'bindFramebuffer'
	| 'bindTexture'
	| 'bindVertexArray'
	| 'blendEquation'
	| 'blendFunc'
	| 'bufferData'
	| 'clear'
	| 'clearColor'
	| 'compileShader'
	| 'createBuffer'
	| 'createFramebuffer'
	| 'createProgram'
	| 'createShader'
	| 'createTexture'
	| 'createVertexArray'
	| 'deleteBuffer'
	| 'deleteFramebuffer'
	| 'deleteProgram'
	| 'deleteShader'
	| 'deleteTexture'
	| 'deleteVertexArray'
	| 'disable'
	| 'drawArrays'
	| 'enable'
	| 'enableVertexAttribArray'
	| 'framebufferTexture2D'
	| 'getActiveUniform'
	| 'getProgramInfoLog'
	| 'getProgramParameter'
	| 'getShaderInfoLog'
	| 'getShaderParameter'
	| 'getUniformLocation'
	| 'linkProgram'
	| 'pixelStorei'
	| 'shaderSource'
	| 'texImage2D'
	| 'texParameteri'
	| 'uniform1f'
	| 'uniform1fv'
	| 'uniform1i'
	| 'uniform1iv'
	| 'uniform2f'
	| 'uniform2fv'
	| 'uniform3fv'
	| 'uniform4f'
	| 'uniform4fv'
	| 'uniformMatrix3fv'
	| 'useProgram'
	| 'vertexAttribPointer'
	| 'viewport'
	// constants
	| 'ACTIVE_UNIFORMS'
	| 'ARRAY_BUFFER'
	| 'BLEND'
	| 'BOOL'
	| 'CLAMP_TO_EDGE'
	| 'COLOR_ATTACHMENT0'
	| 'COLOR_BUFFER_BIT'
	| 'COMPILE_STATUS'
	| 'DST_COLOR'
	| 'FLOAT'
	| 'FLOAT_VEC2'
	| 'FLOAT_VEC3'
	| 'FLOAT_VEC4'
	| 'FRAGMENT_SHADER'
	| 'FRAMEBUFFER'
	| 'FUNC_ADD'
	| 'INT'
	| 'LINEAR'
	| 'LINK_STATUS'
	| 'ONE'
	| 'ONE_MINUS_SRC_ALPHA'
	| 'ONE_MINUS_SRC_COLOR'
	| 'RGBA'
	| 'RGBA8'
	| 'SAMPLER_2D'
	| 'STATIC_DRAW'
	| 'TEXTURE0'
	| 'TEXTURE_2D'
	| 'TEXTURE_MAG_FILTER'
	| 'TEXTURE_MIN_FILTER'
	| 'TEXTURE_WRAP_S'
	| 'TEXTURE_WRAP_T'
	| 'TRIANGLE_STRIP'
	| 'UNPACK_FLIP_Y_WEBGL'
	| 'UNPACK_PREMULTIPLY_ALPHA_WEBGL'
	| 'UNSIGNED_BYTE'
	| 'VERTEX_SHADER'
>

export type ContextEventType = 'webglcontextlost' | 'webglcontextrestored'

/** What the renderer needs from a canvas. `HTMLCanvasElement` and `OffscreenCanvas` both fit. */
export interface CanvasLike {
	width: number
	height: number
	getContext(id: 'webgl2', attrs?: WebGLContextAttributes): EngineGL | null
	addEventListener(type: ContextEventType, listener: (e: Event) => void): void
	removeEventListener(type: ContextEventType, listener: (e: Event) => void): void
}

export type EngineErrorCode =
	| 'webgl2-unavailable'
	| 'shader-compile'
	| 'uniform-type'
	| 'unknown-effect'
	| 'unknown-image'
	| 'invalid-size'
	| 'disposed'

export class EngineError extends Error {
	readonly code: EngineErrorCode

	constructor(code: EngineErrorCode, message: string) {
		super(message)
		this.name = 'EngineError'
		this.code = code
	}
}

function compileShader(gl: EngineGL, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)
	if (!shader) throw new EngineError('shader-compile', 'createShader returned null')
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error'
		gl.deleteShader(shader)
		throw new EngineError('shader-compile', log)
	}
	return shader
}

/**
 * Compiles and links a program. The shaders are deleted once linked. A failure
 * throws `EngineError('shader-compile')` with the driver's info log and leaves
 * no GL objects behind.
 */
export function compileProgram(gl: EngineGL, vertex: string, fragment: string): WebGLProgram {
	const vs = compileShader(gl, gl.VERTEX_SHADER, vertex)
	let fs: WebGLShader
	try {
		fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment)
	} catch (err) {
		gl.deleteShader(vs)
		throw err
	}
	const program = gl.createProgram()
	gl.attachShader(program, vs)
	gl.attachShader(program, fs)
	gl.linkProgram(program)
	gl.deleteShader(vs)
	gl.deleteShader(fs)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) ?? 'unknown link error'
		gl.deleteProgram(program)
		throw new EngineError('shader-compile', log)
	}
	return program
}
