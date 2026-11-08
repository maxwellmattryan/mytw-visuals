import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { SketchCapture } from '@lib/capture'

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalFetch = globalThis.fetch

/** Every URL passed to `fetch`, in call order. */
let urls: string[]
let startOk: boolean

function fakeElement() {
	return {
		width: 0,
		height: 0,
		style: { cssText: '' },
		textContent: '',
		id: '',
		remove: () => {},
		getContext: () => ({ drawImage: () => {} }),
		toBlob: (callback: (blob: Blob | null) => void) => callback(null),
	}
}

beforeEach(() => {
	urls = []
	startOk = true
	Object.defineProperty(globalThis, 'document', {
		value: {
			createElement: fakeElement,
			head: { appendChild: () => {} },
			body: { appendChild: () => {} },
		},
		configurable: true,
		writable: true,
	})
	globalThis.fetch = jest.fn(async (input: string | URL | Request) => {
		const url = String(input)
		urls.push(url)
		const ok = !url.startsWith('/api/capture/start') || startOk
		return new Response(JSON.stringify(ok ? { ok, dir: '/tmp/session' } : { ok, error: 'no' }))
	}) as typeof fetch
	jest.spyOn(console, 'log').mockImplementation(() => {})
	jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
	jest.restoreAllMocks()
	globalThis.fetch = originalFetch
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
	else Reflect.deleteProperty(globalThis, 'document')
})

function frameUploads(): string[] {
	return urls
		.filter((url) => url.startsWith('/api/capture/frame'))
		.map((url) => new URL(url, 'http://localhost').searchParams.get('frame') ?? '')
}

/** Waits until the capture has told the dev server the session stopped. */
async function finished(): Promise<void> {
	const deadline = Date.now() + 2000
	while (!urls.some((url) => url.startsWith('/api/capture/stop')) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

function makeCapture(): SketchCapture {
	return new SketchCapture({ width: 4, height: 4 } as unknown as HTMLCanvasElement)
}

describe('SketchCapture frame limit', () => {
	it('uploads exactly frameLimit frames, then stops itself', async () => {
		const cap = makeCapture()
		await cap.start({ frameLimit: 3 })
		expect(cap.recording).toBe(true)
		expect(cap.frameLimit).toBe(3)

		cap.capture()
		cap.capture()
		expect(cap.framesCaptured).toBe(2)
		expect(cap.recording).toBe(true)
		cap.capture()
		expect(cap.recording).toBe(false)
		cap.capture()
		cap.capture()

		expect(frameUploads()).toEqual(['0', '1', '2'])
		expect(cap.framesCaptured).toBe(3)
		expect(cap.frameLimit).toBeNull()
		await finished()
		expect(urls.filter((url) => url.startsWith('/api/capture/stop'))).toHaveLength(1)
	})

	it('never stops on its own without a frame limit', async () => {
		const cap = makeCapture()
		await cap.start()
		expect(cap.frameLimit).toBeNull()
		for (let i = 0; i < 500; i++) cap.capture()
		expect(cap.recording).toBe(true)
		expect(cap.framesCaptured).toBe(500)

		cap.stop()
		expect(cap.recording).toBe(false)
		await finished()
	})

	it('counts from 0 again on the next start', async () => {
		const cap = makeCapture()
		await cap.start({ frameLimit: 2 })
		cap.capture()
		cap.capture()
		await finished()
		await cap.start({ frameLimit: 5 })
		expect(cap.framesCaptured).toBe(0)
		expect(cap.frameLimit).toBe(5)
		cap.stop()
	})

	it('keeps no frame limit when the session fails to start', async () => {
		startOk = false
		const cap = makeCapture()
		await cap.start({ frameLimit: 3 })
		expect(cap.recording).toBe(false)
		expect(cap.frameLimit).toBeNull()
		cap.capture()
		expect(frameUploads()).toEqual([])
	})
})
