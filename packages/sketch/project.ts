import type { Project } from '@mytw/schema'

/** True if and only if any clip in any track has a layer of kind `sketch`. */
export function projectUsesSketches(project: Project): boolean {
	return project.tracks.some((track) =>
		track.clips.some((clip) => clip.layers.some((layer) => layer.kind === 'sketch'))
	)
}
