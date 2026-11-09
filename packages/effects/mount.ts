import { flushSync, mount, unmount } from 'svelte'
import type { DocumentStore } from '@mytw/document'
import type { Project } from '@mytw/schema'
import { createEffectsController } from './controller'
import type { EffectCompile, EffectsController } from './controller'
import EffectProperties from './EffectProperties.svelte'
import EffectsPanel from './EffectsPanel.svelte'
import type { EffectBank } from './resolve'
import { createWebGLCompile } from './webgl'

export interface MountEffectsOptions {
	readonly store: DocumentStore<Project>
	/** Element the effects panel (target, stack and browser) mounts into. */
	readonly stackTarget: HTMLElement
	/** Element the effect properties panel mounts into. */
	readonly propertiesTarget: HTMLElement
	/** The built-in effects to offer. Defaults to `EFFECTS` from `@mytw/fx`. */
	readonly bank?: EffectBank
	/** Checks custom GLSL on Apply. Defaults to `createWebGLCompile()`. */
	readonly compile?: EffectCompile
}

export interface MountedEffects {
	readonly controller: EffectsController
	/** Removes both panels and stops listening to the store. Later calls do nothing. */
	destroy(): void
}

let mounted = 0

/** Mounts the effects panel and the effect properties panel over one controller. */
export function mountEffects(options: MountEffectsOptions): MountedEffects {
	const controller = createEffectsController({
		store: options.store,
		compile: options.compile ?? createWebGLCompile(),
		...(options.bank !== undefined ? { bank: options.bank } : {}),
	})
	const panel = mount(EffectsPanel, { target: options.stackTarget, props: { controller } })
	const properties = mount(EffectProperties, {
		target: options.propertiesTarget,
		props: { controller, idPrefix: `mytw-effect-props-${++mounted}` },
	})
	// Runs the components' effects now, so they hear controller changes made right after mounting.
	flushSync()
	let destroyed = false
	return {
		controller,
		destroy() {
			if (destroyed) return
			destroyed = true
			void unmount(panel)
			void unmount(properties)
			controller.destroy()
		},
	}
}
