import { timelineFor } from './evaluate'
import { EASES, sampleTrack } from './keyframes'
import type { Keyframe, LoopIssue, TimelineDocument } from './types'

/** Track ends closer than this count as equal, matching the loop tests' tolerance. */
const EPSILON = 1e-9

function trackValue(keys: readonly Keyframe<number>[], t: number): number {
	return sampleTrack(
		{
			times: Float64Array.from(keys, (k) => k.t),
			values: Float64Array.from(keys, (k) => k.value),
			eases: keys.map((k) => EASES[k.ease ?? 'linear']),
		},
		t
	)
}

function component(keys: readonly Keyframe<readonly [number, number]>[], c: 0 | 1) {
	return keys.map((k) => ({ t: k.t, value: k.value[c], ease: k.ease }))
}

/**
 * Every keyframe track whose value at phase 0 differs from its value at phase 1 (any
 * component for vec2). Modulators need no check: whole cycles per loop make them seamless
 * by construction. A document with no issues is loop-safe. Throws `TimelineError` for an
 * invalid document.
 */
export function loopIssues(doc: TimelineDocument): LoopIssue[] {
	timelineFor(doc)
	const issues: LoopIssue[] = []
	for (const [param, p] of Object.entries(doc.params)) {
		if (p.kind !== 'number' && p.kind !== 'vec2') continue
		if (p.keys === undefined || p.keys.length === 0) continue
		const tracks = p.kind === 'number' ? [p.keys] : [component(p.keys, 0), component(p.keys, 1)]
		const differs = tracks.some(
			(keys) => Math.abs(trackValue(keys, 0) - trackValue(keys, 1)) > EPSILON
		)
		if (differs) {
			issues.push({
				param,
				message: `the keyframe track's value at phase 1 differs from phase 0, so the loop jumps`,
			})
		}
	}
	return issues
}
