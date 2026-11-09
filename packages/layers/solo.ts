import type { RenderFrame } from '@mytw/engine'

/**
 * Applies solo to a frame for the preview. An empty set returns the frame as is. Otherwise every
 * layer outside the set is hidden. It never shows a hidden layer, and never mutates the frame.
 */
export function applySolo(frame: RenderFrame, solo: ReadonlySet<string>): RenderFrame {
	if (solo.size === 0) return frame
	return {
		...frame,
		layers: frame.layers.map((layer) =>
			solo.has(layer.id) || layer.visible === false ? layer : { ...layer, visible: false }
		),
	}
}
