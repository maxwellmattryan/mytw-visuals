<script lang="ts">
	import type { Comparing, SnapshotStore } from './snapshots'

	interface Props {
		store: SnapshotStore
		comparing: Comparing
		idPrefix: string
	}

	let { store, comparing, idPrefix }: Props = $props()

	const shown = $derived(comparing.side === 'a' ? 'A: current' : `B: ${comparing.name}`)
</script>

<div class="compare" role="group" aria-labelledby="{idPrefix}-compare-title">
	<p id="{idPrefix}-compare-title" class="title">Comparing with "{comparing.name}"</p>
	<p class="side" aria-live="polite">
		Showing <strong class:b={comparing.side === 'b'}>{shown}</strong>
	</p>
	<div class="actions">
		<button type="button" title="Swap A/B (B)" aria-keyshortcuts="B" onclick={() => store.swap()}
			>Swap A/B</button
		>
		<button type="button" onclick={() => store.keep('a')}>Keep A</button>
		<button type="button" onclick={() => store.keep('b')}>Keep B</button>
	</div>
</div>

<style>
	.compare {
		margin: 0 0 8px;
		padding: 6px 8px;
		border: 1px solid #7aa2ff;
		border-radius: 4px;
		background: rgba(122, 162, 255, 0.08);
	}

	p {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title {
		font-weight: 600;
	}

	.side {
		margin-top: 2px;
		color: #bbb;
	}

	strong {
		color: #eee;
	}

	strong.b {
		color: #7aa2ff;
	}

	.actions {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
</style>
