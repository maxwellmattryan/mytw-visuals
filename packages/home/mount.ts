import { mount, unmount } from 'svelte'
import type { ProjectStore } from '@mytw/storage'
import { downloadBytes } from './bytes'
import HomeView from './Home.svelte'
import { createHomeModel } from './home-model'

export interface ProjectHomeOptions {
	/** The store, or its pending creation: a rejection shows that projects can't be stored. */
	store: ProjectStore | Promise<ProjectStore>
	/** Called with the id of the project to open. */
	onOpen: (id: string) => void
}

export interface ProjectHome {
	/** Reloads the project list and storage status. */
	refresh(): Promise<void>
	/** Removes the home screen. Later calls do nothing. */
	destroy(): void
}

/** Mounts the project list into `target`. */
export function mountProjectHome(target: HTMLElement, options: ProjectHomeOptions): ProjectHome {
	const model = createHomeModel({ ...options, download: downloadBytes })
	const component = mount(HomeView, { target, props: { model } })
	void model.load()
	let destroyed = false
	return {
		refresh: () => (destroyed ? Promise.resolve() : model.refresh()),
		destroy: () => {
			if (destroyed) return
			destroyed = true
			void unmount(component)
		},
	}
}
