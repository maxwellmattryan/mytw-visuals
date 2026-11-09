/**
 * Draws `canvas` scaled to fit `maxSize`×`maxSize` (never enlarged) and resolves PNG bytes, for
 * autosave's `thumbnail` callback. A WebGL canvas needs `preserveDrawingBuffer: true`, or must be
 * read in the same task as its render, or the copy is blank.
 */
export async function thumbnailFromCanvas(
	canvas: HTMLCanvasElement,
	maxSize = 320
): Promise<Uint8Array> {
	const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height, 1))
	const out = document.createElement('canvas')
	out.width = Math.max(1, Math.round(canvas.width * scale))
	out.height = Math.max(1, Math.round(canvas.height * scale))
	const context = out.getContext('2d')
	if (!context) throw new Error('A 2D canvas is not available')
	context.drawImage(canvas, 0, 0, out.width, out.height)
	const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
	if (!blob) throw new Error('The thumbnail could not be encoded')
	return new Uint8Array(await blob.arrayBuffer())
}
