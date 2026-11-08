<script lang="ts">
	import type { Snippet } from 'svelte'

	let { name, children }: { name: string; children: Snippet } = $props()
</script>

<details open>
	<summary>{name}</summary>
	<div class="body">{@render children()}</div>
</details>

<style>
	details {
		border-top: 1px solid #333;
		padding-top: 8px;
		margin-top: 8px;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
		padding: 2px 0;
		border-radius: 4px;
	}

	summary:focus-visible {
		outline: 2px solid #7aa2ff;
		outline-offset: 2px;
	}

	.body {
		padding-top: 4px;
	}
</style>
