<script lang="ts">
	import type { ParamDef } from '@mytw/schema'
	import ColorField from './ColorField.svelte'
	import NumberField from './NumberField.svelte'
	import type { PanelModel } from './state'

	interface Props {
		model: PanelModel
		key: string
		/** Bumped on every state change, so values and errors are read again. */
		version: number
		idPrefix: string
		highlighted: boolean
	}

	let { model, key, version, idPrefix, highlighted }: Props = $props()

	const def: ParamDef = $derived(model.schema.params[key])
	const id = $derived(`${idPrefix}-${key}`)
	const value: unknown = $derived.by(() => {
		void version
		return model.values[key]
	})
	const error = $derived.by(() => {
		void version
		return model.errors[key]
	})
	const pair: readonly number[] = $derived(Array.isArray(value) ? value : [0, 0])
	const helpId = $derived(`${id}-help`)

	// The vec2 component whose text was last rejected, so only that field shows the error.
	let failed = $state<0 | 1>(0)

	function setComponent(component: 0 | 1, n: number) {
		const next: [number, number] = [pair[0], pair[1]]
		next[component] = n
		model.set(key, next)
	}

	function setComponentText(component: 0 | 1, text: string): boolean {
		const result = model.setText(key, text, component)
		if (!result.ok) failed = component
		return result.ok
	}
</script>

{#snippet resetButton()}
	<button
		type="button"
		class="reset"
		aria-label="Reset {def.label}"
		title="Reset {def.label}"
		onclick={() => model.reset(key)}>↺</button
	>
{/snippet}

{#if def.kind === 'number' || def.kind === 'integer'}
	<NumberField
		{id}
		label={def.label}
		{def}
		value={Number(value)}
		{error}
		{highlighted}
		help={def.help}
		onnumber={(n) => model.set(key, n)}
		ontext={(text) => model.setText(key, text).ok}
		onrevert={() => model.clearError(key)}
		reset={resetButton}
	/>
{:else if def.kind === 'vec2'}
	<NumberField
		id="{id}-x"
		label="{def.label} X"
		{def}
		value={pair[0]}
		error={failed === 0 ? error : undefined}
		{highlighted}
		onnumber={(n) => setComponent(0, n)}
		ontext={(text) => setComponentText(0, text)}
		onrevert={() => model.clearError(key)}
		reset={resetButton}
	/>
	<NumberField
		id="{id}-y"
		label="{def.label} Y"
		{def}
		value={pair[1]}
		error={failed === 1 ? error : undefined}
		{highlighted}
		help={def.help}
		onnumber={(n) => setComponent(1, n)}
		ontext={(text) => setComponentText(1, text)}
		onrevert={() => model.clearError(key)}
	/>
{:else if def.kind === 'color'}
	<ColorField
		{id}
		label={def.label}
		value={String(value)}
		{error}
		{highlighted}
		help={def.help}
		onapply={(text) => model.set(key, text).ok}
		onrevert={() => model.clearError(key)}
		reset={resetButton}
	/>
{:else if def.kind === 'boolean'}
	<div class="row" class:highlighted>
		<div class="head">
			<label class="check">
				<input
					{id}
					type="checkbox"
					checked={value === true}
					aria-describedby={def.help !== undefined ? helpId : undefined}
					onchange={(event) => model.set(key, event.currentTarget.checked)}
				/>
				{def.label}
			</label>
			{@render resetButton()}
		</div>
		{#if def.help !== undefined}<p id={helpId} class="help">{def.help}</p>{/if}
	</div>
{:else if def.kind === 'enum'}
	<div class="row" class:highlighted>
		<div class="head">
			<label for={id}>{def.label}</label>
			{@render resetButton()}
		</div>
		<div class="controls">
			<select
				{id}
				class="wide"
				aria-describedby={def.help !== undefined ? helpId : undefined}
				onchange={(event) => model.set(key, event.currentTarget.value)}
			>
				{#each def.options as option (option)}
					<option value={option} selected={option === value}>{option}</option>
				{/each}
			</select>
		</div>
		{#if def.help !== undefined}<p id={helpId} class="help">{def.help}</p>{/if}
	</div>
{/if}
