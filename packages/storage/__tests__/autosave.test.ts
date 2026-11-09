import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { IDBFactory } from 'fake-indexeddb'

import { createDocumentStore } from '@mytw/document'
import type { DocumentStore } from '@mytw/document'
import { PROJECT_SCHEMA_VERSION, validateProject } from '@mytw/schema'
import type { Project } from '@mytw/schema'
import {
	createAutosave,
	createLocalProjectStore,
	newProject,
	ProjectStoreError,
	STORAGE_FULL_MESSAGE,
} from '@mytw/storage'
import type { AutosaveOptions, AutosaveStatus, ProjectMeta } from '@mytw/storage'

const META: ProjectMeta = {
	id: 'p1',
	name: 'Untitled',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	schemaVersion: PROJECT_SCHEMA_VERSION,
	hasThumbnail: false,
}

/** A store whose saves can be held open, failed, and counted. */
function fakeStore() {
	const saved: Project[] = []
	const held: Array<() => void> = []
	const state = { hold: false, fail: null as unknown, active: 0, maxActive: 0 }
	const save = jest.fn(
		(_id: string, project: Project) =>
			new Promise<ProjectMeta>((resolve, reject) => {
				state.active++
				state.maxActive = Math.max(state.maxActive, state.active)
				const settle = () => {
					state.active--
					if (state.fail) reject(state.fail)
					else {
						saved.push(project)
						resolve(META)
					}
				}
				if (state.hold) held.push(settle)
				else settle()
			})
	)
	const setThumbnail = jest.fn(async (_id: string, _bytes: Uint8Array, _mimeType: string) => {})
	const release = () => {
		for (const settle of held.splice(0)) settle()
	}
	return { store: { save, setThumbnail }, saved, state, release }
}

function documentStore(): DocumentStore<Project> {
	return createDocumentStore<Project>({ document: newProject(), validate: validateProject })
}

function setBackground(doc: DocumentStore<Project>, value: string) {
	const result = doc.apply({ op: 'set', path: ['output', 'background'], value })
	if (!result.ok) throw new Error(result.error.message)
}

const color = (n: number) => `#0000${n.toString(16).padStart(2, '0')}`

function setup(options: Partial<AutosaveOptions> = {}) {
	const fake = fakeStore()
	const doc = documentStore()
	const statuses: AutosaveStatus[] = []
	const autosave = createAutosave({
		store: fake.store,
		id: 'p1',
		document: doc,
		target: null,
		onStatus: (status) => statuses.push(status),
		...options,
	})
	return { ...fake, doc, autosave, statuses }
}

describe('createAutosave', () => {
	beforeEach(() => {
		jest.useFakeTimers()
	})
	afterEach(() => {
		jest.useRealTimers()
		jest.restoreAllMocks()
	})

	it('saves once, 500 ms after a burst of changes', async () => {
		const { doc, autosave, store, saved, statuses } = setup()
		expect(autosave.status).toBe('saved')
		for (let i = 1; i <= 5; i++) {
			setBackground(doc, color(i))
			await jest.advanceTimersByTimeAsync(100)
		}
		expect(autosave.status).toBe('pending')
		await jest.advanceTimersByTimeAsync(399)
		expect(store.save).not.toHaveBeenCalled()
		await jest.advanceTimersByTimeAsync(1)
		expect(store.save).toHaveBeenCalledTimes(1)
		expect(saved[0].output.background).toBe(color(5))
		expect(autosave.status).toBe('saved')
		expect(statuses).toEqual(['pending', 'saving', 'saved'])
		await jest.advanceTimersByTimeAsync(10_000)
		expect(store.save).toHaveBeenCalledTimes(1)
	})

	it('saves at least every 5 s while changes keep arriving', async () => {
		const { doc, store, saved } = setup()
		for (let t = 0; t < 4900; t += 300) {
			setBackground(doc, color(t / 300 + 1))
			await jest.advanceTimersByTimeAsync(300)
		}
		// 17 changes, 300 ms apart: the debounce never fires, so only the 5 s cap can.
		expect(store.save).toHaveBeenCalledTimes(1)
		expect(saved[0].output.background).toBe(color(17))
		for (let t = 0; t < 5000; t += 300) {
			setBackground(doc, color(t / 300 + 20))
			await jest.advanceTimersByTimeAsync(300)
		}
		expect(store.save).toHaveBeenCalledTimes(2)
	})

	it('never overlaps saves and saves the latest document after a change during a save', async () => {
		const { doc, autosave, store, saved, state, release } = setup()
		state.hold = true
		setBackground(doc, color(1))
		await jest.advanceTimersByTimeAsync(500)
		expect(store.save).toHaveBeenCalledTimes(1)
		expect(autosave.status).toBe('saving')
		setBackground(doc, color(2))
		setBackground(doc, color(3))
		await jest.advanceTimersByTimeAsync(5000)
		expect(store.save).toHaveBeenCalledTimes(1)
		release()
		await jest.advanceTimersByTimeAsync(0)
		expect(store.save).toHaveBeenCalledTimes(2)
		expect(autosave.status).toBe('saving')
		release()
		await jest.advanceTimersByTimeAsync(0)
		expect(state.maxActive).toBe(1)
		expect(saved.map((project) => project.output.background)).toEqual([color(1), color(3)])
		expect(autosave.status).toBe('saved')
	})

	it('reports an error, keeps changes pending and retries on the next change or flush', async () => {
		const { doc, autosave, store, saved, state } = setup()
		state.fail = new ProjectStoreError('quota-exceeded', 'full')
		setBackground(doc, color(1))
		await jest.advanceTimersByTimeAsync(500)
		expect(autosave.status).toBe('error')
		expect(autosave.error).toBe(STORAGE_FULL_MESSAGE)
		await jest.advanceTimersByTimeAsync(10_000)
		expect(store.save).toHaveBeenCalledTimes(1)

		state.fail = null
		setBackground(doc, color(2))
		await jest.advanceTimersByTimeAsync(500)
		expect(store.save).toHaveBeenCalledTimes(2)
		expect(autosave.status).toBe('saved')
		expect(autosave.error).toBeNull()
		expect(saved[0].output.background).toBe(color(2))

		state.fail = new Error('disk on fire')
		setBackground(doc, color(3))
		await autosave.flush()
		expect(autosave.status).toBe('error')
		expect(autosave.error).toBe('disk on fire')
		state.fail = null
		await autosave.flush()
		expect(autosave.status).toBe('saved')
		expect(saved[1].output.background).toBe(color(3))
	})

	it('flushes on flush(), pagehide, hidden visibility and dispose()', async () => {
		const target = new EventTarget()
		const { doc, autosave, store, saved } = setup({ target })
		setBackground(doc, color(1))
		await autosave.flush()
		expect(store.save).toHaveBeenCalledTimes(1)
		await jest.advanceTimersByTimeAsync(10_000)
		expect(store.save).toHaveBeenCalledTimes(1)
		await autosave.flush()
		expect(store.save).toHaveBeenCalledTimes(1)

		doc.undo()
		target.dispatchEvent(new Event('pagehide'))
		await jest.advanceTimersByTimeAsync(0)
		expect(store.save).toHaveBeenCalledTimes(2)
		expect(saved[1].output.background).toBe('#000000')

		const page = globalThis as { document?: { visibilityState: string } }
		page.document = { visibilityState: 'visible' }
		try {
			doc.redo()
			target.dispatchEvent(new Event('visibilitychange'))
			await jest.advanceTimersByTimeAsync(0)
			expect(store.save).toHaveBeenCalledTimes(2)
			page.document.visibilityState = 'hidden'
			target.dispatchEvent(new Event('visibilitychange'))
			await jest.advanceTimersByTimeAsync(0)
			expect(store.save).toHaveBeenCalledTimes(3)
		} finally {
			delete page.document
		}

		doc.load({ ...newProject('Loaded') })
		await autosave.dispose()
		expect(store.save).toHaveBeenCalledTimes(4)
		expect(saved[3].name).toBe('Loaded')
		setBackground(doc, color(9))
		target.dispatchEvent(new Event('pagehide'))
		await autosave.dispose()
		await jest.advanceTimersByTimeAsync(10_000)
		expect(store.save).toHaveBeenCalledTimes(4)
	})

	it('stores a thumbnail at most every 5 s and on dispose', async () => {
		const thumbnail = jest.fn(async () => new Uint8Array([1]))
		const { doc, autosave, store } = setup({ thumbnail })
		setBackground(doc, color(1))
		await jest.advanceTimersByTimeAsync(500)
		expect(store.setThumbnail).toHaveBeenCalledTimes(1)
		expect(store.setThumbnail).toHaveBeenLastCalledWith('p1', new Uint8Array([1]), 'image/png')
		setBackground(doc, color(2))
		await jest.advanceTimersByTimeAsync(500)
		expect(store.save).toHaveBeenCalledTimes(2)
		expect(store.setThumbnail).toHaveBeenCalledTimes(1)
		await jest.advanceTimersByTimeAsync(4000)
		setBackground(doc, color(3))
		await jest.advanceTimersByTimeAsync(500)
		expect(store.setThumbnail).toHaveBeenCalledTimes(2)

		const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
		thumbnail.mockRejectedValueOnce(new Error('no canvas'))
		await autosave.dispose()
		expect(thumbnail).toHaveBeenCalledTimes(3)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(autosave.status).toBe('saved')
	})
})

describe('autosave with the local store', () => {
	it('restores after reload', async () => {
		const factory = new IDBFactory()
		const store = await createLocalProjectStore({ indexedDB: factory, storage: null })
		const meta = await store.create(newProject('Restore me'))
		const { project } = await store.open(meta.id)
		// fake-indexeddb clones in Node's realm, not Jest's, and the document store only accepts
		// plain objects from its own realm. A browser's IndexedDB returns same-realm objects.
		const plain = JSON.parse(JSON.stringify(project)) as Project
		const doc = createDocumentStore<Project>({ document: plain, validate: validateProject })
		let onSaved = () => {}
		const autosave = createAutosave({
			store,
			id: meta.id,
			document: doc,
			delayMs: 5,
			target: null,
			onStatus: (status) => {
				if (status === 'saved') onSaved()
			},
		})
		const saved = new Promise<void>((resolve) => {
			onSaved = resolve
		})
		setBackground(doc, '#ff0000')
		await saved

		const reloaded = await createLocalProjectStore({ indexedDB: factory, storage: null })
		expect(await reloaded.lastOpened()).toBe(meta.id)
		const reopened = await reloaded.open(meta.id)
		expect(reopened.project.output.background).toBe('#ff0000')
		await autosave.dispose()
	})
})
