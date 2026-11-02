/**
 * UNWIRED: part of the worker variant, see worker-sketch-capture.ts.
 *
 * Capture encoding worker — receives ImageBitmap frames, encodes to
 * JPEG/PNG via OffscreenCanvas.convertToBlob(), and uploads to the
 * dev server. Runs entirely off the main thread.
 */

interface FrameMessage {
	type: 'frame'
	bitmap: ImageBitmap
	session: string
	frame: number
	format: string
	quality: number
}

interface StopMessage {
	type: 'stop'
}

let pending = 0

self.onmessage = async (e: MessageEvent<FrameMessage | StopMessage>) => {
	const { type } = e.data

	if (type === 'frame') {
		pending++
		const { bitmap, session, frame, format, quality } = e.data as FrameMessage
		try {
			const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height)
			const ctx = offscreen.getContext('2d') as OffscreenCanvasRenderingContext2D
			ctx.drawImage(bitmap, 0, 0)
			bitmap.close()

			const blob = await offscreen.convertToBlob({
				type: `image/${format}`,
				quality,
			})

			const url = `/api/capture/frame?session=${session}&frame=${frame}`
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': `image/${format}` },
				body: blob,
			})

			if (!res.ok) {
				self.postMessage({ type: 'error', frame, error: 'upload failed' })
			} else {
				self.postMessage({ type: 'done', frame })
			}
		} catch (err) {
			self.postMessage({
				type: 'error',
				frame,
				error: err instanceof Error ? err.message : String(err),
			})
		} finally {
			pending--
			if (pending === 0) self.postMessage({ type: 'idle' })
		}
	}

	if (type === 'stop') {
		if (pending === 0) self.postMessage({ type: 'idle' })
	}
}
