<script lang="ts">
	import type { LayerRef, LayerRow } from './session'

	interface Props {
		/** `null` with no project open. */
		rows: readonly LayerRow[] | null
		ontoggle: (ref: LayerRef, visible: boolean) => void
	}

	let { rows, ontoggle }: Props = $props()
</script>

<section class="panel" aria-labelledby="layers-heading">
	<h2 id="layers-heading">Layers</h2>
	{#if rows === null}
		<p class="empty">No project</p>
	{:else if rows.length === 0}
		<p class="empty">No layers</p>
	{:else}
		<ul>
			{#each rows as row (`${row.ref.track}/${row.ref.clip}/${row.ref.layer}`)}
				<li class:hidden={!row.visible}>
					<span class="name" title={row.name}>{row.name}</span>
					<span class="kind">{row.kind}</span>
					<button
						type="button"
						class="eye"
						aria-pressed={row.visible}
						aria-label="{row.visible ? 'Hide' : 'Show'} {row.name}"
						title="{row.visible ? 'Hide' : 'Show'} {row.name}"
						onclick={() => ontoggle(row.ref, !row.visible)}
						>{row.visible ? 'Visible' : 'Hidden'}</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.panel {
		height: 100%;
		overflow: auto;
	}

	h2 {
		margin: 0;
		padding: 10px 12px 6px;
		color: #999;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.empty {
		margin: 0;
		padding: 6px 12px;
		color: #777;
	}

	ul {
		margin: 0;
		padding: 0 6px 8px;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 28px;
		padding: 0 6px;
		border-radius: 4px;
	}

	li:hover {
		background: #1a1a1a;
	}

	li.hidden .name,
	li.hidden .kind {
		opacity: 0.45;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.kind {
		color: #888;
		font-size: 11px;
	}

	.eye {
		min-width: 58px;
		padding: 2px 6px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #262626;
		color: inherit;
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}

	.eye[aria-pressed='false'] {
		color: #888;
		background: transparent;
	}

	.eye:hover {
		background: #333;
	}

	.eye:focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
