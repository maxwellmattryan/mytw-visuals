import { describe, expect, it } from '@jest/globals'

import type { Command, DocumentStore } from '@mytw/document'
import { ID_PATTERN } from '@mytw/schema'
import type { Project, ProjectAsset, ProjectLayer } from '@mytw/schema'

import {
	addImageLayers,
	deleteLayer,
	duplicateLayer,
	moveLayer,
	renameLayer,
	setAnimatable,
	setLayerBlend,
	setLayerVisible,
} from '../commands'
import { nextId } from '../ids'
import type { ImportedImage } from '../import'
import { DEFAULT_CLIP } from '../target'
import {
	emptyProject,
	issuesOf,
	loadUnderstory,
	storeFor,
	UNDERSTORY_HASH,
} from '../testing/fixtures'

const NEW_HASH = 'sha256:' + 'b'.repeat(64)
const OTHER_HASH = 'sha256:' + 'c'.repeat(64)

const asset = (name?: string): ProjectAsset => ({
	kind: 'image',
	mimeType: 'image/png',
	width: 10,
	height: 20,
	...(name !== undefined ? { name } : {}),
})

const image = (hash: string, layerName?: string): ImportedImage =>
	layerName !== undefined ? { hash, asset: asset(), layerName } : { hash, asset: asset() }

const layersOf = (project: Project, track = 0, clip = 0): readonly ProjectLayer[] =>
	project.tracks[track].clips[clip].layers

/** Applies a command, checks the result is valid, then checks one undo restores the start. */
function applyAndUndo(store: DocumentStore<Project>, command: Command | null): Project {
	if (command === null) throw new Error('expected a command')
	const before = store.document
	const result = store.apply(command)
	expect(result).toEqual({ ok: true })
	const after = store.document
	expect(issuesOf(after)).toEqual([])
	expect(store.undo()).toBe(true)
	expect(store.document).toEqual(before)
	return after
}

const EFFECT = {
	id: 'glow',
	effect: 'vignette',
	version: 1,
	enabled: true,
	params: { amount: 0.3 },
}

describe('addImageLayers', () => {
	it('adds one layer per image on top of the stack, in order, with neutral defaults', () => {
		const store = storeFor()
		const built = addImageLayers(store.document, DEFAULT_CLIP, [
			image(NEW_HASH, 'first'),
			image(OTHER_HASH),
		])
		expect(built?.ref).toEqual(DEFAULT_CLIP)
		expect(built?.ids).toEqual(['layer', 'layer-2'])
		const after = applyAndUndo(store, built?.command ?? null)
		const layers = layersOf(after)
		expect(layers.map((layer) => layer.id)).toEqual(['base', 'ghost', 'layer', 'layer-2'])
		expect(layers[2]).toEqual({
			id: 'layer',
			name: 'first',
			kind: 'image',
			asset: NEW_HASH,
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
		})
		expect(layers[3]).not.toHaveProperty('name')
		expect(after.assets[NEW_HASH]).toEqual(asset())
		expect(after.assets[OTHER_HASH]).toEqual(asset())
	})

	it('writes each asset entry only when absent', () => {
		const project = loadUnderstory()
		const built = addImageLayers(project, DEFAULT_CLIP, [
			image(UNDERSTORY_HASH),
			image(NEW_HASH),
			image(NEW_HASH),
		])
		if (built?.command.op !== 'batch') throw new Error('expected a batch')
		const assetWrites = built.command.commands.filter(
			(command) => command.op === 'set' && command.path[0] === 'assets'
		)
		expect(assetWrites).toEqual([{ op: 'set', path: ['assets', NEW_HASH], value: asset() }])
		const after = applyAndUndo(storeFor(project), built.command)
		expect(after.assets[UNDERSTORY_HASH]).toEqual(project.assets[UNDERSTORY_HASH])
		expect(layersOf(after)).toHaveLength(5)
	})

	it('creates track-1 with clip-1 when the clip does not exist', () => {
		const project = emptyProject()
		const built = addImageLayers(project, DEFAULT_CLIP, [image(NEW_HASH, 'photo')])
		expect(built?.ref).toEqual({ track: 0, clip: 0 })
		const after = applyAndUndo(storeFor(project), built?.command ?? null)
		expect(after.tracks).toHaveLength(1)
		const track = after.tracks[0]
		expect(track.id).toBe('track-1')
		expect(track.kind).toBe('visual')
		expect(track.clips).toHaveLength(1)
		const { layers, ...clip } = track.clips[0]
		expect(clip).toEqual({
			id: 'clip-1',
			start: 0,
			frames: project.timeline.frames,
			fadeIn: 0,
			fadeOut: 0,
		})
		expect(layers.map((layer) => layer.name)).toEqual(['photo'])
	})

	it('appends the new track after existing ones when the ref points past them', () => {
		const project = loadUnderstory()
		const built = addImageLayers(project, { track: 3, clip: 0 }, [image(NEW_HASH)])
		expect(built?.ref).toEqual({ track: 1, clip: 0 })
		const after = applyAndUndo(storeFor(project), built?.command ?? null)
		expect(after.tracks.map((track) => track.id)).toEqual(['main', 'track-1'])
		expect(layersOf(after, 1)).toHaveLength(1)
	})

	it('cuts layer names to 200 characters and returns null for no images', () => {
		const project = loadUnderstory()
		const built = addImageLayers(project, DEFAULT_CLIP, [image(NEW_HASH, 'n'.repeat(300))])
		const after = applyAndUndo(storeFor(project), built?.command ?? null)
		expect(layersOf(after)[2].name).toBe('n'.repeat(200))
		expect(addImageLayers(project, DEFAULT_CLIP, [])).toBeNull()
	})
})

describe('duplicateLayer', () => {
	/** Understory with an effect on the ghost layer, and an effect id that the copy must avoid. */
	function withEffects(): DocumentStore<Project> {
		const store = storeFor()
		const result = store.apply({
			op: 'batch',
			commands: [
				{ op: 'set', path: ['tracks', 0, 'clips', 0, 'layers', 1, 'effects'], value: [EFFECT] },
				{ op: 'set', path: ['effects', 0, 'id'], value: 'glow-2' },
			],
		})
		expect(result).toEqual({ ok: true })
		return storeFor(store.document)
	}

	it('inserts a deep copy above the original with fresh ids and a copy name', () => {
		const store = withEffects()
		const original = layersOf(store.document)[1]
		const built = duplicateLayer(store.document, DEFAULT_CLIP, 1)
		expect(built?.id).toBe('ghost-2')
		const after = applyAndUndo(store, built?.command ?? null)
		const layers = layersOf(after)
		expect(layers.map((layer) => layer.id)).toEqual(['base', 'ghost', 'ghost-2'])
		const copy = layers[2]
		expect(copy.name).toBe('Ghost copy')
		expect(copy.effects.map((effect) => effect.id)).toEqual(['glow-3'])
		expect({
			...copy,
			id: original.id,
			name: original.name,
			effects: copy.effects.map((effect) => ({ ...effect, id: EFFECT.id })),
		}).toEqual(original)
		expect(copy.transform).not.toBe(original.transform)
	})

	it('names an unnamed copy after its id and cuts the name to 200 characters', () => {
		const store = storeFor()
		expect(
			store.apply({
				op: 'batch',
				commands: [
					{ op: 'remove', path: ['tracks', 0, 'clips', 0, 'layers', 0, 'name'] },
					{
						op: 'set',
						path: ['tracks', 0, 'clips', 0, 'layers', 1, 'name'],
						value: 'x'.repeat(200),
					},
				],
			})
		).toEqual({ ok: true })
		const project = store.document
		const unnamed = duplicateLayer(project, DEFAULT_CLIP, 0)
		const long = duplicateLayer(project, DEFAULT_CLIP, 1)
		expect(
			applyAndUndo(storeFor(project), unnamed?.command ?? null).tracks[0].clips[0].layers[1].name
		).toBe('base copy')
		expect(
			applyAndUndo(storeFor(project), long?.command ?? null).tracks[0].clips[0].layers[2].name
		).toBe('x'.repeat(200))
		expect(duplicateLayer(project, DEFAULT_CLIP, 5)).toBeNull()
	})
})

describe('layer edits', () => {
	it('deleteLayer removes the layer and keeps its asset', () => {
		const store = storeFor()
		const after = applyAndUndo(store, deleteLayer(store.document, DEFAULT_CLIP, 0))
		expect(layersOf(after).map((layer) => layer.id)).toEqual(['ghost'])
		expect(after.assets).toEqual(store.document.assets)
		expect(deleteLayer(store.document, DEFAULT_CLIP, 2)).toBeNull()
	})

	it('deleteLayer keeps the asset even when no layer uses it any more', () => {
		const store = storeFor()
		expect(
			store.apply(deleteLayer(store.document, DEFAULT_CLIP, 0) ?? { op: 'batch', commands: [] })
		).toEqual({ ok: true })
		const after = applyAndUndo(store, deleteLayer(store.document, DEFAULT_CLIP, 0))
		expect(layersOf(after)).toEqual([])
		expect(Object.keys(after.assets)).toEqual([UNDERSTORY_HASH])
	})

	it('renameLayer trims, cuts to 200 characters, removes an empty name and skips no-ops', () => {
		const store = storeFor()
		const project = store.document
		const renamed = applyAndUndo(store, renameLayer(project, DEFAULT_CLIP, 0, '  Sky  '))
		expect(layersOf(renamed)[0].name).toBe('Sky')
		const long = applyAndUndo(store, renameLayer(project, DEFAULT_CLIP, 0, 'y'.repeat(250)))
		expect(layersOf(long)[0].name).toBe('y'.repeat(200))
		const cleared = applyAndUndo(store, renameLayer(project, DEFAULT_CLIP, 0, '   '))
		expect(layersOf(cleared)[0]).not.toHaveProperty('name')
		expect(renameLayer(project, DEFAULT_CLIP, 0, 'Base')).toBeNull()
		expect(renameLayer(project, DEFAULT_CLIP, 0, ' Base ')).toBeNull()
		expect(renameLayer(cleared, DEFAULT_CLIP, 0, '')).toBeNull()
		expect(renameLayer(cleared, DEFAULT_CLIP, 0, 'base')).toBeNull()
	})

	it('moveLayer moves a layer within the stack and skips moves out of range', () => {
		const store = storeFor()
		const project = store.document
		const after = applyAndUndo(store, moveLayer(project, DEFAULT_CLIP, 0, 1))
		expect(layersOf(after).map((layer) => layer.id)).toEqual(['ghost', 'base'])
		expect(moveLayer(project, DEFAULT_CLIP, 1, 2)).toBeNull()
		expect(moveLayer(project, DEFAULT_CLIP, 0, -1)).toBeNull()
		expect(moveLayer(project, DEFAULT_CLIP, 1, 1)).toBeNull()
	})

	it('setLayerVisible sets visible', () => {
		const store = storeFor()
		const after = applyAndUndo(store, setLayerVisible(store.document, DEFAULT_CLIP, 1, false))
		expect(layersOf(after)[1].visible).toBe(false)
		expect(setLayerVisible(store.document, DEFAULT_CLIP, 1, true)).toBeNull()
	})

	it('setLayerBlend sets blend', () => {
		const store = storeFor()
		const after = applyAndUndo(store, setLayerBlend(store.document, DEFAULT_CLIP, 0, 'screen'))
		expect(layersOf(after)[0].blend).toBe('screen')
		expect(setLayerBlend(store.document, DEFAULT_CLIP, 0, 'normal')).toBeNull()
	})
})

describe('setAnimatable', () => {
	const transform = ['tracks', 0, 'clips', 0, 'layers', 0, 'transform']

	it('writes value inside { value, mod } and keeps mod', () => {
		const store = storeFor()
		const before = layersOf(store.document)[0].transform.zoom
		const command = setAnimatable(store.document, [...transform, 'zoom'], 2.5)
		expect(command).toEqual({ op: 'set', path: [...transform, 'zoom', 'value'], value: 2.5 })
		const after = applyAndUndo(store, command)
		const zoom = layersOf(after)[0].transform.zoom
		expect(zoom).toEqual({ value: 2.5, mod: typeof before === 'object' ? before.mod : null })
	})

	it('writes a bare number in place', () => {
		const store = storeFor()
		const command = setAnimatable(store.document, [...transform, 'rotation'], 0.3)
		expect(command).toEqual({ op: 'set', path: [...transform, 'rotation'], value: 0.3 })
		const after = applyAndUndo(store, command)
		expect(layersOf(after)[0].transform.rotation).toBe(0.3)
		expect(setAnimatable(store.document, [...transform, 'rotation'], 0)).toBeNull()
	})
})

describe('nextId', () => {
	it('returns base, then base-2, base-3, … unused across tracks, clips, layers and effects', () => {
		const project = loadUnderstory()
		expect(nextId(project, 'layer')).toBe('layer')
		expect(nextId(project, 'base')).toBe('base-2')
		expect(nextId(project, 'main')).toBe('main-2')
		expect(nextId(project, 'understory')).toBe('understory-2')
		expect(nextId(project, 'vignette')).toBe('vignette-2')
		expect(nextId(project, 'base', new Set(['base-2']))).toBe('base-3')
	})

	it('counts layer effect ids', () => {
		const store = storeFor()
		store.apply({
			op: 'set',
			path: ['tracks', 0, 'clips', 0, 'layers', 0, 'effects'],
			value: [EFFECT, { ...EFFECT, id: 'glow-2' }],
		})
		expect(nextId(store.document, 'glow')).toBe('glow-3')
	})

	it('keeps results within ID_PATTERN', () => {
		const project = loadUnderstory()
		const long = 'a'.repeat(64)
		const store = storeFor()
		store.apply({ op: 'set', path: ['tracks', 0, 'id'], value: long })
		const id = nextId(store.document, long)
		expect(id).toBe('a'.repeat(62) + '-2')
		expect(id).toMatch(ID_PATTERN)
		expect(nextId(project, 'not valid!')).toBe('layer')
		expect(nextId(project, '')).toBe('layer')
	})
})
