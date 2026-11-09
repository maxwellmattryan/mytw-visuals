<script lang="ts">
	import { Group, groupParams, ParamRow } from '@mytw/panel'
	import type { EffectsController } from './controller'
	import CustomEffectEditor from './CustomEffectEditor.svelte'
	import { createEffectModel } from './properties'
	import { rowLabel } from './resolve'

	interface Props {
		controller: EffectsController
		/** Unique per mounted panel, so two panels never share element ids. */
		idPrefix: string
	}

	let { controller, idPrefix }: Props = $props()

	const model = $derived(createEffectModel(controller))
	$effect(() => {
		const current = model
		return () => current.destroy()
	})

	// `model.values` stays a plain object. This counter tells the rows to read it again. The model
	// re-renders on every controller change too, which covers the selection and the draft.
	let version = $state(0)
	$effect(() =>
		model.subscribe(() => {
			version += 1
		})
	)

	const read = <T,>(fn: () => T): T => {
		void version
		return fn()
	}

	const draft = $derived(read(() => controller.editor))
	const row = $derived(read(() => controller.selected))
	const definition = $derived(read(() => model.definition))
	const sections = $derived(definition === null ? [] : groupParams(definition.params))

	/** A row remounts only when its help text changes, which happens when the selection does. */
	const helpOf = (key: string): string => read(() => model.schema.params[key]?.help ?? '')
</script>

<section class="properties" aria-label="Effect properties">
	{#if draft !== null}
		<CustomEffectEditor {controller} {draft} {idPrefix} />
	{:else if row === null}
		<p class="empty">Select an effect to edit its controls.</p>
	{:else}
		{@const label = rowLabel(row)}
		<header>
			<h2 id="{idPrefix}-title" title={label}>{label}</h2>
			{#if definition !== null}
				<button type="button" onclick={() => model.resetAll()}>Reset all</button>
			{/if}
		</header>
		{#if definition === null}
			<p class="empty">This effect isn't available, so it has no controls.</p>
		{:else if sections.length === 0}
			<p class="empty">This effect has no controls.</p>
		{:else}
			{#key definition}
				{#each sections as section (section.group)}
					{#if section.group === null}
						<!-- Params with no group sit above the groups, with no heading. -->
						{#each section.keys as key (key)}
							{#key helpOf(key)}
								<ParamRow {model} {key} {version} {idPrefix} highlighted={false} />
							{/key}
						{/each}
					{:else}
						<Group name={section.group}>
							{#each section.keys as key (key)}
								{#key helpOf(key)}
									<ParamRow {model} {key} {version} {idPrefix} highlighted={false} />
								{/key}
							{/each}
						</Group>
					{/if}
				{/each}
			{/key}
		{/if}
	{/if}
</section>

<style>
	.properties {
		box-sizing: border-box;
		height: 100%;
		min-height: 0;
		overflow-y: auto;
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

	.empty {
		margin: 0;
		padding: 16px 8px;
		color: #999;
		text-align: center;
	}

	/* The same row styles as @mytw/panel's Panel, for its ParamRow and fields. */
	.properties :global(.row) {
		margin: 6px 0;
	}

	.properties :global(.head) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		min-height: 22px;
	}

	.properties :global(.controls) {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
	}

	.properties :global(input[type='range']) {
		flex: 1;
		min-width: 0;
		margin: 0;
		accent-color: #7aa2ff;
	}

	.properties :global(.text) {
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

	.properties :global(.wide) {
		flex: 1;
		width: auto;
		min-width: 0;
	}

	.properties :global(select) {
		padding: 3px 5px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
	}

	.properties :global(.unit) {
		color: #999;
	}

	.properties :global(.check) {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.properties :global(.error) {
		margin: 2px 0 0;
		color: #ff6b6b;
	}

	.properties :global(.help) {
		margin: 2px 0 0;
		color: #999;
		font-size: 11px;
	}

	.properties :global([aria-invalid='true']) {
		outline: 1px solid #ff6b6b;
		outline-offset: 1px;
	}

	.properties :global(button) {
		padding: 3px 8px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #262626;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.properties :global(button:hover:not(:disabled)) {
		background: #333;
	}

	.properties :global(button:disabled) {
		opacity: 0.5;
		cursor: default;
	}

	.properties :global(.reset) {
		padding: 0 6px;
		line-height: 18px;
	}

	.properties :global(:focus-visible) {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
