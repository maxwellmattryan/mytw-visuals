import { compileTimeline } from './compile'
import type { Timeline } from './compile'
import type { FrameState, TimelineDocument } from './types'

/** Compiled plans keyed by document object. Invisible to callers: it only saves work. */
const plans = new WeakMap<TimelineDocument, Timeline>()

/**
 * The compiled timeline for `doc`, compiled on first use and cached by object identity.
 * Documents must not be mutated in place: replace them instead.
 */
export function timelineFor(doc: TimelineDocument): Timeline {
	let timeline = plans.get(doc)
	if (timeline === undefined) {
		timeline = compileTimeline(doc)
		plans.set(doc, timeline)
	}
	return timeline
}

/**
 * Resolve every param of `doc` at loop `phase`. Pure: the result depends only on the
 * arguments. Writes into `out` when given and returns it.
 */
export function evaluate(doc: TimelineDocument, phase: number, out?: FrameState): FrameState {
	return timelineFor(doc).evaluate(phase, out)
}
