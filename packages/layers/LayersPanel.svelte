<script lang="ts" module>
	let mounted = 0
</script>

<script lang="ts">
	import { tick } from 'svelte'
	import type { ProjectLayer } from '@mytw/schema'
	import { displayName, MAX_NAME_LENGTH } from './commands'
	import type { LayersController } from './controller'
	import { IMAGE_ACCEPT } from './import'

	interface Props {
		controller: LayersController
	}

	let { controller }: Props = $props()

	const titleId = `mytw-layers-${++mounted}`

	// The controller holds plain state. This counter tells the template to read it again.
	let version = $state(0)
	$effect(() =>
		controller.subscribe(() => {
			version += 1
		})
	)

	const read = <T,>(fn: () => T): T => {
		void version
		return fn()
	}

	/** Rows run top of the stack first, the reverse of the format's `layers`. */
	const rows: readonly ProjectLayer[] = $derived(read(() => [...controller.layers].reverse()))
	const selectedId = $derived(read(() => controller.selectedId))
	const solo = $derived(read(() => controller.solo))
	const error = $derived(read(() => controller.error))
	const busy = $derived(read(() => controller.busy))
	/** The row that takes Tab focus: the selected one, else the top one. */
	const focusId = $derived(selectedId ?? rows[0]?.id ?? null)

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

	let list = $state<HTMLElement | null>(null)
	let fileInput = $state<HTMLInputElement | null>(null)

	// Rename state: the id being renamed and its draft text.
	let renaming = $state<string | null>(null)
	let draft = $state('')

	// Row drag state: the dragged row and where it would land.
	let dragId = $state<string | null>(null)
	let dropAt = $state<{ id: string; edge: 'above' | 'below' } | null>(null)

	// File drag state. Enter and leave fire for every child, so count them.
	let fileDepth = $state(0)
	const fileHover = $derived(fileDepth > 0)

	async function focusRow(id: string | null) {
		await tick()
		if (id === null || list === null) return
		const row = list.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)
		row?.focus()
	}

	function selectAndFocus(id: string) {
		controller.select(id)
		void focusRow(id)
	}

	function startRename(layer: ProjectLayer) {
		controller.select(layer.id)
		renaming = layer.id
		draft = displayName(layer)
	}

	function commitRename(id: string) {
		if (renaming !== id) return
		renaming = null
		controller.rename(id, draft)
	}

	function cancelRename(id: string) {
		if (renaming !== id) return
		renaming = null
		void focusRow(id)
	}

	function focusInput(node: HTMLInputElement) {
		node.focus()
		node.select()
	}

	function onRenameKeydown(event: KeyboardEvent, id: string) {
		if (event.key === 'Enter') {
			event.preventDefault()
			commitRename(id)
			void focusRow(id)
		} else if (event.key === 'Escape') {
			event.preventDefault()
			cancelRename(id)
		}
	}

	function onRowKeydown(event: KeyboardEvent, layer: ProjectLayer, displayIndex: number) {
		// Only when the row itself has focus, not a toggle or the rename input inside it.
		if (event.target !== event.currentTarget) return
		const mod = isMac ? event.metaKey : event.ctrlKey
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault()
			const up = event.key === 'ArrowUp'
			if (event.altKey) {
				controller.move(layer.id, up ? 1 : -1)
				void focusRow(layer.id)
				return
			}
			const next = rows[displayIndex + (up ? -1 : 1)]
			if (next) selectAndFocus(next.id)
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault()
			controller.select(layer.id)
			controller.remove(layer.id)
			void focusRow(controller.selectedId)
		} else if (mod && (event.key === 'd' || event.key === 'D')) {
			event.preventDefault()
			controller.duplicate(layer.id)
			void focusRow(controller.selectedId)
		} else if (event.key === 'F2' || event.key === 'Enter') {
			event.preventDefault()
			startRename(layer)
		}
	}

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') ?? false
	}

	function onRowDragStart(event: DragEvent, id: string) {
		dragId = id
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move'
			event.dataTransfer.setData('text/plain', id)
		}
	}

	function onRowDragOver(event: DragEvent, id: string) {
		if (dragId === null) return
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
		dropAt = { id, edge: event.clientY < box.top + box.height / 2 ? 'above' : 'below' }
	}

	function onRowDrop(event: DragEvent) {
		if (dragId === null) return
		event.preventDefault()
		event.stopPropagation()
		const target = dropAt
		const moving = dragId
		endRowDrag()
		if (target === null) return
		const count = rows.length
		const fromDisplay = rows.findIndex((layer) => layer.id === moving)
		const overDisplay = rows.findIndex((layer) => layer.id === target.id)
		if (fromDisplay === -1 || overDisplay === -1) return
		// The gap between display rows the drop lands in, then the row's index once it is removed.
		const slot = target.edge === 'above' ? overDisplay : overDisplay + 1
		const toDisplay = slot > fromDisplay ? slot - 1 : slot
		controller.moveTo(count - 1 - fromDisplay, count - 1 - toDisplay)
	}

	function endRowDrag() {
		dragId = null
		dropAt = null
	}

	function onPanelDragEnter(event: DragEvent) {
		if (!hasFiles(event)) return
		event.preventDefault()
		fileDepth += 1
	}

	function onPanelDragOver(event: DragEvent) {
		if (!hasFiles(event)) return
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
	}

	function onPanelDragLeave(event: DragEvent) {
		if (!hasFiles(event)) return
		fileDepth = Math.max(0, fileDepth - 1)
	}

	function onPanelDrop(event: DragEvent) {
		if (!hasFiles(event)) return
		event.preventDefault()
		fileDepth = 0
		const files = [...(event.dataTransfer?.files ?? [])]
		void controller.importFiles(files)
	}

	function onFilesPicked(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget
		const files = [...(input.files ?? [])]
		input.value = ''
		void controller.importFiles(files)
	}
</script>

<section
	class="layers"
	class:file-hover={fileHover}
	aria-labelledby={titleId}
	ondragenter={onPanelDragEnter}
	ondragover={onPanelDragOver}
	ondragleave={onPanelDragLeave}
	ondrop={onPanelDrop}
>
	<header>
		<h2 id={titleId}>Layers</h2>
	</header>

	<div class="toolbar">
		<button type="button" disabled={busy} onclick={() => fileInput?.click()}>
			{busy ? 'Adding…' : 'Add image'}
		</button>
		<button
			type="button"
			disabled={selectedId === null}
			onclick={() => {
				if (selectedId !== null) {
					controller.duplicate(selectedId)
					void focusRow(controller.selectedId)
				}
			}}>Duplicate</button
		>
		<button
			type="button"
			disabled={selectedId === null}
			onclick={() => {
				if (selectedId !== null) controller.remove(selectedId)
			}}>Delete</button
		>
		<input
			bind:this={fileInput}
			class="file"
			type="file"
			accept={IMAGE_ACCEPT}
			multiple
			tabindex="-1"
			aria-hidden="true"
			onchange={onFilesPicked}
		/>
	</div>

	{#if rows.length === 0}
		<p class="empty">No layers yet. Add an image or drop one here.</p>
	{:else}
		<ul bind:this={list} class="list" role="listbox" aria-label="Layers, top of the stack first">
			{#each rows as layer, displayIndex (layer.id)}
				{@const name = displayName(layer)}
				<li
					class="row"
					class:selected={layer.id === selectedId}
					class:hidden-layer={!layer.visible}
					class:dragging={layer.id === dragId}
					class:drop-above={dropAt?.id === layer.id && dropAt.edge === 'above'}
					class:drop-below={dropAt?.id === layer.id && dropAt.edge === 'below'}
					role="option"
					aria-selected={layer.id === selectedId}
					tabindex={layer.id === focusId ? 0 : -1}
					data-layer-id={layer.id}
					draggable={renaming !== layer.id}
					onclick={() => controller.select(layer.id)}
					ondblclick={(event) => {
						// Double-clicking the name renames. The toggles and the input keep their own clicks.
						if (event.target instanceof Element && event.target.closest('.name')) startRename(layer)
					}}
					onkeydown={(event) => onRowKeydown(event, layer, displayIndex)}
					ondragstart={(event) => onRowDragStart(event, layer.id)}
					ondragover={(event) => onRowDragOver(event, layer.id)}
					ondrop={onRowDrop}
					ondragend={endRowDrag}
				>
					{#if renaming === layer.id}
						<input
							class="rename"
							type="text"
							maxlength={MAX_NAME_LENGTH}
							aria-label="Rename {name}"
							bind:value={draft}
							use:focusInput
							onkeydown={(event) => onRenameKeydown(event, layer.id)}
							onblur={() => commitRename(layer.id)}
						/>
					{:else}
						<span class="name" title={name}>{name}</span>
					{/if}
					{#if layer.kind === 'sketch'}<span class="tag">sketch</span>{/if}
					<button
						type="button"
						class="toggle"
						aria-pressed={!layer.visible}
						aria-label="{layer.visible ? 'Hide' : 'Show'} {name}"
						title="{layer.visible ? 'Hide' : 'Show'} {name}"
						onclick={(event) => {
							event.stopPropagation()
							controller.toggleVisible(layer.id)
						}}>{layer.visible ? '●' : '○'}</button
					>
					<button
						type="button"
						class="toggle solo"
						aria-pressed={solo.has(layer.id)}
						aria-label="Solo {name}"
						title="Solo {name}"
						onclick={(event) => {
							event.stopPropagation()
							controller.toggleSolo(layer.id)
						}}>S</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if fileHover}
		<div class="drop-hint" aria-hidden="true">Drop images to add layers</div>
	{/if}

	<p class="error-line" role="alert">{error ?? ''}</p>
</section>

<style>
	.layers {
		position: relative;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
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

	.layers.file-hover {
		border-color: #7aa2ff;
		background: #141a26;
	}

	header {
		margin-bottom: 8px;
	}

	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.toolbar {
		display: flex;
		gap: 6px;
		margin-bottom: 8px;
	}

	.file {
		display: none;
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

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.list {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 6px;
		border-radius: 4px;
		cursor: default;
	}

	.row:hover {
		background: #1c1c1c;
	}

	.row.selected {
		background: #26324a;
	}

	.row.dragging {
		opacity: 0.5;
	}

	.row.drop-above::before,
	.row.drop-below::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: #7aa2ff;
	}

	.row.drop-above::before {
		top: -1px;
	}

	.row.drop-below::after {
		bottom: -1px;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hidden-layer .name {
		color: #777;
	}

	.rename {
		flex: 1;
		min-width: 0;
		padding: 2px 4px;
		border: 1px solid #7aa2ff;
		border-radius: 4px;
		background: #1c1c1c;
		color: inherit;
		font: inherit;
	}

	.tag {
		padding: 0 4px;
		border: 1px solid #444;
		border-radius: 3px;
		color: #999;
		font-size: 10px;
	}

	.toggle {
		width: 22px;
		padding: 0;
		line-height: 18px;
		text-align: center;
	}

	.toggle[aria-pressed='true'] {
		border-color: #7aa2ff;
		color: #7aa2ff;
	}

	.solo[aria-pressed='true'] {
		background: #26324a;
	}

	.empty {
		flex: 1;
		margin: 0;
		padding: 16px 8px;
		color: #999;
		text-align: center;
	}

	.drop-hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed #7aa2ff;
		border-radius: 8px;
		background: rgba(20, 26, 38, 0.9);
		color: #cfdcff;
		font-size: 13px;
		pointer-events: none;
	}

	.error-line {
		min-height: 1.4em;
		margin: 8px 0 0;
		color: #ff6b6b;
	}

	.layers :focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
