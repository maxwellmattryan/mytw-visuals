// The open project and its edit history. Every document edit goes through a `@mytw/document`
// store, and every change recompiles the scene here, never per frame. Plain TS, no DOM.
import { createDocumentStore, DocumentLoadError } from '@mytw/document'
import type { ApplyResult, DocumentStore, DocumentValidation } from '@mytw/document'
import { compileScene, SceneError } from '@mytw/scene'
import type { Scene } from '@mytw/scene'
import { parseProject, validateProject } from '@mytw/schema'
import type { Project, ProjectLayer } from '@mytw/schema'

import { describeError } from './errors'

/** Indexes of a layer in `project.tracks[track].clips[clip].layers[layer]`. */
export interface LayerRef {
	readonly track: number
	readonly clip: number
	readonly layer: number
}

export interface LayerRow {
	readonly ref: LayerRef
	readonly id: string
	/** `layer.name ?? layer.id`. */
	readonly name: string
	readonly kind: ProjectLayer['kind']
	readonly visible: boolean
}

export type OpenResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

export interface EditorSession {
	readonly project: Project | null
	/** The last scene that compiled. Kept when a later change fails to compile. */
	readonly scene: Scene | null
	/** Why the current document doesn't compile, or `null` when `scene` is current. */
	readonly sceneError: string | null
	readonly canUndo: boolean
	readonly canRedo: boolean
	/** Parses, migrates and compiles `json`, then replaces the open project and clears history. */
	open(json: unknown): OpenResult
	setLayerVisible(ref: LayerRef, visible: boolean): ApplyResult
	undo(): boolean
	redo(): boolean
	/** Calls `fn` after every change: an open, an edit, an undo or a redo. */
	subscribe(fn: () => void): () => void
}

function validate(doc: unknown): DocumentValidation {
	const result = validateProject(doc)
	return result.ok ? { ok: true } : { ok: false, issues: result.issues }
}

const NO_PROJECT: ApplyResult = {
	ok: false,
	error: { code: 'path', message: 'No project is open' },
}

export function createSession(): EditorSession {
	let store: DocumentStore<Project> | null = null
	let unsubscribeStore: (() => void) | null = null
	let scene: Scene | null = null
	let sceneError: string | null = null
	const listeners = new Set<() => void>()

	const notify = () => {
		for (const fn of [...listeners]) fn()
	}

	const recompile = (project: Project) => {
		try {
			scene = compileScene(project)
			sceneError = null
		} catch (error) {
			if (!(error instanceof SceneError)) throw error
			sceneError = describeError(error)
		}
	}

	return {
		get project() {
			return store?.document ?? null
		},
		get scene() {
			return scene
		},
		get sceneError() {
			return sceneError
		},
		get canUndo() {
			return store?.canUndo ?? false
		},
		get canRedo() {
			return store?.canRedo ?? false
		},
		open(json) {
			const parsed = parseProject(json)
			if (!parsed.ok)
				return {
					ok: false,
					message: describeError(
						new DocumentLoadError('Could not open the project', parsed.issues)
					),
				}
			let nextScene: Scene
			let nextStore: DocumentStore<Project>
			try {
				nextScene = compileScene(parsed.project)
				nextStore = createDocumentStore<Project>({ document: parsed.project, validate })
			} catch (error) {
				return { ok: false, message: describeError(error) }
			}
			unsubscribeStore?.()
			store = nextStore
			scene = nextScene
			sceneError = null
			unsubscribeStore = nextStore.subscribe((change) => {
				recompile(change.document)
				notify()
			})
			notify()
			return { ok: true }
		},
		setLayerVisible(ref, visible) {
			if (!store) return NO_PROJECT
			return store.apply({
				op: 'set',
				path: ['tracks', ref.track, 'clips', ref.clip, 'layers', ref.layer, 'visible'],
				value: visible,
			})
		},
		undo() {
			return store?.undo() ?? false
		},
		redo() {
			return store?.redo() ?? false
		},
		subscribe(fn) {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
	}
}

/** Every layer, top of the composite first: the last track first, and in a clip the last layer. */
export function listLayers(project: Project): LayerRow[] {
	const rows: LayerRow[] = []
	for (let track = project.tracks.length - 1; track >= 0; track--) {
		const { clips } = project.tracks[track]
		clips.forEach(({ layers }, clip) => {
			for (let layer = layers.length - 1; layer >= 0; layer--) {
				const source = layers[layer]
				rows.push({
					ref: { track, clip, layer },
					id: source.id,
					name: source.name ?? source.id,
					kind: source.kind,
					visible: source.visible,
				})
			}
		})
	}
	return rows
}
