// Cross-reference rules for a structurally valid project. They run only after the codecs pass,
// the same way schema constraints run after the per-param checks in validate.ts.
import { childPath, indexPath, issue, recordPath } from './codec'
import type { ProjectIssue } from './codec'
import type {
	AnimatableNumber,
	EffectInstance,
	LayerMask,
	Modulator,
	Project,
	ProjectClip,
} from './project'

interface Context {
	project: Project
	issues: ProjectIssue[]
	/** Each id seen so far, with the path of its `id` field. */
	ids: Map<string, string>
}

function checkId(ctx: Context, id: string, path: string): void {
	const at = childPath(path, 'id')
	const earlier = ctx.ids.get(id)
	if (earlier === undefined) ctx.ids.set(id, at)
	else
		ctx.issues.push(
			issue(at, 'duplicate', `id ${JSON.stringify(id)} is already used at ${earlier}`)
		)
}

function checkBindings(ctx: Context, value: AnimatableNumber, path: string): void {
	if (typeof value === 'number') return
	value.mod.forEach((binding, index) => {
		if (!Object.hasOwn(ctx.project.modulators, binding.modulator))
			ctx.issues.push(
				issue(
					childPath(indexPath(childPath(path, 'mod'), index), 'modulator'),
					'reference',
					`no modulator ${JSON.stringify(binding.modulator)}`
				)
			)
	})
}

function checkEffects(ctx: Context, effects: EffectInstance[], path: string): void {
	effects.forEach((effect, index) => {
		const at = indexPath(path, index)
		checkId(ctx, effect.id, at)
		const params = childPath(at, 'params')
		for (const [key, value] of Object.entries(effect.params)) {
			if (typeof value === 'number' || (typeof value === 'object' && !Array.isArray(value)))
				checkBindings(ctx, value, recordPath(params, key))
		}
	})
}

function checkModulator(ctx: Context, modulator: Modulator, path: string): void {
	if (modulator.shape !== 'keyframes') return
	const keys = childPath(path, 'keys')
	for (let i = 1; i < modulator.keys.length; i++) {
		const previous = modulator.keys[i - 1].at
		const { at } = modulator.keys[i]
		if (at <= previous)
			ctx.issues.push(
				issue(
					childPath(indexPath(keys, i), 'at'),
					'order',
					`${at} is not after the previous key at ${previous}`
				)
			)
	}
	const first = modulator.keys[0].value
	const lastIndex = modulator.keys.length - 1
	const last = modulator.keys[lastIndex].value
	if (ctx.project.timeline.mode === 'loop' && first !== last)
		ctx.issues.push(
			issue(
				childPath(indexPath(keys, lastIndex), 'value'),
				'seam',
				`the loop ends at ${last} but starts at ${first}, so it jumps at the seam`
			)
		)
}

function checkMask(ctx: Context, mask: LayerMask, path: string): void {
	const [fromX, fromY] = mask.from
	const [toX, toY] = mask.to
	if (fromX === toX && fromY === toY)
		ctx.issues.push(
			issue(
				childPath(path, 'to'),
				'range',
				`[${toX}, ${toY}] equals from, so the gradient has no direction`
			)
		)
}

function checkClip(ctx: Context, clip: ProjectClip, path: string): void {
	checkId(ctx, clip.id, path)
	const timelineFrames = ctx.project.timeline.frames
	const end = clip.start + clip.frames
	if (end > timelineFrames)
		ctx.issues.push(
			issue(
				childPath(path, 'frames'),
				'timeline',
				`clip ends at frame ${end}, after the timeline's ${timelineFrames} frames`
			)
		)
	if (clip.fadeIn + clip.fadeOut > clip.frames)
		ctx.issues.push(
			issue(
				childPath(path, 'fadeOut'),
				'timeline',
				`fadeIn + fadeOut is ${clip.fadeIn + clip.fadeOut}, more than the clip's ${clip.frames} frames`
			)
		)
	clip.layers.forEach((layer, index) => {
		const at = indexPath(childPath(path, 'layers'), index)
		checkId(ctx, layer.id, at)
		if (layer.kind === 'image' && !Object.hasOwn(ctx.project.assets, layer.asset))
			ctx.issues.push(
				issue(childPath(at, 'asset'), 'reference', `no asset ${JSON.stringify(layer.asset)}`)
			)
		checkBindings(ctx, layer.opacity, childPath(at, 'opacity'))
		const transform = childPath(at, 'transform')
		const { centerX, centerY, zoom, rotation } = layer.transform
		checkBindings(ctx, centerX, childPath(transform, 'centerX'))
		checkBindings(ctx, centerY, childPath(transform, 'centerY'))
		checkBindings(ctx, zoom, childPath(transform, 'zoom'))
		checkBindings(ctx, rotation, childPath(transform, 'rotation'))
		if (layer.mask) checkMask(ctx, layer.mask, childPath(at, 'mask'))
		checkEffects(ctx, layer.effects, childPath(at, 'effects'))
	})
}

/** Reports clips that start before an earlier-starting clip in the same track has ended. */
function overlapIssues(clips: ProjectClip[], path: string): ProjectIssue[] {
	const order = clips
		.map((_, index) => index)
		.sort((a, b) => clips[a].start - clips[b].start || a - b)
	const found: { index: number; issue: ProjectIssue }[] = []
	let reach = -1
	for (const index of order) {
		const clip = clips[index]
		if (reach >= 0 && clip.start < clips[reach].start + clips[reach].frames) {
			const at = childPath(indexPath(path, index), 'start')
			const detail = `overlaps clip ${JSON.stringify(clips[reach].id)}`
			found.push({ index, issue: issue(at, 'timeline', detail) })
		}
		if (reach < 0 || clip.start + clip.frames > clips[reach].start + clips[reach].frames)
			reach = index
	}
	return found.sort((a, b) => a.index - b.index).map((entry) => entry.issue)
}

/** Runs the cross-reference rules, in document order, on a structurally valid project. */
export function checkProject(project: Project): ProjectIssue[] {
	const ctx: Context = { project, issues: [], ids: new Map() }
	for (const [key, modulator] of Object.entries(project.modulators))
		checkModulator(ctx, modulator, recordPath('modulators', key))
	project.tracks.forEach((track, trackIndex) => {
		const at = indexPath('tracks', trackIndex)
		checkId(ctx, track.id, at)
		const clips = childPath(at, 'clips')
		track.clips.forEach((clip, index) => checkClip(ctx, clip, indexPath(clips, index)))
		for (const found of overlapIssues(track.clips, clips)) ctx.issues.push(found)
	})
	checkEffects(ctx, project.effects, 'effects')
	return ctx.issues
}
