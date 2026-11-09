<script lang="ts" module>
	let mounted = 0
</script>

<script lang="ts">
	import { tick } from 'svelte'
	import type { EffectsController, EffectScope } from './controller'
	import { rowLabel } from './resolve'
	import type { CatalogItem, StackRow } from './resolve'

	interface Props {
		controller: EffectsController
	}

	let { controller }: Props = $props()

	const uid = ++mounted
	const titleId = `mytw-effects-${uid}`
	const searchId = `mytw-effects-search-${uid}`

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

	const scope = $derived(read(() => controller.scope))
	const hasTarget = $derived(read(() => controller.target !== null))
	/** Apply order: the first one applied is at the top, as in the format's array. */
	const rows: readonly StackRow[] = $derived(read(() => controller.rows))
	const selectedId = $derived(read(() => controller.selectedId))
	const error = $derived(read(() => controller.error))
	const query = $derived(read(() => controller.query))
	const items: readonly CatalogItem[] = $derived(read(() => controller.catalog))
	const builtins = $derived(items.filter((item) => item.source === 'builtin'))
	const customs = $derived(items.filter((item) => item.source === 'custom'))
	const editingId = $derived(read(() => controller.editor?.id ?? null))
	/** The row that takes Tab focus: the selected one, else the first one. */
	const focusId = $derived(selectedId ?? rows[0]?.instance.id ?? null)

	const SCOPES: readonly { value: EffectScope; label: string }[] = [
		{ value: 'layer', label: 'Layer' },
		{ value: 'global', label: 'Composition' },
	]

	let list = $state<HTMLElement | null>(null)

	async function focusRow(id: string | null) {
		await tick()
		if (id === null || list === null) return
		list.querySelector<HTMLElement>(`[data-effect-id="${CSS.escape(id)}"]`)?.focus()
	}

	function onRowKeydown(event: KeyboardEvent, id: string, index: number) {
		// Only when the row itself has focus, not a button or the checkbox inside it.
		if (event.target !== event.currentTarget) return
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault()
			const up = event.key === 'ArrowUp'
			if (event.altKey) {
				controller.move(id, up ? -1 : 1)
				void focusRow(id)
				return
			}
			const next = rows[index + (up ? -1 : 1)]
			if (next) {
				controller.select(next.instance.id)
				void focusRow(next.instance.id)
			}
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault()
			controller.select(id)
			controller.remove(id)
			void focusRow(controller.selectedId)
		} else if (event.key === ' ') {
			event.preventDefault()
			controller.toggleEnabled(id)
		}
	}
</script>

<section class="effects" aria-labelledby={titleId}>
	<header>
		<h2 id={titleId}>Effects</h2>
		<div class="scope" role="group" aria-label="Effect target">
			{#each SCOPES as option (option.value)}
				<button
					type="button"
					aria-pressed={scope === option.value}
					onclick={() => controller.setScope(option.value)}>{option.label}</button
				>
			{/each}
		</div>
	</header>

	<div class="stack">
		{#if !hasTarget}
			<p class="empty">Select a layer, or switch to Composition.</p>
		{:else if rows.length === 0}
			<p class="empty">No effects. Add one from the browser below.</p>
		{:else}
			<ul
				bind:this={list}
				class="list"
				role="listbox"
				aria-label="Effects, first applied at the top"
			>
				{#each rows as row, index (row.instance.id)}
					{@const id = row.instance.id}
					{@const label = rowLabel(row)}
					<li
						class="row"
						class:selected={id === selectedId}
						class:bypassed={!row.instance.enabled}
						class:unknown={row.problem !== null}
						role="option"
						aria-selected={id === selectedId}
						tabindex={id === focusId ? 0 : -1}
						data-effect-id={id}
						onclick={() => controller.select(id)}
						onkeydown={(event) => onRowKeydown(event, id, index)}
					>
						<input
							type="checkbox"
							checked={row.instance.enabled}
							aria-label="Enable {label}"
							title={row.instance.enabled ? 'Bypass' : 'Enable'}
							onclick={(event) => event.stopPropagation()}
							onchange={() => controller.toggleEnabled(id)}
						/>
						<span class="name" title={label}>{label}</span>
						<button
							type="button"
							class="icon"
							aria-label="Move {label} up"
							title="Move up"
							disabled={index === 0}
							onclick={(event) => {
								event.stopPropagation()
								controller.move(id, -1)
							}}>↑</button
						>
						<button
							type="button"
							class="icon"
							aria-label="Move {label} down"
							title="Move down"
							disabled={index === rows.length - 1}
							onclick={(event) => {
								event.stopPropagation()
								controller.move(id, 1)
							}}>↓</button
						>
						<button
							type="button"
							class="icon"
							aria-label="Remove {label}"
							title="Remove"
							onclick={(event) => {
								event.stopPropagation()
								controller.remove(id)
							}}>×</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<p class="error-line" role="alert">{error ?? ''}</p>

	<div class="browser">
		<label class="search-label" for={searchId}>Browse effects</label>
		<input
			id={searchId}
			class="search"
			type="search"
			placeholder="Search effects"
			value={query}
			oninput={(event) => controller.setQuery(event.currentTarget.value)}
		/>

		<div class="catalog">
			{#if items.length === 0 && query.trim() !== ''}
				<p class="empty">No effects match "{query.trim()}".</p>
			{/if}
			{#if builtins.length > 0}
				<ul class="items" aria-label="Built-in effects">
					{#each builtins as item (item.id)}
						{@render entry(item)}
					{/each}
				</ul>
			{/if}
			<h3>Custom</h3>
			{#if customs.length > 0}
				<ul class="items" aria-label="Custom effects">
					{#each customs as item (item.id)}
						{@render entry(item)}
					{/each}
				</ul>
			{/if}
			<button type="button" class="new" onclick={() => controller.newCustomEffect()}
				>New custom effect</button
			>
		</div>
	</div>
</section>

{#snippet entry(item: CatalogItem)}
	<li
		class="item"
		class:editing={item.id === editingId}
		onpointerenter={() => controller.setPreview(item.definition ? item.id : null)}
		onpointerleave={() => controller.setPreview(null)}
		onfocusin={() => controller.setPreview(item.definition ? item.id : null)}
		onfocusout={() => controller.setPreview(null)}
	>
		<div class="item-text">
			<span class="item-name" title={item.name}>{item.name}</span>
			<span class="item-id">{item.id}</span>
			{#if item.error !== null}
				<span class="item-error">{item.error}</span>
			{/if}
		</div>
		{#if item.source === 'custom'}
			<button
				type="button"
				aria-label="Edit {item.name}"
				onclick={() => controller.openEditor(item.id)}>Edit</button
			>
		{/if}
		{#if item.definition !== null}
			<button
				type="button"
				aria-label="Add {item.name}"
				disabled={!hasTarget}
				onclick={() => controller.add(item.id)}>Add</button
			>
		{/if}
	</li>
{/snippet}

<style>
	.effects {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		padding: 12px;
		border: 1px solid #333;
		border-radius: 8px;
		background: #111;
		color: #eee;
		font:
			12px/1.4 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	h3 {
		margin: 10px 0 4px;
		color: #999;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.scope {
		display: flex;
	}

	.scope button {
		border-radius: 0;
	}

	.scope button:first-child {
		border-radius: 4px 0 0 4px;
	}

	.scope button:last-child {
		margin-left: -1px;
		border-radius: 0 4px 4px 0;
	}

	.scope button[aria-pressed='true'] {
		position: relative;
		border-color: #7aa2ff;
		background: #26324a;
		color: #cfdcff;
	}

	button {
		padding: 3px 8px;
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

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.stack {
		flex: 0 1 auto;
		min-height: 48px;
		max-height: 45%;
		overflow-y: auto;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 6px;
		border-radius: 4px;
		cursor: default;
	}

	.row:hover {
		background: #1c1c1c;
	}

	.row.selected {
		background: #26324a;
	}

	.row.bypassed .name {
		color: #777;
	}

	.row.unknown .name {
		color: #e0a060;
	}

	.row input[type='checkbox'] {
		margin: 0;
		accent-color: #7aa2ff;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.icon {
		width: 22px;
		padding: 0;
		line-height: 18px;
		text-align: center;
	}

	.empty {
		margin: 0;
		padding: 12px 8px;
		color: #999;
		text-align: center;
	}

	.error-line {
		min-height: 1.4em;
		margin: 4px 0;
		color: #ff6b6b;
	}

	.browser {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		padding-top: 8px;
		border-top: 1px solid #333;
	}

	.search-label {
		margin-bottom: 4px;
		font-weight: 600;
	}

	.search {
		box-sizing: border-box;
		width: 100%;
		margin-bottom: 6px;
		padding: 4px 6px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
	}

	.catalog {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.items {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
		border-radius: 4px;
	}

	.item:hover,
	.item:focus-within {
		background: #1c1c1c;
	}

	.item.editing {
		background: #26324a;
	}

	.item-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.item-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-id {
		color: #999;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 10px;
	}

	.item-error {
		color: #ff6b6b;
		font-size: 11px;
	}

	.new {
		margin-top: 6px;
	}

	.effects :focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
