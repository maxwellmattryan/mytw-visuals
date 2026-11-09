<script lang="ts">
	import { formatSeconds } from '@lib/loop'
	import type { Playback } from './playback'

	interface Props {
		/** `null` with no project open, which disables the transport. */
		playback: Playback | null
		/** Bumped by the app whenever playback state may have changed. */
		revision: number
		/** Called after a control changes playback state. */
		onchange: () => void
	}

	let { playback, revision, onchange }: Props = $props()

	const view = $derived.by(() => {
		void revision
		if (!playback) return null
		const { frame, frames, fps, playing, loop } = playback
		return {
			frame,
			frames,
			playing,
			loop,
			readout: `Frame ${frame} / ${frames} · ${formatSeconds(frame, fps)} s / ${formatSeconds(frames, fps)} s`,
			valueText: `Frame ${frame} of ${frames}`,
		}
	})

	function toggle() {
		playback?.toggle(performance.now())
		onchange()
	}

	function scrub(value: number) {
		playback?.seek(value)
		onchange()
	}

	function toggleLoop() {
		if (!playback) return
		playback.setLoop(!playback.loop)
		onchange()
	}
</script>

<section class="timeline" aria-label="Timeline">
	<div class="transport">
		<button
			type="button"
			class="play"
			aria-pressed={view?.playing ?? false}
			disabled={!view}
			title="Play or pause (Space)"
			onclick={toggle}>{view?.playing ? 'Pause' : 'Play'}</button
		>
		<input
			type="range"
			aria-label="Scrub"
			min="0"
			max={view ? view.frames - 1 : 0}
			step="1"
			value={view?.frame ?? 0}
			aria-valuetext={view?.valueText}
			disabled={!view}
			oninput={(event) => scrub(Number(event.currentTarget.value))}
		/>
		<button
			type="button"
			aria-pressed={view?.loop ?? true}
			disabled={!view}
			title="Loop playback"
			onclick={toggleLoop}>Loop</button
		>
		<output class="readout" aria-live="off">{view?.readout ?? 'Frame – / –'}</output>
	</div>
</section>

<style>
	.timeline {
		height: 100%;
		padding: 12px;
		box-sizing: border-box;
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	input[type='range'] {
		flex: 1;
		min-width: 80px;
		margin: 0;
		accent-color: #7aa2ff;
	}

	.play {
		min-width: 60px;
	}

	.readout {
		min-width: 210px;
		color: #bbb;
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	button {
		padding: 4px 10px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #262626;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	button[aria-pressed='true'] {
		border-color: #7aa2ff;
		color: #cfdcff;
	}

	button:hover:not(:disabled) {
		background: #333;
	}

	button:disabled,
	input:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	:focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
