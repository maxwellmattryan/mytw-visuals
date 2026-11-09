// Saves a document store to a ProjectStore shortly after changes. Modelled on mountPanel's
// debounced persistence in packages/panel/mount.ts.
import type { DocumentStore } from '@mytw/document'
import type { Project } from '@mytw/schema'
import { ProjectStoreError } from './types'
import type { ProjectStore } from './types'

export type AutosaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export const STORAGE_FULL_MESSAGE =
	'Storage is full. Export projects you want to keep and delete others to free space.'

type ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

export interface AutosaveOptions {
	store: Pick<ProjectStore, 'save' | 'setThumbnail'>
	/** The project id to save to. */
	id: string
	document: DocumentStore<Project>
	/** A save runs this long after the last change. */
	delayMs?: number
	/** While changes keep arriving, a save runs at least this often. */
	maxWaitMs?: number
	/** Produces thumbnail bytes, for example `thumbnailFromCanvas` from `@mytw/home`. */
	thumbnail?: () => Promise<Uint8Array | null>
	/** Defaults to `image/png`. */
	thumbnailMimeType?: string
	/** The shortest time between two thumbnails. */
	thumbnailIntervalMs?: number
	onStatus?: (status: AutosaveStatus, message: string | null) => void
	/** Receives `pagehide` and `visibilitychange`. Defaults to `globalThis` when it has listeners. */
	target?: ListenerTarget | null
}

export interface Autosave {
	readonly status: AutosaveStatus
	/** Why the last save failed, while `status` is `error`. */
	readonly error: string | null
	/** Saves pending changes now and resolves when the save settles. Never rejects. */
	flush(): Promise<void>
	/** Flushes, stores a final thumbnail, then stops watching. Later calls do nothing. */
	dispose(): Promise<void>
}

function describe(error: unknown): string {
	if (error instanceof ProjectStoreError && error.code === 'quota-exceeded')
		return STORAGE_FULL_MESSAGE
	if (error instanceof Error) return error.message
	return String(error)
}

function defaultTarget(): ListenerTarget | null {
	const candidate = globalThis as Partial<ListenerTarget>
	return typeof candidate.addEventListener === 'function' &&
		typeof candidate.removeEventListener === 'function'
		? (candidate as ListenerTarget)
		: null
}

export function createAutosave(options: AutosaveOptions): Autosave {
	const {
		store,
		id,
		document: doc,
		delayMs = 500,
		maxWaitMs = 5000,
		thumbnail,
		thumbnailMimeType = 'image/png',
		thumbnailIntervalMs = 5000,
		onStatus,
	} = options
	const target = options.target !== undefined ? options.target : defaultTarget()

	let status: AutosaveStatus = 'saved'
	let error: string | null = null
	/** Whether the document has changed since the last save started. */
	let dirty = false
	/** A timer fired while a save was running, so one more save follows it. */
	let queued = false
	let current: Promise<void> | null = null
	let debounceTimer: ReturnType<typeof setTimeout> | undefined
	let maxWaitTimer: ReturnType<typeof setTimeout> | undefined
	let lastThumbnailAt: number | null = null
	let disposing: Promise<void> | null = null

	const setStatus = (next: AutosaveStatus, message: string | null = null) => {
		error = message
		if (next === status && next !== 'error') return
		status = next
		onStatus?.(next, message)
	}

	const clearTimers = () => {
		clearTimeout(debounceTimer)
		clearTimeout(maxWaitTimer)
		debounceTimer = undefined
		maxWaitTimer = undefined
	}

	const storeThumbnail = async () => {
		if (!thumbnail) return
		lastThumbnailAt = Date.now()
		try {
			const bytes = await thumbnail()
			if (bytes) await store.setThumbnail(id, bytes, thumbnailMimeType)
		} catch (failure) {
			console.warn(`Autosave could not store a thumbnail: ${describe(failure)}`)
		}
	}

	const save = async () => {
		dirty = false
		setStatus('saving')
		try {
			await store.save(id, doc.document)
		} catch (failure) {
			dirty = true
			setStatus('error', describe(failure))
			return
		}
		setStatus(dirty ? 'pending' : 'saved')
		if (
			thumbnail &&
			(lastThumbnailAt === null || Date.now() - lastThumbnailAt >= thumbnailIntervalMs)
		)
			await storeThumbnail()
	}

	const run = (): Promise<void> => {
		clearTimers()
		if (current) {
			queued = true
			return current
		}
		if (!dirty) return Promise.resolve()
		const started: Promise<void> = save().finally(() => {
			current = null
			if (queued) {
				queued = false
				if (dirty) void run()
			}
		})
		current = started
		return started
	}

	const flush = async () => {
		clearTimers()
		while (current) await current
		if (dirty) await run()
	}

	const unsubscribe = doc.subscribe(() => {
		if (disposing) return
		dirty = true
		if (status !== 'saving') setStatus('pending')
		clearTimeout(debounceTimer)
		debounceTimer = setTimeout(() => void run(), delayMs)
		if (maxWaitTimer === undefined) maxWaitTimer = setTimeout(() => void run(), maxWaitMs)
	})

	const onPageHide = () => void flush()
	const onVisibilityChange = () => {
		const page = (globalThis as { document?: { visibilityState?: string } }).document
		if (page?.visibilityState === 'hidden') void flush()
	}
	target?.addEventListener('pagehide', onPageHide)
	target?.addEventListener('visibilitychange', onVisibilityChange)

	return {
		get status() {
			return status
		},
		get error() {
			return error
		},
		flush: () => (disposing ? disposing : flush()),
		dispose: () => {
			if (disposing) return disposing
			disposing = (async () => {
				await flush()
				await storeThumbnail()
				clearTimers()
				unsubscribe()
				target?.removeEventListener('pagehide', onPageHide)
				target?.removeEventListener('visibilitychange', onVisibilityChange)
			})()
			return disposing
		},
	}
}
