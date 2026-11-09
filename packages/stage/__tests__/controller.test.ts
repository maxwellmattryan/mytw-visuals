import { afterEach, describe, expect, it, jest } from '@jest/globals'

import { MemoryAssetSource } from '@mytw/assets'
import type { Project, ProjectLayer } from '@mytw/schema'

import { createLayersController } from '../../layers/controller'
import { storeFor } from '../../layers/testing/fixtures'
import { createStageController, RUN_IDLE_MS, SELECT_HINT } from '../controller'
import { baseTransform, canvasToSource, sourceSize } from '../geometry'
import type { Vec2 } from '../geometry'

function setup(select: string | null = 'base') {
	const store = storeFor()
	const layers = createLayersController({ store, assetStore: new MemoryAssetSource() })
	layers.select(select)
	const stage = createStageController({ layers })
	stage.setStageSize(600, 1000)
	return { store, layers, stage, original: store.document }
}

function layerOf(project: Project, id: string): ProjectLayer {
	const found = project.tracks[0].clips[0].layers.find((layer) => layer.id === id)
	if (!found) throw new Error(`no layer ${id}`)
	return found
}

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]

afterEach(() => {
	jest.useRealTimers()
})

describe('gestures', () => {
	it('makes a move drag one undo step that changes only the centre and keeps its mod', () => {
		const { store, stage, original } = setup()
		const before = layerOf(original, 'base')
		const c = stage.gizmo?.center ?? [0, 0]
		const start = add(c, [-100, 150])
		expect(stage.hitTest(start)).toBe('move')
		expect(stage.beginGesture('move', start)).toBe(true)
		stage.updateGesture(add(start, [10, 0]))
		stage.updateGesture(add(start, [25, 12]))
		stage.updateGesture(add(start, [40, 20]))
		stage.endGesture()

		const after = layerOf(store.document, 'base')
		expect({ ...after.transform, centerX: null, centerY: null }).toEqual({
			...before.transform,
			centerX: null,
			centerY: null,
		})
		const [cx0, cy0] = [before.transform.centerX, before.transform.centerY]
		const [cx1, cy1] = [after.transform.centerX, after.transform.centerY]
		if (typeof cx0 === 'number' || typeof cx1 === 'number')
			throw new Error('expected { value, mod }')
		if (typeof cy0 === 'number' || typeof cy1 === 'number')
			throw new Error('expected { value, mod }')
		expect(cx1.mod).toEqual(cx0.mod)
		expect(cy1.mod).toEqual(cy0.mod)
		expect(cx1.value).toBeLessThan(cx0.value)
		expect(cy1.value).toBeLessThan(cy0.value)

		// The source point under the pointer at pointerdown is under it at pointerup.
		const output = { width: 1080, height: 1920 }
		const source = sourceSize(original, before)
		const scale = stage.view.scale
		const p: Vec2 = [-100 / scale, 150 / scale]
		const moved = canvasToSource(
			baseTransform(after),
			output,
			source,
			add(p, [40 / scale, 20 / scale])
		)
		const was = canvasToSource(baseTransform(before), output, source, p)
		expect(moved[0]).toBeCloseTo(was[0], 5)
		expect(moved[1]).toBeCloseTo(was[1], 5)

		expect(store.undo()).toBe(true)
		expect(store.document).toEqual(original)
		expect(store.canUndo).toBe(false)
	})

	it('drags the zoom handle to change only zoom', () => {
		const { store, stage, original } = setup()
		const gizmo = stage.gizmo
		if (!gizmo) throw new Error('no gizmo')
		expect(stage.hitTest(gizmo.zoomHandle)).toBe('zoom')
		stage.beginGesture('zoom', gizmo.zoomHandle)
		stage.updateGesture(add(gizmo.center, [96, 0]))
		stage.updateGesture(add(gizmo.center, [0, 128]))
		stage.endGesture()
		const before = layerOf(original, 'base').transform
		const after = layerOf(store.document, 'base').transform
		expect(after).toEqual({ ...before, zoom: { ...(before.zoom as object), value: 4 } })
		expect(store.undo()).toBe(true)
		expect(store.canUndo).toBe(false)
	})

	it('drags the rotation handle to change only rotation, also with a single mirror', () => {
		for (const [id, sign] of [
			['base', 1],
			['ghost', -1],
		] as const) {
			const { store, stage, original } = setup(id)
			const gizmo = stage.gizmo
			if (!gizmo) throw new Error('no gizmo')
			// Rotation 0: the handle sits straight above the centre.
			expect(gizmo.rotateHandle[0]).toBeCloseTo(gizmo.center[0], 9)
			expect(gizmo.rotateHandle[1]).toBeCloseTo(gizmo.center[1] - 96, 9)
			expect(stage.hitTest(gizmo.rotateHandle)).toBe('rotate')
			stage.beginGesture('rotate', gizmo.rotateHandle)
			stage.updateGesture(add(gizmo.center, [50, -50]))
			stage.updateGesture(add(gizmo.center, [96, 0]))
			stage.endGesture()
			const before = layerOf(original, id).transform
			const after = layerOf(store.document, id).transform
			const expected = Math.round(sign * (Math.PI / 2) * 1e6) / 1e6
			expect(after).toEqual({
				...before,
				rotation:
					typeof before.rotation === 'number' ? expected : { ...before.rotation, value: expected },
			})
			// The handle now tracks the pointer, to the right of the centre.
			const moved = stage.gizmo?.rotateHandle ?? [0, 0]
			expect(moved[0]).toBeCloseTo(gizmo.center[0] + 96, 3)
			expect(moved[1]).toBeCloseTo(gizmo.center[1], 3)
		}
	})

	it('restores the pre-gesture document on cancel', () => {
		const { store, stage, original } = setup()
		const c = stage.gizmo?.center ?? [0, 0]
		stage.beginGesture('move', add(c, [0, 200]))
		stage.updateGesture(add(c, [30, 230]))
		stage.updateGesture(add(c, [60, 250]))
		stage.cancelGesture()
		expect(store.document).toEqual(original)
		expect(store.canUndo).toBe(false)
		expect(stage.gesture).toBeNull()
	})

	it('applies nothing with no selected layer', () => {
		const { store, stage, original } = setup(null)
		expect(stage.gizmo).toBeNull()
		expect(stage.hint).toBe(SELECT_HINT)
		expect(stage.hitTest([300, 500])).toBeNull()
		expect(stage.beginGesture('move', [300, 500])).toBe(false)
		stage.updateGesture([400, 600])
		stage.endGesture()
		stage.wheelZoom(-100, [300, 500])
		stage.nudge(1, 0)
		stage.toggleMirror('x')
		expect(store.document).toBe(original)
		expect(store.canUndo).toBe(false)
	})

	it('creates no step for a gesture that changes nothing', () => {
		const { store, stage } = setup()
		const c = stage.gizmo?.center ?? [0, 0]
		stage.beginGesture('move', c)
		stage.updateGesture(c)
		stage.endGesture()
		expect(store.canUndo).toBe(false)
	})
})

describe('mirror', () => {
	it('flips mirrorX as one step', () => {
		const { store, stage, original } = setup()
		stage.toggleMirror('x')
		expect(layerOf(store.document, 'base').transform.mirrorX).toBe(true)
		expect(layerOf(store.document, 'base').transform.mirrorY).toBe(false)
		stage.toggleMirror('y')
		expect(layerOf(store.document, 'base').transform.mirrorY).toBe(true)
		store.undo()
		expect(layerOf(store.document, 'base').transform.mirrorY).toBe(false)
		expect(layerOf(store.document, 'base').transform.mirrorX).toBe(true)
		store.undo()
		expect(store.document).toEqual(original)
		expect(store.canUndo).toBe(false)
	})
})

describe('wheel', () => {
	it('makes a run of wheel zooms one step, sealed 400 ms after the last event', () => {
		jest.useFakeTimers()
		const { store, stage, original } = setup()
		const c = stage.gizmo?.center ?? [0, 0]
		stage.wheelZoom(-50, c)
		stage.wheelZoom(-50, c)
		jest.advanceTimersByTime(RUN_IDLE_MS - 1)
		stage.wheelZoom(-50, c)
		const zoomAfterRun = baseTransform(layerOf(store.document, 'base')).zoom
		expect(zoomAfterRun).toBeCloseTo(2 * Math.exp(150 / 500), 5)
		// Anchored at the canvas centre, the centre stays put.
		expect(baseTransform(layerOf(store.document, 'base')).centerX).toBe(0.5)

		jest.advanceTimersByTime(RUN_IDLE_MS)
		stage.wheelZoom(50, c)
		store.undo()
		expect(baseTransform(layerOf(store.document, 'base')).zoom).toBe(zoomAfterRun)
		store.undo()
		expect(store.document).toEqual(original)
		expect(store.canUndo).toBe(false)
	})

	it('zooms about the pointer, keeping the source point under it', () => {
		const { store, stage, original } = setup()
		const c = stage.gizmo?.center ?? [0, 0]
		const pointer = add(c, [120, -80])
		stage.wheelZoom(-200, pointer)
		const output = { width: 1080, height: 1920 }
		const source = sourceSize(original, layerOf(original, 'base'))
		const p: Vec2 = [120 / stage.view.scale, -80 / stage.view.scale]
		const after = canvasToSource(baseTransform(layerOf(store.document, 'base')), output, source, p)
		const before = canvasToSource(baseTransform(layerOf(original, 'base')), output, source, p)
		expect(after[0]).toBeCloseTo(before[0], 5)
		expect(after[1]).toBeCloseTo(before[1], 5)
	})

	it('rotates by delta / 10 degrees with the mirror sign rule', () => {
		const { store, stage } = setup('ghost')
		stage.wheelRotate(100)
		// ghost has a single mirror, so a clockwise on-screen turn lowers rotation.
		expect(baseTransform(layerOf(store.document, 'ghost')).rotation).toBeCloseTo(
			-(10 * Math.PI) / 180,
			6
		)
	})
})

describe('nudge', () => {
	it.each([1, 10])('moves the selected layer by %i output px', (px) => {
		const { store, stage, original } = setup()
		stage.nudge(px, 0)
		stage.nudge(0, -px)
		const output = { width: 1080, height: 1920 }
		const source = sourceSize(original, layerOf(original, 'base'))
		const after = canvasToSource(baseTransform(layerOf(store.document, 'base')), output, source, [
			px,
			-px,
		])
		const before = canvasToSource(baseTransform(layerOf(original, 'base')), output, source, [0, 0])
		expect(after[0]).toBeCloseTo(before[0], 5)
		expect(after[1]).toBeCloseTo(before[1], 5)
		stage.destroy()
	})

	it('clears its idle timer on destroy', () => {
		jest.useFakeTimers()
		const { stage } = setup()
		stage.nudge(1, 0)
		expect(jest.getTimerCount()).toBe(1)
		stage.destroy()
		expect(jest.getTimerCount()).toBe(0)
	})
})

describe('view state never touches the document', () => {
	it('leaves store.document the same object and adds no undo step', () => {
		const { store, stage, original } = setup()
		const fitted = stage.view
		expect(fitted.fitted).toBe(true)
		stage.zoomView(1.25)
		stage.zoomView(2, [100, 100])
		stage.panViewBy(30, -40)
		expect(stage.view.fitted).toBe(false)
		stage.actualSize()
		expect(stage.view.scale).toBe(1)
		stage.fit()
		expect(stage.view).toEqual(fitted)
		stage.toggleSafeArea()
		expect(stage.safeArea).toBe(true)
		stage.setAspect('4:5')
		expect(stage.aspect).toBe('4:5')
		stage.setStageSize(800, 800)
		expect(store.document).toBe(original)
		expect(store.canUndo).toBe(false)
	})

	it('refits on resize only while fitted', () => {
		const { stage } = setup()
		stage.setStageSize(800, 1200)
		expect(stage.view.scale).toBeCloseTo(Math.min(768 / 1080, 1168 / 1920), 12)
		stage.zoomView(2)
		const zoomed = stage.view
		stage.setStageSize(700, 700)
		expect(stage.view).toEqual(zoomed)
	})
})

describe('edge warning', () => {
	it('flags the selected layer and memoizes on the document', () => {
		const { stage, layers } = setup()
		expect(stage.reveals).toEqual([])
		expect(stage.gizmo?.warn).toBe(false)
		const first = stage.reveals
		expect(stage.reveals).toBe(first)
		// At zoom 1.02 the breathe and drift bindings cover the canvas at some frames, not others.
		// (At exactly 1, drift-x in phase with breathe means base never covers, so isn't reported.)
		const path = ['tracks', 0, 'clips', 0, 'layers', 0, 'transform']
		layers.store.apply({
			op: 'batch',
			commands: [
				{ op: 'set', path: [...path, 'zoom', 'value'], value: 1.02 },
				{ op: 'set', path: [...path, 'centerX', 'value'], value: 0.5 },
				{ op: 'set', path: [...path, 'centerY', 'value'], value: 0.5 },
			],
		})
		expect(stage.reveals.map((reveal) => reveal.layerId)).toEqual(['base'])
		expect(stage.gizmo?.warn).toBe(true)
	})
})
