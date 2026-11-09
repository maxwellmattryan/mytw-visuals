import { describe, expect, it } from '@jest/globals'

import { createRendererFromContext } from '@mytw/engine'
import type { RenderFrame } from '@mytw/engine'
import { engineSource, ExportError, exportPngSequence, exportVideo } from '@mytw/export'

import { FakeCanvas } from '../../engine/testing/fake-gl'
import { fakePng } from '../testing/fake-canvas'
import { fakeWebCodecs } from '../testing/fake-webcodecs'

const FRAME: RenderFrame = { background: [0, 0, 0, 1], layers: [] }

function setup() {
	const canvas = new FakeCanvas()
	const renderer = createRendererFromContext(canvas, canvas.gl, { width: 320, height: 180 })
	const phases: number[] = []
	const source = engineSource(
		renderer,
		(phase) => {
			phases.push(phase)
			return FRAME
		},
		canvas
	)
	return { canvas, renderer, source, phases }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise
	} catch (err) {
		return err
	}
	return null
}

describe('engineSource', () => {
	it('renders at the export size and restores the previous size on end', async () => {
		const { canvas, renderer, source, phases } = setup()
		const sizes: [number, number][] = []
		const { deps } = fakePng()
		await exportPngSequence(
			source,
			{
				width: 64,
				height: 48,
				fps: 30,
				frames: 4,
				onProgress: () => sizes.push([canvas.width, canvas.height]),
			},
			{
				createScratch: (w, h) => {
					const scratch = deps.createScratch(w, h)
					return { copy: () => {}, encode: scratch.encode }
				},
			}
		)
		expect(sizes).toEqual(Array.from({ length: 4 }, () => [64, 48]))
		expect(phases).toEqual([0, 0.25, 0.5, 0.75])
		expect([renderer.width, renderer.height]).toEqual([320, 180])
		expect([canvas.width, canvas.height]).toEqual([320, 180])
	})

	it('fails with context-lost when render returns false', async () => {
		const { canvas, renderer, source, phases } = setup()
		const { deps } = fakeWebCodecs()
		const lose = {
			...source,
			draw: (phase: number, index: number) => {
				if (index === 2) canvas.loseContext(false)
				return source.draw(phase, index)
			},
		}
		const err = await rejection(
			exportVideo(lose, { width: 64, height: 48, fps: 30, frames: 10 }, deps)
		)
		expect(err).toBeInstanceOf(ExportError)
		if (err instanceof ExportError) expect(err.code).toBe('context-lost')
		expect(phases).toHaveLength(3)
		expect([renderer.width, renderer.height]).toEqual([320, 180])
	})
})
