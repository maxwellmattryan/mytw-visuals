<script lang="ts">
	import ProjectCard from './ProjectCard.svelte'
	import type { HomeModel, HomeState } from './home-model'

	interface Props {
		model: HomeModel
	}

	let { model }: Props = $props()

	let home = $state.raw<HomeState | null>(null)
	let now = $state(new Date())
	let fileInput = $state<HTMLInputElement>()

	$effect(() => {
		home = model.state
		return model.subscribe((next) => {
			home = next
		})
	})

	// Keeps "Edited 5 minutes ago" current.
	$effect(() => {
		const timer = setInterval(() => {
			now = new Date()
		}, 60_000)
		return () => clearInterval(timer)
	})

	function pickFile() {
		fileInput?.click()
	}

	function onFile(event: Event) {
		const input = event.currentTarget
		if (!(input instanceof HTMLInputElement)) return
		const file = input.files?.[0]
		input.value = ''
		if (file) void model.importFile(file)
	}
</script>

{#if home}
	<div class="home">
		<header>
			<h1>Projects</h1>
			{#if home.phase === 'ready'}
				<div class="actions">
					<button type="button" class="primary" disabled={home.busy} onclick={() => model.create()}
						>New project</button
					>
					<button type="button" disabled={home.busy} onclick={pickFile}>Import</button>
				</div>
			{/if}
		</header>
		<input
			bind:this={fileInput}
			type="file"
			accept=".zip,application/zip"
			hidden
			onchange={onFile}
		/>

		{#if home.phase === 'ready' && home.showStorageNotice}
			<div class="notice" role="note">
				<p>
					Projects are kept in this browser and can be lost if browser data is cleared. Export
					bundles to keep a copy.
				</p>
				{#if home.canRequestPersistence}
					<button type="button" disabled={home.busy} onclick={() => model.requestPersistence()}
						>Keep data on this device</button
					>
				{/if}
			</div>
		{/if}
		{#if home.phase === 'ready' && home.usageWarning !== null}
			<p class="warning" role="status">
				Storage is {home.usageWarning}% full. Export and delete projects you no longer need.
			</p>
		{/if}
		{#if home.message}
			<div
				class="message {home.message.kind}"
				role={home.message.kind === 'error' ? 'alert' : 'status'}
			>
				<p>{home.message.text}</p>
				<button type="button" aria-label="Dismiss" onclick={() => model.dismissMessage()}>×</button>
			</div>
		{/if}

		{#if home.phase === 'loading'}
			<p class="loading" aria-busy="true">Loading projects…</p>
		{:else if home.phase === 'unavailable'}
			<div class="state">
				<h2>Projects can't be stored in this browser</h2>
				<p>{home.unavailableReason}</p>
				<p>Private browsing modes often turn storage off. Try a normal window.</p>
			</div>
		{:else if home.projects.length === 0}
			<div class="state">
				<h2>No projects yet</h2>
				<p>Start a new project, or import a bundle you exported before.</p>
				<div class="actions">
					<button type="button" class="primary" disabled={home.busy} onclick={() => model.create()}
						>New project</button
					>
					<button type="button" disabled={home.busy} onclick={pickFile}>Import</button>
				</div>
			</div>
		{:else}
			<ul class="grid">
				{#each home.projects as project (project.meta.id)}
					<li>
						<ProjectCard
							{model}
							{project}
							{now}
							busy={home.busy}
							renameError={home.renaming?.id === project.meta.id ? home.renaming.error : undefined}
							confirmingDelete={home.confirmingDelete === project.meta.id}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.home {
		box-sizing: border-box;
		max-width: 1100px;
		margin: 0 auto;
		padding: 24px 16px 48px;
		color: #eee;
		font:
			13px/1.4 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}

	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}

	h2 {
		margin: 0 0 6px;
		font-size: 16px;
		font-weight: 600;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	button {
		padding: 6px 12px;
		border: 1px solid #333;
		border-radius: 6px;
		background: #222;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: #2c2c2c;
	}

	button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	button:focus-visible {
		outline: 2px solid #8ab4ff;
		outline-offset: 1px;
	}

	.primary {
		border-color: #3d5a99;
		background: #253a66;
	}

	.primary:hover:not(:disabled) {
		background: #2d4679;
	}

	.notice,
	.warning,
	.message {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px solid #333;
		border-radius: 6px;
		background: #181818;
	}

	.notice p,
	.message p {
		flex: 1 1 280px;
		margin: 0;
	}

	.warning,
	.message.warning {
		border-color: #5c4a1a;
		background: #2a2310;
		color: #f5d38a;
	}

	.message.error {
		border-color: #5a2323;
		background: #2a1212;
		color: #ffb3b3;
	}

	.message button {
		padding: 2px 8px;
		border: 0;
		background: transparent;
		font-size: 16px;
	}

	.loading,
	.state {
		margin: 48px 0;
		color: #aaa;
		text-align: center;
	}

	.state h2 {
		color: #eee;
	}

	.state p {
		margin: 0 0 6px;
	}

	.state .actions {
		justify-content: center;
		margin-top: 16px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 16px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
