import { createCapture } from '@lib/capture'
import { COMPARE_FRAMES, diffImages, heatmap, meetsThreshold, THRESHOLD } from './diff'
import type { DiffStats, Threshold } from './diff'
import { createEngine } from './engine'
import type { EngineSide } from './engine'
import { createOriginal } from './original'
import type { OriginalSide } from './original'

// A developer check for #19: renders the p5 original of 002-understory and the Understory project
// document through @mytw/scene + @mytw/engine, and diffs them. `?run` starts Compare on load.

const IMAGE_URL = '/images/mytw-002_base.png'
const REPORT_PREFIX = '[understory-compare]'

interface FrameResult extends DiffStats {
	frame: number
	phase: number
	pass: boolean
}

interface Report {
	threshold: Threshold
	frames: FrameResult[]
	pass: boolean
}

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {},
	children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
	const node = Object.assign(document.createElement(tag), props)
	node.append(...children)
	return node
}

const compareButton = element('button', { type: 'button', textContent: 'Compare', disabled: true })
const downloadButton = element('button', {
	type: 'button',
	textContent: 'Download report',
	disabled: true,
})
const recordButton = element('button', {
	type: 'button',
	textContent: 'Record side by side',
	disabled: true,
})
const status = element('pre', { textContent: 'Loading…' })
status.style.cssText = 'white-space:pre-wrap;margin:8px 0'
const verdict = element('div')
verdict.style.cssText = 'font-size:20px;margin:8px 0'
const table = element('table')
table.style.cssText = 'border-collapse:collapse;margin:8px 0;font-size:13px'
const rows = element('div')
document.body.style.padding = '16px'
document.body.append(
	element('h1', { textContent: 'Understory: p5 original vs engine' }),
	element('div', {}, [compareButton, ' ', downloadButton, ' ', recordButton]),
	status,
	verdict,
	table,
	rows
)

function showError(prefix: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error)
	status.textContent = `${prefix}: ${message}`
	status.style.color = '#e77'
	console.error(prefix, error)
}

let original: OriginalSide
let engine: EngineSide
let report: Report | null = null
let busy = false

const readCanvas = element('canvas')
const readContext = readCanvas.getContext('2d', { willReadFrequently: true })

/** The pixels of a WebGL canvas, read right after it was drawn. */
function pixelsOf(source: HTMLCanvasElement): Uint8ClampedArray<ArrayBuffer> {
	if (!readContext) throw new Error('2D canvas is not available')
	readCanvas.width = source.width
	readCanvas.height = source.height
	readContext.drawImage(source, 0, 0)
	return readContext.getImageData(0, 0, source.width, source.height).data
}

function imageCanvas(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
	const canvas = element('canvas', { width, height })
	canvas.style.cssText = 'width:300px;height:auto;display:block'
	canvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
	return canvas
}

const fixed = (value: number, digits: number) => value.toFixed(digits)

function metricsText(result: FrameResult): string {
	return (
		`frame ${result.frame} · mean abs ${fixed(result.meanAbs, 3)} · max ${result.maxAbs} · ` +
		`over ${THRESHOLD.tolerance}: ${fixed(result.fractionOver * 100, 3)}% · ` +
		(result.pass ? 'pass' : 'FAIL')
	)
}

function renderTable(results: FrameResult[]): void {
	const cell = (tag: 'td' | 'th', text: string) => {
		const node = element(tag, { textContent: text })
		node.style.cssText = 'border:1px solid #444;padding:4px 8px;text-align:right'
		return node
	}
	table.replaceChildren(
		element('tr', {}, [
			cell('th', 'frame'),
			cell('th', 'phase'),
			cell('th', 'mean abs (≤ 2)'),
			cell('th', 'max'),
			cell('th', `over ${THRESHOLD.tolerance} (≤ 1%)`),
			cell('th', 'result'),
		]),
		...results.map((result) => {
			const row = element('tr', {}, [
				cell('td', String(result.frame)),
				cell('td', fixed(result.phase, 4)),
				cell('td', fixed(result.meanAbs, 3)),
				cell('td', String(result.maxAbs)),
				cell('td', `${fixed(result.fractionOver * 100, 3)}%`),
				cell('td', result.pass ? 'pass' : 'FAIL'),
			])
			row.style.color = result.pass ? '#7c7' : '#e77'
			return row
		})
	)
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function compare(): Promise<void> {
	if (busy) return
	busy = true
	compareButton.disabled = recordButton.disabled = true
	rows.replaceChildren()
	verdict.textContent = ''
	const { width, height } = engine.scene
	const results: FrameResult[] = []
	try {
		for (const frame of COMPARE_FRAMES) {
			status.textContent = `Rendering frame ${frame}…`
			original.draw(frame)
			const a = pixelsOf(original.canvas)
			engine.draw(frame)
			const b = pixelsOf(engine.canvas)
			const stats = diffImages(a, b, width, height, THRESHOLD.tolerance)
			const result: FrameResult = {
				frame,
				phase: frame / engine.scene.frames,
				...stats,
				pass: meetsThreshold(stats),
			}
			results.push(result)
			const row = element('section', { id: `frame-${frame}` }, [
				element('h2', { textContent: `Frame ${frame}` }),
			])
			const images = element('div', {}, [
				element('figure', {}, [
					element('figcaption', { textContent: 'original' }),
					imageCanvas(a, width, height),
				]),
				element('figure', {}, [
					element('figcaption', { textContent: 'engine' }),
					imageCanvas(b, width, height),
				]),
				element('figure', {}, [
					element('figcaption', { textContent: 'diff' }),
					imageCanvas(heatmap(a, b, width, height, THRESHOLD.tolerance), width, height),
				]),
			])
			images.style.cssText = 'display:flex;gap:8px'
			const metrics = element('div', { textContent: metricsText(result) })
			metrics.style.color = result.pass ? '#7c7' : '#e77'
			row.append(images, metrics)
			rows.append(row)
			renderTable(results)
			await nextTask()
		}
		report = { threshold: { ...THRESHOLD }, frames: results, pass: results.every((r) => r.pass) }
		verdict.textContent = `Overall: ${report.pass ? 'PASS' : 'FAIL'}`
		verdict.style.color = report.pass ? '#7c7' : '#e77'
		status.textContent = 'Done.'
		downloadButton.disabled = false
		console.log(REPORT_PREFIX, JSON.stringify(report))
	} catch (error) {
		showError('Compare failed', error)
	} finally {
		busy = false
		compareButton.disabled = recordButton.disabled = false
	}
}

function download(): void {
	if (!report) return
	const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
	const url = URL.createObjectURL(blob)
	element('a', { href: url, download: 'understory-compare.json' }).click()
	URL.revokeObjectURL(url)
}

async function record(): Promise<void> {
	if (busy) return
	busy = true
	compareButton.disabled = recordButton.disabled = true
	const { width, height, frames, fps } = engine.scene
	const canvas = element('canvas', { width: width * 2, height })
	const context = canvas.getContext('2d')
	try {
		if (!context) throw new Error('2D canvas is not available')
		const cap = createCapture(canvas, { framerate: fps })
		status.textContent = 'Starting capture…'
		await cap.start({ frameLimit: frames })
		if (!cap.recording) throw new Error(cap.startError ?? 'Capture did not start')
		// Frames render one at a time, never in real time, so the recording is frame-accurate.
		for (let frame = 0; frame < frames; frame++) {
			status.textContent = `Recording frame ${frame + 1} / ${frames}…`
			original.draw(frame)
			context.drawImage(original.canvas, 0, 0)
			engine.draw(frame)
			context.drawImage(engine.canvas, width, 0)
			cap.capture()
			await nextTask()
		}
		status.textContent = 'Uploading frames…'
		await cap.flushed()
		status.textContent = `Recorded ${frames} frames. See the console for the folder and the yarn convert command.`
	} catch (error) {
		showError('Recording failed', error)
	} finally {
		busy = false
		compareButton.disabled = recordButton.disabled = false
	}
}

compareButton.addEventListener('click', () => void compare())
downloadButton.addEventListener('click', download)
recordButton.addEventListener('click', () => void record())

async function init(): Promise<void> {
	try {
		;[original, engine] = await Promise.all([createOriginal(IMAGE_URL), createEngine()])
		if (original.loopFrames !== engine.scene.frames)
			throw new Error(
				`The sketch loops over ${original.loopFrames} frames and the project over ${engine.scene.frames}`
			)
	} catch (error) {
		showError('Setup failed', error)
		return
	}
	status.textContent = 'Ready.'
	compareButton.disabled = recordButton.disabled = false
	if (new URLSearchParams(location.search).has('run')) await compare()
}

void init()
