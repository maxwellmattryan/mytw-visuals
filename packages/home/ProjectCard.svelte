<script lang="ts">
	import { blobOf } from './bytes'
	import { relativeTime } from './home-model'
	import type { HomeModel, HomeProject } from './home-model'

	interface Props {
		model: HomeModel
		project: HomeProject
		/** The inline rename error while this card is being renamed, or `undefined` when it isn't. */
		renameError: string | null | undefined
		confirmingDelete: boolean
		busy: boolean
		now: Date
	}

	let { model, project, renameError, confirmingDelete, busy, now }: Props = $props()

	const meta = $derived(project.meta)
	const renaming = $derived(renameError !== undefined)
	const errorId = $derived(`rename-error-${meta.id}`)

	let thumbnailUrl = $state<string | null>(null)

	// Reloads the thumbnail when the project is saved, and revokes the old object URL.
	$effect(() => {
		const id = meta.id
		if (!meta.hasThumbnail) return
		void meta.updatedAt
		let url: string | null = null
		let cancelled = false
		void model.thumbnail(id).then((thumbnail) => {
			if (cancelled || !thumbnail) return
			url = URL.createObjectURL(blobOf(thumbnail.bytes, thumbnail.mimeType))
			thumbnailUrl = url
		})
		return () => {
			cancelled = true
			if (url) URL.revokeObjectURL(url)
			thumbnailUrl = null
		}
	})

	function focusSelect(node: HTMLInputElement) {
		node.focus()
		node.select()
	}

	function submitRename(event: SubmitEvent) {
		event.preventDefault()
		const form = event.currentTarget
		if (!(form instanceof HTMLFormElement)) return
		const field = form.elements.namedItem('name')
		if (field instanceof HTMLInputElement) void model.commitRename(field.value)
	}

	function renameKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault()
			model.cancelRename()
		}
	}
</script>

<article class="card" class:newer={project.newer}>
	<button
		type="button"
		class="open"
		onclick={() => model.open(meta.id)}
		aria-label={`Open ${meta.name}`}
	>
		{#if thumbnailUrl}
			<img src={thumbnailUrl} alt="" />
		{:else}
			<span class="placeholder" aria-hidden="true"></span>
		{/if}
	</button>
	<div class="body">
		{#if renaming}
			<form onsubmit={submitRename}>
				<input
					name="name"
					value={meta.name}
					maxlength="400"
					aria-label="Project name"
					aria-invalid={renameError ? 'true' : undefined}
					aria-describedby={renameError ? errorId : undefined}
					onkeydown={renameKeydown}
					use:focusSelect
				/>
				{#if renameError}
					<p class="error" id={errorId}>{renameError}</p>
				{/if}
			</form>
		{:else}
			<h3 title={meta.name}>{meta.name}</h3>
		{/if}
		<p class="time">Edited {relativeTime(meta.updatedAt, now)}</p>
		{#if project.newer}
			<span class="badge">Made with a newer version</span>
		{/if}
		{#if confirmingDelete}
			<div class="confirm" role="alert">
				<p>Delete “{meta.name}”? This can't be undone.</p>
				<div class="actions">
					<button type="button" class="danger" disabled={busy} onclick={() => model.confirmDelete()}
						>Delete</button
					>
					<button type="button" onclick={() => model.cancelDelete()}>Cancel</button>
				</div>
			</div>
		{:else}
			<div class="actions">
				<button type="button" disabled={busy} onclick={() => model.startRename(meta.id)}
					>Rename</button
				>
				<button type="button" disabled={busy} onclick={() => model.duplicate(meta.id)}
					>Duplicate</button
				>
				<button type="button" disabled={busy} onclick={() => model.exportProject(meta.id)}
					>Export</button
				>
				<button type="button" disabled={busy} onclick={() => model.requestDelete(meta.id)}
					>Delete</button
				>
			</div>
		{/if}
	</div>
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		background: #151515;
	}

	.open {
		position: relative;
		display: block;
		overflow: hidden;
		aspect-ratio: 1;
		width: 100%;
		padding: 0;
		border: 0;
		background: #0b0b0b;
		cursor: pointer;
	}

	.open:focus-visible {
		outline: 2px solid #8ab4ff;
		outline-offset: -2px;
	}

	.open img {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.placeholder {
		display: block;
		width: 100%;
		height: 100%;
		background: repeating-linear-gradient(45deg, #121212 0 12px, #181818 12px 24px);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px 12px;
	}

	h3 {
		margin: 0;
		overflow: hidden;
		font-size: 14px;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		padding: 4px 6px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #0b0b0b;
		color: inherit;
		font: inherit;
		font-size: 14px;
	}

	input[aria-invalid='true'] {
		border-color: #ff6b6b;
	}

	.time {
		margin: 0;
		color: #999;
	}

	.badge {
		align-self: flex-start;
		padding: 2px 6px;
		border-radius: 4px;
		background: #3a2f12;
		color: #f5c76b;
		font-size: 11px;
	}

	.error {
		margin: 4px 0 0;
		color: #ff8a8a;
	}

	.confirm p {
		margin: 4px 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 6px;
	}

	button:not(.open) {
		padding: 4px 8px;
		border: 1px solid #333;
		border-radius: 4px;
		background: #222;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	button:not(.open):hover:not(:disabled) {
		background: #2c2c2c;
	}

	button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	button:not(.open):focus-visible {
		outline: 2px solid #8ab4ff;
		outline-offset: 1px;
	}

	.danger {
		border-color: #5a2323;
		background: #3a1414;
		color: #ffb3b3;
	}
</style>
