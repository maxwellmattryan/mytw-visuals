<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		name: string
		/** Whether the group starts expanded. Bind it to follow the user's toggles. */
		open?: boolean
		children: Snippet
	}

	let { name, open = $bindable(true), children }: Props = $props()
</script>

<details bind:open>
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
