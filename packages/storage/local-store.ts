// The IndexedDB `ProjectStore`. See "IndexedDB layout" in README.md.
import { hashBytes, isContentHash } from '@mytw/assets'
import { parseProject, PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, validateProject } from '@mytw/schema'
import type { Project, ProjectIssue } from '@mytw/schema'
import { openDatabase, request, toStoreError, transact } from './idb'
import { ProjectStoreError } from './types'
import type {
	ImportProjectInput,
	OpenedProject,
	ProjectMeta,
	ProjectStore,
	StorageStatus,
	Thumbnail,
} from './types'

export const DB_NAME = 'mytw-visuals'
export const DB_VERSION = 1
export const MAX_NAME_LENGTH = 200

const PROJECTS = 'projects'
const DOCUMENTS = 'documents'
const ASSETS = 'assets'
const THUMBNAILS = 'thumbnails'
const SETTINGS = 'settings'
const LAST_OPENED = 'lastOpened'
const COPY_SUFFIX = ' copy'
const ASSET_KEY = /^sha256:([0-9a-f]{64})$/

interface DocumentRecord {
	readonly id: string
	readonly doc: unknown
}

interface AssetRecord {
	readonly hash: string
	readonly bytes: Uint8Array
	readonly size: number
}

interface SettingRecord {
	readonly key: string
	readonly value: string | null
}

export interface LocalProjectStoreOptions {
	/** Defaults to `globalThis.indexedDB`. `null` behaves like a browser without IndexedDB. */
	indexedDB?: IDBFactory | null
	/** Defaults to `mytw-visuals`. */
	dbName?: string
	/** Defaults to `navigator.storage`. `null` behaves like a browser without it. */
	storage?: StorageManager | null
	now?: () => Date
	newId?: () => string
}

/** The starting document for a new project: 1080×1080 at 30 fps, black, a 60-frame loop. */
export function newProject(name = 'Untitled'): Project {
	return {
		format: PROJECT_FORMAT,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		name,
		output: { width: 1080, height: 1080, fps: 30, background: '#000000' },
		timeline: { mode: 'loop', frames: 60 },
		assets: {},
		modulators: {},
		tracks: [],
		effects: [],
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The bare hex hashes of the `sha256:` asset keys in a raw document. */
export function referencedAssets(doc: unknown): Set<string> {
	const hashes = new Set<string>()
	if (!isRecord(doc) || !isRecord(doc.assets)) return hashes
	for (const key of Object.keys(doc.assets)) {
		const match = ASSET_KEY.exec(key)
		if (match) hashes.add(match[1])
	}
	return hashes
}

/** A copy of exactly these bytes. Structured clone of a view would store its whole buffer. */
function exactBytes(bytes: Uint8Array): Uint8Array {
	if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes
	return bytes.slice()
}

function invalidProject(issues: readonly ProjectIssue[]): ProjectStoreError {
	const first = issues[0]
	const detail = first ? `${first.path || 'project'}: ${first.message}` : 'it failed validation'
	return new ProjectStoreError('invalid-project', `The project is not valid (${detail})`, issues)
}

/** Validates a project for writing, or throws `invalid-project`. */
function checkProject(project: Project): Project {
	const result = validateProject(project)
	if (!result.ok) throw invalidProject(result.issues)
	return result.project
}

function notFound(id: string): ProjectStoreError {
	return new ProjectStoreError('not-found', `No project with id ${id}`)
}

function checkName(name: string): string {
	const trimmed = name.trim()
	if (trimmed.length === 0) throw new ProjectStoreError('invalid-name', 'The name is empty')
	if (trimmed.length > MAX_NAME_LENGTH)
		throw new ProjectStoreError(
			'invalid-name',
			`The name is longer than ${MAX_NAME_LENGTH} characters`
		)
	return trimmed
}

function upgrade(db: IDBDatabase, oldVersion: number): void {
	// Each later version adds a step here, guarded by `oldVersion < n`.
	if (oldVersion < 1) {
		db.createObjectStore(PROJECTS, { keyPath: 'id' })
		db.createObjectStore(DOCUMENTS, { keyPath: 'id' })
		db.createObjectStore(ASSETS, { keyPath: 'hash' })
		db.createObjectStore(THUMBNAILS)
		db.createObjectStore(SETTINGS, { keyPath: 'key' })
	}
}

function getMeta(tx: IDBTransaction, id: string): Promise<ProjectMeta | undefined> {
	return request<unknown>(tx.objectStore(PROJECTS).get(id)) as Promise<ProjectMeta | undefined>
}

function getDocument(tx: IDBTransaction, id: string): Promise<DocumentRecord | undefined> {
	return request<unknown>(tx.objectStore(DOCUMENTS).get(id)) as Promise<DocumentRecord | undefined>
}

function getThumbnailRecord(tx: IDBTransaction, id: string): Promise<Thumbnail | undefined> {
	return request<unknown>(tx.objectStore(THUMBNAILS).get(id)) as Promise<Thumbnail | undefined>
}

/** Stores asset bytes unless an asset with that hash exists already. */
async function putAssetRecord(tx: IDBTransaction, hash: string, bytes: Uint8Array): Promise<void> {
	const assets = tx.objectStore(ASSETS)
	const existing = await request<IDBValidKey | undefined>(assets.getKey(hash))
	if (existing !== undefined) return
	const record: AssetRecord = { hash, bytes: exactBytes(bytes), size: bytes.byteLength }
	await request(assets.put(record))
}

/** Opens the IndexedDB project store, or rejects with `unavailable`. */
export async function createLocalProjectStore(
	options: LocalProjectStoreOptions = {}
): Promise<ProjectStore> {
	const factory =
		options.indexedDB !== undefined
			? options.indexedDB
			: ((globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null)
	if (!factory)
		throw new ProjectStoreError(
			'unavailable',
			"Projects can't be stored in this browser: IndexedDB is not available"
		)
	const storage =
		options.storage !== undefined
			? options.storage
			: ((globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage ?? null)
	const now = options.now ?? (() => new Date())
	const newId = options.newId ?? (() => crypto.randomUUID())
	const db = await openDatabase(factory, options.dbName ?? DB_NAME, DB_VERSION, upgrade)

	const timestamp = () => now().toISOString()

	/** Runs work that isn't a transaction, mapping its failures like a transaction's. */
	const guard = async <T>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work()
		} catch (error) {
			throw toStoreError(error)
		}
	}

	const insert = async (
		tx: IDBTransaction,
		project: Project,
		hasThumbnail: boolean
	): Promise<ProjectMeta> => {
		const at = timestamp()
		const meta: ProjectMeta = {
			id: newId(),
			name: project.name,
			createdAt: at,
			updatedAt: at,
			schemaVersion: project.schemaVersion,
			hasThumbnail,
		}
		const record: DocumentRecord = { id: meta.id, doc: project }
		await request(tx.objectStore(PROJECTS).put(meta))
		await request(tx.objectStore(DOCUMENTS).put(record))
		return meta
	}

	const putSetting = (tx: IDBTransaction, value: string | null) => {
		const record: SettingRecord = { key: LAST_OPENED, value }
		return request(tx.objectStore(SETTINGS).put(record))
	}

	return {
		list: () =>
			transact(db, [PROJECTS], 'readonly', async (tx) => {
				const all = (await request<unknown[]>(tx.objectStore(PROJECTS).getAll())) as ProjectMeta[]
				return all.sort(
					(a, b) =>
						b.updatedAt.localeCompare(a.updatedAt) ||
						b.createdAt.localeCompare(a.createdAt) ||
						a.id.localeCompare(b.id)
				)
			}),

		create: async (project) => {
			const checked = checkProject(project)
			return transact(db, [PROJECTS, DOCUMENTS], 'readwrite', (tx) => insert(tx, checked, false))
		},

		importProject: async ({ project, assets, thumbnail }: ImportProjectInput) => {
			const checked = checkProject(project)
			const hashed = await guard(() =>
				Promise.all(assets.map(async (bytes) => ({ hash: await hashBytes(bytes), bytes })))
			)
			return transact(db, [PROJECTS, DOCUMENTS, ASSETS, THUMBNAILS], 'readwrite', async (tx) => {
				for (const { hash, bytes } of hashed) await putAssetRecord(tx, hash, bytes)
				const meta = await insert(tx, checked, thumbnail !== null)
				if (thumbnail) {
					const record: Thumbnail = {
						bytes: exactBytes(thumbnail.bytes),
						mimeType: thumbnail.mimeType,
					}
					await request(tx.objectStore(THUMBNAILS).put(record, meta.id))
				}
				return meta
			})
		},

		open: (id, { remember = true } = {}) =>
			transact(db, [PROJECTS, DOCUMENTS, SETTINGS], 'readwrite', async (tx) => {
				const meta = await getMeta(tx, id)
				const stored = await getDocument(tx, id)
				if (!meta || !stored) throw notFound(id)
				const parsed = parseProject(stored.doc)
				if (!parsed.ok) {
					const newer = parsed.issues.find((found) => found.code === 'newer-version')
					if (newer)
						throw new ProjectStoreError(
							'newer-version',
							`This project was made with a newer version of the app (${newer.message})`,
							parsed.issues
						)
					throw invalidProject(parsed.issues)
				}
				let current = meta
				if (parsed.migratedFrom !== null) {
					current = { ...meta, schemaVersion: parsed.project.schemaVersion }
					const record: DocumentRecord = { id, doc: parsed.project }
					await request(tx.objectStore(DOCUMENTS).put(record))
					await request(tx.objectStore(PROJECTS).put(current))
				}
				if (remember) await putSetting(tx, id)
				const opened: OpenedProject = {
					meta: current,
					project: parsed.project,
					migratedFrom: parsed.migratedFrom,
				}
				return opened
			}),

		save: async (id, project) => {
			const checked = checkProject(project)
			return transact(db, [PROJECTS, DOCUMENTS], 'readwrite', async (tx) => {
				const meta = await getMeta(tx, id)
				if (!meta) throw notFound(id)
				const next: ProjectMeta = {
					...meta,
					name: checked.name,
					schemaVersion: checked.schemaVersion,
					updatedAt: timestamp(),
				}
				const record: DocumentRecord = { id, doc: checked }
				await request(tx.objectStore(DOCUMENTS).put(record))
				await request(tx.objectStore(PROJECTS).put(next))
				return next
			})
		},

		rename: async (id, name) => {
			const trimmed = checkName(name)
			return transact(db, [PROJECTS, DOCUMENTS], 'readwrite', async (tx) => {
				const meta = await getMeta(tx, id)
				const stored = await getDocument(tx, id)
				if (!meta || !stored) throw notFound(id)
				const next: ProjectMeta = { ...meta, name: trimmed, updatedAt: timestamp() }
				const doc = isRecord(stored.doc) ? { ...stored.doc, name: trimmed } : stored.doc
				const record: DocumentRecord = { id, doc }
				await request(tx.objectStore(DOCUMENTS).put(record))
				await request(tx.objectStore(PROJECTS).put(next))
				return next
			})
		},

		duplicate: (id) =>
			transact(db, [PROJECTS, DOCUMENTS, THUMBNAILS], 'readwrite', async (tx) => {
				const meta = await getMeta(tx, id)
				const stored = await getDocument(tx, id)
				if (!meta || !stored) throw notFound(id)
				const thumbnail = await getThumbnailRecord(tx, id)
				// Shortens the original name rather than cutting off " copy".
				const name = `${meta.name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`
				const at = timestamp()
				const copy: ProjectMeta = {
					id: newId(),
					name,
					createdAt: at,
					updatedAt: at,
					schemaVersion: meta.schemaVersion,
					hasThumbnail: thumbnail !== undefined,
				}
				const doc = isRecord(stored.doc) ? { ...stored.doc, name } : stored.doc
				const record: DocumentRecord = { id: copy.id, doc }
				await request(tx.objectStore(PROJECTS).put(copy))
				await request(tx.objectStore(DOCUMENTS).put(record))
				if (thumbnail) await request(tx.objectStore(THUMBNAILS).put(thumbnail, copy.id))
				return copy
			}),

		delete: (id) =>
			transact(db, [PROJECTS, DOCUMENTS, THUMBNAILS, ASSETS, SETTINGS], 'readwrite', async (tx) => {
				const meta = await getMeta(tx, id)
				if (!meta) throw notFound(id)
				const stored = await getDocument(tx, id)
				const released = referencedAssets(stored?.doc)
				await request(tx.objectStore(PROJECTS).delete(id))
				await request(tx.objectStore(DOCUMENTS).delete(id))
				await request(tx.objectStore(THUMBNAILS).delete(id))
				if (released.size > 0) {
					const remaining = (await request<unknown[]>(
						tx.objectStore(DOCUMENTS).getAll()
					)) as DocumentRecord[]
					for (const record of remaining)
						for (const hash of referencedAssets(record.doc)) released.delete(hash)
					for (const hash of released) await request(tx.objectStore(ASSETS).delete(hash))
				}
				const setting = (await request<unknown>(tx.objectStore(SETTINGS).get(LAST_OPENED))) as
					| SettingRecord
					| undefined
				if (setting?.value === id) await putSetting(tx, null)
			}),

		putAsset: async (bytes) => {
			const hash = await guard(() => hashBytes(bytes))
			await transact(db, [ASSETS], 'readwrite', (tx) => putAssetRecord(tx, hash, bytes))
			return hash
		},

		read: async (hash) => {
			if (!isContentHash(hash)) return null
			return transact(db, [ASSETS], 'readonly', async (tx) => {
				const record = (await request<unknown>(tx.objectStore(ASSETS).get(hash))) as
					| AssetRecord
					| undefined
				return record?.bytes ?? null
			})
		},

		setThumbnail: (id, bytes, mimeType) =>
			transact(db, [PROJECTS, THUMBNAILS], 'readwrite', async (tx) => {
				const meta = await getMeta(tx, id)
				if (!meta) throw notFound(id)
				const record: Thumbnail = { bytes: exactBytes(bytes), mimeType }
				await request(tx.objectStore(THUMBNAILS).put(record, id))
				if (!meta.hasThumbnail)
					await request(tx.objectStore(PROJECTS).put({ ...meta, hasThumbnail: true }))
			}),

		getThumbnail: (id) =>
			transact(db, [THUMBNAILS], 'readonly', async (tx) => {
				const record = await getThumbnailRecord(tx, id)
				return record ? { bytes: record.bytes, mimeType: record.mimeType } : null
			}),

		lastOpened: () =>
			transact(db, [SETTINGS], 'readonly', async (tx) => {
				const setting = (await request<unknown>(tx.objectStore(SETTINGS).get(LAST_OPENED))) as
					| SettingRecord
					| undefined
				return setting?.value ?? null
			}),

		setLastOpened: (id) =>
			transact(db, [SETTINGS], 'readwrite', async (tx) => {
				await putSetting(tx, id)
			}),

		storageStatus: async (): Promise<StorageStatus> => {
			let persisted: boolean | null = null
			let usage: number | null = null
			let quota: number | null = null
			if (storage && typeof storage.persisted === 'function') {
				try {
					persisted = await storage.persisted()
				} catch {
					persisted = null
				}
			}
			if (storage && typeof storage.estimate === 'function') {
				try {
					const estimate = await storage.estimate()
					usage = estimate.usage ?? null
					quota = estimate.quota ?? null
				} catch {
					usage = null
					quota = null
				}
			}
			return { persisted, usage, quota }
		},

		requestPersistence: async () => {
			if (!storage || typeof storage.persist !== 'function') return null
			try {
				return await storage.persist()
			} catch {
				return null
			}
		},
	}
}
