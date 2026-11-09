import { createDocumentStore } from '@mytw/document'
import { createRenderer } from '@mytw/engine'
import type { Renderer } from '@mytw/engine'
import { mountProjectHome, thumbnailFromCanvas } from '@mytw/home'
import type { ProjectHome } from '@mytw/home'
import { compileScene } from '@mytw/scene'
import { parseProject, validateProject } from '@mytw/schema'
import type { Project } from '@mytw/schema'
import { createAutosave, createLocalProjectStore } from '@mytw/storage'
import type { Autosave, ProjectStore } from '@mytw/storage'
import understory from '../../../../packages/schema/fixtures/v1/understory.json'

// A manual check for @mytw/storage and @mytw/home: the project list, and an editor stub that
// renders the project, edits its background through a DocumentStore and autosaves it.

const UNDERSTORY_IMAGE = '/images/mytw-002_base.png'

const root = document.body
const storePromise = createLocalProjectStore()

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {},
	children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
	const node = Object.assign(document.createElement(tag), props)
	node.append(...children)
	return node
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function showError(message: string) {
	root.append(element('p', { className: 'page-error', textContent: message, role: 'alert' }))
}

let home: ProjectHome | null = null
let closeEditor: (() => Promise<void>) | null = null

function showHome() {
	root.replaceChildren()
	const understoryButton = element('button', { type: 'button', textContent: 'New from Understory' })
	const toolbar = element('div', { className: 'toolbar' }, [
		element('p', { className: 'title', textContent: '007 project home' }),
		understoryButton,
	])
	const container = element('div')
	root.append(toolbar, container)
	understoryButton.addEventListener('click', () => {
		understoryButton.disabled = true
		void createUnderstory()
			.then((id) => openEditor(id))
			.catch((error: unknown) => {
				understoryButton.disabled = false
				showError(`Could not create the Understory project: ${describe(error)}`)
			})
	})
	home = mountProjectHome(container, {
		store: storePromise,
		onOpen: (id) => void openEditor(id),
	})
}

async function createUnderstory(): Promise<string> {
	const store = await storePromise
	const response = await fetch(UNDERSTORY_IMAGE)
	if (!response.ok) throw new Error(`${UNDERSTORY_IMAGE} returned ${response.status}`)
	await store.putAsset(new Uint8Array(await response.arrayBuffer()))
	const parsed = parseProject(understory)
	if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '))
	const meta = await store.create(parsed.project)
	return meta.id
}

/** Decodes every image the scene uses from the store. Missing ones are left out (not drawn). */
async function loadImages(store: ProjectStore, renderer: Renderer, images: readonly string[]) {
	await Promise.all(
		images.map(async (key) => {
			const bytes = await store.read(key.replace(/^sha256:/, ''))
			if (!bytes) return
			renderer.setImage(key, await createImageBitmap(new Blob([bytes.slice()])))
		})
	)
}

async function openEditor(id: string) {
	const store = await storePromise
	let project: Project
	try {
		project = (await store.open(id)).project
	} catch (error) {
		showHome()
		showError(describe(error))
		return
	}
	home?.destroy()
	home = null
	root.replaceChildren()

	const doc = createDocumentStore<Project>({ document: project, validate: validateProject })
	const heading = element('h2', { textContent: project.name })
	const background = element('input', {
		type: 'color',
		value: project.output.background,
		title: 'Background',
	})
	background.setAttribute('aria-label', 'Background colour')
	const undo = element('button', { type: 'button', textContent: 'Undo' })
	const redo = element('button', { type: 'button', textContent: 'Redo' })
	const status = element('span', { className: 'status', textContent: 'Saved' })
	status.setAttribute('role', 'status')
	const homeButton = element('button', { type: 'button', textContent: 'Home' })
	const canvas = element('canvas')
	root.append(
		element('div', { className: 'toolbar' }, [heading, background, undo, redo, status, homeButton]),
		element('div', { className: 'stage' }, [canvas])
	)

	let scene = compileScene(doc.document)
	const renderer = createRenderer(canvas, {
		width: scene.width,
		height: scene.height,
		preserveDrawingBuffer: true,
	})
	for (const effect of scene.effects) renderer.registerEffect(effect)
	await loadImages(store, renderer, scene.images)

	let frame = 0
	let raf = 0
	const draw = () => {
		renderer.render(scene.frameAt(frame))
		frame = (frame + 1) % scene.frames
		raf = requestAnimationFrame(draw)
	}

	const syncControls = () => {
		background.value = doc.document.output.background
		heading.textContent = doc.document.name
		undo.disabled = !doc.canUndo
		redo.disabled = !doc.canRedo
	}
	const unsubscribe = doc.subscribe(() => {
		scene = compileScene(doc.document)
		syncControls()
	})
	syncControls()

	const labels = { saved: 'Saved', pending: 'Unsaved', saving: 'Saving…', error: 'Not saved' }
	const autosave: Autosave = createAutosave({
		store,
		id,
		document: doc,
		thumbnail: () => thumbnailFromCanvas(canvas),
		onStatus: (next, message) => {
			status.textContent = message ? `${labels[next]}: ${message}` : labels[next]
			status.classList.toggle('error', next === 'error')
		},
	})

	background.addEventListener('input', () => {
		doc.apply(
			{ op: 'set', path: ['output', 'background'], value: background.value },
			{ mergeKey: 'background' }
		)
	})
	background.addEventListener('change', () => doc.seal())
	undo.addEventListener('click', () => doc.undo())
	redo.addEventListener('click', () => doc.redo())

	closeEditor = async () => {
		closeEditor = null
		cancelAnimationFrame(raf)
		await autosave.dispose()
		unsubscribe()
		renderer.dispose()
	}
	homeButton.addEventListener('click', () => {
		homeButton.disabled = true
		void (closeEditor?.() ?? Promise.resolve())
			.then(() => store.setLastOpened(null))
			.then(showHome, (error: unknown) => {
				showHome()
				showError(describe(error))
			})
	})

	draw()
}

async function start() {
	let store: ProjectStore
	try {
		store = await storePromise
	} catch {
		// The home screen shows why projects can't be stored.
		showHome()
		return
	}
	const last = await store.lastOpened()
	const exists = last !== null && (await store.list()).some((meta) => meta.id === last)
	if (exists) await openEditor(last)
	else showHome()
}

void start()
