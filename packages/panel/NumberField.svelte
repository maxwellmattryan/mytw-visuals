<script lang="ts">
	import type { Snippet } from 'svelte'
	import { describedBy, roundNumber, sliderFor, stepValue } from './state'
	import type { RangedParam } from './state'

	interface Props {
		id: string
		label: string
		def: RangedParam
		value: number
		error: string | undefined
		highlighted: boolean
		/** Plain-text help shown under the control. */
		help?: string
		/** Applies a number from the slider or the arrow keys. */
		onnumber: (value: number) => void
		/** Applies typed text. Returns whether it was accepted. */
		ontext: (text: string) => boolean
		/** Puts back the current value after Escape. */
		onrevert: () => void
		reset?: Snippet
	}

	let {
		id,
		label,
		def,
		value,
		error,
		highlighted,
		help,
		onnumber,
		ontext,
		onrevert,
		reset,
	}: Props = $props()

	const slider = $derived(sliderFor(def))
	const errorId = $derived(`${id}-error`)
	const helpId = $derived(`${id}-help`)
	const labelId = $derived(`${id}-label`)
	const describedIds = $derived(
		describedBy(help !== undefined ? helpId : undefined, error !== undefined ? errorId : undefined)
	)

	// The user's text while it differs from the applied value, kept when it is rejected.
	let draft = $state<string | null>(null)
	const shown = $derived(draft ?? String(roundNumber(value)))

	// A new value or a cleared error (slider, reset, reset all) replaces any rejected draft.
	$effect(() => {
		void value
		if (error === undefined) draft = null
	})

	function commit() {
		if (draft !== null && ontext(draft)) draft = null
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault()
			commit()
		} else if (event.key === 'Escape') {
			event.preventDefault()
			draft = null
			onrevert()
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault()
			draft = null
			onnumber(stepValue(def, value, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey))
		}
	}
</script>

<div class="row" class:highlighted>
	<div class="head">
		<label id={labelId} for={id}>{label}</label>
		{@render reset?.()}
	</div>
	<div class="controls">
		{#if slider}
			<input
				type="range"
				min={slider.min}
				max={slider.max}
				step={slider.step}
				{value}
				aria-labelledby={labelId}
				oninput={(event) => onnumber(Number(event.currentTarget.value))}
			/>
		{/if}
		<input
			{id}
			class="text"
			class:wide={!slider}
			type="text"
			inputmode="decimal"
			autocomplete="off"
			spellcheck="false"
			value={shown}
			aria-invalid={error !== undefined ? 'true' : undefined}
			aria-describedby={describedIds}
			oninput={(event) => (draft = event.currentTarget.value)}
			onblur={commit}
			{onkeydown}
		/>
		{#if def.unit}<span class="unit">{def.unit}</span>{/if}
	</div>
	{#if help !== undefined}<p id={helpId} class="help">{help}</p>{/if}
	{#if error !== undefined}<p id={errorId} class="error">{error}</p>{/if}
</div>
