<script lang="ts">
	import Group from './Group.svelte'
	import ParamRow from './ParamRow.svelte'
	import { groupParams } from './state'
	import type { PanelModel } from './state'

	interface Props {
		model: PanelModel
		title: string
		/** Unique per mounted panel, so two panels never share element ids. */
		idPrefix: string
		onhide: () => void
	}

	let { model, title, idPrefix, onhide }: Props = $props()

	// `model.values` stays a plain object. This counter tells the rows to read it again.
	let version = $state(0)
	$effect(() =>
		model.subscribe(() => {
			version += 1
		})
	)

	const sections = $derived(groupParams(model.schema))
	const issues = $derived.by(() => {
		void version
		return model.constraintIssues
	})
	const highlighted = $derived(new Set<string>(issues.flatMap((issue) => issue.params)))
</script>

<section class="panel" aria-labelledby="{idPrefix}-title">
	<header>
		<h2 id="{idPrefix}-title">{title}</h2>
		<button type="button" onclick={() => model.resetAll()}>Reset all</button>
		<button type="button" aria-label="Hide panel (H)" title="Hide panel (H)" onclick={onhide}
			>Hide</button
		>
	</header>

	<div class="issues" role="status">
		{#each issues as issue (issue.constraint)}
			<p class="issue">{issue.message}</p>
		{/each}
	</div>

	{#each sections as section (section.group)}
		{#if section.group === null}
			<div class="ungrouped">
				{#each section.keys as key (key)}
					<ParamRow {model} {key} {version} {idPrefix} highlighted={highlighted.has(key)} />
				{/each}
			</div>
		{:else}
			<Group name={section.group}>
				{#each section.keys as key (key)}
					<ParamRow {model} {key} {version} {idPrefix} highlighted={highlighted.has(key)} />
				{/each}
			</Group>
		{/if}
	{/each}
</section>

<style>
	.panel {
		position: fixed;
		top: 16px;
		left: 16px;
		z-index: 1000;
		box-sizing: border-box;
		width: 280px;
		max-height: calc(100vh - 32px);
		overflow-y: auto;
		padding: 12px;
		border-radius: 8px;
		background: rgba(16, 16, 16, 0.92);
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
		gap: 6px;
		margin-bottom: 8px;
	}

	h2 {
		flex: 1;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		font-size: 13px;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.issue {
		margin: 0 0 8px;
		padding: 6px 8px;
		border: 1px solid #ff6b6b;
		border-radius: 4px;
		color: #ff6b6b;
	}

	/* Shared by every row component inside this panel. */
	.panel :global(.row) {
		margin: 6px 0;
	}

	.panel :global(.head) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		min-height: 22px;
	}

	.panel :global(.controls) {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
	}

	.panel :global(input[type='range']) {
		flex: 1;
		min-width: 0;
		margin: 0;
		accent-color: #7aa2ff;
	}

	.panel :global(.text) {
		box-sizing: border-box;
		width: 64px;
		padding: 3px 5px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
	}

	.panel :global(.wide) {
		flex: 1;
		width: auto;
		min-width: 0;
	}

	.panel :global(select) {
		padding: 3px 5px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
	}

	.panel :global(input[type='color']) {
		width: 32px;
		height: 24px;
		padding: 0;
		border: 1px solid #444;
		border-radius: 4px;
		background: none;
	}

	.panel :global(.unit) {
		color: #999;
	}

	.panel :global(.check) {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.panel :global(.error) {
		margin: 2px 0 0;
		color: #ff6b6b;
	}

	.panel :global([aria-invalid='true']),
	.panel :global(.highlighted input),
	.panel :global(.highlighted select) {
		outline: 1px solid #ff6b6b;
		outline-offset: 1px;
	}

	.panel :global(button) {
		padding: 3px 8px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #262626;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.panel :global(button:hover) {
		background: #333;
	}

	.panel :global(.reset) {
		padding: 0 6px;
		line-height: 18px;
	}

	/* Also beats the invalid and highlighted outlines, so focus always shows. */
	.panel :global(:focus-visible),
	.panel :global(.highlighted :focus-visible) {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
