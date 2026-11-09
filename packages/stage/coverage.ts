// The edge warning: which image layers in a clip cover the canvas at some frames and not at
// others, meaning their motion reveals an edge. Uses the engine's own matrix on scene frames, so it
// shares the renderer's math. Feather and masks are ignored. No DOM, no Svelte.
import { layerToSourceMatrix } from '@mytw/engine'
import type { Project } from '@mytw/schema'
import type { Scene } from '@mytw/scene'
import { displayName } from '../layers/commands'
import { clipAt } from '../layers/target'
import type { ClipRef } from '../layers/target'

export interface EdgeReveal {
	readonly layerId: string
	/** The layer's display name. */
	readonly name: string
	/** Frames where the layer doesn't cover the canvas. */
	readonly count: number
	/** Frames checked: those where the clip is active. */
	readonly total: number
	/** The first frame where it doesn't cover. */
	readonly first: number
}

const TOLERANCE = 1e-9
/** The canvas corners in output UV. */
const CORNERS = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1],
] as const

function inUnit(v: number): boolean {
	return v >= -TOLERANCE && v <= 1 + TOLERANCE
}

/**
 * Image layers of the clip at `ref` that cover the canvas at some active frames and not at others,
 * top of the stack first. A layer that never covers is framed small on purpose and isn't reported.
 * Returns nothing for a missing clip or scene.
 */
export function findEdgeReveals(project: Project, scene: Scene | null, ref: ClipRef): EdgeReveal[] {
	const clip = clipAt(project, ref)
	if (!clip || !scene) return []
	const images = clip.layers.filter((layer) => layer.kind === 'image')
	if (images.length === 0) return []

	const output = { width: project.output.width, height: project.output.height }
	const end = Math.min(clip.start + clip.frames, project.timeline.frames, scene.frames)
	const stats = new Map(images.map((layer) => [layer.id, { total: 0, count: 0, first: -1 }]))
	const matrix = new Float64Array(9)

	for (let f = Math.max(0, clip.start); f < end; f++) {
		const frame = scene.frameAt(f)
		for (const layer of frame.layers) {
			const stat = stats.get(layer.id)
			if (!stat) continue
			const asset = Object.hasOwn(project.assets, layer.image) ? project.assets[layer.image] : null
			if (!asset) continue
			layerToSourceMatrix(layer.transform, output, asset, matrix)
			const covers = CORNERS.every(
				([u, v]) =>
					inUnit(matrix[0] * u + matrix[3] * v + matrix[6]) &&
					inUnit(matrix[1] * u + matrix[4] * v + matrix[7])
			)
			stat.total += 1
			if (!covers) {
				if (stat.count === 0) stat.first = f
				stat.count += 1
			}
		}
	}

	const reveals: EdgeReveal[] = []
	for (const layer of [...images].reverse()) {
		const stat = stats.get(layer.id)
		if (!stat || stat.count === 0 || stat.count === stat.total) continue
		reveals.push({ layerId: layer.id, name: displayName(layer), ...stat })
	}
	return reveals
}

/** The warning line for one reveal. */
export function describeReveal(reveal: EdgeReveal): string {
	return `Motion reveals the edge of ${reveal.name} on ${reveal.count} of ${reveal.total} frames, first at frame ${reveal.first}`
}
