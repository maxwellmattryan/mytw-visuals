<script lang="ts">
	import { SPLITTER_STEP } from './panels'

	interface Props {
		/** The panel edge it sits on. A vertical splitter moves left and right. */
		orientation: 'vertical' | 'horizontal'
		/** +1 when moving right or down grows the panel, −1 when it shrinks it. */
		direction: 1 | -1
		label: string
		value: number
		min: number
		max: number
		/** Asks the panel to grow by `delta` px (negative shrinks). The panel clamps it. */
		onresize: (delta: number) => void
	}

	let { orientation, direction, label, value, min, max, onresize }: Props = $props()

	// The pointer position and panel size when the drag started, so a clamped drag doesn't drift.
	let drag: { start: number; size: number } | null = null
	let dragging = $state(false)

	const position = (event: PointerEvent) =>
		orientation === 'vertical' ? event.clientX : event.clientY

	function onpointerdown(event: PointerEvent & { currentTarget: HTMLDivElement }) {
		if (event.button !== 0) return
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		event.currentTarget.focus()
		drag = { start: position(event), size: value }
		dragging = true
	}

	function onpointermove(event: PointerEvent) {
		if (!drag) return
		const target = drag.size + (position(event) - drag.start) * direction
		if (target !== value) onresize(target - value)
	}

	function endDrag() {
		drag = null
		dragging = false
	}

	function onkeydown(event: KeyboardEvent) {
		const keys = orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
		const index = keys.indexOf(event.key)
		if (index === -1) return
		event.preventDefault()
		// Index 1 (right or down) moves the splitter forward.
		onresize((index === 1 ? 1 : -1) * direction * SPLITTER_STEP)
	}
</script>

<!-- A focusable separator with a value is an interactive widget in WAI-ARIA (the window splitter
pattern), but Svelte's a11y check counts every separator as static. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="splitter {orientation}"
	class:dragging
	role="separator"
	aria-label={label}
	aria-orientation={orientation}
	aria-valuenow={value}
	aria-valuemin={min}
	aria-valuemax={max}
	tabindex="0"
	{onpointerdown}
	{onpointermove}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onlostpointercapture={endDrag}
	{onkeydown}
></div>

<style>
	.splitter {
		position: absolute;
		z-index: 5;
		touch-action: none;
	}

	.splitter::after {
		content: '';
		position: absolute;
		background: transparent;
		transition: background 0.1s;
	}

	.vertical {
		top: 0;
		bottom: 0;
		width: 8px;
		cursor: col-resize;
	}

	.vertical::after {
		top: 0;
		bottom: 0;
		left: 3px;
		width: 2px;
	}

	.horizontal {
		left: 0;
		right: 0;
		height: 8px;
		cursor: row-resize;
	}

	.horizontal::after {
		left: 0;
		right: 0;
		top: 3px;
		height: 2px;
	}

	.splitter:hover::after,
	.dragging::after {
		background: #3a3a3a;
	}

	.splitter:focus-visible {
		outline: none;
	}

	.splitter:focus-visible::after {
		background: #7aa2ff;
	}
</style>
