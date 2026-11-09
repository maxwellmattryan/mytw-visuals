import { describe, expect, it } from '@jest/globals'

import { defineSchema, param } from '@mytw/schema'
import { createSketchRuntime, defineSketch, SketchError } from '@mytw/sketch'
import type {
	P5Constructor,
	SketchDefinition,
	SketchFrame,
	SketchInput,
	SketchLayerOptions,
	SketchTime,
} from '@mytw/sketch'

type Call = [name: string, ...args: unknown[]]

/**
 * Records every call. Like p5, it runs the sketch function, then `setup()` on a microtask followed
 * by one draw it starts itself, and its `redraw()` runs `draw()` synchronously.
 */
class FakeP5 {
	static last: FakeP5 | undefined
	calls: Call[] = []
	setup: () => void = () => {}
	draw: () => void = () => {}

	constructor(sketch: (p: FakeP5) => void) {
		FakeP5.last = this
		sketch(this)
		queueMicrotask(() => {
			this.setup()
			this.draw()
		})
	}

	pixelDensity(density: number) {
		this.calls.push(['pixelDensity', density])
	}

	createCanvas(width: number, height: number) {
		this.calls.push(['createCanvas', width, height])
		return { elt: { width, height }, hide: () => this.calls.push(['hide']) }
	}

	noLoop() {
		this.calls.push(['noLoop'])
	}

	randomSeed(seed: number) {
		this.calls.push(['randomSeed', seed])
	}

	noiseSeed(seed: number) {
		this.calls.push(['noiseSeed', seed])
	}

	clear() {
		this.calls.push(['clear'])
	}

	redraw() {
		this.calls.push(['redraw'])
		this.draw()
	}

	remove() {
		this.calls.push(['remove'])
	}
}

/** A p5 whose `redraw` returns without drawing, as p5 does before its setup is done. */
class SilentP5 extends FakeP5 {
	redraw() {
		this.calls.push(['redraw'])
	}
}

const asP5 = (P5: typeof FakeP5) => P5 as unknown as P5Constructor

const params = defineSchema({
	count: param.integer({ label: 'Count', min: 1, max: 64, default: 12 }),
	glow: param.boolean({ label: 'Glow', default: false }),
})

type Defs = typeof params.params

function fake(): FakeP5 {
	if (!FakeP5.last) throw new Error('no p5 instance yet')
	return FakeP5.last
}

/** A sketch whose draw records the frame it got on the fake. */
function recording(patch: Partial<SketchInput<Defs>> = {}): SketchDefinition<Defs> {
	return defineSketch<Defs>({
		id: 'orbits',
		version: 1,
		name: 'Orbits',
		params,
		draw: (_p, frame) => fake().calls.push(['draw', frame]),
		...patch,
	})
}

const SIZE = { width: 40, height: 30 }
const TIME: SketchTime = { frame: 3, frames: 12, fps: 4 }

async function start(
	options: Partial<SketchLayerOptions> = {},
	definition = recording(),
	P5: typeof FakeP5 = FakeP5
) {
	const instance = await createSketchRuntime(asP5(P5)).createSketchLayer(definition, {
		...SIZE,
		...options,
	})
	const p = fake()
	p.calls = []
	return { instance, p }
}

function drawnFrames(p: FakeP5): SketchFrame<Defs>[] {
	return p.calls.filter(([name]) => name === 'draw').map(([, frame]) => frame as SketchFrame<Defs>)
}

async function codeOf(run: () => unknown): Promise<string | undefined> {
	try {
		await run()
	} catch (error) {
		return error instanceof SketchError ? error.code : `not a SketchError: ${String(error)}`
	}
	return undefined
}

describe('createSketchRuntime', () => {
	it('seeds, clears and draws the requested frame', async () => {
		const { instance, p } = await start({ seed: 7 })
		expect(instance.render(TIME)).toBe(instance.canvas)
		expect(p.calls).toEqual([
			['randomSeed', 7],
			['noiseSeed', 7],
			['clear'],
			['redraw'],
			[
				'draw',
				{
					t: 0.25,
					frame: 3,
					frames: 12,
					fps: 4,
					seconds: 0.75,
					width: 40,
					height: 30,
					seed: 7,
					params: { count: 12, glow: false },
				},
			],
		])
		p.calls = []
		instance.render({ frame: 0, frames: 1, fps: 30 })
		expect(drawnFrames(p)).toEqual([expect.objectContaining({ t: 0, frame: 0, seconds: 0 })])
	})

	it('defaults the seed to 0', async () => {
		const { instance, p } = await start()
		instance.render(TIME)
		expect(p.calls.slice(0, 2)).toEqual([
			['randomSeed', 0],
			['noiseSeed', 0],
		])
		expect(drawnFrames(p)[0].seed).toBe(0)
	})

	it('renders the same frame identically twice', async () => {
		const { instance, p } = await start({ seed: 3 })
		instance.render(TIME)
		const first = p.calls
		p.calls = []
		instance.render({ frame: 5, frames: 12, fps: 4 })
		p.calls = []
		instance.render(TIME)
		expect(p.calls).toEqual(first)
	})

	it("creates a fixed-size canvas and ignores p5's own draws", async () => {
		const draws: number[] = []
		const definition = recording({ draw: (_p, frame) => draws.push(frame.frame) })
		const runtime = createSketchRuntime(asP5(FakeP5))
		const instance = await runtime.createSketchLayer(definition, { width: 1080, height: 1920 })
		const p = fake()
		expect(p.calls).toEqual([
			['pixelDensity', 1],
			['createCanvas', 1080, 1920],
			['hide'],
			['noLoop'],
		])
		expect(instance.canvas).toEqual({ width: 1080, height: 1920 })
		// p5 drew once after setup, and draws it starts later are ignored too.
		p.draw()
		expect(draws).toEqual([])
		instance.render(TIME)
		p.draw()
		expect(draws).toEqual([3])
	})

	it('runs the definition setup with the size before resolving', async () => {
		const order: string[] = []
		const definition = recording({
			setup: async (_p, size) => {
				await Promise.resolve()
				order.push(`setup ${size.width}x${size.height}`)
			},
		})
		const pending = createSketchRuntime(asP5(FakeP5))
			.createSketchLayer(definition, SIZE)
			.then(() => order.push('ready'))
		await pending
		expect(order).toEqual(['setup 40x30', 'ready'])
	})

	it('reads params through the shared schema', async () => {
		const envelope = { format: 'mytw-params', version: 1, values: { count: 5, glow: true } }
		expect((await start({ params: envelope })).instance.values).toEqual({ count: 5, glow: true })
		expect((await start({ params: { count: 9 } })).instance.values).toEqual({
			count: 9,
			glow: false,
		})
		expect((await start({ params: { count: 999 } })).instance.values.count).toBe(64)
		const fallback = { count: 12, glow: false }
		expect((await start()).instance.values).toEqual(fallback)
		expect((await start({ params: 'not json' })).instance.values).toEqual(fallback)
		expect((await start({ params: { other: 1 } })).instance.values).toEqual(fallback)
		expect((await start({ params: { ...envelope, version: 2 } })).instance.values).toEqual(fallback)

		const { instance, p } = await start()
		const changed = instance.setParams({ count: 20 })
		expect(changed).toEqual(expect.objectContaining({ ok: true }))
		expect(instance.values).toEqual({ count: 20, glow: false })
		instance.render(TIME)
		expect(drawnFrames(p)[0].params).toEqual({ count: 20, glow: false })

		const rejected = instance.setParams({ nothing: true })
		expect(rejected).toEqual({ ok: false, message: expect.any(String) })
		expect(instance.values).toEqual({ count: 20, glow: false })
		p.calls = []
		instance.render(TIME)
		expect(drawnFrames(p)[0].params).toEqual({ count: 20, glow: false })
	})

	const failing: [label: string, run: () => Promise<unknown>, code: string][] = [
		...(
			[
				[0, 0, 30],
				[0, 1.5, 30],
				[-1, 12, 30],
				[12, 12, 30],
				[1.5, 12, 30],
				[0, 12, 0],
				[0, 12, -1],
				[0, 12, Infinity],
				[0, 12, NaN],
			] as const
		).map(([frame, frames, fps]): [string, () => Promise<unknown>, string] => [
			`frame ${frame} of ${frames} at ${fps} fps`,
			async () => (await start()).instance.render({ frame, frames, fps }),
			'invalid-time',
		]),
		[
			'a setup that throws',
			() =>
				start(
					{},
					recording({
						setup: () => {
							throw new Error('no image')
						},
					})
				),
			'setup-failed',
		],
		[
			'a setup that rejects',
			() => start({}, recording({ setup: () => Promise.reject(new Error('no image')) })),
			'setup-failed',
		],
		[
			'a draw that throws',
			async () => {
				const definition = recording({
					draw: () => {
						throw new Error('boom')
					},
				})
				return (await start({}, definition)).instance.render(TIME)
			},
			'draw-failed',
		],
		[
			'a p5 that skips the draw',
			async () => (await start({}, recording(), SilentP5)).instance.render(TIME),
			'draw-failed',
		],
		[
			'render after dispose',
			async () => {
				const { instance } = await start()
				instance.dispose()
				return instance.render(TIME)
			},
			'disposed',
		],
		[
			'setParams after dispose',
			async () => {
				const { instance } = await start()
				instance.dispose()
				return instance.setParams({ count: 1 })
			},
			'disposed',
		],
	]

	it.each(failing)('throws SketchError codes: %s', async (_label, run, code) => {
		expect(await codeOf(run)).toBe(code)
	})

	it('removes p5 when setup fails, and keeps the draw error', async () => {
		const failed = start({}, recording({ setup: () => Promise.reject(new Error('no image')) }))
		await expect(failed).rejects.toThrow('Sketch "orbits": setup failed: no image')
		expect(fake().calls.filter(([name]) => name === 'remove')).toHaveLength(1)

		const boom = new Error('boom')
		const definition = recording({
			draw: () => {
				throw boom
			},
		})
		const { instance } = await start({}, definition)
		let thrown: unknown
		try {
			instance.render(TIME)
		} catch (error) {
			thrown = error
		}
		expect(thrown).toBeInstanceOf(SketchError)
		expect(thrown).toEqual(
			expect.objectContaining({
				message: 'Sketch "orbits": draw failed at frame 3: boom',
				cause: boom,
			})
		)
	})

	it('disposes once', async () => {
		const { instance, p } = await start()
		instance.dispose()
		instance.dispose()
		expect(p.calls).toEqual([['remove']])
	})
})
