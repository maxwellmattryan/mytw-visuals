import type { Path } from '@mytw/document'
import type { Project, ProjectClip } from '@mytw/schema'

/** The clip whose layers the panels edit, as array indexes into `tracks` and its `clips`. */
export interface ClipRef {
	readonly track: number
	readonly clip: number
}

export const DEFAULT_CLIP: ClipRef = { track: 0, clip: 0 }

/** The clip `ref` points at, or `null` when the track or the clip doesn't exist. */
export function clipAt(project: Project, ref: ClipRef): ProjectClip | null {
	return project.tracks[ref.track]?.clips[ref.clip] ?? null
}

/** The document path of the clip's `layers` array. */
export function layersPath(ref: ClipRef): Path {
	return ['tracks', ref.track, 'clips', ref.clip, 'layers']
}
