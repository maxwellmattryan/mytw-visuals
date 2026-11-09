import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { createSession, listLayers } from '../src/session'

const FIXTURES = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../packages/schema/fixtures'
)
const fixture = (path: string): string => readFileSync(resolve(FIXTURES, path), 'utf8')

const understory = fixture('v1/understory.json')
const minimal = fixture('v1/minimal.json')
const BASE = { track: 0, clip: 0, layer: 0 }

describe('createSession', () => {
	it('starts with no project', () => {
		const session = createSession()
		expect(session.project).toBeNull()
		expect(session.scene).toBeNull()
		expect([session.canUndo, session.canRedo]).toEqual([false, false])
		expect(session.undo()).toBe(false)
		expect(session.setLayerVisible(BASE, false).ok).toBe(false)
	})

	it('opens the Understory fixture', () => {
		const session = createSession()
		let changes = 0
		session.subscribe(() => changes++)
		expect(session.open(understory)).toEqual({ ok: true })
		expect(session.project?.name).toBe('Understory')
		expect(session.scene).toMatchObject({ width: 1080, height: 1920, fps: 30, frames: 225 })
		expect(session.scene?.images).toEqual([
			'sha256:740b8530c50ed203aa2ecb3ef2ecd24e100b1fef711424f2c8033bb6b724384b',
		])
		expect(session.sceneError).toBeNull()
		expect([session.canUndo, session.canRedo]).toEqual([false, false])
		expect(changes).toBe(1)
	})

	it('opens an already parsed value', () => {
		const session = createSession()
		expect(session.open(JSON.parse(minimal))).toEqual({ ok: true })
		expect(session.scene?.frames).toBe(60)
		expect(listLayers(session.project!)).toEqual([])
	})

	it('keeps the open project when an open fails', () => {
		const session = createSession()
		session.open(understory)
		session.setLayerVisible(BASE, false)
		const project = session.project
		let changes = 0
		session.subscribe(() => changes++)

		const notJson = session.open('{ nope')
		expect(notJson).toEqual({
			ok: false,
			message: 'Could not open the project: document: Not valid JSON',
		})

		const invalid = JSON.parse(minimal)
		invalid.output.fps = 0
		const bad = session.open(invalid)
		expect(bad.ok).toBe(false)
		if (!bad.ok) expect(bad.message).toMatch(/^Could not open the project: output\.fps: /)

		// v2 with a sketch layer parses, but the scene can't render it.
		const sketch = session.open(fixture('v2/sketch-layer.json'))
		expect(sketch.ok).toBe(false)
		if (!sketch.ok)
			expect(sketch.message).toMatch(/^tracks\[0\]\.clips\[0\]\.layers\[\d+\]\.kind: /)

		expect(session.project).toBe(project)
		expect(session.canUndo).toBe(true)
		expect(changes).toBe(0)
	})

	it('clears history when another project opens', () => {
		const session = createSession()
		session.open(understory)
		session.setLayerVisible(BASE, false)
		expect(session.canUndo).toBe(true)
		expect(session.open(minimal)).toEqual({ ok: true })
		expect(session.project?.name).toBe('Minimal')
		expect([session.canUndo, session.canRedo]).toEqual([false, false])
		expect(session.undo()).toBe(false)
		// Re-opening the same project also starts fresh.
		session.open(understory)
		session.setLayerVisible(BASE, false)
		session.open(understory)
		expect(session.project?.tracks[0].clips[0].layers[0].visible).toBe(true)
		expect(session.canUndo).toBe(false)
	})

	it('toggles layer visibility through a command with undo and redo', () => {
		const session = createSession()
		session.open(understory)
		let changes = 0
		session.subscribe(() => changes++)
		const visible = () => session.project?.tracks[0].clips[0].layers[0].visible
		const frameLayer = () => session.scene?.frameAt(0).layers.find((l) => l.id === 'base')

		expect(session.setLayerVisible(BASE, false)).toEqual({ ok: true })
		expect(visible()).toBe(false)
		expect(frameLayer()?.visible).toBe(false)
		expect([session.canUndo, session.canRedo]).toEqual([true, false])

		expect(session.undo()).toBe(true)
		expect(visible()).toBe(true)
		expect(frameLayer()?.visible).toBe(true)
		expect([session.canUndo, session.canRedo]).toEqual([false, true])

		expect(session.redo()).toBe(true)
		expect(visible()).toBe(false)
		expect(frameLayer()?.visible).toBe(false)
		expect([session.canUndo, session.canRedo]).toEqual([true, false])
		expect(changes).toBe(3)

		// One command is one history step.
		expect(session.undo()).toBe(true)
		expect(session.undo()).toBe(false)
	})

	it('rejects a visibility edit on a layer that does not exist', () => {
		const session = createSession()
		session.open(understory)
		expect(session.setLayerVisible({ track: 0, clip: 0, layer: 99 }, false).ok).toBe(false)
		expect(session.canUndo).toBe(false)
	})
})

describe('listLayers', () => {
	it('lists the top of the composite first', () => {
		const session = createSession()
		session.open(understory)
		const project = session.project!
		const layers = project.tracks[0].clips[0].layers
		const rows = listLayers(project)
		expect(rows.map((row) => row.id)).toEqual(layers.map((l) => l.id).reverse())
		expect(rows[rows.length - 1]).toEqual({
			ref: BASE,
			id: 'base',
			name: 'Base',
			kind: 'image',
			visible: true,
		})
		for (const row of rows) {
			const source = layers[row.ref.layer]
			expect(row.name).toBe(source.name ?? source.id)
		}
	})

	it('puts the last track first', () => {
		const doc = JSON.parse(understory)
		const second = JSON.parse(JSON.stringify(doc.tracks[0]))
		second.id = 'overlay'
		second.clips[0].id = 'overlay-clip'
		second.clips[0].layers = [{ ...second.clips[0].layers[0], id: 'top' }]
		delete second.clips[0].layers[0].name
		doc.tracks.push(second)
		const session = createSession()
		expect(session.open(doc)).toEqual({ ok: true })
		const rows = listLayers(session.project!)
		expect(rows[0]).toMatchObject({ ref: { track: 1, clip: 0, layer: 0 }, id: 'top', name: 'top' })
		expect(rows[1].ref.track).toBe(0)
	})
})
