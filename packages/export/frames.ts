import { ExportError } from './errors'
import type { ExportSize, StillOptions, VideoOptions } from './types'

const QUALITIES: readonly string[] = ['low', 'medium', 'high', 'very-high']

export const MAX_FPS = 240

export interface FrameEntry {
	/** Output frame index, 0 to `frames - 1`. */
	index: number
	/** Loop phase, `(index % loopFrames) / loopFrames`: never 1. */
	phase: number
	/** Microseconds, `round(index * 1e6 / fps)`. */
	timestamp: number
	/** Microseconds, up to the next frame's timestamp. */
	duration: number
}

/** The timestamp of frame `index` in microseconds. */
export function frameTimestamp(index: number, fps: number): number {
	return Math.round((index * 1e6) / fps)
}

/**
 * Every frame of an export, in order. Phases come from the frame index alone,
 * so the last frame of a loop sits one step before phase 1 and the loop is
 * seamless; timestamps tile with no gaps.
 */
export function framePlan(frames: number, loopFrames: number, fps: number): FrameEntry[] {
	const plan: FrameEntry[] = []
	for (let index = 0; index < frames; index++) {
		const timestamp = frameTimestamp(index, fps)
		plan.push({
			index,
			phase: (index % loopFrames) / loopFrames,
			timestamp,
			duration: frameTimestamp(index + 1, fps) - timestamp,
		})
	}
	return plan
}

export interface ValidOptions {
	width: number
	height: number
	fps: number
	frames: number
	loopFrames: number
}

function invalid(message: string): ExportError {
	return new ExportError('invalid-options', message)
}

function positiveInteger(name: string, value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw invalid(`${name} must be a positive integer, got ${String(value)}`)
	}
	return value
}

function size(options: { width: unknown; height: unknown }, even: boolean): ExportSize {
	const width = positiveInteger('width', options.width)
	const height = positiveInteger('height', options.height)
	if (even && width % 2 !== 0) throw invalid(`width must be even for video, got ${width}`)
	if (even && height % 2 !== 0) throw invalid(`height must be even for video, got ${height}`)
	return { width, height }
}

/**
 * Checks export options and fills in defaults. Throws `ExportError('invalid-options')`
 * naming the first bad field.
 */
export function validateOptions(options: VideoOptions, kind: 'video' | 'png'): ValidOptions {
	const { width, height } = size(options, kind === 'video')
	const { fps } = options
	if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > MAX_FPS) {
		throw invalid(`fps must be a finite number in (0, ${MAX_FPS}], got ${String(fps)}`)
	}
	const frames = positiveInteger('frames', options.frames)
	const loopFrames =
		options.loopFrames === undefined ? frames : positiveInteger('loopFrames', options.loopFrames)
	if (kind === 'video') {
		const { bitrate, quality } = options
		if (bitrate !== undefined && quality !== undefined) {
			throw invalid('bitrate and quality: pass at most one')
		}
		if (bitrate !== undefined) positiveInteger('bitrate', bitrate)
		if (quality !== undefined && !QUALITIES.includes(quality)) {
			throw invalid(`quality must be low, medium, high or very-high, got ${String(quality)}`)
		}
	}
	return { width, height, fps, frames, loopFrames }
}

/** Checks still options. Throws `ExportError('invalid-options')` naming the bad field. */
export function validateStill(options: StillOptions): ExportSize & { phase: number } {
	const { width, height } = size(options, false)
	const { phase } = options
	if (typeof phase !== 'number' || !Number.isFinite(phase) || phase < 0 || phase >= 1) {
		throw invalid(`phase must be a number in [0, 1), got ${String(phase)}`)
	}
	return { width, height, phase }
}
