<script lang="ts">
	interface Props {
		message: string
		ondismiss: () => void
	}

	let { message, ondismiss }: Props = $props()
</script>

<div class="banner" role="alert">
	<p>{message}</p>
	<button type="button" aria-label="Dismiss error" title="Dismiss" onclick={ondismiss}>×</button>
</div>

<style>
	.banner {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid #ff6b6b;
		border-radius: 6px;
		background: rgba(40, 14, 14, 0.95);
		color: #ffd6d6;
		pointer-events: auto;
	}

	p {
		flex: 1;
		margin: 0;
		overflow-wrap: anywhere;
	}

	button {
		flex: none;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 1px solid #6b3434;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
	}

	button:hover {
		background: rgba(255, 107, 107, 0.15);
	}

	button:focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 1px;
	}
</style>
