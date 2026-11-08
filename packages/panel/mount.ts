import { mount, unmount } from 'svelte'
import type { ParamDefs, ParamValues, Schema } from '@mytw/schema'
import PanelView from './Panel.svelte'
import { createPanelState, isToggleKey } from './state'
import type { ChangeListener, ParamKey, SetResult } from './state'

export interface PanelOptions {
	/** Header title. Defaults to `document.title`. */
	title?: string
	/** Element to mount into. Defaults to `document.body`. */
	target?: HTMLElement
	/** Mount the panel hidden. Press H to show it. */
	hidden?: boolean
}

export interface Panel<P extends ParamDefs> {
	/** Current values. A plain object, updated in place, so read it in `draw()`. */
	readonly values: ParamValues<P>
	/** Validates and applies a value, as a control would. */
	set<K extends ParamKey<P>>(key: K, value: ParamValues<P>[K]): SetResult
	reset(key: ParamKey<P>): void
	resetAll(): void
	/** Listens for applied changes. Returns a function that stops listening. */
	onChange(fn: ChangeListener<P>): () => void
	show(): void
	hide(): void
	toggle(): void
	readonly visible: boolean
	/** Removes the panel and its key listener. Later calls do nothing. */
	destroy(): void
}

let mounted = 0

/** Mounts a control panel for a schema and returns its live values. */
export function mountPanel<P extends ParamDefs>(
	schema: Schema<P>,
	options: PanelOptions = {}
): Panel<P> {
	const state = createPanelState(schema)
	const container = document.createElement('div')
	container.className = 'mytw-panel'
	;(options.target ?? document.body).appendChild(container)

	let visible = options.hidden !== true
	let destroyed = false
	container.hidden = !visible

	const setVisible = (next: boolean) => {
		if (destroyed || next === visible) return
		if (!next && container.contains(document.activeElement)) {
			const active = document.activeElement
			if (active instanceof HTMLElement) active.blur()
		}
		visible = next
		container.hidden = !next
	}

	const component = mount(PanelView, {
		target: container,
		props: {
			model: state,
			title: options.title ?? document.title,
			idPrefix: `mytw-panel-${++mounted}`,
			onhide: () => setVisible(false),
		},
	})

	const onKeydown = (event: KeyboardEvent) => {
		if (event.repeat || !isToggleKey(event, document.activeElement)) return
		setVisible(!visible)
	}
	window.addEventListener('keydown', onKeydown)

	return {
		values: state.values,
		set: (key, value) =>
			destroyed ? { ok: false, message: 'Panel is destroyed' } : state.set(key, value),
		reset: (key) => {
			if (!destroyed) state.reset(key)
		},
		resetAll: () => {
			if (!destroyed) state.resetAll()
		},
		onChange: (fn) => (destroyed ? () => {} : state.onChange(fn)),
		show: () => setVisible(true),
		hide: () => setVisible(false),
		toggle: () => setVisible(!visible),
		get visible() {
			return visible
		},
		destroy: () => {
			if (destroyed) return
			destroyed = true
			window.removeEventListener('keydown', onKeydown)
			void unmount(component)
			container.remove()
		},
	}
}
