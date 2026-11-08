<script lang="ts">
	import { untrack } from 'svelte'
	import { LOOP_TARGETS } from '@lib/loop'
	import type { TransportController } from './transport'

	interface Props {
		controller: TransportController
		/** Unique per mounted transport, so two never share element ids. */
		idPrefix: string
		onhide: () => void
	}

	let { controller, idPrefix, onhide }: Props = $props()

	type Choice = 'none' | 'spotifyCanvas' | 'custom'

	// The controller's state is plain. This counter tells the view to read it again.
	let version = $state(0)
	$effect(() =>
		controller.subscribe(() => {
			version += 1
		})
	)

	const view = $derived.by(() => {
		void version
		const { clock } = controller
		return {
			frame: clock.frame,
			loopFrames: clock.loopFrames,
			playing: clock.playing,
			frameLabel: controller.frameLabel,
			frameValueText: controller.frameValueText,
			loopLabel: controller.loopLabel,
			recording: controller.recording,
			loopRecording: controller.loopRecording,
			targetWarning: controller.targetWarning,
			customError: controller.customError,
			status: controller.status,
		}
	})

	// The select starts from the sketch's target, then the user owns it.
	const initial = untrack(() => controller.target)
	const initialChoice: Choice =
		initial === null ? 'none' : initial === LOOP_TARGETS.spotifyCanvas ? 'spotifyCanvas' : 'custom'
	let choice = $state<Choice>(initialChoice)
	let customText = $state(
		initial !== null && initialChoice === 'custom' ? String(initial.maxSeconds) : '10'
	)

	function choose(next: Choice) {
		choice = next
		if (next === 'none') controller.setTarget(null)
		else if (next === 'spotifyCanvas') controller.setTarget(LOOP_TARGETS.spotifyCanvas)
		else controller.setCustomSeconds(customText)
	}

	function setCustom(text: string) {
		customText = text
		controller.setCustomSeconds(text)
	}
</script>

<section class="transport" aria-label="Transport">
	<header>
		<h2>Transport</h2>
		<button
			type="button"
			aria-label="Hide transport (H)"
			title="Hide transport (H)"
			onclick={onhide}>Hide</button
		>
	</header>

	<div class="controls">
		<button
			type="button"
			aria-label="Step back"
			title="Step back"
			disabled={view.recording}
			onclick={() => controller.step(-1)}>−1</button
		>
		<button
			type="button"
			class="play"
			aria-pressed={view.playing}
			disabled={view.loopRecording}
			onclick={() => controller.togglePlay()}>{view.playing ? 'Pause' : 'Play'}</button
		>
		<button
			type="button"
			aria-label="Step forward"
			title="Step forward"
			disabled={view.recording}
			onclick={() => controller.step(1)}>+1</button
		>
		<span class="readout">{view.frameLabel}</span>
	</div>

	<input
		type="range"
		aria-label="Loop phase"
		min="0"
		max={view.loopFrames - 1}
		step="1"
		value={view.frame}
		aria-valuetext={view.frameValueText}
		disabled={view.recording}
		oninput={(event) => controller.scrub(Number(event.currentTarget.value))}
	/>

	<p class="loop">{view.loopLabel}</p>

	<div class="field">
		<label for="{idPrefix}-target">Target</label>
		<select
			id="{idPrefix}-target"
			value={choice}
			onchange={(event) => choose(event.currentTarget.value as Choice)}
		>
			<option value="none">None</option>
			<option value="spotifyCanvas">Spotify Canvas (3–8 s)</option>
			<option value="custom">Custom</option>
		</select>
	</div>

	{#if choice === 'custom'}
		<div class="field">
			<label for="{idPrefix}-custom">Max seconds</label>
			<input
				id="{idPrefix}-custom"
				class="text"
				type="number"
				min="0"
				step="any"
				value={customText}
				aria-invalid={view.customError !== null ? 'true' : undefined}
				aria-describedby={view.customError !== null ? `${idPrefix}-custom-error` : undefined}
				oninput={(event) => setCustom(event.currentTarget.value)}
			/>
		</div>
		{#if view.customError !== null}
			<p id="{idPrefix}-custom-error" class="error">{view.customError}</p>
		{/if}
	{/if}

	<div role="status">
		{#if view.targetWarning !== null}
			<p class="warning">{view.targetWarning}</p>
		{/if}
	</div>

	<div class="controls">
		<button type="button" disabled={view.recording} onclick={() => void controller.recordLoop()}
			>Record loop</button
		>
		<button type="button" disabled={view.recording} onclick={() => controller.checkSeam()}
			>Check seam</button
		>
	</div>

	<p
		class="status"
		class:warn={view.status?.tone === 'warn'}
		class:error={view.status?.tone === 'error'}
		role="status"
	>
		{view.status?.text ?? ''}
	</p>
</section>

<style>
	.transport {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 1000;
		box-sizing: border-box;
		width: 280px;
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
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 6px 0;
	}

	.play {
		min-width: 52px;
	}

	.readout {
		flex: 1;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	input[type='range'] {
		box-sizing: border-box;
		width: 100%;
		margin: 6px 0;
		accent-color: #7aa2ff;
	}

	.loop {
		margin: 0 0 6px;
		color: #bbb;
		font-variant-numeric: tabular-nums;
	}

	.field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		margin: 6px 0;
	}

	select,
	.text {
		padding: 3px 5px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
	}

	.text {
		box-sizing: border-box;
		width: 64px;
		font-variant-numeric: tabular-nums;
	}

	.error {
		margin: 2px 0 0;
		color: #ff6b6b;
	}

	.warning {
		margin: 6px 0;
		padding: 6px 8px;
		border: 1px solid #ff6b6b;
		border-radius: 4px;
		color: #ff6b6b;
	}

	.status {
		min-height: 17px;
		margin: 6px 0 0;
		color: #bbb;
	}

	.status.warn,
	.status.error {
		color: #ff6b6b;
	}

	[aria-invalid='true'] {
		outline: 1px solid #ff6b6b;
		outline-offset: 1px;
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

	button:disabled,
	input:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	/* Also beats the invalid outline, so focus always shows. */
	:focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
