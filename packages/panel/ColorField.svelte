<script lang="ts">
	import type { Snippet } from 'svelte'
	import { describedBy } from './state'

	interface Props {
		id: string
		label: string
		value: string
		error: string | undefined
		highlighted: boolean
		/** Plain-text help shown under the control. */
		help?: string
		/** Applies a color from the picker or the hex field. Returns whether it was accepted. */
		onapply: (value: string) => boolean
		/** Puts back the current value after Escape. */
		onrevert: () => void
		reset: Snippet
	}

	let { id, label, value, error, highlighted, help, onapply, onrevert, reset }: Props = $props()

	const errorId = $derived(`${id}-error`)
	const helpId = $derived(`${id}-help`)
	const labelId = $derived(`${id}-label`)
	const describedIds = $derived(
		describedBy(help !== undefined ? helpId : undefined, error !== undefined ? errorId : undefined)
	)

	// The user's hex text while it differs from the applied value, kept when it is rejected.
	let draft = $state<string | null>(null)
	const shown = $derived(draft ?? value)

	// A new value or a cleared error (picker, reset, reset all) replaces any rejected draft.
	$effect(() => {
		void value
		if (error === undefined) draft = null
	})

	function commit() {
		if (draft !== null && onapply(draft.trim())) draft = null
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault()
			commit()
		} else if (event.key === 'Escape') {
			event.preventDefault()
			draft = null
			onrevert()
		}
	}
</script>

<div class="row" class:highlighted>
	<div class="head">
		<label id={labelId} for={id}>{label}</label>
		{@render reset()}
	</div>
	<div class="controls">
		<input
			type="color"
			value={value.toLowerCase()}
			aria-label="{label} picker"
			aria-describedby={describedIds}
			oninput={(event) => onapply(event.currentTarget.value)}
		/>
		<input
			{id}
			class="text wide"
			type="text"
			autocomplete="off"
			spellcheck="false"
			value={shown}
			aria-invalid={error !== undefined ? 'true' : undefined}
			aria-describedby={describedIds}
			oninput={(event) => (draft = event.currentTarget.value)}
			onblur={commit}
			{onkeydown}
		/>
	</div>
	{#if help !== undefined}<p id={helpId} class="help">{help}</p>{/if}
	{#if error !== undefined}<p id={errorId} class="error">{error}</p>{/if}
</div>
