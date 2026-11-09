import { describe, expect, it } from '@jest/globals'

import { MemoryAssetSource } from '@mytw/assets'
import type { ProjectLayer } from '@mytw/schema'

import { createLayersController } from '../controller'
import { createLayerModel, LAYER_SCHEMA, MASK_DIFFERS_MESSAGE, MODULATED_HELP } from '../properties'
import { storeFor } from '../testing/fixtures'

function setup(select: string | null = 'ghost') {
	const store = storeFor()
	const controller = createLayersController({ store, assetStore: new MemoryAssetSource() })
	controller.select(select)
	const model = createLayerModel(controller)
	const layer = (id = 'ghost'): ProjectLayer => {
		const found = controller.layers.find((l) => l.id === id)
		if (!found) throw new Error(`no layer ${id}`)
		return found
	}
	return { store, controller, model, layer }
}

describe('layer model', () => {
	it('reads the selected layer, showing animatable fields as their value', () => {
		const { model, controller } = setup()
		expect(model.values).toEqual({
			opacity: 1,
			blend: 'multiply',
			feather: 0.06,
			centerX: 0.2,
			centerY: 0.75,
			zoom: 3.4,
			rotation: 0,
			mirrorX: true,
			mirrorY: false,
			maskFrom: [0.5, 1],
			maskTo: [0.5, 0],
		})
		expect(model.hasMask).toBe(true)
		expect([...model.modulated].sort()).toEqual(['centerX', 'centerY', 'rotation', 'zoom'])
		expect(model.schema.params.zoom.help).toBe(MODULATED_HELP)
		expect(model.schema.params.opacity.help).toBeUndefined()
		const values = model.values
		controller.select('base')
		expect(model.values).toBe(values)
		expect(model.values.blend).toBe('normal')
		expect(model.values.zoom).toBe(2)
		expect(model.hasMask).toBe(false)
		expect(model.schema.params.rotation.help).toBeUndefined()
	})

	it('shows defaults and rejects edits with no selection', () => {
		const { model } = setup(null)
		expect(model.layer).toBeNull()
		expect(model.values.opacity).toBe(1)
		expect(model.set('opacity', 0.5).ok).toBe(false)
	})

	it('applies sets through the store and merges several sets on one param into one undo step', () => {
		const { store, model, layer } = setup()
		const before = store.document
		expect(model.set('opacity', 0.5)).toEqual({ ok: true })
		expect(model.set('opacity', 0.4)).toEqual({ ok: true })
		expect(model.setText('opacity', '0.3')).toEqual({ ok: true })
		expect(layer().opacity).toBe(0.3)
		expect(model.values.opacity).toBe(0.3)
		store.undo()
		expect(store.document).toEqual(before)
	})

	it('keeps mod when editing a modulated field', () => {
		const { model, layer } = setup()
		const mod = (layer().transform.zoom as { mod: unknown }).mod
		expect(model.set('zoom', 5)).toEqual({ ok: true })
		expect(layer().transform.zoom).toEqual({ value: 5, mod })
		expect(model.set('mirrorX', false)).toEqual({ ok: true })
		expect(layer().transform.mirrorX).toBe(false)
		expect(model.set('blend', 'screen')).toEqual({ ok: true })
		expect(layer().blend).toBe('screen')
	})

	it('starts a new undo step after the selection changes', () => {
		const { store, model, controller, layer } = setup()
		model.set('feather', 0.1)
		controller.select('base')
		controller.select('ghost')
		model.set('feather', 0.2)
		store.undo()
		expect(layer().feather).toBe(0.1)
	})

	it('rejects out-of-range values and equal mask points with a field error', () => {
		const { store, model } = setup()
		const before = store.document
		expect(model.set('opacity', 2).ok).toBe(false)
		expect(model.errors.opacity).toMatch(/opacity/)
		expect(model.set('zoom', 0).ok).toBe(false)
		expect(model.setText('feather', 'abc')).toEqual({ ok: false, message: 'Enter a number' })
		expect(model.set('maskTo', [0.5, 1])).toEqual({ ok: false, message: MASK_DIFFERS_MESSAGE })
		expect(model.errors.maskTo).toBe(MASK_DIFFERS_MESSAGE)
		expect(model.setText('maskFrom', '0', 1)).toEqual({ ok: false, message: MASK_DIFFERS_MESSAGE })
		expect(store.document).toBe(before)
		expect(model.set('opacity', 0.5).ok).toBe(true)
		expect(model.errors.opacity).toBeUndefined()
	})

	it('resets one field to neutral, and Reset all resets every field but the mask in one step', () => {
		const { store, model, layer } = setup()
		const before = layer()
		model.reset('blend')
		expect(layer().blend).toBe('normal')
		model.reset('zoom')
		expect(layer().transform.zoom).toEqual({
			value: 1,
			mod: (before.transform.zoom as { mod: unknown }).mod,
		})
		store.undo()
		store.undo()
		model.resetAll()
		const reset = layer()
		expect(reset.opacity).toBe(1)
		expect(reset.blend).toBe('normal')
		expect(reset.feather).toBe(0)
		expect(model.values).toMatchObject({
			centerX: 0.5,
			centerY: 0.5,
			zoom: 1,
			rotation: 0,
			mirrorX: false,
			mirrorY: false,
		})
		expect(reset.mask).toEqual(before.mask)
		store.undo()
		expect(layer()).toEqual(before)
	})

	it('adds and removes the mask, and edits it while present', () => {
		const { store, model, layer } = setup('base')
		expect(model.hasMask).toBe(false)
		expect(model.set('maskFrom', [0, 0]).ok).toBe(false)
		model.addMask()
		expect(layer('base').mask).toEqual({ kind: 'linear-gradient', from: [0.5, 0], to: [0.5, 1] })
		expect(model.values.maskFrom).toEqual([0.5, 0])
		expect(model.setText('maskTo', '0.8', 1)).toEqual({ ok: true })
		expect(layer('base').mask).toEqual({ kind: 'linear-gradient', from: [0.5, 0], to: [0.5, 0.8] })
		model.removeMask()
		expect(layer('base')).not.toHaveProperty('mask')
		store.undo()
		store.undo()
		store.undo()
		expect(layer('base')).not.toHaveProperty('mask')
	})

	it('groups params as Layer, Framing and Mask', () => {
		const groups = Object.values(LAYER_SCHEMA.params).map((def) => def.group)
		expect([...new Set(groups)]).toEqual(['Layer', 'Framing', 'Mask'])
	})
})
