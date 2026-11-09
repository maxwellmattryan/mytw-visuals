<script lang="ts">
	import { isTypingTarget } from '@lib/capture'
	import type { StageController } from './controller'
	import { describeReveal } from './coverage'
	import type { Vec2 } from './geometry'
	import { ASPECT_GUIDES, aspectRect, safeAreas } from './guides'
	import type { AspectGuide, Rect } from './guides'

	interface Props {
		controller: StageController
		/** The renderer's canvas. The overlay positions it; it never draws into it. */
		canvas: HTMLCanvasElement
	}

	let { controller, canvas }: Props = $props()

	// The controller holds plain state. This counter tells the template to read it again.
	let version = $state(0)
	$effect(() =>
		controller.subscribe(() => {
			version += 1
		})
	)

	const read = <T,>(fn: () => T): T => {
		void version
		return fn()
	}

	const view = $derived(read(() => controller.view))
	const output = $derived(read(() => controller.output))
	const selected = $derived(read(() => controller.selected))
	const gizmo = $derived(read(() => controller.gizmo))
	const reveals = $derived(read(() => controller.reveals))
	const hint = $derived(read(() => controller.hint))
	const safeArea = $derived(read(() => controller.safeArea))
	const aspect = $derived(read(() => controller.aspect))
	const gesture = $derived(read(() => controller.gesture))

	const ZOOM_STEP = 1.25

	let surface = $state<HTMLDivElement | null>(null)
	let spaceHeld = $state(false)
	let hover = $state<'move' | 'zoom' | 'rotate' | null>(null)
	/** The last pointer position of a viewport pan, or `null` when not panning. */
	let panFrom = $state<Vec2 | null>(null)

	/** An output-px rectangle in stage px. */
	function toStage(rect: Rect): Rect {
		return {
			x: view.x + rect.x * view.scale,
			y: view.y + rect.y * view.scale,
			width: rect.width * view.scale,
			height: rect.height * view.scale,
		}
	}

	const canvasRect = $derived(toStage({ x: 0, y: 0, ...output }))
	const safe = $derived(safeArea ? safeAreas(output) : null)
	const aspectBox = $derived(aspect ? toStage(aspectRect(output, aspect)) : null)

	const cursor = $derived.by(() => {
		if (panFrom || gesture === 'move') return 'grabbing'
		if (gesture === 'zoom') return 'nwse-resize'
		if (gesture === 'rotate') return 'crosshair'
		if (spaceHeld) return 'grab'
		if (hover === 'zoom') return 'nwse-resize'
		if (hover === 'rotate') return 'crosshair'
		return hover === 'move' ? 'grab' : 'default'
	})

	// The canvas keeps its W×H drawing buffer; only its CSS box follows the view.
	$effect(() => {
		canvas.style.left = `${view.x}px`
		canvas.style.top = `${view.y}px`
		canvas.style.width = `${output.width * view.scale}px`
		canvas.style.height = `${output.height * view.scale}px`
	})

	$effect(() => {
		const el = surface
		if (!el) return
		const resize = () => controller.setStageSize(el.clientWidth, el.clientHeight)
		resize()
		const observer = new ResizeObserver(resize)
		observer.observe(el)
		// The surface is a custom 2D control (role="application"), which Svelte's a11y checks count
		// as non-interactive, so its focusability and listeners are set here rather than in markup.
		// Wheel needs `passive: false` anyway, since the stage always keeps the page from scrolling.
		el.tabIndex = 0
		const stops: (() => void)[] = [() => observer.disconnect()]
		const on = <K extends keyof HTMLElementEventMap>(
			type: K,
			fn: (event: HTMLElementEventMap[K]) => void,
			opts?: AddEventListenerOptions
		) => {
			el.addEventListener(type, fn, opts)
			stops.push(() => el.removeEventListener(type, fn, opts))
		}
		on('wheel', onWheel, { passive: false })
		on('pointerdown', onPointerDown)
		on('pointermove', onPointerMove)
		on('pointerup', onPointerUp)
		on('pointercancel', onPointerCancel)
		on('lostpointercapture', onPointerUp)
		on('pointerleave', onPointerLeave)
		on('keydown', onKeyDown)
		on('keyup', onKeyUp)
		on('blur', onBlur)
		return () => {
			for (const stop of stops) stop()
		}
	})

	function onPointerLeave() {
		if (!controller.gesture && !panFrom) hover = null
	}

	function onBlur() {
		spaceHeld = false
	}

	function pointOf(event: MouseEvent): Vec2 {
		const rect = surface?.getBoundingClientRect()
		return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)]
	}

	function onPointerDown(event: PointerEvent) {
		const el = surface
		if (!el) return
		el.focus({ preventScroll: true })
		const point = pointOf(event)
		if (event.button === 1 || (event.button === 0 && spaceHeld)) {
			event.preventDefault()
			panFrom = point
			el.setPointerCapture(event.pointerId)
			return
		}
		if (event.button !== 0) return
		const kind = controller.hitTest(point)
		if (kind && controller.beginGesture(kind, point)) {
			event.preventDefault()
			el.setPointerCapture(event.pointerId)
		}
	}

	function onPointerMove(event: PointerEvent) {
		const point = pointOf(event)
		if (panFrom) {
			controller.panViewBy(point[0] - panFrom[0], point[1] - panFrom[1])
			panFrom = point
		} else if (controller.gesture) {
			controller.updateGesture(point)
		} else {
			hover = controller.hitTest(point)
		}
	}

	function onPointerUp() {
		if (panFrom) panFrom = null
		else controller.endGesture()
	}

	function onPointerCancel() {
		if (panFrom) panFrom = null
		else controller.cancelGesture()
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault()
		const unit =
			event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (surface?.clientHeight ?? 0) : 1
		const dy = event.deltaY * unit
		const dx = event.deltaX * unit
		const point = pointOf(event)
		if (event.ctrlKey || event.metaKey) controller.zoomView(Math.exp(-dy / 100), point)
		else if (event.altKey) controller.wheelRotate(dy !== 0 ? dy : dx)
		else controller.wheelZoom(dy, point)
	}

	const ARROWS: Record<string, Vec2> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1],
	}

	function onKeyDown(event: KeyboardEvent) {
		if (isTypingTarget(event.target)) return
		if (event.key === ' ') {
			event.preventDefault()
			spaceHeld = true
		} else if (event.key === 'Escape') {
			if (controller.gesture) {
				event.preventDefault()
				controller.cancelGesture()
			}
		} else if (event.key in ARROWS && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault()
			const step = event.shiftKey ? 10 : 1
			const [x, y] = ARROWS[event.key]
			controller.nudge(x * step, y * step)
		}
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.key === ' ') spaceHeld = false
	}

	function onAspect(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value
		controller.setAspect(ASPECT_GUIDES.find((ratio) => ratio === value) ?? null)
	}

	const points = (list: readonly Vec2[]) => list.map(([x, y]) => `${x},${y}`).join(' ')

	/** A path for the area of the canvas outside `inner`, for an even-odd fill. */
	function outside(inner: Rect): string {
		const o = canvasRect
		return (
			`M${o.x},${o.y}h${o.width}v${o.height}h${-o.width}Z` +
			`M${inner.x},${inner.y}h${inner.width}v${inner.height}h${-inner.width}Z`
		)
	}
</script>

<div class="surface" bind:this={surface} role="application" aria-label="Canvas" style:cursor>
	<svg class="guides" width="100%" height="100%" aria-hidden="true">
		{#if aspectBox}
			<path class="dim" d={outside(aspectBox)} fill-rule="evenodd" />
			<rect
				class="aspect"
				x={aspectBox.x}
				y={aspectBox.y}
				width={aspectBox.width}
				height={aspectBox.height}
			/>
		{/if}
		{#if safe}
			{#each [safe.action, safe.title] as area, i (i)}
				{@const r = toStage(area)}
				<rect class="safe" x={r.x} y={r.y} width={r.width} height={r.height} />
			{/each}
		{/if}
		{#if gizmo}
			<polygon class="outline" class:warn={gizmo.warn} points={points(gizmo.outline)} />
			<g class="gizmo">
				<line
					x1={gizmo.center[0] - 8}
					y1={gizmo.center[1]}
					x2={gizmo.center[0] + 8}
					y2={gizmo.center[1]}
				/>
				<line
					x1={gizmo.center[0]}
					y1={gizmo.center[1] - 8}
					x2={gizmo.center[0]}
					y2={gizmo.center[1] + 8}
				/>
				<circle class="ring" cx={gizmo.center[0]} cy={gizmo.center[1]} r={gizmo.ring} />
				<line
					x1={gizmo.stem[0]}
					y1={gizmo.stem[1]}
					x2={gizmo.rotateHandle[0]}
					y2={gizmo.rotateHandle[1]}
				/>
				<circle class="handle" cx={gizmo.rotateHandle[0]} cy={gizmo.rotateHandle[1]} r="5" />
				<rect
					class="handle"
					x={gizmo.zoomHandle[0] - 5}
					y={gizmo.zoomHandle[1] - 5}
					width="10"
					height="10"
				/>
			</g>
		{/if}
	</svg>
</div>

<div class="overlay">
	<div class="toolbar">
		<button type="button" aria-label="Zoom out" onclick={() => controller.zoomView(1 / ZOOM_STEP)}
			>−</button
		>
		<output class="scale" aria-label="View scale">{Math.round(view.scale * 100)}%</output>
		<button type="button" aria-label="Zoom in" onclick={() => controller.zoomView(ZOOM_STEP)}
			>+</button
		>
		<button type="button" onclick={() => controller.fit()}>Fit</button>
		<button type="button" onclick={() => controller.actualSize()}>100%</button>
		<span class="divider" aria-hidden="true"></span>
		<button
			type="button"
			title="Flip horizontally"
			aria-pressed={selected?.transform.mirrorX ?? false}
			disabled={!selected}
			onclick={() => controller.toggleMirror('x')}>Mirror X</button
		>
		<button
			type="button"
			title="Flip vertically"
			aria-pressed={selected?.transform.mirrorY ?? false}
			disabled={!selected}
			onclick={() => controller.toggleMirror('y')}>Mirror Y</button
		>
		<span class="divider" aria-hidden="true"></span>
		<button type="button" aria-pressed={safeArea} onclick={() => controller.toggleSafeArea()}
			>Safe area</button
		>
		<select aria-label="Aspect guide" value={aspect ?? ''} onchange={onAspect}>
			<option value="">Aspect: Off</option>
			{#each ASPECT_GUIDES as ratio (ratio)}
				<option value={ratio}>{ratio}</option>
			{/each}
		</select>
	</div>
	{#if hint}
		<p class="hint">{hint}</p>
	{/if}
	<ul class="warnings" role="status">
		{#each reveals as reveal (reveal.layerId)}
			<li>{describeReveal(reveal)}</li>
		{/each}
	</ul>
</div>

<style>
	.surface {
		position: absolute;
		inset: 0;
		z-index: 1;
		outline: none;
		touch-action: none;
	}

	.surface:focus-visible {
		box-shadow: inset 0 0 0 2px #7aa2ff;
	}

	.guides {
		position: absolute;
		inset: 0;
		overflow: visible;
		pointer-events: none;
	}

	.dim {
		fill: rgba(0, 0, 0, 0.4);
	}

	.aspect,
	.safe,
	.outline,
	.gizmo line,
	.ring {
		fill: none;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.aspect {
		stroke: rgba(255, 255, 255, 0.7);
	}

	.safe {
		stroke: rgba(255, 255, 255, 0.55);
		stroke-dasharray: 6 4;
	}

	.outline {
		stroke: #7aa2ff;
	}

	.outline.warn {
		stroke: #ffb347;
	}

	.gizmo line,
	.ring {
		stroke: #7aa2ff;
	}

	.handle {
		fill: #111;
		stroke: #7aa2ff;
		stroke-width: 1.5;
	}

	.overlay {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		max-width: calc(100% - 16px);
		color: #eee;
		font:
			12px/1.4 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		pointer-events: none;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		padding: 4px;
		border: 1px solid #333;
		border-radius: 6px;
		background: rgba(17, 17, 17, 0.92);
		pointer-events: auto;
	}

	button,
	select {
		padding: 3px 8px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #262626;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	button:hover:not(:disabled),
	select:hover {
		background: #333;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	button[aria-pressed='true'] {
		border-color: #7aa2ff;
		background: #1d2a44;
	}

	button:focus-visible,
	select:focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}

	.scale {
		min-width: 44px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.divider {
		width: 1px;
		align-self: stretch;
		margin: 0 4px;
		background: #333;
	}

	.hint,
	.warnings li {
		margin: 0;
		padding: 4px 8px;
		border: 1px solid #333;
		border-radius: 4px;
		background: rgba(17, 17, 17, 0.92);
	}

	.warnings {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.warnings li {
		border-color: #ffb347;
		color: #ffb347;
	}
</style>
