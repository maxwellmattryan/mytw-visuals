<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import type { Snippet } from 'svelte'
	import { createRenderer, EngineError } from '@mytw/engine'
	import type { Renderer } from '@mytw/engine'
	import type { Scene } from '@mytw/scene'
	import { describeError } from './errors'
	import { fitRect } from './fit'
	import type { Size } from './fit'
	import type { Playback } from './playback'

	interface Props {
		scene: Scene | null
		/** Why the document doesn't compile. The stage holds the last good frame meanwhile. */
		sceneError: string | null
		/** Decoded image assets by hash, for every image the open project has. */
		images: ReadonlyMap<string, ImageBitmap>
		playback: Playback | null
		/** Bumped on every document or playback change, so the next animation frame redraws. */
		revision: number
		/** Called when playback moves to a new frame on its own. */
		onframe: () => void
		/** Shown over the stage: the empty state, the opening message, banners. */
		children?: Snippet
	}

	let { scene, sceneError, images, playback, revision, onframe, children }: Props = $props()

	let stage: HTMLDivElement
	let canvas: HTMLCanvasElement
	let renderer = $state.raw<Renderer | null>(null)
	let webglMissing = $state(false)
	let contextLost = $state(false)
	let renderError = $state<string | null>(null)
	let box = $state<Size>({ width: 0, height: 0 })

	const registered = new Set<string>()
	let uploaded: ReadonlyMap<string, ImageBitmap> = new Map()
	let dirty = true

	const fit = $derived(
		scene ? fitRect({ width: scene.width, height: scene.height }, box) : { width: 0, height: 0 }
	)

	// Uploads what a new scene or image set needs. Effects register once per id, because the
	// renderer recompiles on every registerEffect.
	$effect(() => {
		const r = renderer
		const s = scene
		const next = images
		if (!r || !s) return
		untrack(() => {
			try {
				if (r.width !== s.width || r.height !== s.height) r.setSize(s.width, s.height)
				if (next !== uploaded) {
					for (const id of uploaded.keys()) if (!next.has(id)) r.deleteImage(id)
					for (const [id, bitmap] of next) r.setImage(id, bitmap)
					uploaded = next
				}
				for (const effect of s.effects) {
					if (registered.has(effect.id)) continue
					r.registerEffect(effect)
					registered.add(effect.id)
				}
				renderError = null
			} catch (error) {
				renderError = describeError(error)
			}
			dirty = true
		})
	})

	$effect(() => {
		void revision
		void sceneError
		dirty = true
	})

	function frame(now: number) {
		raf = requestAnimationFrame(frame)
		const r = renderer
		if (!r || !scene || !playback) return
		if (playback.tick(now)) {
			dirty = true
			onframe()
		}
		if (r.contextLost !== contextLost) contextLost = r.contextLost
		// Hold the last good frame while the document doesn't compile or the last draw failed.
		if (!dirty || sceneError !== null || renderError !== null || contextLost) return
		try {
			if (r.render(scene.frameAt(playback.frame))) dirty = false
		} catch (error) {
			renderError = describeError(error)
		}
	}

	let raf = 0

	onMount(() => {
		try {
			renderer = createRenderer(canvas, { width: scene?.width ?? 1, height: scene?.height ?? 1 })
		} catch (error) {
			if (!(error instanceof EngineError)) throw error
			webglMissing = true
		}
		const offRestored = renderer?.onRestored(() => {
			contextLost = false
			renderError = null
			dirty = true
		})
		const observer = new ResizeObserver(([entry]) => {
			box = { width: entry.contentRect.width, height: entry.contentRect.height }
			dirty = true
		})
		observer.observe(stage)
		raf = requestAnimationFrame(frame)
		return () => {
			cancelAnimationFrame(raf)
			observer.disconnect()
			offRestored?.()
			renderer?.dispose()
			renderer = null
		}
	})
</script>

<div class="stage" bind:this={stage}>
	<canvas
		bind:this={canvas}
		class:shown={scene !== null && renderer !== null && fit.width > 0}
		style:width="{fit.width}px"
		style:height="{fit.height}px"
	></canvas>

	<div class="notices" role="status">
		{#if webglMissing}
			<p class="notice">This browser can't run WebGL2, which the editor needs.</p>
		{:else if contextLost}
			<p class="notice">Graphics context lost. Waiting for the browser to restore it.</p>
		{/if}
		{#if sceneError !== null}
			<p class="notice warn">Can't render: {sceneError}</p>
		{:else if renderError !== null}
			<p class="notice warn">Can't render: {renderError}</p>
		{/if}
	</div>

	{@render children?.()}
</div>

<style>
	.stage {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #1a1a1a;
	}

	canvas {
		display: none;
		box-shadow: 0 0 0 1px #2a2a2a;
	}

	canvas.shown {
		display: block;
	}

	.notices {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		pointer-events: none;
	}

	.notice {
		max-width: 100%;
		margin: 0;
		padding: 6px 10px;
		border: 1px solid #444;
		border-radius: 6px;
		background: rgba(16, 16, 16, 0.92);
		overflow-wrap: anywhere;
	}

	.notice.warn {
		border-color: #e0a84e;
		color: #ffe3b3;
	}
</style>
