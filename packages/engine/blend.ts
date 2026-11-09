import type { BlendMode } from './types'

/** The WebGL blend factors the engine uses, by their constant names. */
export type BlendFactor = 'ONE' | 'ONE_MINUS_SRC_ALPHA' | 'DST_COLOR' | 'ONE_MINUS_SRC_COLOR'

export interface BlendState {
	src: BlendFactor
	dst: BlendFactor
}

/**
 * Fixed-function blends on premultiplied colour with `FUNC_ADD`. The backdrop is
 * always opaque, so these are exact:
 *
 * - normal: `s + d(1 - αs)`
 * - multiply: `s·d + d(1 - αs)`
 * - screen: `s + d - s·d`
 * - add: `s + d`
 */
export const BLEND_STATES: Readonly<Record<BlendMode, BlendState>> = {
	normal: { src: 'ONE', dst: 'ONE_MINUS_SRC_ALPHA' },
	multiply: { src: 'DST_COLOR', dst: 'ONE_MINUS_SRC_ALPHA' },
	screen: { src: 'ONE', dst: 'ONE_MINUS_SRC_COLOR' },
	add: { src: 'ONE', dst: 'ONE' },
}
