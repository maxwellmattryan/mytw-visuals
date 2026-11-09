import type p5 from 'p5'
import { defaults, parseValues } from '@mytw/schema'
import type { ParamDefs, ParamValues, Schema } from '@mytw/schema'
import { describeError, SketchError } from './errors'
import type {
	P5Constructor,
	SketchDefinition,
	SketchFrame,
	SketchInstance,
	SketchLayerOptions,
	SketchRuntime,
	SketchTime,
} from './types'

function initialValues<P extends ParamDefs>(schema: Schema<P>, input: unknown): ParamValues<P> {
	if (input === undefined) return defaults(schema)
	const result = parseValues(schema, input)
	return result.ok ? result.values : defaults(schema)
}

function timeProblem({ frame, frames, fps }: SketchTime): string | undefined {
	if (!Number.isInteger(frames) || frames < 1)
		return `frames (${String(frames)}) must be an integer >= 1`
	if (!Number.isInteger(frame) || frame < 0 || frame >= frames)
		return `frame (${String(frame)}) must be an integer in [0, ${frames})`
	if (!Number.isFinite(fps) || fps <= 0) return `fps (${String(fps)}) must be a finite number > 0`
	return undefined
}

/** Starts a p5 instance and resolves once its setup has made the canvas. */
function startP5(P5: P5Constructor, width: number, height: number, onDraw: (p: p5) => void) {
	return new Promise<{ p: p5; canvas: HTMLCanvasElement }>((resolve, reject) => {
		new P5((p) => {
			p.setup = () => {
				try {
					p.pixelDensity(1)
					const renderer = p.createCanvas(width, height)
					renderer.hide()
					p.noLoop()
					resolve({ p, canvas: renderer.elt })
				} catch (cause) {
					p.remove()
					reject(cause)
				}
			}
			p.draw = () => onDraw(p)
		})
	})
}

async function createSketchLayer<P extends ParamDefs>(
	P5: P5Constructor,
	definition: SketchDefinition<P>,
	options: SketchLayerOptions
): Promise<SketchInstance<P>> {
	const { width, height, seed = 0 } = options
	let values = initialValues(definition.params, options.params)
	// The frame a `render` call asked for. p5's own draws find none and do nothing.
	let pending: SketchFrame<P> | null = null
	let drew = false
	let failure: { cause: unknown } | null = null
	let disposed = false

	const onDraw = (p: p5) => {
		const frame = pending
		if (!frame) return
		pending = null
		drew = true
		try {
			definition.draw(p, frame)
		} catch (cause) {
			failure = { cause }
		}
	}

	const label = `Sketch "${definition.id}"`
	let started: { p: p5; canvas: HTMLCanvasElement }
	try {
		started = await startP5(P5, width, height, onDraw)
	} catch (cause) {
		throw new SketchError('setup-failed', `${label}: p5 setup failed: ${describeError(cause)}`, {
			cause,
		})
	}
	const { p, canvas } = started
	try {
		await definition.setup?.(p, { width, height })
	} catch (cause) {
		p.remove()
		throw new SketchError('setup-failed', `${label}: setup failed: ${describeError(cause)}`, {
			cause,
		})
	}

	const live = (what: string) => {
		if (disposed) throw new SketchError('disposed', `${label}: ${what} after dispose`)
	}

	return {
		definition,
		canvas,
		seed,
		get values() {
			return values
		},
		render(time) {
			live('render')
			const problem = timeProblem(time)
			if (problem) throw new SketchError('invalid-time', `${label}: ${problem}`)
			const { frame, frames, fps } = time
			p.randomSeed(seed)
			p.noiseSeed(seed)
			p.clear()
			pending = {
				t: frame / frames,
				frame,
				frames,
				fps,
				seconds: frame / fps,
				width,
				height,
				seed,
				params: values,
			}
			drew = false
			failure = null
			try {
				p.redraw()
			} catch (cause) {
				failure = { cause }
			} finally {
				pending = null
			}
			const failed: { cause: unknown } | null = failure
			if (failed)
				throw new SketchError(
					'draw-failed',
					`${label}: draw failed at frame ${frame}: ${describeError(failed.cause)}`,
					{ cause: failed.cause }
				)
			if (!drew)
				throw new SketchError('draw-failed', `${label}: p5 did not run the draw at frame ${frame}`)
			return canvas
		},
		setParams(input) {
			live('setParams')
			const result = parseValues(definition.params, input)
			if (result.ok) values = result.values
			return result
		},
		dispose() {
			if (disposed) return
			disposed = true
			p.remove()
		},
	}
}

/** Builds a runtime on a given p5 constructor. `loadSketchRuntime` passes the real one. */
export function createSketchRuntime(P5: P5Constructor): SketchRuntime {
	return {
		createSketchLayer: (definition, options) => createSketchLayer(P5, definition, options),
	}
}
