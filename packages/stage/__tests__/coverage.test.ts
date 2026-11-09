import { describe, expect, it } from '@jest/globals'

import type { JsonValue } from '@mytw/document'
import type { Project } from '@mytw/schema'
import { compileScene } from '@mytw/scene'

import { storeFor } from '../../layers/testing/fixtures'
import { describeReveal, findEdgeReveals } from '../coverage'

const REF = { track: 0, clip: 0 }
const BASE = ['tracks', 0, 'clips', 0, 'layers', 0, 'transform']

/** Understory with `base` framed at centre 0.5 and the given zoom field. */
function understoryWithBaseZoom(zoom: JsonValue): Project {
	const store = storeFor()
	const result = store.apply({
		op: 'batch',
		commands: [
			{ op: 'set', path: [...BASE, 'centerX'], value: 0.5 },
			{ op: 'set', path: [...BASE, 'centerY'], value: 0.5 },
			{ op: 'set', path: [...BASE, 'zoom'], value: zoom },
		],
	})
	if (!result.ok) throw new Error(result.error.message)
	return store.document
}

const breathe = (amount: number): JsonValue => ({
	value: 1,
	mod: [{ modulator: 'breathe', amount, mode: 'multiply' }],
})

describe('findEdgeReveals', () => {
	it('reports a layer whose modulated zoom dips below the cover fit', () => {
		const project = understoryWithBaseZoom(breathe(0.022))
		const reveals = findEdgeReveals(project, compileScene(project), REF)
		// breathe is sin(2π·f/225): zoom < 1 exactly on frames 113…224.
		expect(reveals).toEqual([{ layerId: 'base', name: 'Base', count: 112, total: 225, first: 113 }])
		expect(describeReveal(reveals[0])).toBe(
			'Motion reveals the edge of Base on 112 of 225 frames, first at frame 113'
		)
	})

	it('reports nothing with the binding amount 0', () => {
		const project = understoryWithBaseZoom(breathe(0))
		expect(findEdgeReveals(project, compileScene(project), REF)).toEqual([])
	})

	it('reports nothing for a static layer that never covers', () => {
		const project = understoryWithBaseZoom(0.5)
		expect(findEdgeReveals(project, compileScene(project), REF)).toEqual([])
	})

	it('reports nothing when the clip does not exist', () => {
		const project = understoryWithBaseZoom(breathe(0.022))
		expect(findEdgeReveals(project, compileScene(project), { track: 3, clip: 0 })).toEqual([])
		expect(findEdgeReveals(project, null, REF)).toEqual([])
	})
})
