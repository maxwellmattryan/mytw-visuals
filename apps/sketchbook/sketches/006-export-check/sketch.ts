import { createRenderer } from '@mytw/engine'
import type { Renderer } from '@mytw/engine'
import {
	checkVideoSupport,
	engineSource,
	EXPORT_PRESETS,
	ExportError,
	exportPngSequence,
	exportStill,
	exportVideo,
	presetIssues,
} from '@mytw/export'
import type { ExportOptions, ExportResult, Quality } from '@mytw/export'
import { formatSeconds, LoopClock } from '@lib/loop'

import {
	registerUnderstoryEffects,
	UNDERSTORY_IMAGE,
	UNDERSTORY_IMAGE_ID,
	understoryFrame,
} from '../004-engine-demo/understory-frame'

// ---------------------------------------------------------------------------
// Export check: exports Understory with @mytw/export as an MP4, a PNG sequence
// or a still, from a production build with no dev server. The preview plays
// the loop; exports render into a separate offscreen renderer at full size.
// Where the browser has showSaveFilePicker, output streams to the chosen file.
// ---------------------------------------------------------------------------

/** Chromium's File System Access picker, which the TS DOM lib doesn't declare. */
interface SaveFilePickerOptions {
	suggestedName?: string
	types?: { description: string; accept: Record<string, string[]> }[]
}

declare global {
	interface Window {
		showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
	}
}

type PresetKey = keyof typeof EXPORT_PRESETS | 'custom'
type Kind = 'mp4' | 'zip' | 'png'

const PREVIEW_MAX = 960
const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'very-high']
const MIME: Record<Kind, string> = {
	mp4: 'video/mp4',
	zip: 'application/zip',
	png: 'image/png',
}

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
	const node = document.getElementById(id)
	if (!(node instanceof type)) throw new Error(`#${id} is missing`)
	return node
}

const ui = {
	preset: byId('preset', HTMLSelectElement),
	width: byId('width', HTMLInputElement),
	height: byId('height', HTMLInputElement),
	fps: byId('fps', HTMLInputElement),
	frames: byId('frames', HTMLInputElement),
	quality: byId('quality', HTMLSelectElement),
	mp4: byId('export-mp4', HTMLButtonElement),
	png: byId('export-png', HTMLButtonElement),
	still: byId('export-still', HTMLButtonElement),
	cancel: byId('cancel', HTMLButtonElement),
	progress: byId('progress', HTMLOutputElement),
	warnings: byId('warnings', HTMLOutputElement),
	status: byId('status', HTMLOutputElement),
}

interface Settings {
	width: number
	height: number
	fps: number
	frames: number
	quality: Quality
}

function presetKey(value: string): PresetKey {
	return value === 'spotifyCanvas' || value === 'instagramReel' ? value : 'custom'
}

function quality(value: string): Quality {
	return QUALITIES.find((q) => q === value) ?? 'high'
}

function settings(): Settings {
	return {
		width: ui.width.valueAsNumber,
		height: ui.height.valueAsNumber,
		fps: ui.fps.valueAsNumber,
		frames: ui.frames.valueAsNumber,
		quality: quality(ui.quality.value),
	}
}

function applyPreset(key: PresetKey): void {
	if (key === 'custom') return
	const preset = EXPORT_PRESETS[key]
	ui.width.valueAsNumber = preset.width
	ui.height.valueAsNumber = preset.height
	ui.fps.valueAsNumber = preset.fps
	ui.quality.value = preset.quality
}

function fileName(s: Settings, kind: Kind): string {
	return `understory-${s.width}x${s.height}-${s.fps}fps.${kind}`
}

function describeError(err: unknown): string {
	if (err instanceof ExportError) return err.code === 'cancelled' ? 'Cancelled.' : err.message
	return err instanceof Error ? err.message : String(err)
}

/** Asks for a file to stream into, or `null` to download a blob instead. Throws if the user cancels. */
async function pickFile(name: string, kind: Kind): Promise<FileSystemWritableFileStream | null> {
	if (!window.showSaveFilePicker) return null
	const handle = await window.showSaveFilePicker({
		suggestedName: name,
		types: [{ description: name, accept: { [MIME[kind]]: [`.${kind}`] } }],
	})
	return handle.createWritable()
}

function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = name
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function loadImage(): Promise<HTMLImageElement> {
	const image = new Image()
	image.src = UNDERSTORY_IMAGE
	await image.decode()
	return image
}

function prepare(renderer: Renderer, image: HTMLImageElement): Renderer {
	renderer.setImage(UNDERSTORY_IMAGE_ID, image)
	registerUnderstoryEffects(renderer)
	return renderer
}

async function main(): Promise<void> {
	const image = await loadImage()

	const preview = document.createElement('canvas')
	document.body.appendChild(preview)
	const previewRenderer = prepare(createRenderer(preview, { width: 540, height: 960 }), image)

	// Exports draw here, so the preview keeps its size.
	const exportCanvas = document.createElement('canvas')
	const exportRenderer = prepare(createRenderer(exportCanvas, { width: 2, height: 2 }), image)
	const source = engineSource(exportRenderer, (phase) => understoryFrame(phase), exportCanvas)

	let clock = new LoopClock({ loopFrames: 225, fps: 30 })
	let busy: AbortController | null = null
	let videoOk = false
	let check = 0
	/** The status line: the last export's outcome, then the H.264 support message. */
	const status = { export: '', support: '' }

	function showStatus(): void {
		ui.status.textContent = [...new Set([status.export, status.support])].filter(Boolean).join('\n')
	}

	function setBusy(controller: AbortController | null): void {
		busy = controller
		ui.cancel.disabled = controller === null
		ui.png.disabled = controller !== null
		ui.still.disabled = controller !== null
		ui.mp4.disabled = controller !== null || !videoOk
	}

	/** Rechecks H.264 support, the preset warnings and the preview size. */
	async function refresh(): Promise<void> {
		const s = settings()
		const key = presetKey(ui.preset.value)
		const issues = key === 'custom' ? [] : presetIssues(EXPORT_PRESETS[key], s)
		ui.warnings.textContent = issues.join('\n')

		if (s.width > 0 && s.height > 0) {
			const scale = Math.min(1, PREVIEW_MAX / Math.max(s.width, s.height))
			previewRenderer.setSize(
				Math.max(1, Math.round(s.width * scale)),
				Math.max(1, Math.round(s.height * scale))
			)
		}
		if (s.frames > 0 && s.fps > 0 && Number.isInteger(s.frames)) {
			clock = new LoopClock({ loopFrames: s.frames, fps: s.fps })
		}

		const id = ++check
		const support = await checkVideoSupport(s)
		if (id !== check) return
		videoOk = support.ok
		status.support = support.ok ? '' : support.message
		showStatus()
		setBusy(busy)
	}

	async function run(kind: Kind): Promise<void> {
		const s = settings()
		const name = fileName(s, kind)
		let destination: FileSystemWritableFileStream | null
		try {
			destination = await pickFile(name, kind)
		} catch (err) {
			status.export = describeError(err)
			showStatus()
			return
		}
		const controller = new AbortController()
		setBusy(controller)
		status.export = ''
		showStatus()
		const total = kind === 'png' ? 1 : s.frames
		ui.progress.textContent = `${kind}: 0 / ${total}`
		const started = performance.now()
		const options: ExportOptions = {
			width: s.width,
			height: s.height,
			fps: s.fps,
			frames: s.frames,
			signal: controller.signal,
			onProgress: ({ done }) => {
				ui.progress.textContent = `${kind}: ${done} / ${total}`
			},
			destination: destination ?? undefined,
		}
		try {
			let blob: Blob | null
			let result: ExportResult | null = null
			if (kind === 'mp4') {
				result = await exportVideo(source, { ...options, quality: s.quality })
				blob = result.blob
			} else if (kind === 'zip') {
				result = await exportPngSequence(source, options)
				blob = result.blob
			} else {
				blob = await exportStill(source, {
					width: s.width,
					height: s.height,
					phase: clock.phase,
					signal: controller.signal,
				})
				if (destination) {
					await destination.write(blob)
					await destination.close()
					blob = null
				}
			}
			if (blob) download(blob, name)
			const seconds = ((performance.now() - started) / 1000).toFixed(1)
			const detail = result
				? `${result.frames} frames, ${formatSeconds(result.frames, result.fps)} s${result.codec ? `, ${result.codec}` : ''}`
				: `phase ${clock.phase.toFixed(3)}`
			ui.progress.textContent = `${kind}: done in ${seconds} s (${detail}) → ${name}`
		} catch (err) {
			status.export = describeError(err)
			showStatus()
			// The exporters abort a destination they took; this covers early failures
			// (invalid options, no encoder) and the still, so no partial file is kept.
			if (destination) await destination.abort().catch(() => {})
		} finally {
			setBusy(null)
			await refresh()
		}
	}

	ui.preset.addEventListener('change', () => {
		applyPreset(presetKey(ui.preset.value))
		void refresh()
	})
	for (const input of [ui.width, ui.height, ui.fps, ui.quality]) {
		input.addEventListener('change', () => {
			ui.preset.value = 'custom'
			void refresh()
		})
	}
	ui.frames.addEventListener('change', () => void refresh())
	ui.mp4.addEventListener('click', () => void run('mp4'))
	ui.png.addEventListener('click', () => void run('zip'))
	ui.still.addEventListener('click', () => void run('png'))
	ui.cancel.addEventListener('click', () => busy?.abort())

	applyPreset(presetKey(ui.preset.value))
	await refresh()

	const start = performance.now()
	function tick(now: number): void {
		requestAnimationFrame(tick)
		clock.seek(Math.floor(((now - start) / 1000) * clock.fps))
		previewRenderer.render(understoryFrame(clock.next()))
	}
	requestAnimationFrame(tick)
}

main().catch((err: unknown) => {
	console.error(err)
	ui.status.textContent = describeError(err)
})
