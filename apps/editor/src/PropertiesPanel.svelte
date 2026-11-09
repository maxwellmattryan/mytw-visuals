<script lang="ts">
	import { formatSeconds } from '@lib/loop'
	import type { Project } from '@mytw/schema'

	interface Props {
		project: Project | null
	}

	let { project }: Props = $props()
</script>

<section class="panel" aria-labelledby="properties-heading">
	<h2 id="properties-heading">Properties</h2>
	{#if project}
		<dl>
			<dt>Name</dt>
			<dd>{project.name}</dd>
			<dt>Output</dt>
			<dd>{project.output.width} × {project.output.height}</dd>
			<dt>FPS</dt>
			<dd>{project.output.fps}</dd>
			<dt>Frames</dt>
			<dd>
				{project.timeline.frames} ({formatSeconds(project.timeline.frames, project.output.fps)} s)
			</dd>
			<dt>Background</dt>
			<dd>
				<span class="swatch" style:background={project.output.background}></span>
				{project.output.background}
			</dd>
		</dl>
	{/if}
</section>

<style>
	.panel {
		height: 100%;
		overflow: auto;
	}

	h2 {
		margin: 0;
		padding: 10px 12px 6px;
		color: #999;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 12px;
		margin: 0;
		padding: 4px 12px 12px;
	}

	dt {
		color: #888;
	}

	dd {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
		font-variant-numeric: tabular-nums;
	}

	.swatch {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 1px solid #555;
		border-radius: 2px;
	}
</style>
