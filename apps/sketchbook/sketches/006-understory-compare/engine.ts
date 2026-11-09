import { hashBytes } from '@mytw/assets'
import { createRenderer } from '@mytw/engine'
import { parseProject } from '@mytw/schema'
import { compileScene } from '@mytw/scene'
import type { Scene } from '@mytw/scene'
import fixture from '../../../../packages/schema/fixtures/v1/understory.json'

// The engine side: the Understory project document through @mytw/scene and @mytw/engine. It
// imports nothing from 002-understory, so it can only match the sketch through generic code.

/** The sketchbook's asset source: where each content hash's bytes are served. */
const ASSET_URLS: Readonly<Record<string, string>> = {
	'sha256:740b8530c50ed203aa2ecb3ef2ecd24e100b1fef711424f2c8033bb6b724384b':
		'/images/mytw-002_base.png',
}

export interface EngineSide {
	readonly canvas: HTMLCanvasElement
	readonly scene: Scene
	/** Renders frame `frame` to `canvas` (its drawing buffer is preserved). */
	draw(frame: number): void
}

async function loadImage(hash: string): Promise<ImageBitmap> {
	const url = ASSET_URLS[hash]
	if (!url) throw new Error(`No URL for asset ${hash}`)
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`)
	const bytes = new Uint8Array(await response.arrayBuffer())
	const actual = `sha256:${await hashBytes(bytes)}`
	if (actual !== hash)
		throw new Error(`Asset hash mismatch for ${url}: expected ${hash}, got ${actual}`)
	return createImageBitmap(new Blob([bytes]))
}

export async function createEngine(): Promise<EngineSide> {
	const parsed = parseProject(fixture)
	if (!parsed.ok)
		throw new Error(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
	const scene = compileScene(parsed.project)
	const canvas = document.createElement('canvas')
	const renderer = createRenderer(canvas, {
		width: scene.width,
		height: scene.height,
		preserveDrawingBuffer: true,
	})
	const bitmaps = await Promise.all(scene.images.map(loadImage))
	scene.images.forEach((hash, i) => renderer.setImage(hash, bitmaps[i]))
	for (const effect of scene.effects) renderer.registerEffect(effect)
	return {
		canvas,
		scene,
		draw(frame) {
			renderer.render(scene.frameAt(frame))
		},
	}
}
