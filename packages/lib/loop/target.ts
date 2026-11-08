/** A loop length range that a destination accepts, in seconds. Both bounds are inclusive. */
export interface LoopTarget {
	label: string
	minSeconds?: number
	maxSeconds: number
}

/** The label of a target built by `customTarget`. */
export const CUSTOM_TARGET_LABEL = 'target'

export const LOOP_TARGETS = {
	spotifyCanvas: { label: 'Spotify Canvas', minSeconds: 3, maxSeconds: 8 },
} as const satisfies Record<string, LoopTarget>

/** A target with only a maximum length, chosen by the user. */
export function customTarget(maxSeconds: number): LoopTarget {
	return { label: CUSTOM_TARGET_LABEL, maxSeconds }
}

/** The loop length in seconds, with 2 decimals: `formatSeconds(225, 30)` is `'7.50'`. */
export function formatSeconds(frames: number, fps: number): string {
	return (frames / fps).toFixed(2)
}

/** Allows for float error, so 240 frames at 30 fps is exactly 8 s. */
const EPSILON = 1e-9

/** Returns `null` when the loop fits the target, otherwise a warning to show. */
export function checkLoopTarget(seconds: number, target: LoopTarget | null): string | null {
	if (target === null) return null
	const loop = `Loop is ${seconds.toFixed(2)} s`
	if (seconds > target.maxSeconds + EPSILON) {
		const name =
			target.label === CUSTOM_TARGET_LABEL ? CUSTOM_TARGET_LABEL : `${target.label} limit`
		return `${loop}, over the ${bound(target.maxSeconds)} s ${name}.`
	}
	if (target.minSeconds !== undefined && seconds < target.minSeconds - EPSILON) {
		return `${loop}, under the ${bound(target.minSeconds)} s ${target.label} minimum.`
	}
	return null
}

/** A bound with no trailing zeros: `8`, `7.5`. */
function bound(seconds: number): string {
	return String(Number(seconds.toFixed(2)))
}
