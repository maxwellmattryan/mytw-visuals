import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { clamp, easeInOutQuad, fbm, valueNoise2 } from '@lib/math'
import { layerToSourceMatrix } from '@mytw/engine'
import type { RenderFrame, RenderLayer } from '@mytw/engine'
import { parseProject } from '@mytw/schema'
import type {
	AnimatableNumber,
	EffectInstance,
	Modulator,
	Project,
	ProjectClip,
	ProjectImageLayer,
} from '@mytw/schema'
import { compileScene, SceneError } from '@mytw/scene'

const TAU = Math.PI * 2
const HASH = 'sha256:' + 'a'.repeat(64)

const FIXTURE = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../schema/fixtures/v1/understory.json'
)
const UNDERSTORY_HASH = 'sha256:740b8530c50ed203aa2ecb3ef2ecd24e100b1fef711424f2c8033bb6b724384b'

function loadUnderstory(): Project {
	const result = parseProject(readFileSync(FIXTURE, 'utf8'))
	if (!result.ok) throw new Error(result.issues.map((found) => found.message).join('\n'))
	return result.project
}

function testLayer(overrides: Partial<ProjectImageLayer> = {}): ProjectImageLayer {
	return {
		id: 'layer',
		kind: 'image',
		asset: HASH,
		visible: true,
		opacity: 1,
		blend: 'normal',
		feather: 0,
		transform: {
			centerX: 0.5,
			centerY: 0.5,
			zoom: 1,
			rotation: 0,
			mirrorX: false,
			mirrorY: false,
		},
		effects: [],
		...overrides,
	}
}

function testClip(overrides: Partial<ProjectClip> = {}): ProjectClip {
	return {
		id: 'clip',
		start: 0,
		frames: 100,
		fadeIn: 0,
		fadeOut: 0,
		layers: [testLayer()],
		...overrides,
	}
}

function testProject(overrides: Partial<Project> = {}): Project {
	return {
		format: 'mytw-project',
		schemaVersion: 2,
		name: 'Test',
		output: { width: 1080, height: 1920, fps: 30, background: '#336699' },
		timeline: { mode: 'loop', frames: 100 },
		assets: { [HASH]: { kind: 'image', mimeType: 'image/png', width: 1688, height: 3000 } },
		modulators: {},
		tracks: [{ id: 'track', kind: 'visual', clips: [testClip()] }],
		effects: [],
		...overrides,
	}
}

function effect(id: string, name: string, overrides: Partial<EffectInstance> = {}): EffectInstance {
	return { id, effect: name, version: 1, enabled: true, params: {}, ...overrides }
}

function only(frame: RenderFrame): RenderLayer {
	expect(frame.layers).toHaveLength(1)
	return frame.layers[0]
}

function thrown(fn: () => unknown): unknown {
	try {
		fn()
	} catch (error) {
		return error
	}
	throw new Error('expected a throw')
}

describe('compileScene', () => {
	it('renders the Understory fixture at frames 0 and 45', () => {
		const scene = compileScene(loadUnderstory())
		expect(scene).toMatchObject({ frames: 225, width: 1080, height: 1920, fps: 30 })
		expect(scene.images).toEqual([UNDERSTORY_HASH])
		expect(scene.effects.map((program) => program.id).sort()).toEqual([
			'caustic-warp',
			'chromatic-aberration',
			'hue-shift',
			'vignette',
		])
		for (const program of scene.effects) expect(program.fragment).toMatch(/^#version 300 es/)

		for (const f of [0, 45]) {
			const t = f / 225
			const sin = (phase: number) => Math.sin(TAU * (t + phase))
			const breathe = 1 + 0.022 * sin(0)
			const frame = scene.frameAt(f)
			expect(frame.background).toEqual([0, 0, 0, 1])
			expect(frame.layers).toHaveLength(2)
			const [base, ghost] = frame.layers

			expect(base).toMatchObject({
				id: 'base',
				image: UNDERSTORY_HASH,
				visible: true,
				opacity: 1,
				blend: 'normal',
				edgeFeather: 0.06,
				effects: [],
			})
			expect(base.mask).toBeUndefined()
			expect(base.transform).toEqual({
				center: [
					expect.closeTo(0.5 + 0.012 * sin(0), 12),
					expect.closeTo(0.28 - 0.012 * sin(0.25), 12),
				],
				zoom: expect.closeTo(2 * breathe, 12),
				rotation: 0,
				mirrorX: false,
				mirrorY: false,
				fit: 'cover',
			})

			expect(ghost).toMatchObject({
				id: 'ghost',
				image: UNDERSTORY_HASH,
				visible: true,
				opacity: 1,
				blend: 'multiply',
				edgeFeather: 0.06,
				mask: { kind: 'linear', from: [0.5, 1], to: [0.5, 0] },
				effects: [],
			})
			expect(ghost.transform).toEqual({
				center: [
					expect.closeTo(0.2 + 0.0096 * sin(0), 12),
					expect.closeTo(0.75 - 0.0096 * sin(0.25), 12),
				],
				zoom: expect.closeTo(3.4 * breathe, 12),
				// The fixture's wobble is -0.03·m, and the single-axis mirror flips the angle for
				// the engine (see AC3), so the engine sees +0.03·m.
				rotation: expect.closeTo(0.03 * sin(0), 12),
				mirrorX: true,
				mirrorY: false,
				fit: 'cover',
			})

			expect(frame.effects).toEqual([
				{
					effect: 'caustic-warp',
					enabled: true,
					uniforms: { uAmount: 0.005, uScale: 2, uLoopRadius: 0.8, uPhase: t },
				},
				{
					effect: 'vignette',
					enabled: true,
					uniforms: { uAmount: 0.2, uInner: 0.35, uOuter: 0.95, uPhase: t },
				},
				{
					effect: 'chromatic-aberration',
					enabled: true,
					uniforms: {
						uAmount: expect.closeTo(0.006 + 0.005 * sin(0.75), 12),
						uMode: 0,
						uPhase: t,
					},
				},
				{ effect: 'hue-shift', enabled: true, uniforms: { uDegrees: -15, uPhase: t } },
			])
		}
	})

	const sine = (cycles: number, phase: number): Modulator => ({ shape: 'sine', cycles, phase })
	const noiseAt = (seed: number, x: number) => {
		const a = TAU * x
		const v = fbm((nx, ny) => valueNoise2(nx, ny, seed), Math.cos(a), Math.sin(a), 4)
		return clamp((2 * v) / 0.9375 - 1, -1, 1)
	}
	const triangleAt = (x: number) => {
		const u = x - 0.25 - Math.floor(x - 0.25)
		return 1 - 4 * Math.min(u, 1 - u)
	}
	const sineAt = (x: number) => Math.sin(TAU * x)

	const bindingRows: [
		string,
		Record<string, Modulator>,
		{ centerX?: AnimatableNumber; opacity?: AnimatableNumber },
		number,
		{ centerX?: number; opacity?: number },
	][] = [
		[
			'sine',
			{ m: sine(2, 0.1) },
			{ centerX: { value: 0.5, mod: [{ modulator: 'm', amount: 0.1, mode: 'add' }] } },
			13,
			{ centerX: 0.5 + 0.1 * sineAt(2 * 0.13 + 0.1) },
		],
		[
			'triangle',
			{ m: { shape: 'triangle', cycles: 3, phase: 0.3 } },
			{ centerX: { value: 0.5, mod: [{ modulator: 'm', amount: 0.2, mode: 'add' }] } },
			41,
			{ centerX: 0.5 + 0.2 * triangleAt(3 * 0.41 + 0.3) },
		],
		[
			'noise',
			{ m: { shape: 'noise', cycles: 1, phase: 0.2, seed: 7 } },
			{ centerX: { value: 0.5, mod: [{ modulator: 'm', amount: 0.3, mode: 'multiply' }] } },
			57,
			{ centerX: 0.5 * (1 + 0.3 * noiseAt(7, 0.57 + 0.2)) },
		],
		[
			'keyframes, linear segment',
			{
				m: {
					shape: 'keyframes',
					keys: [
						{ at: 0, value: 0, easing: 'linear' },
						{ at: 0.5, value: 1, easing: 'easeInOutQuad' },
						{ at: 1, value: 0, easing: 'linear' },
					],
				},
			},
			{ centerX: { value: 0, mod: [{ modulator: 'm', amount: 1, mode: 'add' }] } },
			10,
			{ centerX: 0.2 },
		],
		[
			'keyframes, eased segment',
			{
				m: {
					shape: 'keyframes',
					keys: [
						{ at: 0, value: 0, easing: 'linear' },
						{ at: 0.5, value: 1, easing: 'easeInOutQuad' },
						{ at: 1, value: 0, easing: 'linear' },
					],
				},
			},
			{ centerX: { value: 0, mod: [{ modulator: 'm', amount: 1, mode: 'add' }] } },
			60,
			{ centerX: 1 - easeInOutQuad(0.2) },
		],
		[
			'add then multiply',
			{ a: sine(1, 0), b: sine(1, 0.25) },
			{
				centerX: {
					value: 2,
					mod: [
						{ modulator: 'a', amount: 0.5, mode: 'add' },
						{ modulator: 'b', amount: 0.25, mode: 'multiply' },
					],
				},
			},
			10,
			{ centerX: (2 + 0.5 * sineAt(0.1)) * (1 + 0.25 * sineAt(0.35)) },
		],
		[
			'multiply then add',
			{ a: sine(1, 0), b: sine(1, 0.25) },
			{
				centerX: {
					value: 2,
					mod: [
						{ modulator: 'b', amount: 0.25, mode: 'multiply' },
						{ modulator: 'a', amount: 0.5, mode: 'add' },
					],
				},
			},
			10,
			{ centerX: 2 * (1 + 0.25 * sineAt(0.35)) + 0.5 * sineAt(0.1) },
		],
		[
			'opacity over 1 is clamped',
			{ m: sine(1, 0) },
			{ opacity: { value: 0.9, mod: [{ modulator: 'm', amount: 0.5, mode: 'add' }] } },
			25,
			{ opacity: 1 },
		],
		[
			'opacity under 0 is clamped',
			{ m: sine(1, 0) },
			{ opacity: { value: 0.1, mod: [{ modulator: 'm', amount: -0.5, mode: 'add' }] } },
			25,
			{ opacity: 0 },
		],
	]

	it.each(bindingRows)(
		'evaluates bindings and modulators: %s',
		(_, modulators, values, f, want) => {
			const base = testLayer()
			const layer = testLayer({
				opacity: values.opacity ?? 1,
				transform: { ...base.transform, centerX: values.centerX ?? 0.5 },
			})
			const scene = compileScene(
				testProject({
					modulators,
					tracks: [{ id: 'track', kind: 'visual', clips: [testClip({ layers: [layer] })] }],
				})
			)
			const got = only(scene.frameAt(f))
			if (want.centerX !== undefined)
				expect(got.transform?.center?.[0]).toBeCloseTo(want.centerX, 12)
			if (want.opacity !== undefined) expect(got.opacity).toBeCloseTo(want.opacity, 12)
		}
	)

	const transformRows: [boolean, boolean, number][] = [
		[false, false, 0.4],
		[true, false, 0.4],
		[false, true, 0.4],
		[true, true, 0.4],
		[true, false, -1.1],
		[false, true, 2.3],
	]

	it.each(transformRows)(
		'transform matches the format mapping: mirrorX %s, mirrorY %s, rotation %s',
		(mirrorX, mirrorY, rotation) => {
			const W = 1080
			const H = 1920
			for (const [w, h] of [
				[1688, 3000],
				[2000, 1000],
			]) {
				const [centerX, centerY, zoom] = [0.4, 0.6, 1.7]
				const scene = compileScene(
					testProject({
						assets: { [HASH]: { kind: 'image', mimeType: 'image/png', width: w, height: h } },
						tracks: [
							{
								id: 'track',
								kind: 'visual',
								clips: [
									testClip({
										layers: [
											testLayer({
												transform: { centerX, centerY, zoom, rotation, mirrorX, mirrorY },
											}),
										],
									}),
								],
							},
						],
					})
				)
				const m = layerToSourceMatrix(
					only(scene.frameAt(0)).transform,
					{ width: W, height: H },
					{ width: w, height: h },
					new Float64Array(9)
				)
				const s = Math.max(W / w, H / h)
				const c = Math.cos(rotation)
				const sn = Math.sin(rotation)
				for (const [qx, qy] of [
					[0, 0],
					[W, 0],
					[0, H],
					[W, H],
					[123, 1500],
					[900, 77],
				]) {
					// The format's mapping: sourcePx = R(rotation)·(M·p) / (zoom·s).
					const px = (qx - W / 2) * (mirrorX ? -1 : 1)
					const py = (qy - H / 2) * (mirrorY ? -1 : 1)
					const sx = (c * px + sn * py) / (zoom * s)
					const sy = (-sn * px + c * py) / (zoom * s)
					const u = qx / W
					const v = qy / H
					expect(Math.abs(m[0] * u + m[3] * v + m[6] - (centerX + sx / w))).toBeLessThan(1e-9)
					expect(Math.abs(m[1] * u + m[4] * v + m[7] - (centerY + sy / h))).toBeLessThan(1e-9)
				}
			}
		}
	)

	it('applies clip ranges and fades', () => {
		const scene = compileScene(
			testProject({
				timeline: { mode: 'sequence', frames: 50 },
				tracks: [
					{
						id: 'bottom',
						kind: 'visual',
						clips: [
							testClip({
								start: 10,
								frames: 20,
								fadeIn: 5,
								fadeOut: 4,
								layers: [testLayer({ id: 'faded', opacity: 0.8 })],
							}),
						],
					},
					{
						id: 'top',
						kind: 'visual',
						clips: [
							testClip({ id: 'a', start: 0, frames: 20, layers: [testLayer({ id: 'first' })] }),
							testClip({ id: 'b', start: 20, frames: 30, layers: [testLayer({ id: 'second' })] }),
						],
					},
				],
				effects: [effect('v', 'vignette')],
			})
		)
		const opacityAt = (f: number) =>
			scene.frameAt(f).layers.find((layer) => layer.id === 'faded')?.opacity
		expect(opacityAt(9)).toBeUndefined()
		expect(opacityAt(10)).toBeCloseTo(0, 12)
		expect(opacityAt(12)).toBeCloseTo(0.8 * 0.4, 12)
		expect(opacityAt(20)).toBeCloseTo(0.8, 12)
		expect(opacityAt(27)).toBeCloseTo(0.8 * 0.75, 12)
		expect(opacityAt(29)).toBeCloseTo(0.8 * 0.25, 12)
		expect(opacityAt(30)).toBeUndefined()

		// Tracks are bottom first, and each track draws only its active clip.
		expect(scene.frameAt(15).layers.map((layer) => layer.id)).toEqual(['faded', 'first'])
		expect(scene.frameAt(25).layers.map((layer) => layer.id)).toEqual(['faded', 'second'])

		const empty = compileScene(
			testProject({
				tracks: [{ id: 'track', kind: 'visual', clips: [testClip({ start: 50, frames: 10 })] }],
				effects: [effect('v', 'vignette'), effect('h', 'hue-shift', { enabled: false })],
			})
		).frameAt(0)
		expect(empty.layers).toEqual([])
		expect(empty.background).toEqual([0x33 / 255, 0x66 / 255, 0x99 / 255, 1])
		expect(empty.effects?.map((e) => [e.effect, e.enabled])).toEqual([
			['vignette', true],
			['hue-shift', false],
		])
		expect(compileScene(testProject({ tracks: [] })).frameAt(0).layers).toEqual([])

		const hidden = compileScene(
			testProject({
				tracks: [
					{
						id: 'track',
						kind: 'visual',
						clips: [testClip({ layers: [testLayer({ visible: false })] })],
					},
				],
			})
		)
		expect(only(hidden.frameAt(0)).visible).toBe(false)
		expect(hidden.images).toEqual([])
	})

	it('rejects unknown effects and bad frames', () => {
		const unknown = thrown(() =>
			compileScene(
				testProject({
					effects: [effect('a', 'vignette'), effect('b', 'hue-shift'), effect('c', 'no-such-fx')],
				})
			)
		)
		expect(unknown).toBeInstanceOf(SceneError)
		expect((unknown as SceneError).path).toBe('effects[2].effect')

		const version = thrown(() =>
			compileScene(testProject({ effects: [effect('a', 'vignette', { version: 2 })] }))
		)
		expect(version).toBeInstanceOf(SceneError)
		expect((version as SceneError).path).toBe('effects[0].version')

		const layerEffect = thrown(() =>
			compileScene(
				testProject({
					tracks: [
						{
							id: 'track',
							kind: 'visual',
							clips: [testClip({ layers: [testLayer({ effects: [effect('x', 'missing')] })] })],
						},
					],
				})
			)
		)
		expect(layerEffect).toBeInstanceOf(SceneError)
		expect((layerEffect as SceneError).path).toBe('tracks[0].clips[0].layers[0].effects[0].effect')

		const scene = compileScene(testProject())
		for (const f of [-1, 100, 1.5, Number.NaN]) expect(() => scene.frameAt(f)).toThrow(RangeError)
		expect(() => scene.frameAt(99)).not.toThrow()
	})
})
