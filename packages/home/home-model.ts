// The project home's state and actions, free of DOM and Svelte so it can be tested directly.
// Home.svelte renders it; object URLs for thumbnails live in the Svelte layer.
import { PROJECT_SCHEMA_VERSION } from '@mytw/schema'
import {
	exportProjectBundle,
	importProjectBundle,
	MAX_BUNDLE_BYTES,
	newProject,
	ProjectStoreError,
	STORAGE_FULL_MESSAGE,
} from '@mytw/storage'
import type { ProjectMeta, ProjectStore, StorageStatus } from '@mytw/storage'

export const HOME_STATUS = {
	storageFull: STORAGE_FULL_MESSAGE,
	newerVersion: 'This project was made with a newer version of the app. Update the app to open it.',
	persistenceDenied:
		'The browser did not agree to keep data on this device. Export bundles to keep a copy.',
} as const

/** Usage at or above this share of the quota shows a warning. */
export const USAGE_WARNING_RATIO = 0.8

export type HomePhase = 'loading' | 'ready' | 'unavailable'

export interface HomeMessage {
	readonly kind: 'error' | 'warning' | 'info'
	readonly text: string
}

export interface HomeProject {
	readonly meta: ProjectMeta
	/** Saved by a newer app version, so it can't be opened here. */
	readonly newer: boolean
}

export interface HomeState {
	readonly phase: HomePhase
	/** Why projects can't be stored, while `phase` is `unavailable`. */
	readonly unavailableReason: string | null
	readonly projects: readonly HomeProject[]
	/** The card being renamed and its inline error. */
	readonly renaming: { readonly id: string; readonly error: string | null } | null
	/** The card waiting for delete confirmation. */
	readonly confirmingDelete: string | null
	readonly message: HomeMessage | null
	readonly storage: StorageStatus
	/** Whether the "kept in this browser" notice shows: data isn't known to be persisted. */
	readonly showStorageNotice: boolean
	/** Whether the notice offers to keep data: the browser reports persistence and may grant it. */
	readonly canRequestPersistence: boolean
	/** The whole percentage of quota used, when at least 80%. */
	readonly usageWarning: number | null
	/** An action is running. */
	readonly busy: boolean
}

export interface HomeModelOptions {
	/** The store, or its pending creation: a rejection shows the unavailable state. */
	store: ProjectStore | Promise<ProjectStore>
	onOpen: (id: string) => void
	/** Saves an exported bundle, for example as a download. */
	download?: (bytes: Uint8Array, fileName: string) => void
}

/** The parts of a `File` import needs. */
export interface BundleFile {
	readonly size: number
	arrayBuffer(): Promise<ArrayBuffer>
}

export interface HomeModel {
	readonly state: HomeState
	subscribe(fn: (state: HomeState) => void): () => void
	/** Opens the store and loads the list. Resolves once the first list settles. */
	load(): Promise<void>
	refresh(): Promise<void>
	create(): Promise<void>
	open(id: string): void
	startRename(id: string): void
	cancelRename(): void
	commitRename(name: string): Promise<void>
	duplicate(id: string): Promise<void>
	requestDelete(id: string): void
	cancelDelete(): void
	confirmDelete(): Promise<void>
	exportProject(id: string): Promise<void>
	importBundle(bytes: Uint8Array): Promise<void>
	/** Imports a picked file, refusing one over the bundle limit before reading it. */
	importFile(file: BundleFile): Promise<void>
	requestPersistence(): Promise<void>
	dismissMessage(): void
	/** The thumbnail bytes for a card, or `null`. */
	thumbnail(id: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>
}

const EMPTY_STORAGE: StorageStatus = { persisted: null, usage: null, quota: null }

function describe(error: unknown): string {
	if (error instanceof ProjectStoreError && error.code === 'quota-exceeded')
		return HOME_STATUS.storageFull
	if (error instanceof Error) return error.message
	return String(error)
}

function usagePercent(storage: StorageStatus): number | null {
	const { usage, quota } = storage
	if (usage === null || quota === null || quota <= 0) return null
	const ratio = usage / quota
	return ratio >= USAGE_WARNING_RATIO ? Math.floor(ratio * 100) : null
}

/** "just now", "5 minutes ago", "yesterday" and so on, from an ISO timestamp. */
export function relativeTime(iso: string, now: Date = new Date()): string {
	const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000)
	if (Number.isNaN(seconds)) return 'at an unknown time'
	if (Math.abs(seconds) < 45) return 'just now'
	const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		['minute', 60],
		['hour', 3600],
		['day', 86_400],
		['week', 604_800],
		['month', 2_592_000],
		['year', 31_536_000],
	]
	let chosen = units[0]
	for (const unit of units) if (Math.abs(seconds) >= unit[1]) chosen = unit
	return format.format(Math.round(seconds / chosen[1]), chosen[0])
}

export function createHomeModel(options: HomeModelOptions): HomeModel {
	const { onOpen, download } = options
	let store: ProjectStore | null = null
	let persistenceAsked = false
	const listeners = new Set<(state: HomeState) => void>()
	let state: HomeState = {
		phase: 'loading',
		unavailableReason: null,
		projects: [],
		renaming: null,
		confirmingDelete: null,
		message: null,
		storage: EMPTY_STORAGE,
		showStorageNotice: false,
		canRequestPersistence: false,
		usageWarning: null,
		busy: false,
	}

	const update = (patch: Partial<HomeState>) => {
		state = { ...state, ...patch }
		for (const fn of [...listeners]) fn(state)
	}

	const withStorage = (storage: StorageStatus, canRequest = state.canRequestPersistence) => ({
		storage,
		showStorageNotice: storage.persisted !== true,
		canRequestPersistence: canRequest && storage.persisted !== true,
		usageWarning: usagePercent(storage),
	})

	const fail = (error: unknown) => update({ message: { kind: 'error', text: describe(error) } })

	const reload = async (current: ProjectStore, first = false) => {
		const [metas, storage] = await Promise.all([current.list(), current.storageStatus()])
		update({
			phase: 'ready',
			projects: metas.map((meta) => ({
				meta,
				newer: meta.schemaVersion > PROJECT_SCHEMA_VERSION,
			})),
			// On the first load: `persisted()` gave an answer, so `persist()` can be asked.
			...withStorage(storage, first ? storage.persisted === false : state.canRequestPersistence),
		})
	}

	/** Runs an action against the store, reporting failures as the home message. */
	const run = async (action: (current: ProjectStore) => Promise<void>) => {
		if (!store) return
		update({ busy: true })
		try {
			await action(store)
		} catch (error) {
			fail(error)
		} finally {
			update({ busy: false })
		}
	}

	/** Asks once per page, on the first create or import, while the click still counts. */
	const askPersistenceOnce = (current: ProjectStore): Promise<void> => {
		if (persistenceAsked || state.storage.persisted === true) return Promise.resolve()
		persistenceAsked = true
		return current.requestPersistence().then(
			(granted) => {
				if (granted === true) update(withStorage({ ...state.storage, persisted: true }))
			},
			() => {}
		)
	}

	/** Imports a bundle; persistence is asked before `read`, while the gesture still counts. */
	const importWith = (read: () => Promise<Uint8Array>) =>
		run(async (current) => {
			const asked = askPersistenceOnce(current)
			const { missingAssets } = await importProjectBundle(current, await read())
			await asked
			await reload(current)
			const count = missingAssets.length
			const images = count === 1 ? '1 image is' : `${count} images are`
			update({
				message:
					count === 0
						? null
						: {
								kind: 'warning',
								text: `Imported, but ${images} missing from the bundle and will show as placeholders.`,
							},
			})
		})

	return {
		get state() {
			return state
		},
		subscribe(fn) {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		async load() {
			try {
				store = await options.store
			} catch (error) {
				update({ phase: 'unavailable', unavailableReason: describe(error) })
				return
			}
			try {
				await reload(store, true)
			} catch (error) {
				update({ phase: 'ready' })
				fail(error)
			}
		},
		refresh: () => run((current) => reload(current)),
		create: () =>
			run(async (current) => {
				const asked = askPersistenceOnce(current)
				const meta = await current.create(newProject())
				await asked
				await reload(current)
				onOpen(meta.id)
			}),
		open(id) {
			const found = state.projects.find((project) => project.meta.id === id)
			if (!found) return
			if (found.newer) {
				update({ message: { kind: 'error', text: HOME_STATUS.newerVersion } })
				return
			}
			onOpen(id)
		},
		startRename(id) {
			update({ renaming: { id, error: null }, confirmingDelete: null })
		},
		cancelRename() {
			update({ renaming: null })
		},
		commitRename: (name) =>
			run(async (current) => {
				const renaming = state.renaming
				if (!renaming) return
				try {
					await current.rename(renaming.id, name)
				} catch (error) {
					if (error instanceof ProjectStoreError && error.code === 'invalid-name') {
						update({ renaming: { id: renaming.id, error: error.message } })
						return
					}
					throw error
				}
				update({ renaming: null })
				await reload(current)
			}),
		duplicate: (id) =>
			run(async (current) => {
				await current.duplicate(id)
				await reload(current)
			}),
		requestDelete(id) {
			update({ confirmingDelete: id, renaming: null })
		},
		cancelDelete() {
			update({ confirmingDelete: null })
		},
		confirmDelete: () =>
			run(async (current) => {
				const id = state.confirmingDelete
				if (id === null) return
				update({ confirmingDelete: null })
				await current.delete(id)
				await reload(current)
			}),
		exportProject: (id) =>
			run(async (current) => {
				const bundle = await exportProjectBundle(current, id)
				download?.(bundle.bytes, bundle.fileName)
			}),
		importBundle: (bytes) => importWith(async () => bytes),
		importFile: (file) =>
			importWith(async () => {
				if (file.size > MAX_BUNDLE_BYTES)
					throw new ProjectStoreError('invalid-bundle', 'The bundle is larger than 512 MiB')
				return new Uint8Array(await file.arrayBuffer())
			}),
		requestPersistence: () =>
			run(async (current) => {
				persistenceAsked = true
				const granted = await current.requestPersistence()
				if (granted === true) update(withStorage({ ...state.storage, persisted: true }))
				else if (granted === null) update({ canRequestPersistence: false })
				else
					update({
						canRequestPersistence: false,
						message: { kind: 'info', text: HOME_STATUS.persistenceDenied },
					})
			}),
		dismissMessage() {
			update({ message: null })
		},
		thumbnail: async (id) => {
			if (!store) return null
			try {
				return await store.getThumbnail(id)
			} catch {
				return null
			}
		},
	}
}
