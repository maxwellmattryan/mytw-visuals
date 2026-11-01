/**
 * Canvas sizing presets.
 */

export interface CanvasSize {
	width: number
	height: number
}

export type SizeName = 'SQUARE' | 'STORY' | 'LANDSCAPE' | 'TWITTER'

export const SIZES: Record<SizeName, CanvasSize> = {
	SQUARE: { width: 1080, height: 1080 },
	STORY: { width: 1080, height: 1920 },
	LANDSCAPE: { width: 1920, height: 1080 },
	TWITTER: { width: 1200, height: 675 },
}
