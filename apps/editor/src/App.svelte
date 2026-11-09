<script lang="ts">
	import { onMount } from 'svelte'
	import { DocumentLoadError } from '@mytw/document'
	import { parseProject } from '@mytw/schema'
	import type { Project } from '@mytw/schema'
	import { loadImageAsset } from './assets'
	import ErrorBanner from './ErrorBanner.svelte'
	import { describeError } from './errors'
	import type { ErrorFeed } from './errors'
	import { findFixture, FIXTURES } from './fixtures'
	import type { Fixture } from './fixtures'
	import LayersPanel from './LayersPanel.svelte'
	import { clampPanels, PANEL_DEFAULTS, PANEL_MIN, panelMax, resizePanel } from './panels'
	import type { PanelId, PanelSizes, Viewport } from './panels'
	import { createPlayback } from './playback'
	import type { Playback } from './playback'
	import PropertiesPanel from './PropertiesPanel.svelte'
	import { createSession, listLayers } from './session'
	import type { LayerRef } from './session'
	import { shortcutFor } from './shortcuts'
	import Splitter from './Splitter.svelte'
	import Stage from './Stage.svelte'
	import Timeline from './Timeline.svelte'

	interface Props {
		/** The `?fixture=` id to open on start, or `null` for the empty state. */
		fixture: string | null
		errors: ErrorFeed
	}

	let { fixture: initialFixture, errors }: Props = $props()

	const HEADER_HEIGHT = 40
	const VERSION = `v${__APP_VERSION__}`

	const session = createSession()
	let playback = $state.raw<Playback | null>(null)
	let images = $state.raw<ReadonlyMap<string, ImageBitmap>>(new Map())
	let currentFixture = $state<Fixture['id'] | null>(null)
	let opening = $state<string | null>(null)
	let openError = $state<string | null>(null)
	let openToken = 0

	// Session, playback and the error feed are plain objects. This counter tells the view to read
	// them again, as in packages/panel/Transport.svelte.
	let revision = $state(0)
	const bump = () => {
		revision += 1
	}
	onMount(() => {
		const offSession = session.subscribe(bump)
		const offErrors = errors.subscribe(bump)
		if (initialFixture !== null) void openFixture(initialFixture)
		return () => {
			offSession()
			offErrors()
		}
	})

	const view = $derived.by(() => {
		void revision
		const project = session.project
		return {
			project,
			scene: session.scene,
			sceneError: session.sceneError,
			canUndo: session.canUndo,
			canRedo: session.canRedo,
			rows: project ? listLayers(project) : null,
			errors: errors.entries,
		}
	})

	// Layout. `preferred` holds the sizes the user chose, and the shown sizes are clamped from it,
	// so panels come back when a shrunk window grows again.
	let innerWidth = $state(window.innerWidth)
	let innerHeight = $state(window.innerHeight)
	let preferred = $state<PanelSizes>(PANEL_DEFAULTS)
	const viewport = $derived<Viewport>({
		width: innerWidth,
		height: innerHeight,
		header: HEADER_HEIGHT,
	})
	const sizes = $derived(clampPanels(preferred, viewport))

	function resize(id: PanelId, delta: number) {
		preferred = resizePanel(sizes, id, delta, viewport)
	}

	async function loadImages(project: Project, urls: Fixture['assets']) {
		const entries = Object.entries(project.assets).filter(([, asset]) => asset.kind === 'image')
		const results = await Promise.allSettled(
			entries.map(([hash, asset]) => {
				const name = asset.name ?? hash
				const url = urls[hash]
				if (!url) return Promise.reject(new Error(`No source for asset ${name}`))
				return loadImageAsset(hash, url, name)
			})
		)
		const failed = results.find((result) => result.status === 'rejected')
		if (failed) {
			for (const result of results) if (result.status === 'fulfilled') result.value.close()
			throw failed.reason
		}
		return new Map(
			entries.map(([hash], i) => [hash, (results[i] as PromiseFulfilledResult<ImageBitmap>).value])
		)
	}

	/** Loads and checks everything first, so a failed open leaves the open project untouched. */
	async function openFixture(id: string) {
		const fixture = findFixture(id)
		if (!fixture) {
			openError = `Unknown fixture "${id}"`
			return
		}
		const token = ++openToken
		opening = fixture.name
		openError = null
		try {
			const json = await fixture.load()
			const parsed = parseProject(json)
			if (!parsed.ok) throw new DocumentLoadError('Could not open the project', parsed.issues)
			const loaded = await loadImages(parsed.project, fixture.assets)
			if (token !== openToken) {
				for (const bitmap of loaded.values()) bitmap.close()
				return
			}
			const result = session.open(json)
			if (!result.ok) {
				for (const bitmap of loaded.values()) bitmap.close()
				throw new Error(result.message)
			}
			const previous = images
			images = loaded
			for (const bitmap of previous.values()) bitmap.close()
			const { timeline, output } = parsed.project
			const next = createPlayback({ frames: timeline.frames, fps: output.fps })
			next.play(performance.now())
			playback = next
			currentFixture = fixture.id
		} catch (error) {
			if (token === openToken) openError = describeError(error)
		} finally {
			if (token === openToken) opening = null
		}
	}

	function onFixtureChange(event: Event & { currentTarget: HTMLSelectElement }) {
		const id = event.currentTarget.value
		// The select shows the open project until the new one replaces it.
		event.currentTarget.value = currentFixture ?? ''
		if (id) void openFixture(id)
	}

	function toggleLayer(ref: LayerRef, visible: boolean) {
		const result = session.setLayerVisible(ref, visible)
		if (!result.ok) errors.push(result.error.message)
	}

	function undo() {
		session.undo()
	}

	function redo() {
		session.redo()
	}

	function onkeydown(event: KeyboardEvent) {
		const action = shortcutFor(event, document.activeElement)
		if (action === null) return
		if (action === 'toggle-play') {
			if (!playback) return
			playback.toggle(performance.now())
			bump()
		} else if (action === 'undo') {
			if (!session.canUndo) return
			undo()
		} else {
			if (!session.canRedo) return
			redo()
		}
		event.preventDefault()
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight {onkeydown} />

<svelte:boundary>
	<div
		class="app"
		style:grid-template-columns="{sizes.left}px minmax(0, 1fr) {sizes.right}px"
		style:grid-template-rows="{HEADER_HEIGHT}px minmax(0, 1fr) {sizes.timeline}px"
	>
		<header class="bar">
			<h1>mytw editor</h1>
			<span class="project-name">{view.project?.name ?? ''}</span>
			<select
				aria-label="Open fixture"
				value={currentFixture ?? ''}
				disabled={opening !== null}
				onchange={onFixtureChange}
			>
				<option value="" disabled>Open fixture…</option>
				{#each FIXTURES as fixture (fixture.id)}
					<option value={fixture.id}>{fixture.name}</option>
				{/each}
			</select>
			<div class="history">
				<button type="button" disabled={!view.canUndo} title="Undo (Ctrl+Z / Cmd+Z)" onclick={undo}
					>Undo</button
				>
				<button
					type="button"
					disabled={!view.canRedo}
					title="Redo (Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y)"
					onclick={redo}>Redo</button
				>
			</div>
			<span class="version">{VERSION}</span>
		</header>

		<aside class="left">
			<LayersPanel rows={view.rows} ontoggle={toggleLayer} />
			<div class="edge right-edge">
				<Splitter
					orientation="vertical"
					direction={1}
					label="Resize layers panel"
					value={sizes.left}
					min={PANEL_MIN.left}
					max={panelMax(sizes, 'left', viewport)}
					onresize={(delta) => resize('left', delta)}
				/>
			</div>
		</aside>

		<main class="center">
			<Stage
				scene={view.scene}
				sceneError={view.sceneError}
				{images}
				{playback}
				{revision}
				onframe={bump}
			>
				<div class="overlay">
					<div class="banners">
						{#if openError !== null}
							<ErrorBanner message={openError} ondismiss={() => (openError = null)} />
						{/if}
						{#each view.errors as entry (entry.id)}
							<ErrorBanner message={entry.message} ondismiss={() => errors.dismiss(entry.id)} />
						{/each}
					</div>
					{#if opening !== null}
						<p class="message" role="status">Opening {opening}…</p>
					{:else if view.project === null}
						<div class="empty">
							<p class="message">No project open</p>
							<div class="actions">
								{#each FIXTURES as fixture (fixture.id)}
									<button type="button" onclick={() => openFixture(fixture.id)}
										>Open {fixture.name}</button
									>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</Stage>
		</main>

		<aside class="right">
			<PropertiesPanel project={view.project} />
			<div class="edge left-edge">
				<Splitter
					orientation="vertical"
					direction={-1}
					label="Resize properties panel"
					value={sizes.right}
					min={PANEL_MIN.right}
					max={panelMax(sizes, 'right', viewport)}
					onresize={(delta) => resize('right', delta)}
				/>
			</div>
		</aside>

		<footer class="bottom">
			<Timeline {playback} {revision} onchange={bump} />
			<div class="edge top-edge">
				<Splitter
					orientation="horizontal"
					direction={-1}
					label="Resize timeline panel"
					value={sizes.timeline}
					min={PANEL_MIN.timeline}
					max={panelMax(sizes, 'timeline', viewport)}
					onresize={(delta) => resize('timeline', delta)}
				/>
			</div>
		</footer>
	</div>

	{#snippet failed(error)}
		<div class="fatal" role="alert">
			<h1>The editor hit an error</h1>
			<p>{describeError(error)}</p>
			<button type="button" onclick={() => location.reload()}>Reload</button>
		</div>
	{/snippet}
</svelte:boundary>

<style>
	.app {
		display: grid;
		grid-template-areas:
			'header header header'
			'left center right'
			'bottom bottom bottom';
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background: #101010;
		color: #eee;
		font:
			12px/1.4 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}

	.bar {
		grid-area: header;
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: 0 12px;
		border-bottom: 1px solid #262626;
	}

	h1 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
	}

	.project-name {
		min-width: 0;
		overflow: hidden;
		color: #bbb;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history {
		display: flex;
		gap: 6px;
	}

	.version {
		margin-left: auto;
		color: #777;
		font-variant-numeric: tabular-nums;
	}

	.left,
	.right,
	.bottom {
		position: relative;
		min-width: 0;
		min-height: 0;
		background: #121212;
	}

	.left {
		grid-area: left;
		border-right: 1px solid #262626;
	}

	.right {
		grid-area: right;
		border-left: 1px solid #262626;
	}

	.bottom {
		grid-area: bottom;
		border-top: 1px solid #262626;
	}

	.center {
		grid-area: center;
		min-width: 0;
		min-height: 0;
	}

	/* Each splitter straddles its panel's inner edge. */
	.edge {
		position: absolute;
	}

	.right-edge {
		top: 0;
		bottom: 0;
		right: -4px;
		width: 8px;
	}

	.left-edge {
		top: 0;
		bottom: 0;
		left: -4px;
		width: 8px;
	}

	.top-edge {
		top: -4px;
		left: 0;
		right: 0;
		height: 8px;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 16px;
		pointer-events: none;
	}

	.banners {
		position: absolute;
		top: 12px;
		left: 12px;
		right: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		z-index: 2;
	}

	.message {
		margin: 0;
		color: #bbb;
		font-size: 14px;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		pointer-events: auto;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}

	select {
		padding: 3px 5px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
	}

	button {
		padding: 4px 10px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #262626;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: #333;
	}

	button:disabled,
	select:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	:focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}

	.fatal {
		max-width: 40rem;
		margin: 0 auto;
		padding: 4rem 1.5rem;
		color: #eee;
		font:
			14px/1.5 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}

	.fatal h1 {
		margin: 0 0 12px;
		font-size: 18px;
	}

	.fatal p {
		margin: 0 0 16px;
		color: #ffb3b3;
		overflow-wrap: anywhere;
	}
</style>
