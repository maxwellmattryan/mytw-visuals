import type { RenderFrame, Renderer } from '@mytw/engine'

import { ExportError } from './errors'
import type { ExportSize, FrameSource, SourceCanvas } from './types'

/**
 * Adapts an engine renderer. `begin` sets the export size, `draw` renders
 * `frameAt(phase, index)`, `end` restores the previous size. `canvas` is the
 * renderer's canvas, which `Renderer` doesn't expose. A lost context fails the
 * export with `ExportError('context-lost')`; the frame is not retried.
 */
export function engineSource<C extends SourceCanvas>(
	renderer: Renderer,
	frameAt: (phase: number, index: number) => RenderFrame,
	canvas: C
): FrameSource<C> {
	let previous: ExportSize | null = null
	return {
		canvas,
		begin({ width, height }) {
			previous = { width: renderer.width, height: renderer.height }
			renderer.setSize(width, height)
		},
		draw(phase, index) {
			if (!renderer.render(frameAt(phase, index))) {
				throw new ExportError('context-lost', `The WebGL context was lost at frame ${index}`)
			}
		},
		end() {
			if (previous) renderer.setSize(previous.width, previous.height)
			previous = null
		},
	}
}
