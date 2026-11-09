import p5 from 'p5'
import { createWebGLCanvas, SIZES } from '@lib/layout'
import { defaults } from '@mytw/schema'
import { understorySchema } from '../002-understory/params'
import { createUnderstoryRenderer } from '../002-understory/render'

// The reference side: the unchanged p5 sketch code from 002-understory at its schema defaults.

export interface OriginalSide {
	readonly canvas: HTMLCanvasElement
	readonly loopFrames: number
	/** Draws frame `frame` of the loop to `canvas`. Read the pixels in the same task. */
	draw(frame: number): void
}

export function createOriginal(imageUrl: string): Promise<OriginalSide> {
	const values = defaults(understorySchema)
	return new Promise((resolve, reject) => {
		new p5((p: p5) => {
			let img: p5.Image
			let phase: number | null = null
			let draw: ((phase: number) => void) | null = null

			p.preload = () => {
				img = p.loadImage(imageUrl, undefined, () =>
					reject(new Error(`Could not load ${imageUrl}`))
				)
			}

			p.setup = () => {
				const cnv = createWebGLCanvas(p, SIZES.STORY)
				cnv.elt.style.display = 'none'
				p.noLoop()
				const renderer = createUnderstoryRenderer(p, img)
				draw = (at) => renderer.draw(values, at)
				const canvas: HTMLCanvasElement = cnv.elt
				resolve({
					canvas,
					loopFrames: values.loopFrames,
					draw(frame) {
						// redraw() runs p.draw synchronously, the way the sketch draws a frame.
						phase = frame / values.loopFrames
						p.redraw()
						phase = null
					},
				})
			}

			p.draw = () => {
				if (draw && phase !== null) draw(phase)
			}
		})
	})
}
