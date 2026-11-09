import { describe, expect, it, jest } from '@jest/globals'

import { PROJECT_SCHEMA_VERSION } from '@mytw/schema'
import type { Project, ProjectLayer } from '@mytw/schema'

let evaluations = 0

jest.unstable_mockModule('p5', () => {
	evaluations++
	return { default: class {} }
})

const minimal: Project = {
	format: 'mytw-project',
	schemaVersion: PROJECT_SCHEMA_VERSION,
	name: 'Lazy',
	output: { width: 64, height: 64, fps: 30, background: '#000000' },
	timeline: { mode: 'loop', frames: 30 },
	assets: {},
	modulators: {},
	tracks: [],
	effects: [],
}

function withLayer(kind: 'image' | 'sketch'): Project {
	const shared = {
		id: 'layer',
		visible: true,
		opacity: 1,
		blend: 'normal' as const,
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
	}
	const layer: ProjectLayer =
		kind === 'image'
			? { ...shared, kind, asset: `sha256:${'ab'.repeat(32)}` }
			: {
					...shared,
					kind,
					sketch: 'orbits',
					version: 1,
					seed: 0,
					params: { format: 'mytw-params', version: 1, values: {} },
				}
	return {
		...minimal,
		tracks: [
			{ id: 'empty', kind: 'visual', clips: [] },
			{
				id: 'main',
				kind: 'visual',
				clips: [{ id: 'clip', start: 0, frames: 30, fadeIn: 0, fadeOut: 0, layers: [layer] }],
			},
		],
	}
}

describe('@mytw/sketch', () => {
	it('loads p5 only for projects with sketch layers', async () => {
		const sketch = await import('@mytw/sketch')
		const { defineSchema } = await import('@mytw/schema')
		sketch.defineSketch({
			id: 'orbits',
			version: 1,
			name: 'Orbits',
			params: defineSchema({}),
			draw: () => {},
		})
		expect(sketch.projectUsesSketches(minimal)).toBe(false)
		expect(sketch.projectUsesSketches(withLayer('image'))).toBe(false)
		expect(sketch.projectUsesSketches(withLayer('sketch'))).toBe(true)
		expect(await sketch.loadSketchRuntimeFor(minimal)).toBeNull()
		expect(await sketch.loadSketchRuntimeFor(withLayer('image'))).toBeNull()
		expect(evaluations).toBe(0)

		const runtime = await sketch.loadSketchRuntimeFor(withLayer('sketch'))
		expect(runtime).toEqual({ createSketchLayer: expect.any(Function) })
		expect(evaluations).toBe(1)
		expect(await sketch.loadSketchRuntime()).toBe(runtime)
	})
})
