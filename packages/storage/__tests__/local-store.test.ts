import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'

import { hashBytes } from '@mytw/assets'
import { PROJECT_SCHEMA_VERSION } from '@mytw/schema'
import { createLocalProjectStore, newProject, ProjectStoreError } from '@mytw/storage'
import type { LocalProjectStoreOptions, ProjectMeta } from '@mytw/storage'

import { projectWithAssets, rawCount, rawGet, rawPut, readFixture } from '../testing/fixtures'

const META_KEYS = ['createdAt', 'hasThumbnail', 'id', 'name', 'schemaVersion', 'updatedAt']

function setup(options: LocalProjectStoreOptions = {}) {
	const factory = new IDBFactory()
	let tick = 0
	let ids = 0
	const store = createLocalProjectStore({
		indexedDB: factory,
		storage: null,
		now: () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000),
		newId: () => `p${++ids}`,
		...options,
	})
	return { factory, store }
}

async function rejection(promise: Promise<unknown>): Promise<ProjectStoreError> {
	try {
		await promise
	} catch (error) {
		if (error instanceof ProjectStoreError) return error
		throw error
	}
	throw new Error('expected a rejection')
}

afterEach(() => {
	jest.restoreAllMocks()
})

describe('createLocalProjectStore', () => {
	it('project lifecycle', async () => {
		const { store: opening } = setup()
		const store = await opening
		expect(await store.list()).toEqual([])

		const a = await store.create(newProject('A'))
		const b = await store.create(newProject('B'))
		expect(a.id).not.toBe(b.id)
		const listed = await store.list()
		expect(listed.map((meta) => meta.name)).toEqual(['B', 'A'])
		for (const meta of listed) expect(Object.keys(meta).sort()).toEqual(META_KEYS)
		expect(listed[1]).toEqual(a)
		expect(a).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, hasThumbnail: false })

		const opened = await store.open(a.id)
		expect(opened.project).toEqual(newProject('A'))
		expect(opened.migratedFrom).toBeNull()

		const renamed = await store.rename(a.id, '  Renamed  ')
		expect(renamed.name).toBe('Renamed')
		expect((await store.open(a.id)).project.name).toBe('Renamed')
		expect((await store.list()).map((meta) => meta.name)).toEqual(['Renamed', 'B'])
		for (const name of ['   ', 'x'.repeat(201)])
			expect((await rejection(store.rename(a.id, name))).code).toBe('invalid-name')
		expect((await store.rename(a.id, 'y'.repeat(200))).name).toHaveLength(200)
		await store.rename(a.id, 'Renamed')

		const hash = await store.putAsset(new Uint8Array([1, 2, 3]))
		const withAsset = await store.create(projectWithAssets('Shared', [hash]))
		await store.setThumbnail(withAsset.id, new Uint8Array([9]), 'image/png')
		const copy = await store.duplicate(withAsset.id)
		expect(copy).toMatchObject({ name: 'Shared copy', hasThumbnail: true })
		expect(copy.id).not.toBe(withAsset.id)
		const copied = await store.open(copy.id)
		expect(copied.project.name).toBe('Shared copy')
		expect(Object.keys(copied.project.assets)).toEqual([`sha256:${hash}`])
		expect(await store.getThumbnail(copy.id)).toEqual({
			bytes: new Uint8Array([9]),
			mimeType: 'image/png',
		})

		const long = await store.create(newProject('z'.repeat(200)))
		expect((await store.duplicate(long.id)).name).toBe(`${'z'.repeat(195)} copy`)

		await store.delete(b.id)
		expect((await store.list()).some((meta: ProjectMeta) => meta.id === b.id)).toBe(false)
		expect((await rejection(store.open(b.id))).code).toBe('not-found')
		expect((await rejection(store.save(b.id, newProject('B')))).code).toBe('not-found')
		expect((await rejection(store.duplicate(b.id))).code).toBe('not-found')
		expect((await rejection(store.delete(b.id))).code).toBe('not-found')
	})

	it('save rejects an invalid project', async () => {
		const { store: opening } = setup()
		const store = await opening
		const meta = await store.create(newProject('Valid'))
		const invalid = { ...newProject('Valid'), output: { ...newProject().output, width: 0 } }
		const error = await rejection(store.save(meta.id, invalid))
		expect(error.code).toBe('invalid-project')
		expect(error.issues.length).toBeGreaterThan(0)
		expect((await store.open(meta.id)).project).toEqual(newProject('Valid'))
		expect((await store.list())[0]).toEqual(meta)

		const saved = await store.save(meta.id, {
			...newProject('Saved'),
			timeline: { mode: 'loop', frames: 90 },
		})
		expect(saved.name).toBe('Saved')
		expect(saved.updatedAt > meta.updatedAt).toBe(true)
		expect((await store.open(meta.id)).project.timeline.frames).toBe(90)
	})

	it('assets are deduplicated and collected on delete', async () => {
		const { factory, store: opening } = setup()
		const store = await opening
		const bytes = new Uint8Array([1, 2, 3])
		const first = await store.putAsset(bytes)
		const second = await store.putAsset(new Uint8Array([1, 2, 3]))
		expect(first).toBe(second)
		expect(first).toBe(await hashBytes(bytes))
		expect(await rawCount(factory, 'assets')).toBe(1)
		expect(await store.read(first)).toEqual(bytes)
		expect(await store.read('0'.repeat(64))).toBeNull()

		// A view stores only its own bytes, not its whole buffer.
		const view = new Uint8Array([7, 8, 9, 10]).subarray(1, 3)
		const viewHash = await store.putAsset(view)
		expect(await store.read(viewHash)).toEqual(new Uint8Array([8, 9]))

		const x = await store.putAsset(new Uint8Array([10]))
		const y = await store.putAsset(new Uint8Array([20]))
		const z = await store.putAsset(new Uint8Array([30]))
		const p1 = await store.create(projectWithAssets('One', [x, y]))
		const p2 = await store.create(projectWithAssets('Two', [y]))

		await store.open(p1.id)
		expect(await store.lastOpened()).toBe(p1.id)
		await store.delete(p1.id)
		expect(await store.lastOpened()).toBeNull()
		expect(await store.read(x)).toBeNull()
		expect(await store.read(y)).toEqual(new Uint8Array([20]))
		expect(await store.read(z)).toEqual(new Uint8Array([30]))
		expect(await rawGet(factory, 'thumbnails', p1.id)).toBeUndefined()

		await store.open(p2.id)
		await store.setLastOpened(null)
		await store.delete(p2.id)
		expect(await store.read(y)).toBeNull()
		expect(await store.read(z)).toEqual(new Uint8Array([30]))
	})

	it('open migrates older projects', async () => {
		const { factory, store: opening } = setup()
		const store = await opening
		const meta = {
			id: 'old',
			name: 'Minimal',
			createdAt: '2025-01-01T00:00:00.000Z',
			updatedAt: '2025-01-01T00:00:00.000Z',
			schemaVersion: 1,
			hasThumbnail: false,
		}
		await rawPut(factory, 'projects', meta)
		await rawPut(factory, 'documents', { id: 'old', doc: readFixture('v1/minimal.json') })

		const first = await store.open('old')
		expect(first.migratedFrom).toBe(1)
		expect(first.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
		expect(first.meta.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
		expect(await rawGet(factory, 'documents', 'old')).toEqual({ id: 'old', doc: first.project })
		const second = await store.open('old')
		expect(second.migratedFrom).toBeNull()
		expect(second.project).toEqual(first.project)
		expect(await store.lastOpened()).toBe('old')

		const newer = { ...readFixture('v1/minimal.json'), schemaVersion: PROJECT_SCHEMA_VERSION + 1 }
		await rawPut(factory, 'projects', { ...meta, id: 'newer', schemaVersion: newer.schemaVersion })
		await rawPut(factory, 'documents', { id: 'newer', doc: newer })
		expect((await rejection(store.open('newer'))).code).toBe('newer-version')
		expect(await rawGet(factory, 'documents', 'newer')).toEqual({ id: 'newer', doc: newer })
		expect(await store.lastOpened()).toBe('old')

		await rawPut(factory, 'projects', { ...meta, id: 'broken' })
		await rawPut(factory, 'documents', { id: 'broken', doc: { format: 'something-else' } })
		const broken = await rejection(store.open('broken'))
		expect(broken.code).toBe('invalid-project')
		expect(broken.issues.length).toBeGreaterThan(0)
	})

	it('storage errors and persistence', async () => {
		const { store: opening } = setup()
		const store = await opening
		const meta = await store.create(newProject('Kept'))

		jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
		})
		expect((await rejection(store.create(newProject('Full')))).code).toBe('quota-exceeded')
		expect((await rejection(store.save(meta.id, newProject('Full')))).code).toBe('quota-exceeded')
		jest.restoreAllMocks()

		jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
			throw new Error('disk on fire')
		})
		const failed = await rejection(store.save(meta.id, newProject('Broken')))
		expect(failed.code).toBe('failed')
		expect(failed.message).toContain('disk on fire')
		jest.restoreAllMocks()
		expect((await store.list()).map((found) => found.name)).toEqual(['Kept'])

		expect((await rejection(createLocalProjectStore({ indexedDB: null }))).code).toBe('unavailable')
		expect((await rejection(createLocalProjectStore())).code).toBe('unavailable')
		const throwing = new IDBFactory()
		jest.spyOn(throwing, 'open').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError')
		})
		expect((await rejection(createLocalProjectStore({ indexedDB: throwing }))).code).toBe(
			'unavailable'
		)

		expect(await store.storageStatus()).toEqual({ persisted: null, usage: null, quota: null })
		expect(await store.requestPersistence()).toBeNull()

		const fake: Pick<StorageManager, 'persisted' | 'estimate' | 'persist'> = {
			persisted: async () => false,
			estimate: async () => ({ usage: 80, quota: 100 }),
			persist: async () => true,
		}
		const { store: withStorage } = setup({ storage: fake as StorageManager })
		const persistent = await withStorage
		expect(await persistent.storageStatus()).toEqual({ persisted: false, usage: 80, quota: 100 })
		expect(await persistent.requestPersistence()).toBe(true)
		const partial: Pick<StorageManager, 'estimate'> = { estimate: async () => ({}) }
		const { store: withPartial } = setup({ storage: partial as StorageManager })
		const sparse = await withPartial
		expect(await sparse.storageStatus()).toEqual({ persisted: null, usage: null, quota: null })
		expect(await sparse.requestPersistence()).toBeNull()
	})
})
