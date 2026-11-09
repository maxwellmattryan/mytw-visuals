// State the layers panel and the properties panel share: the selection, solo, the error line and
// the busy flag. Document edits all go through the store, so undo covers them. No DOM or Svelte.
import type { ApplyOptions, Command, DocumentStore } from '@mytw/document'
import type { Project, ProjectLayer } from '@mytw/schema'
import {
	addImageLayers,
	deleteLayer,
	duplicateLayer,
	moveLayer,
	renameLayer,
	setLayerBlend,
	setLayerVisible,
} from './commands'
import type { BlendMode } from './commands'
import { importImageFiles } from './import'
import type { AssetStore, ImageFile } from './import'
import { clipAt, DEFAULT_CLIP } from './target'
import type { ClipRef } from './target'

export interface LayersControllerOptions {
	readonly store: DocumentStore<Project>
	/** Receives the bytes of every imported image. `MemoryAssetSource` satisfies it. */
	readonly assetStore: AssetStore
	/** The clip to edit. Defaults to `{ track: 0, clip: 0 }`. */
	readonly ref?: ClipRef
}

export interface LayersController {
	readonly store: DocumentStore<Project>
	readonly project: Project
	/** The clip being edited. Adding the first image to a missing clip moves it to the new clip. */
	readonly ref: ClipRef
	/** The clip's layers, bottom first as in the format. Empty when the clip doesn't exist. */
	readonly layers: readonly ProjectLayer[]
	readonly selectedId: string | null
	/** Soloed layer ids. View state only: never written to the document. */
	readonly solo: ReadonlySet<string>
	/** The error line: the last import error or rejected command, cleared by the next success. */
	readonly error: string | null
	/** Whether files are being read and hashed. */
	readonly busy: boolean
	select(id: string | null): void
	toggleSolo(id: string): void
	toggleVisible(id: string): void
	rename(id: string, text: string): void
	/** Moves a layer `delta` steps up (positive) or down (negative) the stack. */
	move(id: string, delta: number): void
	/** Moves the layer at array index `from` to array index `to` (0 is the bottom). */
	moveTo(from: number, to: number): void
	duplicate(id: string): void
	remove(id: string): void
	setBlend(id: string, blend: BlendMode): void
	/** Adds every accepted image as one undo step and selects the last one. */
	importFiles(files: readonly ImageFile[]): Promise<void>
	/** Sets or clears the error line. */
	setError(message: string | null): void
	/** Called after any change to the document, selection, solo, error or busy flag. */
	subscribe(fn: () => void): () => void
	destroy(): void
}

export function createLayersController(options: LayersControllerOptions): LayersController {
	const { store, assetStore } = options
	let ref = options.ref ?? DEFAULT_CLIP
	let selectedId: string | null = null
	let solo: ReadonlySet<string> = new Set()
	let error: string | null = null
	let busy = false
	let destroyed = false
	const subscribers = new Set<() => void>()

	const notify = () => {
		for (const fn of [...subscribers]) fn()
	}

	const layers = (): readonly ProjectLayer[] => clipAt(store.document, ref)?.layers ?? []
	const indexOf = (id: string) => layers().findIndex((layer) => layer.id === id)

	const setSelected = (id: string | null) => {
		if (id === selectedId) return
		selectedId = id
		store.seal()
	}

	/** Drops a selection or solo ids whose layers no longer exist. */
	const prune = () => {
		const ids = new Set(layers().map((layer) => layer.id))
		if (selectedId !== null && !ids.has(selectedId)) setSelected(null)
		if ([...solo].some((id) => !ids.has(id))) solo = new Set([...solo].filter((id) => ids.has(id)))
	}

	const stopStore = store.subscribe(() => {
		prune()
		notify()
	})

	/** Applies a command. The store notifies on success, which prunes and re-renders. */
	const run = (command: Command | null, applyOptions?: ApplyOptions): boolean => {
		if (destroyed || command === null) return false
		const result = store.apply(command, applyOptions)
		if (!result.ok) {
			error = result.error.message
			notify()
			return false
		}
		if (error !== null) {
			error = null
			notify()
		}
		return true
	}

	const withLayer = (id: string, fn: (index: number) => void) => {
		const index = indexOf(id)
		if (index !== -1) fn(index)
	}

	return {
		store,
		get project() {
			return store.document
		},
		get ref() {
			return ref
		},
		get layers() {
			return layers()
		},
		get selectedId() {
			return selectedId
		},
		get solo() {
			return solo
		},
		get error() {
			return error
		},
		get busy() {
			return busy
		},
		select(id) {
			const next = id !== null && indexOf(id) === -1 ? null : id
			if (next === selectedId) return
			setSelected(next)
			notify()
		},
		toggleSolo(id) {
			if (indexOf(id) === -1) return
			const next = new Set(solo)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			solo = next
			notify()
		},
		toggleVisible(id) {
			withLayer(id, (index) =>
				run(setLayerVisible(store.document, ref, index, !layers()[index].visible))
			)
		},
		rename(id, text) {
			withLayer(id, (index) => run(renameLayer(store.document, ref, index, text)))
		},
		move(id, delta) {
			withLayer(id, (index) => run(moveLayer(store.document, ref, index, index + delta)))
		},
		moveTo(from, to) {
			run(moveLayer(store.document, ref, from, to))
		},
		duplicate(id) {
			withLayer(id, (index) => {
				const built = duplicateLayer(store.document, ref, index)
				if (built && run(built.command)) {
					setSelected(built.id)
					notify()
				}
			})
		},
		remove(id) {
			withLayer(id, (index) => {
				const wasSelected = selectedId === id
				if (!run(deleteLayer(store.document, ref, index))) return
				if (!wasSelected) return
				const remaining = layers()
				const next = remaining[index - 1] ?? remaining[0] ?? null
				setSelected(next?.id ?? null)
				notify()
			})
		},
		setBlend(id, blend) {
			withLayer(id, (index) => run(setLayerBlend(store.document, ref, index, blend)))
		},
		async importFiles(files) {
			if (destroyed || files.length === 0) return
			busy = true
			notify()
			try {
				const { images, errors } = await importImageFiles(files, assetStore)
				if (destroyed) return
				const built = addImageLayers(store.document, ref, images)
				let added = false
				if (built) {
					const previousRef = ref
					ref = built.ref
					added = run(built.command)
					if (added) setSelected(built.ids[built.ids.length - 1])
					else ref = previousRef
				}
				if (errors.length > 0) error = errors.join('; ')
				else if (added) error = null
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause)
			} finally {
				busy = false
				if (!destroyed) notify()
			}
		},
		setError(message) {
			if (message === error) return
			error = message
			notify()
		},
		subscribe(fn) {
			subscribers.add(fn)
			return () => {
				subscribers.delete(fn)
			}
		},
		destroy() {
			if (destroyed) return
			destroyed = true
			stopStore()
			subscribers.clear()
		},
	}
}
