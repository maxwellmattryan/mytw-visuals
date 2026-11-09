import { isTypingTarget } from '@lib/capture'
import { MemoryAssetSource } from '@mytw/assets'
import { createDocumentStore } from '@mytw/document'
import type { DocumentValidation } from '@mytw/document'
import { createRenderer } from '@mytw/engine'
import { applySolo, mountLayers } from '@mytw/layers'
import { parseProject, validateProject } from '@mytw/schema'
import type { Project } from '@mytw/schema'
import { compileScene } from '@mytw/scene'
import type { Scene } from '@mytw/scene'
import fixture from '../../../../packages/schema/fixtures/v1/understory.json'

// The layers panel's host and manual test page: layers on the left, a live engine preview in the
// centre, properties on the right. Every edit goes through one document store, so Mod+Z undoes it.

const FIXTURE_IMAGE = '/images/mytw-002_base.png'

function element<T extends HTMLElement>(id: string, type: new () => T): T {
	const found = document.getElementById(id)
	if (!(found instanceof type)) throw new Error(`Missing #${id}`)
	return found
}

function validate(doc: unknown): DocumentValidation {
	const result = validateProject(doc)
	return result.ok ? { ok: true } : { ok: false, issues: result.issues }
}

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)

async function main() {
	const message = element('stage-message', HTMLParagraphElement)
	const canvas = element('canvas', HTMLCanvasElement)
	const stage = element('stage', HTMLDivElement)

	const parsed = parseProject(fixture)
	if (!parsed.ok)
		throw new Error(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
	const store = createDocumentStore<Project>({ document: parsed.project, validate })

	const assets = new MemoryAssetSource()
	const response = await fetch(FIXTURE_IMAGE)
	if (!response.ok) throw new Error(`Could not load ${FIXTURE_IMAGE} (${response.status})`)
	await assets.add(new Uint8Array(await response.arrayBuffer()))

	const { controller } = mountLayers({
		store,
		assetStore: assets,
		layersTarget: element('layers', HTMLDivElement),
		propertiesTarget: element('properties', HTMLDivElement),
	})
	if (controller.layers.length > 0) controller.select(controller.layers.at(-1)?.id ?? null)

	const { output } = store.document
	const renderer = createRenderer(canvas, { width: output.width, height: output.height })
	// Hashes whose upload has started, and those the renderer holds.
	const uploaded = new Set<string>()
	const ready = new Set<string>()
	const registered = new Set<string>()
	let scene: Scene | null = null
	let sceneError = ''
	let renderError = ''

	const showMessage = () => {
		message.textContent = sceneError || renderError
	}

	const upload = async (hash: string) => {
		const bytes = await assets.read(hash.slice('sha256:'.length))
		if (!bytes) throw new Error(`No bytes for asset ${hash}`)
		renderer.setImage(hash, await createImageBitmap(new Blob([new Uint8Array(bytes)])))
		ready.add(hash)
	}

	/** Recompiles the scene, then uploads new images and registers new effects. */
	const sync = () => {
		try {
			scene = compileScene(store.document)
			sceneError = ''
		} catch (error) {
			scene = null
			sceneError = error instanceof Error ? error.message : String(error)
		}
		if (scene) {
			for (const hash of scene.images) {
				if (uploaded.has(hash)) continue
				uploaded.add(hash)
				upload(hash).catch((error: unknown) => {
					uploaded.delete(hash)
					renderError = error instanceof Error ? error.message : String(error)
					showMessage()
				})
			}
			for (const effect of scene.effects) {
				if (registered.has(effect.id)) continue
				registered.add(effect.id)
				renderer.registerEffect(effect)
			}
		}
		showMessage()
	}
	store.subscribe(sync)
	sync()

	// Plays the loop in real time. Solo applies to the preview only.
	const started = performance.now()
	const loop = (now: number) => {
		if (scene) {
			const frame = Math.floor(((now - started) / 1000) * scene.fps) % scene.frames
			try {
				const full = scene.frameAt(frame)
				// Layers whose image is still decoding sit out, since the renderer doesn't know them yet.
				const loaded = {
					...full,
					layers: full.layers.map((layer) =>
						ready.has(layer.image) ? layer : { ...layer, visible: false }
					),
				}
				renderer.render(applySolo(loaded, controller.solo))
				if (renderError) {
					renderError = ''
					showMessage()
				}
			} catch (error) {
				renderError = error instanceof Error ? error.message : String(error)
				showMessage()
			}
		}
		requestAnimationFrame(loop)
	}
	requestAnimationFrame(loop)

	window.addEventListener('keydown', (event) => {
		if (isTypingTarget(document.activeElement)) return
		const mod = isMac ? event.metaKey : event.ctrlKey
		if (!mod) return
		const key = event.key.toLowerCase()
		if (key === 'z' && !event.shiftKey) {
			event.preventDefault()
			store.undo()
		} else if ((key === 'z' && event.shiftKey) || (key === 'y' && !isMac)) {
			event.preventDefault()
			store.redo()
		}
	})

	// Images dropped on the preview are added too.
	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
	stage.addEventListener('dragover', (event) => {
		if (!hasFiles(event)) return
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
	})
	stage.addEventListener('drop', (event) => {
		if (!hasFiles(event)) return
		event.preventDefault()
		void controller.importFiles([...(event.dataTransfer?.files ?? [])])
	})
}

main().catch((error: unknown) => {
	const message = document.getElementById('stage-message')
	if (message) message.textContent = error instanceof Error ? error.message : String(error)
	console.error(error)
})
