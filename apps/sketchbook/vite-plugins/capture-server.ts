import { existsSync, mkdirSync, writeFileSync } from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { homedir } from 'os'
import { resolve, sep } from 'path'
import type { Connect, Plugin } from 'vite'

const START_ROUTE = '/api/capture/start'
const FRAME_ROUTE = '/api/capture/frame'
const STOP_ROUTE = '/api/capture/stop'

// The format localTimestamp() in lib/capture/sketch-capture.ts produces.
const SESSION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/
// 0 to 9999999, which is what the 7-digit filename and convert.sh's %07d can hold.
const FRAME_PATTERN = /^\d{1,7}$/
const FPS_PATTERN = /^\d{1,3}(\.\d{1,3})?$/
const MIN_FPS = 1
const MAX_FPS = 240

/** Returns the session's directory, or null unless it is strictly inside the captures directory. */
export function resolveSessionDir(capturesDir: string, session: string): string | null {
	const dir = resolve(capturesDir, session)
	return dir.startsWith(resolve(capturesDir) + sep) ? dir : null
}

/**
 * Handles POSTs to the capture endpoints. Origin and parameters are checked before any
 * request body is read and before any filesystem access.
 */
export function createCaptureMiddleware(capturesDir: string): Connect.NextHandleFunction {
	return (req, res, next) => {
		if (req.method !== 'POST' || !req.url?.startsWith('/api/capture/')) return next()

		const url = new URL(req.url, 'http://localhost')
		const route = url.pathname
		if (route !== START_ROUTE && route !== FRAME_ROUTE && route !== STOP_ROUTE) return next()

		if (!isSameOrigin(req)) return reject(res, 403, 'Capture requests must be same-origin')

		const session = url.searchParams.get('session')
		if (session === null || !SESSION_PATTERN.test(session)) {
			return reject(res, 400, 'session must be a YYYY-MM-DDTHH-MM-SS timestamp')
		}

		let handle: (dir: string) => void
		if (route === START_ROUTE) {
			const fps = parseFps(url.searchParams.get('fps'))
			if (fps === null) return reject(res, 400, `fps must be from ${MIN_FPS} to ${MAX_FPS}`)
			handle = (dir) => startSession(res, dir, fps)
		} else if (route === FRAME_ROUTE) {
			const frame = url.searchParams.get('frame')
			if (frame === null || !FRAME_PATTERN.test(frame)) {
				return reject(res, 400, 'frame must be an integer from 0 to 9999999')
			}
			handle = (dir) => writeFrame(req, res, dir, frame)
		} else {
			handle = (dir) => stopSession(res, dir)
		}

		const dir = resolveSessionDir(capturesDir, session)
		if (dir === null) return reject(res, 400, 'session is outside the captures directory')

		handle(dir)
	}
}

export function captureServerPlugin(): Plugin {
	const capturesDir = resolve(homedir(), 'Downloads', 'mytw-captures')

	return {
		name: 'capture-server',

		configureServer(server) {
			// The post hook places this behind Vite's allowedHosts check, which is what stops DNS
			// rebinding: a rebound page is same-origin, so the origin check can't catch it.
			return () => {
				server.middlewares.use(createCaptureMiddleware(capturesDir))
			}
		},
	}
}

function startSession(res: ServerResponse, dir: string, fps: number): void {
	try {
		mkdirSync(dir, { recursive: true })
		writeFileSync(resolve(dir, 'meta.json'), JSON.stringify({ fps }))
	} catch (error) {
		console.error('[capture] Could not start session:', error)
		return reject(res, 500, 'Could not start the capture session')
	}
	console.log(`[capture] Session started: ${dir}`)
	respond(res, { ok: true, dir })
}

function writeFrame(req: IncomingMessage, res: ServerResponse, dir: string, frame: string): void {
	const filename = frame.padStart(7, '0') + '.png'
	const chunks: Buffer[] = []
	req.on('data', (chunk: Buffer) => chunks.push(chunk))
	req.on('end', () => {
		try {
			writeFileSync(resolve(dir, filename), Buffer.concat(chunks))
		} catch (error) {
			if (isMissingPathError(error)) return reject(res, 404, 'Capture session was not started')
			console.error('[capture] Could not write frame:', error)
			return reject(res, 500, 'Could not write the frame')
		}
		respond(res, { ok: true })
	})
}

function stopSession(res: ServerResponse, dir: string): void {
	if (!existsSync(dir)) return reject(res, 404, 'Capture session was not started')
	console.log(`[capture] Session complete: ${dir}`)
	console.log(`[capture] Convert with: yarn convert "${dir}"`)
	respond(res, { ok: true, dir })
}

/**
 * A request with no Origin passes: browsers always send one on POST, so this only admits
 * non-browser local clients.
 */
function isSameOrigin(req: IncomingMessage): boolean {
	const { origin, host } = req.headers
	if (origin === undefined) return true
	if (!host) return false
	const originHost = parseHost(origin)
	return originHost !== null && originHost === parseHost(`http://${host}`)
}

function parseHost(value: string): string | null {
	try {
		return new URL(value).host
	} catch {
		return null
	}
}

function parseFps(value: string | null): number | null {
	if (value === null || !FPS_PATTERN.test(value)) return null
	const fps = Number(value)
	return fps >= MIN_FPS && fps <= MAX_FPS ? fps : null
}

// Checks the shape rather than instanceof, which fails for fs errors under Jest's VM modules.
function isMissingPathError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function reject(res: ServerResponse, status: number, error: string): void {
	res.statusCode = status
	respond(res, { ok: false, error })
}

function respond(res: ServerResponse, body: object): void {
	res.setHeader('Content-Type', 'application/json')
	res.end(JSON.stringify(body))
}
