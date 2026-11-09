import type { EffectInstance as RenderEffect, RenderFrame } from '@mytw/engine'
import { uniformValues } from '@mytw/fx'
import type { EffectPreview } from './controller'

/**
 * Applies the browser's hover preview to a frame: the previewed effect, at its defaults, appended
 * to the target layer's chain or to the global chain. A null preview, or a layer target that isn't
 * in the frame, returns the frame itself. It never mutates the frame, and never touches the
 * document, so export ignores it.
 */
export function applyEffectPreview(
	frame: RenderFrame,
	preview: EffectPreview | null,
	phase: number
): RenderFrame {
	if (preview === null) return frame
	const { definition, target } = preview
	const effect: RenderEffect = {
		effect: definition.id,
		enabled: true,
		uniforms: { ...uniformValues(definition, {}), uPhase: phase },
	}
	if (target.kind === 'global') return { ...frame, effects: [...(frame.effects ?? []), effect] }
	const index = frame.layers.findIndex((layer) => layer.id === target.layerId)
	if (index === -1) return frame
	const layers = frame.layers.map((layer, i) =>
		i === index ? { ...layer, effects: [...(layer.effects ?? []), effect] } : layer
	)
	return { ...frame, layers }
}
