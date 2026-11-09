import { describe, expect, it, jest } from '@jest/globals'
import { IDBFactory } from 'fake-indexeddb'

import { PROJECT_SCHEMA_VERSION } from '@mytw/schema'
import {
	createLocalProjectStore,
	exportProjectBundle,
	MAX_BUNDLE_BYTES,
	newProject,
	ProjectStoreError,
} from '@mytw/storage'
import type { ProjectStore } from '@mytw/storage'

import { createHomeModel, HOME_STATUS, relativeTime } from '../home-model'
import type { HomeModelOptions, HomePhase } from '../home-model'
import { projectWithAssets, rawPut } from '../../storage/testing/fixtures'

type FakeStorage = Pick<StorageManager, 'persisted' | 'estimate' | 'persist'>

function fakeStorage(persisted: boolean, usage = 10, quota = 100, grant = true) {
	const persist = jest.fn(async () => grant)
	const storage: FakeStorage = {
		persisted: async () => persisted,
		estimate: async () => ({ usage, quota }),
		persist,
	}
	return { storage: storage as StorageManager, persist }
}

async function setup(
	storage: StorageManager | null = null,
	override: (store: ProjectStore) => ProjectStore = (store) => store
) {
	const factory = new IDBFactory()
	const store = override(await createLocalProjectStore({ indexedDB: factory, storage }))
	const onOpen = jest.fn((_id: string) => {})
	const download = jest.fn((_bytes: Uint8Array, _fileName: string) => {})
	const options: HomeModelOptions = { store, onOpen, download }
	const model = createHomeModel(options)
	return { factory, store, model, onOpen, download }
}

describe('createHomeModel', () => {
	it('loads the list: loading, then empty or newest first', async () => {
		let resolve: (store: ProjectStore) => void = () => {}
		const pending = new Promise<ProjectStore>((done) => {
			resolve = done
		})
		const model = createHomeModel({ store: pending, onOpen: () => {} })
		const phases: HomePhase[] = []
		model.subscribe((state) => phases.push(state.phase))
		expect(model.state.phase).toBe('loading')
		const store = await createLocalProjectStore({ indexedDB: new IDBFactory(), storage: null })
		const loaded = model.load()
		expect(model.state.phase).toBe('loading')
		resolve(store)
		await loaded
		expect(model.state.phase).toBe('ready')
		expect(model.state.projects).toEqual([])
		expect(phases).toEqual(['ready'])

		await store.create(newProject('Older'))
		await new Promise((done) => setTimeout(done, 2))
		await store.create(newProject('Newer'))
		await model.refresh()
		expect(model.state.projects.map((project) => project.meta.name)).toEqual(['Newer', 'Older'])
	})

	it('shows why projects are unavailable', async () => {
		const model = createHomeModel({
			store: Promise.reject(new ProjectStoreError('unavailable', 'IndexedDB is not available')),
			onOpen: () => {},
		})
		await model.load()
		expect(model.state.phase).toBe('unavailable')
		expect(model.state.unavailableReason).toBe('IndexedDB is not available')
	})

	it('creates, renames, duplicates and deletes through the store', async () => {
		const { storage, persist } = fakeStorage(false)
		const { model, onOpen, store } = await setup(storage)
		await model.load()

		await model.create()
		expect(onOpen).toHaveBeenCalledTimes(1)
		const id = onOpen.mock.calls[0][0]
		expect(model.state.projects.map((project) => project.meta.id)).toEqual([id])

		model.startRename(id)
		await model.commitRename('   ')
		expect(model.state.renaming).toEqual({ id, error: 'The name is empty' })
		await model.commitRename('Night drive')
		expect(model.state.renaming).toBeNull()
		expect(model.state.projects[0].meta.name).toBe('Night drive')
		model.startRename(id)
		model.cancelRename()
		expect(model.state.renaming).toBeNull()

		await model.duplicate(id)
		expect(model.state.projects.map((project) => project.meta.name).sort()).toEqual([
			'Night drive',
			'Night drive copy',
		])

		model.requestDelete(id)
		expect(model.state.confirmingDelete).toBe(id)
		model.cancelDelete()
		expect(model.state.projects).toHaveLength(2)
		model.requestDelete(id)
		await model.confirmDelete()
		expect(model.state.confirmingDelete).toBeNull()
		expect(model.state.projects.map((project) => project.meta.name)).toEqual(['Night drive copy'])
		expect((await store.list()).map((meta) => meta.name)).toEqual(['Night drive copy'])

		// Persistence was asked once, on the first create, and never again.
		await model.create()
		await model.importBundle(new Uint8Array([1, 2, 3]))
		expect(persist).toHaveBeenCalledTimes(1)
	})

	it('imports bundles, warns about missing images and shows import errors', async () => {
		const { storage, persist } = fakeStorage(false)
		const { model, store, download } = await setup(storage)
		await model.load()
		const hash = await store.putAsset(new Uint8Array([5, 6, 7]))
		const meta = await store.create(projectWithAssets('Bundle', [hash, '0'.repeat(64)]))

		await model.exportProject(meta.id)
		expect(download).toHaveBeenCalledTimes(1)
		const [bytes, fileName] = download.mock.calls[0]
		expect(fileName).toBe('bundle.mytw.zip')

		await model.importBundle(bytes)
		expect(persist).toHaveBeenCalledTimes(1)
		expect(model.state.projects).toHaveLength(2)
		expect(model.state.message).toEqual({
			kind: 'warning',
			text: 'Imported, but 1 image is missing from the bundle and will show as placeholders.',
		})

		const complete = await store.create(projectWithAssets('Complete', [hash]))
		await model.importBundle((await exportProjectBundle(store, complete.id)).bytes)
		expect(model.state.message).toBeNull()

		await model.importBundle(new Uint8Array([1, 2, 3]))
		expect(model.state.message).toEqual({ kind: 'error', text: 'The file is not a zip bundle' })
		expect(model.state.busy).toBe(false)

		const read = jest.fn(async () => bytes.slice().buffer)
		await model.importFile({ size: MAX_BUNDLE_BYTES + 1, arrayBuffer: read })
		expect(read).not.toHaveBeenCalled()
		expect(model.state.message?.text).toBe('The bundle is larger than 512 MiB')
		await model.importFile({ size: bytes.byteLength, arrayBuffer: read })
		expect(model.state.projects).toHaveLength(5)
	})

	it('blocks opening projects from a newer version', async () => {
		const { model, factory, onOpen } = await setup()
		await rawPut(factory, 'projects', {
			id: 'future',
			name: 'Future',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			schemaVersion: PROJECT_SCHEMA_VERSION + 1,
			hasThumbnail: false,
		})
		await model.load()
		expect(model.state.projects[0].newer).toBe(true)
		model.open('future')
		expect(onOpen).not.toHaveBeenCalled()
		expect(model.state.message).toEqual({ kind: 'error', text: HOME_STATUS.newerVersion })
		model.dismissMessage()
		expect(model.state.message).toBeNull()
	})

	it('shows the storage notice, usage warning and storage-full message', async () => {
		const notPersisted = fakeStorage(false, 85, 100)
		const first = await setup(notPersisted.storage)
		await first.model.load()
		expect(first.model.state.showStorageNotice).toBe(true)
		expect(first.model.state.canRequestPersistence).toBe(true)
		expect(first.model.state.usageWarning).toBe(85)
		await first.model.requestPersistence()
		expect(notPersisted.persist).toHaveBeenCalledTimes(1)
		expect(first.model.state.showStorageNotice).toBe(false)

		const denied = fakeStorage(false, 79, 100, false)
		const second = await setup(denied.storage)
		await second.model.load()
		expect(second.model.state.usageWarning).toBeNull()
		await second.model.requestPersistence()
		expect(second.model.state.showStorageNotice).toBe(true)
		expect(second.model.state.canRequestPersistence).toBe(false)
		expect(second.model.state.message?.text).toBe(HOME_STATUS.persistenceDenied)

		const unsupported = await setup(null)
		await unsupported.model.load()
		expect(unsupported.model.state.showStorageNotice).toBe(true)
		expect(unsupported.model.state.canRequestPersistence).toBe(false)

		const persisted = await setup(fakeStorage(true).storage)
		await persisted.model.load()
		expect(persisted.model.state.showStorageNotice).toBe(false)

		const full = await setup(null, (store) => ({
			...store,
			create: () => Promise.reject(new ProjectStoreError('quota-exceeded', 'full')),
		}))
		await full.model.load()
		await full.model.create()
		expect(full.onOpen).not.toHaveBeenCalled()
		expect(full.model.state.message).toEqual({ kind: 'error', text: HOME_STATUS.storageFull })
		expect(HOME_STATUS.storageFull).toBe(
			'Storage is full. Export projects you want to keep and delete others to free space.'
		)
	})

	it('describes edit times relative to now', () => {
		const now = new Date('2026-06-01T12:00:00.000Z')
		expect(relativeTime('2026-06-01T11:59:50.000Z', now)).toBe('just now')
		expect(relativeTime('2026-06-01T11:55:00.000Z', now)).toBe('5 minutes ago')
		expect(relativeTime('2026-05-31T12:00:00.000Z', now)).toBe('yesterday')
	})
})
