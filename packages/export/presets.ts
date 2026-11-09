import { checkLoopTarget } from '@lib/loop'

import type { Quality } from './types'

export interface ExportPreset {
	label: string
	width: number
	height: number
	fps: number
	quality: Quality
	/** Shortest accepted length in seconds, inclusive. */
	minSeconds: number
	/** Longest accepted length in seconds, inclusive. */
	maxSeconds: number
}

export const EXPORT_PRESETS = {
	spotifyCanvas: {
		label: 'Spotify Canvas',
		width: 1080,
		height: 1920,
		fps: 30,
		quality: 'high',
		minSeconds: 3,
		maxSeconds: 8,
	},
	instagramReel: {
		label: 'Instagram Reel',
		width: 1080,
		height: 1920,
		fps: 30,
		quality: 'high',
		minSeconds: 3,
		maxSeconds: 90,
	},
} as const satisfies Record<string, ExportPreset>

/** Warnings for an export that doesn't fit `preset`. An empty array means it fits. */
export function presetIssues(
	preset: ExportPreset,
	{ frames, fps }: { frames: number; fps: number }
): string[] {
	const issues: string[] = []
	const length = checkLoopTarget(frames / fps, {
		label: preset.label,
		minSeconds: preset.minSeconds,
		maxSeconds: preset.maxSeconds,
	})
	if (length) issues.push(length)
	if (fps !== preset.fps) issues.push(`${preset.label} expects ${preset.fps} fps, got ${fps} fps.`)
	return issues
}
