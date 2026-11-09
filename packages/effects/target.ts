// Which effect chain the panels edit: a layer's own chain or the document's global chain.
import type { Path } from '@mytw/document'
import type { EffectInstance, Project, ProjectLayer } from '@mytw/schema'

export type EffectTarget =
	| { readonly kind: 'layer'; readonly layerId: string }
	| { readonly kind: 'global' }

/**
 * The layer with this id anywhere in the project, with its document path. Ids are unique across
 * the document, so the first match is the only one.
 */
export function findLayer(
	project: Project,
	layerId: string
): { layer: ProjectLayer; path: Path } | null {
	for (const [t, track] of project.tracks.entries())
		for (const [c, clip] of track.clips.entries())
			for (const [l, layer] of clip.layers.entries())
				if (layer.id === layerId) return { layer, path: ['tracks', t, 'clips', c, 'layers', l] }
	return null
}

/** The document path of the target's `effects` array, or `null` when its layer doesn't exist. */
export function chainPath(project: Project, target: EffectTarget): Path | null {
	if (target.kind === 'global') return ['effects']
	const found = findLayer(project, target.layerId)
	return found ? [...found.path, 'effects'] : null
}

/** The target's effect chain in apply order, or `null` when its layer doesn't exist. */
export function chainAt(project: Project, target: EffectTarget): readonly EffectInstance[] | null {
	if (target.kind === 'global') return project.effects
	return findLayer(project, target.layerId)?.layer.effects ?? null
}

/** Whether two targets name the same chain. */
export function sameTarget(a: EffectTarget | null, b: EffectTarget | null): boolean {
	if (a === null || b === null) return a === b
	if (a.kind === 'global' || b.kind === 'global') return a.kind === b.kind
	return a.layerId === b.layerId
}
