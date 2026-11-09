import { ID_PATTERN } from '@mytw/schema'
import type { EffectInstance, Project } from '@mytw/schema'

const MAX_ID_LENGTH = 64
const FALLBACK_BASE = 'layer'

function addEffects(ids: Set<string>, effects: readonly EffectInstance[]): void {
	for (const effect of effects) ids.add(effect.id)
}

/** Every track, clip, layer and effect id in the project. */
function usedIds(project: Project): Set<string> {
	const ids = new Set<string>()
	addEffects(ids, project.effects)
	for (const track of project.tracks) {
		ids.add(track.id)
		for (const clip of track.clips) {
			ids.add(clip.id)
			for (const layer of clip.layers) {
				ids.add(layer.id)
				addEffects(ids, layer.effects)
			}
		}
	}
	return ids
}

/**
 * An id no track, clip, layer or effect uses: `base`, else the first free `base-2`, `base-3`, …
 * The base is cut so the result stays within 64 characters, and an invalid base becomes `layer`.
 */
export function nextId(
	project: Project,
	base: string,
	reserved: ReadonlySet<string> = new Set()
): string {
	const root = ID_PATTERN.test(base) ? base : FALLBACK_BASE
	const used = usedIds(project)
	const taken = (id: string) => used.has(id) || reserved.has(id)
	if (!taken(root)) return root
	for (let n = 2; ; n++) {
		const suffix = `-${n}`
		const id = root.slice(0, MAX_ID_LENGTH - suffix.length) + suffix
		if (!taken(id)) return id
	}
}
