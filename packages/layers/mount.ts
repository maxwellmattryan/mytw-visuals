import { flushSync, mount, unmount } from 'svelte'
import type { DocumentStore } from '@mytw/document'
import type { Project } from '@mytw/schema'
import { createLayersController } from './controller'
import type { LayersController } from './controller'
import type { AssetStore } from './import'
import LayerProperties from './LayerProperties.svelte'
import LayersPanel from './LayersPanel.svelte'
import type { ClipRef } from './target'

export interface MountLayersOptions {
	readonly store: DocumentStore<Project>
	readonly assetStore: AssetStore
	/** Element the layer list mounts into. */
	readonly layersTarget: HTMLElement
	/** Element the properties panel mounts into. */
	readonly propertiesTarget: HTMLElement
	/** The clip to edit. Defaults to `{ track: 0, clip: 0 }`. */
	readonly ref?: ClipRef
}

export interface MountedLayers {
	readonly controller: LayersController
	/** Removes both panels and stops listening to the store. Later calls do nothing. */
	destroy(): void
}

let mounted = 0

/** Mounts the layers panel and the properties panel over one controller, for non-Svelte hosts. */
export function mountLayers(options: MountLayersOptions): MountedLayers {
	const controller = createLayersController({
		store: options.store,
		assetStore: options.assetStore,
		...(options.ref !== undefined ? { ref: options.ref } : {}),
	})
	const list = mount(LayersPanel, { target: options.layersTarget, props: { controller } })
	const properties = mount(LayerProperties, {
		target: options.propertiesTarget,
		props: { controller, idPrefix: `mytw-layer-props-${++mounted}` },
	})
	// Runs the components' effects now, so they hear controller changes made right after mounting.
	flushSync()
	let destroyed = false
	return {
		controller,
		destroy() {
			if (destroyed) return
			destroyed = true
			void unmount(list)
			void unmount(properties)
			controller.destroy()
		},
	}
}
