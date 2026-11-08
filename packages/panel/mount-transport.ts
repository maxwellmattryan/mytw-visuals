import { mount, unmount } from 'svelte'
import type { SketchCapture } from '@lib/capture'
import type { LoopClock, LoopTarget } from '@lib/loop'
import TransportView from './Transport.svelte'
import { isToggleKey } from './state'
import { createTransport } from './transport'

export interface TransportOptions {
	/** Draws one frame now. In p5, `() => p.redraw()`. */
	redraw: () => void
	/** The loop length to check against. Defaults to none. */
	target?: LoopTarget | null
	/** Mount the transport hidden. Press H to show it. */
	hidden?: boolean
	/** Element to mount into. Defaults to `document.body`. */
	parent?: HTMLElement
}

export interface Transport {
	show(): void
	hide(): void
	toggle(): void
	readonly visible: boolean
	/** Removes the transport and its listeners. Later calls do nothing. */
	destroy(): void
}

/** Check seam compares frames scaled down so their longest side is at most this. */
const SEAM_SIZE = 256

let mounted = 0

/**
 * Mounts a transport bar for a loop clock at the bottom right of the page: play, pause,
 * step, scrub, the loop length against a target, Record loop and Check seam. It sits
 * outside the canvas, so captures and screenshots never include it.
 */
export function mountTransport(
	clock: LoopClock,
	capture: SketchCapture,
	options: TransportOptions
): Transport {
	const scratch = document.createElement('canvas')
	const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })
	// p5's WebGL canvas keeps its drawing buffer, so it can be read right after a redraw.
	const grab = () => {
		const source = capture.canvas
		const scale = Math.min(1, SEAM_SIZE / Math.max(source.width, source.height, 1))
		const width = Math.max(1, Math.round(source.width * scale))
		const height = Math.max(1, Math.round(source.height * scale))
		if (scratch.width !== width) scratch.width = width
		if (scratch.height !== height) scratch.height = height
		if (scratchCtx === null) return new Uint8ClampedArray(0)
		scratchCtx.clearRect(0, 0, width, height)
		scratchCtx.drawImage(source, 0, 0, width, height)
		return scratchCtx.getImageData(0, 0, width, height).data
	}

	const controller = createTransport(
		clock,
		capture,
		{ redraw: options.redraw, grab },
		options.target ?? null
	)

	const container = document.createElement('div')
	container.className = 'mytw-transport'
	;(options.parent ?? document.body).appendChild(container)

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
		if (next) controller.poll()
	}

	const component = mount(TransportView, {
		target: container,
		props: {
			controller,
			idPrefix: `mytw-transport-${++mounted}`,
			onhide: () => setVisible(false),
		},
	})

	let frame = 0
	const tick = () => {
		if (visible) controller.poll()
		frame = requestAnimationFrame(tick)
	}
	frame = requestAnimationFrame(tick)

	const onKeydown = (event: KeyboardEvent) => {
		if (event.repeat) return
		if (isToggleKey(event, document.activeElement)) setVisible(!visible)
	}
	window.addEventListener('keydown', onKeydown)

	return {
		show: () => setVisible(true),
		hide: () => setVisible(false),
		toggle: () => setVisible(!visible),
		get visible() {
			return visible
		},
		destroy: () => {
			if (destroyed) return
			destroyed = true
			cancelAnimationFrame(frame)
			window.removeEventListener('keydown', onKeydown)
			controller.destroy()
			void unmount(component)
			container.remove()
		},
	}
}
