<script lang="ts">
	import { CHUNKS, isChunkId } from '@mytw/fx'
	import type { ChunkId } from '@mytw/fx'
	import type { CustomEffectDraft, EffectsController } from './controller'

	interface Props {
		controller: EffectsController
		draft: CustomEffectDraft
		/** Unique per mounted panel, so two panels never share element ids. */
		idPrefix: string
	}

	let { controller, draft, idPrefix }: Props = $props()

	const CHUNK_IDS: readonly ChunkId[] = Object.keys(CHUNKS).filter(isChunkId)
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

	const lineCount = $derived(draft.glsl.split('\n').length)
	/** The first message for each GLSL line that has an error, for the gutter. */
	const lineErrors = $derived.by(() => {
		const byLine = new Map<number, string>()
		for (const error of draft.errors)
			if (error.line !== null && !byLine.has(error.line)) byLine.set(error.line, error.message)
		return byLine
	})

	let gutter = $state<HTMLElement | null>(null)

	function onEditorKeydown(event: KeyboardEvent) {
		const mod = isMac ? event.metaKey : event.ctrlKey
		if (mod && event.key === 'Enter') {
			event.preventDefault()
			controller.applyDraft()
		}
	}

	function toggleChunk(id: ChunkId, on: boolean) {
		const chunks = on
			? CHUNK_IDS.filter((chunk) => chunk === id || draft.chunks.includes(chunk))
			: draft.chunks.filter((chunk) => chunk !== id)
		controller.editDraft({ chunks })
	}
</script>

<div class="glsl-editor">
	<header>
		<h2 id="{idPrefix}-title">Custom effect</h2>
		<span class="id" title="The id can't be changed">{draft.id}</span>
		{#if draft.dirty}<span class="dirty">Unapplied changes</span>{/if}
	</header>

	<label class="field">
		<span>Name</span>
		<input
			type="text"
			maxlength="200"
			value={draft.name}
			oninput={(event) => controller.editDraft({ name: event.currentTarget.value })}
		/>
	</label>

	<label class="field-label" for="{idPrefix}-glsl">GLSL</label>
	<div class="code">
		<div class="gutter" bind:this={gutter} aria-hidden="true">
			{#each { length: lineCount }, i (i)}
				{@const message = lineErrors.get(i + 1)}
				<div class="line-number" class:has-error={message !== undefined} title={message}>
					{i + 1}
				</div>
			{/each}
		</div>
		<textarea
			id="{idPrefix}-glsl"
			class="source"
			spellcheck="false"
			autocomplete="off"
			wrap="off"
			rows="12"
			aria-describedby="{idPrefix}-errors"
			value={draft.glsl}
			oninput={(event) => controller.editDraft({ glsl: event.currentTarget.value })}
			onkeydown={onEditorKeydown}
			onscroll={(event) => {
				if (gutter) gutter.scrollTop = event.currentTarget.scrollTop
			}}
		></textarea>
	</div>

	<ul id="{idPrefix}-errors" class="errors" aria-live="polite">
		{#each draft.errors as error, i (i)}
			<li>{error.line === null ? error.message : `Line ${error.line}: ${error.message}`}</li>
		{/each}
	</ul>

	<label class="field-label" for="{idPrefix}-params">Params (JSON)</label>
	<textarea
		id="{idPrefix}-params"
		class="source params"
		spellcheck="false"
		autocomplete="off"
		rows="5"
		value={draft.paramsText}
		oninput={(event) => controller.editDraft({ paramsText: event.currentTarget.value })}
		onkeydown={onEditorKeydown}
	></textarea>

	<fieldset class="chunks">
		<legend>Chunks</legend>
		{#each CHUNK_IDS as chunk (chunk)}
			<label class="check">
				<input
					type="checkbox"
					checked={draft.chunks.includes(chunk)}
					onchange={(event) => toggleChunk(chunk, event.currentTarget.checked)}
				/>
				{chunk}
			</label>
		{/each}
	</fieldset>

	<div class="actions">
		<button type="button" class="primary" onclick={() => controller.applyDraft()}>Apply</button>
		<button type="button" disabled={!draft.dirty} onclick={() => controller.revertDraft()}
			>Revert</button
		>
		<button type="button" onclick={() => controller.deleteCustom()}>Delete</button>
		<button type="button" onclick={() => controller.closeEditor()}>Close</button>
	</div>
	<p class="hint">{isMac ? '⌘' : 'Ctrl'}+Enter applies.</p>
</div>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
	}

	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.id {
		padding: 0 4px;
		border: 1px solid #444;
		border-radius: 3px;
		color: #999;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 10px;
	}

	.dirty {
		margin-left: auto;
		color: #e0a060;
		font-size: 11px;
	}

	.field {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
	}

	.field input {
		flex: 1;
		min-width: 0;
		padding: 3px 5px;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
	}

	.field-label {
		display: block;
		margin: 6px 0 2px;
	}

	.code {
		display: flex;
		max-height: 320px;
		overflow: hidden;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
	}

	.gutter {
		flex: none;
		min-width: 28px;
		padding: 4px 0;
		overflow: hidden;
		border-right: 1px solid #333;
		color: #777;
		text-align: right;
	}

	.line-number,
	.source {
		font:
			12px/18px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}

	.line-number {
		padding: 0 6px;
	}

	.line-number.has-error {
		background: #4a1f24;
		color: #ff6b6b;
		font-weight: 600;
	}

	.source {
		box-sizing: border-box;
		width: 100%;
		margin: 0;
		padding: 4px 6px;
		border: 0;
		background: transparent;
		color: inherit;
		resize: vertical;
		tab-size: 2;
	}

	.code .source {
		flex: 1;
		min-width: 0;
		overflow: auto;
	}

	.params {
		border: 1px solid #444;
		border-radius: 4px;
		background: #1c1c1c;
	}

	.errors {
		margin: 4px 0 0;
		padding: 0;
		color: #ff6b6b;
		list-style: none;
	}

	.errors li {
		margin: 2px 0;
		white-space: pre-wrap;
	}

	.chunks {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin: 8px 0;
		padding: 6px 8px;
		border: 1px solid #333;
		border-radius: 4px;
	}

	.chunks legend {
		padding: 0 4px;
		color: #999;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.primary {
		border-color: #7aa2ff;
		background: #26324a;
	}

	.hint {
		margin: 6px 0 0;
		color: #999;
		font-size: 11px;
	}
</style>
