<script lang="ts">
	import { tick } from 'svelte'
	import Group from './Group.svelte'
	import type { SnapshotMeta, SnapshotStore } from './snapshots'

	interface Props {
		store: SnapshotStore
		/** Bumped on every store change, so the list and status are read again. */
		version: number
		idPrefix: string
	}

	let { store, version, idPrefix }: Props = $props()

	const MAX_FILE_BYTES = 1024 * 1024

	let open = $state(false)
	let name = $state('')
	let pasteText = $state('')
	let renamingId = $state<string | null>(null)
	let renameText = $state('')
	let renameError = $state<string | null>(null)
	let textarea = $state<HTMLTextAreaElement>()
	let fileInput = $state<HTMLInputElement>()

	const snapshots = $derived.by(() => {
		void version
		return store.snapshots
	})
	const status = $derived.by(() => {
		void version
		return store.status
	})
	const comparingId = $derived.by(() => {
		void version
		return store.comparing?.id ?? null
	})
	const placeholder = $derived.by(() => {
		void version
		return store.defaultName()
	})
	const rowId = (index: number, part: string) => `${idPrefix}-snapshot-${index}-${part}`

	function save(event: SubmitEvent) {
		event.preventDefault()
		store.save(name)
		name = ''
	}

	function focusSelect(node: HTMLInputElement) {
		node.focus()
		node.select()
	}

	function startRename(snapshot: SnapshotMeta) {
		renamingId = snapshot.id
		renameText = snapshot.name
		renameError = null
	}

	async function endRename(index: number, refocus: boolean) {
		renamingId = null
		renameError = null
		if (!refocus) return
		await tick()
		document.getElementById(rowId(index, 'rename'))?.focus()
	}

	function commitRename(snapshot: SnapshotMeta, index: number, refocus: boolean) {
		if (renamingId !== snapshot.id) return
		const result = store.rename(snapshot.id, renameText)
		if (result.ok) void endRename(index, refocus)
		else renameError = result.message
	}

	function onRenameKey(event: KeyboardEvent, snapshot: SnapshotMeta, index: number) {
		if (event.key === 'Enter') {
			event.preventDefault()
			commitRename(snapshot, index, true)
		} else if (event.key === 'Escape') {
			event.preventDefault()
			void endRename(index, true)
		}
	}

	function remove(snapshot: SnapshotMeta) {
		if (!window.confirm(`Delete snapshot "${snapshot.name}"?`)) return
		if (renamingId === snapshot.id) renamingId = null
		store.remove(snapshot.id)
	}

	async function copy() {
		const text = store.copyText()
		try {
			if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('No clipboard')
			await navigator.clipboard.writeText(text)
			store.report({ kind: 'info', message: 'Copied values as JSON' })
		} catch {
			pasteText = text
			open = true
			await tick()
			textarea?.focus()
			textarea?.select()
			store.report({
				kind: 'error',
				message: "Couldn't copy automatically. The JSON is selected below.",
			})
		}
	}

	function apply() {
		store.applyText(pasteText)
	}

	async function importFile(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget
		const file = input.files?.[0]
		input.value = ''
		if (!file) return
		if (file.size > MAX_FILE_BYTES) {
			store.report({ kind: 'error', message: 'File is too large (max 1 MB)' })
			return
		}
		let text: string
		try {
			text = await file.text()
		} catch {
			store.report({ kind: 'error', message: "Couldn't read the file" })
			return
		}
		store.applyText(text)
	}
</script>

{#snippet statusLine()}
	<div class="status" class:failed={status?.kind === 'error'} role="status">
		{#if status}
			<p>{status.message}</p>
			{#if status.details}
				<ul>
					{#each status.details as detail, i (i)}
						<li>{detail}</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
{/snippet}

<div class="snapshots">
	<Group name="Snapshots" bind:open>
		{#if open}{@render statusLine()}{/if}

		<form class="save" onsubmit={save}>
			<input
				class="text wide"
				type="text"
				aria-label="Snapshot name"
				maxlength="80"
				{placeholder}
				bind:value={name}
			/>
			<button type="submit">Save</button>
		</form>

		{#if snapshots.length === 0}
			<p class="empty">No snapshots yet.</p>
		{:else}
			<ul class="list">
				{#each snapshots as snapshot, index (snapshot.id)}
					<li class:active={snapshot.id === comparingId}>
						{#if renamingId === snapshot.id}
							<div class="field">
								<input
									class="text wide"
									type="text"
									aria-label="New name for {snapshot.name}"
									aria-invalid={renameError !== null ? 'true' : undefined}
									aria-describedby={renameError !== null ? rowId(index, 'error') : undefined}
									maxlength="80"
									bind:value={renameText}
									use:focusSelect
									onkeydown={(event) => onRenameKey(event, snapshot, index)}
									onblur={() => commitRename(snapshot, index, false)}
								/>
							</div>
							{#if renameError !== null}
								<p id={rowId(index, 'error')} class="error">{renameError}</p>
							{/if}
						{:else}
							<p class="name" title={snapshot.name}>{snapshot.name}</p>
						{/if}
						<div class="actions">
							<button
								type="button"
								aria-label="Load {snapshot.name}"
								onclick={() => store.load(snapshot.id)}>Load</button
							>
							<button
								type="button"
								aria-label="Compare with {snapshot.name}"
								onclick={() => store.compare(snapshot.id)}>Compare</button
							>
							<button
								type="button"
								id={rowId(index, 'rename')}
								aria-label="Rename {snapshot.name}"
								onclick={() => startRename(snapshot)}>Rename</button
							>
							<button
								type="button"
								aria-label="Delete {snapshot.name}"
								onclick={() => remove(snapshot)}>Delete</button
							>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="json">
			<div class="actions">
				<button type="button" onclick={copy}>Copy JSON</button>
				<button type="button" onclick={() => fileInput?.click()}>Import file</button>
				<input
					type="file"
					accept="application/json,.json"
					hidden
					bind:this={fileInput}
					onchange={importFile}
				/>
			</div>
			<label for="{idPrefix}-paste">Paste JSON</label>
			<div class="field">
				<textarea
					id="{idPrefix}-paste"
					class="text wide"
					rows="4"
					spellcheck="false"
					bind:value={pasteText}
					bind:this={textarea}
				></textarea>
			</div>
			<div class="actions">
				<button type="button" onclick={apply}>Apply</button>
			</div>
		</div>
	</Group>
	{#if !open}{@render statusLine()}{/if}
</div>

<style>
	.status p {
		margin: 4px 0;
		color: #bbb;
	}

	.status.failed p {
		color: #ff6b6b;
	}

	.status ul {
		margin: 0 0 4px;
		padding-left: 16px;
		color: #999;
		font-size: 11px;
	}

	/* A flex row, so the shared `.wide` class stretches its field to the full width. */
	.field,
	.save,
	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.save {
		margin: 4px 0 8px;
	}

	.empty {
		margin: 0 0 8px;
		color: #999;
	}

	.list {
		margin: 0 0 8px;
		padding: 0;
		list-style: none;
	}

	li {
		padding: 6px 0 6px 8px;
		border-left: 2px solid transparent;
	}

	li + li {
		border-top: 1px solid #2a2a2a;
	}

	li.active {
		border-left-color: #7aa2ff;
	}

	.name {
		margin: 0 0 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	li .field {
		margin-bottom: 4px;
	}

	li .actions button {
		padding: 2px 6px;
	}

	.json {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 8px;
		border-top: 1px solid #2a2a2a;
	}

	textarea {
		resize: vertical;
		tab-size: 2;
	}
</style>
