import { describe, expect, it, jest } from '@jest/globals'

import { createRendererFromContext, EngineError } from '@mytw/engine'
import type { EngineErrorCode, RenderFrame, RendererOptions } from '@mytw/engine'

import { FakeCanvas } from '../testing/fake-gl'
import type { FakeGL } from '../testing/fake-gl'

const RESOURCE_KINDS = ['Texture', 'Framebuffer', 'Program', 'Shader', 'Buffer', 'VertexArray']

function image(width = 4, height = 4): ImageData {
	return { width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }
}

function effectSource(declarations = ''): string {
	return `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
${declarations}
out vec4 outColor;
void main() { outColor = texture(uInput, vUv); }
`
}

function setup(options: RendererOptions = { width: 64, height: 32 }) {
	const canvas = new FakeCanvas()
	const renderer = createRendererFromContext(canvas, canvas.gl, options)
	return { canvas, gl: canvas.gl, renderer }
}

function creates(gl: FakeGL): number[] {
	return RESOURCE_KINDS.map((kind) => gl.count(`create${kind}`))
}

function expectEngineError(fn: () => unknown, code: EngineErrorCode, ...fragments: string[]) {
	let caught: unknown
	try {
		fn()
	} catch (err) {
		caught = err
	}
	expect(caught).toBeInstanceOf(EngineError)
	if (!(caught instanceof EngineError)) return
	expect(caught.code).toBe(code)
	for (const fragment of fragments) expect(caught.message).toContain(fragment)
}

const TWO_LAYERS: RenderFrame = {
	layers: [
		{ id: 'base', image: 'img', transform: { zoom: 2 } },
		{ id: 'ghost', image: 'img', transform: { mirrorX: true, zoom: 3 }, blend: 'multiply' },
	],
}

describe('renderer', () => {
	it('shares one texture between layers', () => {
		const { gl, renderer } = setup()
		const before = { textures: gl.count('createTexture'), uploads: gl.count('texImage2D') }
		renderer.setImage('img', image())
		expect(gl.count('createTexture') - before.textures).toBe(1)
		expect(gl.count('texImage2D') - before.uploads).toBe(1)

		const uploads = gl.count('texImage2D')
		const framebuffers = gl.count('createFramebuffer')
		expect(renderer.render(TWO_LAYERS)).toBe(true)
		// The only uploads during render are the pooled buffers' storage.
		expect(gl.count('texImage2D') - uploads).toBe(gl.count('createFramebuffer') - framebuffers)

		const matrices = gl.uniformCalls('uSrcMatrix').map((call) => call.values)
		expect(matrices).toHaveLength(2)
		expect(matrices[0]).not.toEqual(matrices[1])
	})

	it('reuses pooled framebuffers', () => {
		const { gl, renderer } = setup()
		renderer.setImage('img', image())
		renderer.registerEffect({ id: 'fx', fragment: effectSource() })
		const frame: RenderFrame = {
			layers: [{ ...TWO_LAYERS.layers[0], effects: [{ effect: 'fx' }, { effect: 'fx' }] }],
			effects: [{ effect: 'fx' }],
		}
		renderer.render(frame)
		const after = creates(gl)
		const draws = gl.draws.length
		renderer.render(frame)
		expect(creates(gl)).toEqual(after)
		expect(gl.draws.length - draws).toBe(draws)
	})

	it('setSize resizes canvas and pool', () => {
		const { canvas, gl, renderer } = setup()
		renderer.setImage('img', image())
		renderer.registerEffect({ id: 'fx', fragment: effectSource() })
		renderer.render({ layers: TWO_LAYERS.layers, effects: [{ effect: 'fx' }] })
		const framebuffers = gl.count('createFramebuffer')
		expect(framebuffers).toBe(2)
		const textureDeletes = gl.count('deleteTexture')

		renderer.setSize(128, 64)
		expect(canvas.width).toBe(128)
		expect(canvas.height).toBe(64)
		expect(renderer.width).toBe(128)
		expect(gl.count('deleteFramebuffer')).toBe(framebuffers)
		expect(gl.count('deleteTexture') - textureDeletes).toBe(framebuffers)

		renderer.render(TWO_LAYERS)
		expect(gl.viewports.at(-1)).toEqual([0, 0, 128, 64])
	})

	it('renders at output size', () => {
		const { canvas, gl, renderer } = setup({ width: 1080, height: 1920 })
		expect(canvas.width).toBe(1080)
		expect(canvas.height).toBe(1920)
		expect('clientWidth' in canvas).toBe(false)
		renderer.setImage('img', image())
		renderer.render(TWO_LAYERS)
		expect(gl.viewports.at(-1)).toEqual([0, 0, 1080, 1920])
	})

	it('recovers from context loss', () => {
		const { canvas, gl, renderer } = setup()
		renderer.setImage('img', image())
		renderer.registerEffect({ id: 'fx', fragment: effectSource() })
		const restored = jest.fn()
		renderer.onRestored(restored)

		// Before the browser fires the event, the driver already reports the loss.
		canvas.loseContext(false)
		const draws = gl.draws.length
		expect(renderer.render(TWO_LAYERS)).toBe(false)
		expect(gl.draws.length).toBe(draws)

		const event = canvas.loseContext()
		expect(event?.defaultPrevented).toBe(true)
		expect(renderer.contextLost).toBe(true)
		expect(renderer.render(TWO_LAYERS)).toBe(false)
		expect(gl.draws.length).toBe(draws)

		renderer.setImage('late', image(8, 2))
		renderer.registerEffect({ id: 'late-fx', fragment: effectSource() })
		expect(restored).not.toHaveBeenCalled()

		const fresh = canvas.restore()
		expect(renderer.contextLost).toBe(false)
		expect(restored).toHaveBeenCalledTimes(1)
		// Three built-in programs plus the two registered effects.
		expect(fresh.count('createProgram')).toBe(5)
		expect(fresh.count('texImage2D')).toBe(2)

		const frame: RenderFrame = {
			layers: [
				{ id: 'a', image: 'img', effects: [{ effect: 'fx' }] },
				{ id: 'b', image: 'late' },
			],
			effects: [{ effect: 'late-fx' }],
		}
		expect(renderer.render(frame)).toBe(true)
		expect(fresh.draws.length).toBeGreaterThan(0)
		expect(gl.draws.length).toBe(draws)
	})

	it('dispose releases every GPU resource', () => {
		const { canvas, gl, renderer } = setup()
		renderer.setImage('img', image())
		renderer.setImage('mask', image())
		renderer.registerEffect({ id: 'fx', fragment: effectSource() })
		renderer.registerEffect({ id: 'fx', fragment: effectSource('uniform float uAmount;') })
		renderer.render({
			layers: [
				{ id: 'a', image: 'img', effects: [{ effect: 'fx' }, { effect: 'fx' }] },
				{ id: 'b', image: 'img', mask: { kind: 'image', image: 'mask' } },
			],
			effects: [{ effect: 'fx' }, { effect: 'fx' }],
		})
		renderer.setSize(32, 32)
		renderer.render(TWO_LAYERS)
		expect(canvas.listenerCount()).toBe(2)

		renderer.dispose()
		for (const kind of RESOURCE_KINDS) {
			expect([kind, gl.count(`delete${kind}`)]).toEqual([kind, gl.count(`create${kind}`)])
		}
		expect(canvas.listenerCount()).toBe(0)

		const calls = new Map(gl.calls)
		renderer.dispose()
		expect(gl.calls).toEqual(calls)

		expectEngineError(() => renderer.render(TWO_LAYERS), 'disposed')
		expectEngineError(() => renderer.setImage('img', image()), 'disposed')
		expectEngineError(
			() => renderer.registerEffect({ id: 'x', fragment: effectSource() }),
			'disposed'
		)
		expectEngineError(() => renderer.setSize(8, 8), 'disposed')
	})

	describe('effect errors', () => {
		const cases: [
			string,
			(r: ReturnType<typeof setup>['renderer']) => unknown,
			EngineErrorCode,
			string[],
		][] = [
			[
				'compile failure',
				(r) => r.registerEffect({ id: 'bad', fragment: effectSource('#error broken') }),
				'shader-compile',
				['#error broken'],
			],
			[
				'unknown global effect',
				(r) => r.render({ layers: [], effects: [{ effect: 'missing' }] }),
				'unknown-effect',
				['global effect 0', '"missing"'],
			],
			[
				'unknown layer effect',
				(r) => r.render({ layers: [{ id: 'l', image: 'img', effects: [{ effect: 'nope' }] }] }),
				'unknown-effect',
				['layer 0', 'effect 0', '"nope"'],
			],
			[
				'unknown image',
				(r) =>
					r.render({
						layers: [
							{ id: 'base', image: 'img' },
							{ id: 'x', image: 'nope' },
						],
					}),
				'unknown-image',
				['layer 1', '"x"', '"nope"'],
			],
			[
				'unknown mask image',
				(r) =>
					r.render({ layers: [{ id: 'l', image: 'img', mask: { kind: 'image', image: 'gone' } }] }),
				'unknown-image',
				['layer 0', '"gone"'],
			],
			[
				'unknown effect texture',
				(r) => r.render({ layers: [], effects: [{ effect: 'ok', textures: { uNoise: 'gone' } }] }),
				'unknown-image',
				['"gone"'],
			],
			[
				'uniform of the wrong length',
				(r) => r.render({ layers: [], effects: [{ effect: 'ok', uniforms: { uTint: [1, 2] } }] }),
				'uniform-type',
				['uTint', '3', '2'],
			],
		]

		it.each(cases)('%s', (_name, act, code, fragments) => {
			const { gl, renderer } = setup()
			renderer.setImage('img', image())
			renderer.registerEffect({
				id: 'ok',
				fragment: effectSource('uniform vec3 uTint;\nuniform sampler2D uNoise;'),
			})
			const draws = gl.draws.length
			expectEngineError(() => act(renderer), code, ...fragments)
			expect(gl.draws.length).toBe(draws)
		})

		it('keeps an earlier registration after a failed re-registration', () => {
			const { gl, renderer } = setup()
			renderer.setImage('img', image())
			renderer.registerEffect({ id: 'fx', fragment: effectSource() })
			const programs = gl.count('createProgram')
			expectEngineError(
				() => renderer.registerEffect({ id: 'fx', fragment: effectSource('#error nope') }),
				'shader-compile'
			)
			expect(gl.count('deleteProgram')).toBe(gl.count('createProgram') - programs)
			expect(
				renderer.render({ layers: [{ id: 'l', image: 'img' }], effects: [{ effect: 'fx' }] })
			).toBe(true)
			expect(gl.draws.length).toBe(3)
		})
	})

	describe('effect uniforms', () => {
		const declarations = [
			'uniform float uAmount;',
			'uniform vec2 uDir;',
			'uniform vec3 uTint;',
			'uniform vec4 uColor;',
			'uniform int uCount;',
			'uniform bool uFlag;',
			'uniform sampler2D uNoise;',
			'uniform vec2 uResolution;',
		].join('\n')

		const cases: [string, string, number[]][] = [
			['uAmount', 'uniform1f', [0.5]],
			['uDir', 'uniform2fv', [1, 2]],
			['uTint', 'uniform3fv', [0.25, 0.5, 0.75]],
			['uColor', 'uniform4fv', [1, 0, 0, 1]],
			['uCount', 'uniform1i', [3]],
			['uFlag', 'uniform1i', [1]],
			['uNoise', 'uniform1i', [1]],
			['uResolution', 'uniform2f', [64, 32]],
		]

		it.each(cases)('%s binds with %s', (name, method, values) => {
			const { gl, renderer } = setup()
			renderer.setImage('img', image())
			renderer.setImage('noise', image())
			renderer.registerEffect({ id: 'fx', fragment: effectSource(declarations) })
			renderer.render({
				layers: [{ id: 'l', image: 'img' }],
				effects: [
					{
						effect: 'fx',
						uniforms: {
							uAmount: 0.5,
							uDir: [1, 2],
							uTint: [0.25, 0.5, 0.75],
							uColor: [1, 0, 0, 1],
							uCount: 3,
							uFlag: true,
							uUndeclared: [1, 2, 3, 4, 5],
						},
						textures: { uNoise: 'noise' },
					},
				],
			})
			const calls = gl.uniformCalls(name)
			expect(calls.at(-1)).toMatchObject({ method, values })
			expect(gl.uniformCalls('uUndeclared')).toHaveLength(0)
		})

		it('skips disabled instances', () => {
			const { gl, renderer } = setup()
			renderer.registerEffect({ id: 'fx', fragment: effectSource('uniform float uAmount;') })
			renderer.render({
				layers: [],
				effects: [{ effect: 'fx', enabled: false, uniforms: { uAmount: 1 } }],
			})
			expect(gl.uniformCalls('uAmount')).toHaveLength(0)
			expect(gl.draws).toHaveLength(1)
		})
	})
})
