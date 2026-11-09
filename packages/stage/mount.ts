import { flushSync, mount, unmount } from 'svelte'
import type { Scene } from '@mytw/scene'
import type { LayersController } from '../layers/controller'
import { createStageController } from './controller'
import type { StageController } from './controller'
import StageOverlay from './StageOverlay.svelte'

export interface MountStageOptions {
	/** The layers controller whose selection the stage frames and whose store it edits. */
	readonly layers: LayersController
	/** The stage element. It must be positioned and clip overflow; the overlay fills it. */
	readonly stage: HTMLElement
	/** The renderer's canvas, inside `stage`. The overlay positions it and never draws into it. */
	readonly canvas: HTMLCanvasElement
	/** The host's compiled scene, for the edge warning. Without it the stage compiles its own. */
	readonly scene?: () => Scene | null
}

export interface MountedStage {
	readonly controller: StageController
	/** Removes the overlay and stops listening. Later calls do nothing. */
	destroy(): void
}

/** Mounts the stage overlay over a renderer's canvas, for non-Svelte hosts. */
export function mountStage(options: MountStageOptions): MountedStage {
	const controller = createStageController({
		layers: options.layers,
		...(options.scene !== undefined ? { scene: options.scene } : {}),
	})
	const overlay = mount(StageOverlay, {
		target: options.stage,
		props: { controller, canvas: options.canvas },
	})
	// Runs the component's effects now, so it sizes the view and hears changes made right away.
	flushSync()
	let destroyed = false
	return {
		controller,
		destroy() {
			if (destroyed) return
			destroyed = true
			void unmount(overlay)
			controller.destroy()
		},
	}
}
