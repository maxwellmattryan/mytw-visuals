/**
 * A recording stand-in for WebGL2 and a canvas, for tests. It draws nothing:
 * it hands out unique handles, counts calls per method and records draws,
 * viewports and uniform values. A shader whose source contains `#error` fails
 * to compile with an info log. Active uniforms come from `uniform <type> <name>;`
 * lines in the attached sources.
 */
import type { CanvasLike, ContextEventType, EngineGL } from '../gl'

export class FakeHandle {
	constructor(
		readonly kind: string,
		readonly id: number
	) {}
}

export interface FakeDraw {
	program: WebGLProgram | null
	framebuffer: WebGLFramebuffer | null
	blend: boolean
}

export interface FakeUniformCall {
	program: WebGLProgram | null
	name: string
	method: string
	values: number[]
}

interface FakeUniform {
	name: string
	type: number
}

const TYPES: Record<string, number> = {
	float: 0x1406,
	vec2: 0x8b50,
	vec3: 0x8b51,
	vec4: 0x8b52,
	int: 0x1404,
	bool: 0x8b56,
	mat3: 0x8b5b,
	sampler2D: 0x8b5e,
}

function parseUniforms(source: string): FakeUniform[] {
	const out: FakeUniform[] = []
	for (const match of source.matchAll(/uniform\s+(\w+)\s+(\w+)\s*;/g)) {
		out.push({ type: TYPES[match[1]] ?? 0, name: match[2] })
	}
	return out
}

export class FakeGL implements EngineGL {
	readonly ACTIVE_UNIFORMS = 0x8b86
	readonly ARRAY_BUFFER = 0x8892
	readonly BLEND = 0x0be2
	readonly BOOL = 0x8b56
	readonly CLAMP_TO_EDGE = 0x812f
	readonly COLOR_ATTACHMENT0 = 0x8ce0
	readonly COLOR_BUFFER_BIT = 0x00004000
	readonly COMPILE_STATUS = 0x8b81
	readonly DST_COLOR = 0x0306
	readonly FLOAT = 0x1406
	readonly FLOAT_VEC2 = 0x8b50
	readonly FLOAT_VEC3 = 0x8b51
	readonly FLOAT_VEC4 = 0x8b52
	readonly FRAGMENT_SHADER = 0x8b30
	readonly FRAMEBUFFER = 0x8d40
	readonly FUNC_ADD = 0x8006
	readonly INT = 0x1404
	readonly LINEAR = 0x2601
	readonly LINK_STATUS = 0x8b82
	readonly ONE = 1
	readonly ONE_MINUS_SRC_ALPHA = 0x0303
	readonly ONE_MINUS_SRC_COLOR = 0x0301
	readonly RGBA = 0x1908
	readonly RGBA8 = 0x8058
	readonly SAMPLER_2D = 0x8b5e
	readonly STATIC_DRAW = 0x88e4
	readonly TEXTURE0 = 0x84c0
	readonly TEXTURE_2D = 0x0de1
	readonly TEXTURE_MAG_FILTER = 0x2800
	readonly TEXTURE_MIN_FILTER = 0x2801
	readonly TEXTURE_WRAP_S = 0x2802
	readonly TEXTURE_WRAP_T = 0x2803
	readonly TRIANGLE_STRIP = 0x0005
	readonly UNPACK_FLIP_Y_WEBGL = 0x9240
	readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241
	readonly UNSIGNED_BYTE = 0x1401
	readonly VERTEX_SHADER = 0x8b31

	/** Calls per method name. */
	readonly calls = new Map<string, number>()
	readonly draws: FakeDraw[] = []
	readonly viewports: [number, number, number, number][] = []
	readonly uniforms: FakeUniformCall[] = []

	private nextId = 1
	private shaders = new Map<WebGLShader, { source: string; failed: boolean }>()
	private programs = new Map<
		WebGLProgram,
		{ shaders: WebGLShader[]; uniforms: FakeUniform[]; failed: boolean }
	>()
	private locations = new Map<WebGLUniformLocation, { program: WebGLProgram; name: string }>()
	private program: WebGLProgram | null = null
	private framebuffer: WebGLFramebuffer | null = null
	private blending = false

	/** How many times a method was called. */
	count(method: string): number {
		return this.calls.get(method) ?? 0
	}

	/** Uniform calls for one uniform name, in call order. */
	uniformCalls(name: string): FakeUniformCall[] {
		return this.uniforms.filter((call) => call.name === name)
	}

	private hit(method: string): void {
		this.calls.set(method, this.count(method) + 1)
	}

	private handle(method: string, kind: string): FakeHandle {
		this.hit(method)
		return new FakeHandle(kind, this.nextId++)
	}

	private recordUniform(
		method: string,
		location: WebGLUniformLocation | null,
		values: Iterable<number>
	): void {
		this.hit(method)
		const target = location ? this.locations.get(location) : undefined
		if (!target) return
		this.uniforms.push({
			program: target.program,
			name: target.name,
			method,
			values: Array.from(values),
		})
	}

	// --- creation and deletion -----------------------------------------------

	createBuffer(): WebGLBuffer {
		return this.handle('createBuffer', 'buffer')
	}
	createFramebuffer(): WebGLFramebuffer {
		return this.handle('createFramebuffer', 'framebuffer')
	}
	createTexture(): WebGLTexture {
		return this.handle('createTexture', 'texture')
	}
	createVertexArray(): WebGLVertexArrayObject {
		return this.handle('createVertexArray', 'vertexArray')
	}
	createShader(_type: number): WebGLShader | null {
		const shader = this.handle('createShader', 'shader')
		this.shaders.set(shader, { source: '', failed: false })
		return shader
	}
	createProgram(): WebGLProgram {
		const program = this.handle('createProgram', 'program')
		this.programs.set(program, { shaders: [], uniforms: [], failed: false })
		return program
	}
	deleteBuffer(_buffer: WebGLBuffer | null): void {
		this.hit('deleteBuffer')
	}
	deleteFramebuffer(_framebuffer: WebGLFramebuffer | null): void {
		this.hit('deleteFramebuffer')
	}
	deleteTexture(_texture: WebGLTexture | null): void {
		this.hit('deleteTexture')
	}
	deleteVertexArray(_vertexArray: WebGLVertexArrayObject | null): void {
		this.hit('deleteVertexArray')
	}
	deleteShader(_shader: WebGLShader | null): void {
		this.hit('deleteShader')
	}
	deleteProgram(_program: WebGLProgram | null): void {
		this.hit('deleteProgram')
	}

	// --- shaders and programs ------------------------------------------------

	shaderSource(shader: WebGLShader, source: string): void {
		this.hit('shaderSource')
		const entry = this.shaders.get(shader)
		if (entry) entry.source = source
	}
	compileShader(shader: WebGLShader): void {
		this.hit('compileShader')
		const entry = this.shaders.get(shader)
		if (entry) entry.failed = entry.source.includes('#error')
	}
	getShaderParameter(shader: WebGLShader, _pname: number): boolean {
		this.hit('getShaderParameter')
		return !this.shaders.get(shader)?.failed
	}
	getShaderInfoLog(shader: WebGLShader): string | null {
		this.hit('getShaderInfoLog')
		const entry = this.shaders.get(shader)
		if (!entry?.failed) return ''
		const line = entry.source.split('\n').find((l) => l.includes('#error')) ?? ''
		return `ERROR: 0:1: '${line.trim()}' : compilation terminated`
	}
	attachShader(program: WebGLProgram, shader: WebGLShader): void {
		this.hit('attachShader')
		this.programs.get(program)?.shaders.push(shader)
	}
	linkProgram(program: WebGLProgram): void {
		this.hit('linkProgram')
		const entry = this.programs.get(program)
		if (!entry) return
		const seen = new Set<string>()
		entry.uniforms = []
		for (const shader of entry.shaders) {
			const source = this.shaders.get(shader)
			if (!source) continue
			if (source.failed) entry.failed = true
			for (const uniform of parseUniforms(source.source)) {
				if (seen.has(uniform.name)) continue
				seen.add(uniform.name)
				entry.uniforms.push(uniform)
			}
		}
	}
	getProgramParameter(program: WebGLProgram, pname: number): boolean | number {
		this.hit('getProgramParameter')
		const entry = this.programs.get(program)
		if (pname === this.ACTIVE_UNIFORMS) return entry?.uniforms.length ?? 0
		return !!entry && !entry.failed
	}
	getProgramInfoLog(_program: WebGLProgram): string | null {
		this.hit('getProgramInfoLog')
		return 'link failed'
	}
	getActiveUniform(program: WebGLProgram, index: number): WebGLActiveInfo | null {
		this.hit('getActiveUniform')
		const uniform = this.programs.get(program)?.uniforms[index]
		return uniform ? { name: uniform.name, type: uniform.type, size: 1 } : null
	}
	getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
		this.hit('getUniformLocation')
		const entry = this.programs.get(program)
		if (!entry?.uniforms.some((u) => u.name === name)) return null
		for (const [location, target] of this.locations) {
			if (target.program === program && target.name === name) return location
		}
		const location = new FakeHandle('uniformLocation', this.nextId++)
		this.locations.set(location, { program, name })
		return location
	}
	useProgram(program: WebGLProgram | null): void {
		this.hit('useProgram')
		this.program = program
	}

	// --- uniforms ------------------------------------------------------------

	uniform1f(location: WebGLUniformLocation | null, x: number): void {
		this.recordUniform('uniform1f', location, [x])
	}
	uniform1fv(location: WebGLUniformLocation | null, data: Iterable<number>): void {
		this.recordUniform('uniform1fv', location, data)
	}
	uniform1i(location: WebGLUniformLocation | null, x: number): void {
		this.recordUniform('uniform1i', location, [x])
	}
	uniform1iv(location: WebGLUniformLocation | null, data: Iterable<number>): void {
		this.recordUniform('uniform1iv', location, data)
	}
	uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void {
		this.recordUniform('uniform2f', location, [x, y])
	}
	uniform2fv(location: WebGLUniformLocation | null, data: Iterable<number>): void {
		this.recordUniform('uniform2fv', location, data)
	}
	uniform3fv(location: WebGLUniformLocation | null, data: Iterable<number>): void {
		this.recordUniform('uniform3fv', location, data)
	}
	uniform4f(
		location: WebGLUniformLocation | null,
		x: number,
		y: number,
		z: number,
		w: number
	): void {
		this.recordUniform('uniform4f', location, [x, y, z, w])
	}
	uniform4fv(location: WebGLUniformLocation | null, data: Iterable<number>): void {
		this.recordUniform('uniform4fv', location, data)
	}
	uniformMatrix3fv(
		location: WebGLUniformLocation | null,
		_transpose: boolean,
		data: Iterable<number>
	): void {
		this.recordUniform('uniformMatrix3fv', location, data)
	}

	// --- state and drawing ---------------------------------------------------

	activeTexture(_texture: number): void {
		this.hit('activeTexture')
	}
	bindBuffer(_target: number, _buffer: WebGLBuffer | null): void {
		this.hit('bindBuffer')
	}
	bindFramebuffer(_target: number, framebuffer: WebGLFramebuffer | null): void {
		this.hit('bindFramebuffer')
		this.framebuffer = framebuffer
	}
	bindTexture(_target: number, _texture: WebGLTexture | null): void {
		this.hit('bindTexture')
	}
	bindVertexArray(_array: WebGLVertexArrayObject | null): void {
		this.hit('bindVertexArray')
	}
	blendEquation(_mode: number): void {
		this.hit('blendEquation')
	}
	blendFunc(_src: number, _dst: number): void {
		this.hit('blendFunc')
	}
	bufferData(..._args: unknown[]): void {
		this.hit('bufferData')
	}
	clear(_mask: number): void {
		this.hit('clear')
	}
	clearColor(_r: number, _g: number, _b: number, _a: number): void {
		this.hit('clearColor')
	}
	disable(cap: number): void {
		this.hit('disable')
		if (cap === this.BLEND) this.blending = false
	}
	enable(cap: number): void {
		this.hit('enable')
		if (cap === this.BLEND) this.blending = true
	}
	drawArrays(_mode: number, _first: number, _count: number): void {
		this.hit('drawArrays')
		this.draws.push({ program: this.program, framebuffer: this.framebuffer, blend: this.blending })
	}
	enableVertexAttribArray(_index: number): void {
		this.hit('enableVertexAttribArray')
	}
	framebufferTexture2D(..._args: unknown[]): void {
		this.hit('framebufferTexture2D')
	}
	pixelStorei(_pname: number, _param: number | boolean): void {
		this.hit('pixelStorei')
	}
	texImage2D(..._args: unknown[]): void {
		this.hit('texImage2D')
	}
	texParameteri(_target: number, _pname: number, _param: number): void {
		this.hit('texParameteri')
	}
	vertexAttribPointer(..._args: unknown[]): void {
		this.hit('vertexAttribPointer')
	}
	viewport(x: number, y: number, width: number, height: number): void {
		this.hit('viewport')
		this.viewports.push([x, y, width, height])
	}
}

/** A canvas with no display size that hands out `FakeGL` contexts and fires context events. */
export class FakeCanvas implements CanvasLike {
	width = 300
	height = 150
	gl: FakeGL
	private listeners = new Map<ContextEventType, Set<(e: Event) => void>>()

	constructor(gl: FakeGL = new FakeGL()) {
		this.gl = gl
	}

	getContext(_id: 'webgl2', _attrs?: WebGLContextAttributes): FakeGL {
		return this.gl
	}

	addEventListener(type: ContextEventType, listener: (e: Event) => void): void {
		const set = this.listeners.get(type) ?? new Set()
		set.add(listener)
		this.listeners.set(type, set)
	}

	removeEventListener(type: ContextEventType, listener: (e: Event) => void): void {
		this.listeners.get(type)?.delete(listener)
	}

	/** Listeners currently registered, across both event types. */
	listenerCount(): number {
		let n = 0
		for (const set of this.listeners.values()) n += set.size
		return n
	}

	/** Fires `webglcontextlost` and returns the event, whose `defaultPrevented` shows `preventDefault` was called. */
	loseContext(): Event {
		return this.dispatch('webglcontextlost')
	}

	/** Swaps in a fresh context and fires `webglcontextrestored`. */
	restore(): FakeGL {
		this.gl = new FakeGL()
		this.dispatch('webglcontextrestored')
		return this.gl
	}

	private dispatch(type: ContextEventType): Event {
		const event = new Event(type, { cancelable: true })
		for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
		return event
	}
}
