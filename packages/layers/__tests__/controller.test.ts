import { describe, expect, it, jest } from '@jest/globals'

import { MemoryAssetSource } from '@mytw/assets'
import type { RenderFrame, RenderLayer } from '@mytw/engine'
import type { Project } from '@mytw/schema'

import { createLayersController } from '../controller'
import { applySolo } from '../solo'
import { emptyProject, fileOf, pngBytes, storeFor } from '../testing/fixtures'

function controllerFor(project?: Project) {
	const store = storeFor(project)
	const controller = createLayersController({ store, assetStore: new MemoryAssetSource() })
	return { store, controller }
}

const ids = (controller: ReturnType<typeof controllerFor>['controller']) =>
	controller.layers.map((layer) => layer.id)

describe('selection', () => {
	it('selects a layer, ignores unknown ids and seals the store when it changes', () => {
		const { store, controller } = controllerFor()
		const seal = jest.spyOn(store, 'seal')
		expect(controller.selectedId).toBeNull()
		controller.select('ghost')
		expect(controller.selectedId).toBe('ghost')
		expect(seal).toHaveBeenCalledTimes(1)
		controller.select('ghost')
		expect(seal).toHaveBeenCalledTimes(1)
		controller.select('missing')
		expect(controller.selectedId).toBeNull()
	})

	it('moves the selection to the layer below on delete, else the new bottom, else null', () => {
		const { controller } = controllerFor()
		controller.duplicate('base')
		expect(ids(controller)).toEqual(['base', 'base-2', 'ghost'])
		controller.select('ghost')
		controller.remove('ghost')
		expect(controller.selectedId).toBe('base-2')
		controller.select('base')
		controller.remove('base')
		expect(controller.selectedId).toBe('base-2')
		controller.remove('base-2')
		expect(controller.selectedId).toBeNull()
		expect(controller.layers).toEqual([])
	})

	it('keeps the selection when another layer is deleted', () => {
		const { controller } = controllerFor()
		controller.select('ghost')
		controller.remove('base')
		expect(controller.selectedId).toBe('ghost')
	})

	it('selects the copy after duplicating', () => {
		const { controller } = controllerFor()
		controller.select('base')
		controller.duplicate('base')
		expect(controller.selectedId).toBe('base-2')
		expect(ids(controller)).toEqual(['base', 'base-2', 'ghost'])
	})

	it('selects the last image added, as one undo step, and reports skipped files', async () => {
		const { store, controller } = controllerFor()
		const before = store.document
		const pending = controller.importFiles([
			fileOf('a.png', pngBytes(4, 4)),
			fileOf('notes.txt', 'hello'),
			fileOf('b.png', pngBytes(4, 4, 1)),
		])
		expect(controller.busy).toBe(true)
		await pending
		expect(controller.busy).toBe(false)
		expect(ids(controller)).toEqual(['base', 'ghost', 'layer', 'layer-2'])
		expect(controller.layers.map((layer) => layer.name)).toEqual(['Base', 'Ghost', 'a', 'b'])
		expect(controller.selectedId).toBe('layer-2')
		expect(controller.error).toBe('"notes.txt" is not a PNG, JPEG or WebP image')
		store.undo()
		expect(store.document).toEqual(before)
	})

	it('creates a clip for the first image in an empty project', async () => {
		const { controller } = controllerFor(emptyProject())
		expect(controller.layers).toEqual([])
		await controller.importFiles([fileOf('a.png', pngBytes(4, 4))])
		expect(ids(controller)).toEqual(['layer'])
		expect(controller.selectedId).toBe('layer')
		expect(controller.error).toBeNull()
	})

	it('clears the selection when an undo removes the selected layer', () => {
		const { store, controller } = controllerFor()
		controller.duplicate('ghost')
		expect(controller.selectedId).toBe('ghost-2')
		store.undo()
		expect(controller.selectedId).toBeNull()
		store.redo()
		expect(controller.selectedId).toBeNull()
	})

	it('moves layers by delta and by index, and sets the error line on a rejected command', () => {
		const { store, controller } = controllerFor()
		controller.move('base', 1)
		expect(ids(controller)).toEqual(['ghost', 'base'])
		controller.move('base', 1)
		expect(ids(controller)).toEqual(['ghost', 'base'])
		controller.moveTo(1, 0)
		expect(ids(controller)).toEqual(['base', 'ghost'])
		// A blend the format rejects reaches the store and comes back as the error line.
		const listener = jest.fn()
		controller.subscribe(listener)
		controller.setBlend('base', 'overlay' as 'add')
		expect(controller.error).toBe('the document validator rejected the result')
		expect(listener).toHaveBeenCalled()
		controller.rename('base', 'Sky')
		expect(controller.error).toBeNull()
		expect(store.document.tracks[0].clips[0].layers[0].name).toBe('Sky')
	})
})

describe('solo', () => {
	const layer = (id: string, visible?: boolean): RenderLayer =>
		visible === undefined ? { id, image: 'img' } : { id, image: 'img', visible }

	it('applySolo returns the frame unchanged for an empty set', () => {
		const frame: RenderFrame = { layers: [layer('a'), layer('b')] }
		expect(applySolo(frame, new Set())).toBe(frame)
	})

	it('applySolo hides every layer outside the set and never shows a hidden one', () => {
		const frame: RenderFrame = {
			background: [0, 0, 0, 1],
			layers: [layer('a'), layer('b', false), layer('c', true)],
		}
		const copy = structuredClone(frame)
		const soloed = applySolo(frame, new Set(['b', 'c']))
		expect(soloed).toEqual({
			background: [0, 0, 0, 1],
			layers: [layer('a', false), layer('b', false), layer('c', true)],
		})
		expect(frame).toEqual(copy)
	})

	it('toggles solo ids without touching the document or history', () => {
		const { store, controller } = controllerFor()
		const before = store.document
		controller.toggleSolo('ghost')
		controller.toggleSolo('base')
		expect([...controller.solo].sort()).toEqual(['base', 'ghost'])
		controller.toggleSolo('base')
		expect([...controller.solo]).toEqual(['ghost'])
		controller.toggleSolo('missing')
		expect([...controller.solo]).toEqual(['ghost'])
		expect(store.document).toBe(before)
		expect(store.canUndo).toBe(false)
	})

	it('drops solo ids whose layer is gone after a delete or an undo', () => {
		const { store, controller } = controllerFor()
		controller.duplicate('base')
		controller.toggleSolo('base-2')
		controller.toggleSolo('ghost')
		store.undo()
		expect([...controller.solo]).toEqual(['ghost'])
		controller.remove('ghost')
		expect(controller.solo.size).toBe(0)
	})

	it('toggleVisible writes visible as an undoable document change', () => {
		const { store, controller } = controllerFor()
		controller.toggleVisible('ghost')
		expect(store.document.tracks[0].clips[0].layers[1].visible).toBe(false)
		store.undo()
		expect(store.document.tracks[0].clips[0].layers[1].visible).toBe(true)
	})
})
