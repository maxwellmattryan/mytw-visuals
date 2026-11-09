import { ImageAssets, MemoryAssetSource } from '@mytw/assets'
import type { AssetIssue, ImageAsset } from '@mytw/assets'

// A developer check for @mytw/assets: open an image, zoom it with raw WebGL2 (no p5), force a
// downscale, or load a missing asset to see the placeholder.

const MISSING_HASH = '0'.repeat(64)
const LIMITED_TEXTURE_SIZE = 1024

const VERTEX = `#version 300 es
in vec2 corner;
uniform vec2 scale;
out vec2 uv;
void main() {
	// Image space: (0, 0) is the quad's top-left and v grows downward. No flip.
	uv = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
	gl_Position = vec4(corner * scale, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D image;
out vec4 color;
void main() {
	color = texture(image, uv);
}`

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {},
	children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
	const node = Object.assign(document.createElement(tag), props)
	node.append(...children)
	return node
}

const canvas = element('canvas')
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%'
const fileInput = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' })
const zoom = element('input', { type: 'range', min: '0.1', max: '8', step: '0.1', value: '1' })
const zoomValue = element('span', { textContent: '1.0×' })
const limit = element('input', { type: 'checkbox' })
const missing = element('button', { type: 'button', textContent: 'Load missing asset' })
const status = element('pre', { textContent: 'Open a PNG, JPEG or WebP file.' })
status.style.cssText = 'margin:8px 0 0;white-space:pre-wrap;font:12px ui-monospace,monospace'
const overlay = element('div', {}, [
	element('div', {}, [fileInput]),
	element('label', {}, ['Zoom ', zoom, ' ', zoomValue]),
	element('label', {}, [limit, ` Limit textures to ${LIMITED_TEXTURE_SIZE} px`]),
	missing,
	status,
])
overlay.style.cssText =
	'position:fixed;top:12px;left:12px;max-width:360px;padding:12px;display:grid;gap:8px;' +
	'background:rgba(0,0,0,0.72);color:#eee;font:13px system-ui,sans-serif;border-radius:6px'
document.body.append(canvas, overlay)

const context = canvas.getContext('webgl2', { premultipliedAlpha: true })
if (!context) throw new Error('WebGL2 is not available')
const gl: WebGL2RenderingContext = context

function compile(type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)
	if (!shader) throw new Error('Could not create a shader')
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed')
	}
	return shader
}

const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
gl.linkProgram(program)
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
	throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed')
}
gl.bindVertexArray(gl.createVertexArray())
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
const cornerLocation = gl.getAttribLocation(program, 'corner')
gl.enableVertexAttribArray(cornerLocation)
gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0)
const scaleLocation = gl.getUniformLocation(program, 'scale')
gl.useProgram(program)
gl.uniform1i(gl.getUniformLocation(program, 'image'), 0)
// Textures hold premultiplied alpha.
gl.enable(gl.BLEND)
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

const source = new MemoryAssetSource()
let assets: ImageAssets | null = null
let current: ImageAsset | null = null
let currentHash: string | null = null
let issues: AssetIssue[] = []

function createAssets(): ImageAssets {
	assets?.dispose()
	current = null
	issues = []
	assets = new ImageAssets(gl, source, {
		maxTextureSize: limit.checked ? LIMITED_TEXTURE_SIZE : undefined,
		onIssue: (issue) => {
			issues.push(issue)
			showStatus()
		},
	})
	return assets
}

function showStatus(): void {
	const lines = issues.map((issue) => `${issue.severity} ${issue.code}: ${issue.message}`)
	if (current) {
		lines.push(
			`${current.status} · natural ${current.naturalWidth}×${current.naturalHeight}` +
				` · uploaded ${current.width}×${current.height} · scale ${current.scale.toFixed(3)}`
		)
	}
	status.textContent = lines.join('\n') || 'Loading…'
}

async function show(hash: string, target: ImageAssets): Promise<void> {
	currentHash = hash
	const asset = await target.load(hash)
	// A newer load or a new instance replaced this one while it was loading.
	if (target !== assets || currentHash !== hash) return
	current = asset
	showStatus()
	draw()
}

function draw(): void {
	const ratio = window.devicePixelRatio || 1
	canvas.width = Math.round(canvas.clientWidth * ratio)
	canvas.height = Math.round(canvas.clientHeight * ratio)
	gl.viewport(0, 0, canvas.width, canvas.height)
	gl.clearColor(0.08, 0.08, 0.08, 1)
	gl.clear(gl.COLOR_BUFFER_BIT)
	if (!current) return
	const imageAspect = current.naturalWidth / current.naturalHeight
	const canvasAspect = canvas.width / canvas.height
	const fitX = imageAspect > canvasAspect ? 1 : imageAspect / canvasAspect
	const fitY = imageAspect > canvasAspect ? canvasAspect / imageAspect : 1
	const factor = Number(zoom.value)
	gl.uniform2f(scaleLocation, fitX * factor, fitY * factor)
	gl.activeTexture(gl.TEXTURE0)
	gl.bindTexture(gl.TEXTURE_2D, current.texture)
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

fileInput.addEventListener('change', async () => {
	const file = fileInput.files?.[0]
	if (!file) return
	const hash = await source.add(new Uint8Array(await file.arrayBuffer()))
	await show(hash, createAssets())
})

limit.addEventListener('change', () => {
	if (currentHash) void show(currentHash, createAssets())
})

missing.addEventListener('click', () => {
	void show(MISSING_HASH, createAssets())
})

zoom.addEventListener('input', () => {
	zoomValue.textContent = `${Number(zoom.value).toFixed(1)}×`
	draw()
})

window.addEventListener('resize', draw)
draw()
