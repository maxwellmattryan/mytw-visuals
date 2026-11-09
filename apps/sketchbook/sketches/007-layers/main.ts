import { isTypingTarget } from '@lib/capture'
import { MemoryAssetSource } from '@mytw/assets'
import { createDocumentStore } from '@mytw/document'
import type { DocumentValidation } from '@mytw/document'
import { applyEffectPreview, buildCustomEffect, mountEffects } from '@mytw/effects'
import { createRenderer } from '@mytw/engine'
import type { EffectProgram } from '@mytw/engine'
import { assembleFragment, EFFECTS } from '@mytw/fx'
import { applySolo, mountLayers } from '@mytw/layers'
import { parseProject, validateProject } from '@mytw/schema'
import type { Project } from '@mytw/schema'
import { compileScene } from '@mytw/scene'
import type { Scene } from '@mytw/scene'
import fixture from '../../../../packages/schema/fixtures/v1/understory.json'

// The layers and effects panels' host and manual test page: layers and effects on the left, a live
// engine preview in the centre, layer and effect properties on the right. Every edit goes through
// one document store, so Mod+Z undoes it.

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

/** Inputs that take no text, so undo still works right after dragging a slider or ticking a box. */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'color'])

function isTextEntry(el: Element | null): boolean {
	if (el instanceof HTMLInputElement && NON_TEXT_INPUTS.has(el.type)) return false
	return isTypingTarget(el)
}

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

	// The effects panels edit the layer the layers panel selects.
	const effects = mountEffects({
		store,
		stackTarget: element('effects', HTMLDivElement),
		propertiesTarget: element('effect-properties', HTMLDivElement),
	})
	effects.controller.setLayer(controller.selectedId)
	controller.subscribe(() => effects.controller.setLayer(controller.selectedId))

	const { output } = store.document
	const renderer = createRenderer(canvas, { width: output.width, height: output.height })
	// Hashes whose upload has started, and those the renderer holds.
	const uploaded = new Set<string>()
	const ready = new Set<string>()
	// The fragment each effect id was registered with, so an edited custom effect re-registers.
	const registered = new Map<string, string>()
	let scene: Scene | null = null
	let sceneError = ''
	let renderError = ''
	let effectError = ''

	const showMessage = () => {
		message.textContent = sceneError || effectError || renderError
	}

	const register = (program: EffectProgram) => {
		if (registered.get(program.id) === program.fragment) return
		registered.set(program.id, program.fragment)
		try {
			renderer.registerEffect(program)
		} catch (error) {
			effectError = `${program.id}: ${error instanceof Error ? error.message : String(error)}`
		}
	}

	// Every bank effect up front, so a hover preview of one the project doesn't use yet renders.
	for (const definition of EFFECTS)
		register({ id: definition.id, fragment: assembleFragment(definition).source })

	const upload = async (hash: string) => {
		const bytes = await assets.read(hash.slice('sha256:'.length))
		if (!bytes) throw new Error(`No bytes for asset ${hash}`)
		renderer.setImage(hash, await createImageBitmap(new Blob([new Uint8Array(bytes)])))
		ready.add(hash)
	}

	/** Recompiles the scene, then uploads new images and registers new or changed effects. */
	const sync = () => {
		effectError = ''
		// Custom effects register as soon as they exist, so hovering one in the browser previews it.
		for (const entry of store.document.customEffects ?? []) {
			const built = buildCustomEffect(entry)
			if (built.ok)
				register({ id: built.effect.id, fragment: assembleFragment(built.effect).source })
		}
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
			for (const effect of scene.effects) register(effect)
		}
		showMessage()
	}
	store.subscribe(sync)
	sync()

	// Plays the loop in real time. Solo and the effect browser's hover preview apply to the preview
	// only, never to the document.
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
				const previewed = applyEffectPreview(
					loaded,
					effects.controller.preview,
					frame / scene.frames
				)
				renderer.render(applySolo(previewed, controller.solo))
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
		if (isTextEntry(document.activeElement)) return
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
