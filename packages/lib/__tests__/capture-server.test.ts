import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'fs'
import { createServer, request } from 'http'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { localTimestamp } from '@lib/capture/sketch-capture'
import { createCaptureMiddleware, resolveSessionDir } from '../../../apps/sketchbook/vite-plugins/capture-server'

const SESSION = '2026-01-01T00-00-00'
const NEXT_STATUS = 418

let parent: string
let capturesDir: string
let server: Server
let port: number

/**
 * Query strings are built by hand so raw encodings reach the server unchanged: fetch normalises
 * `..` path segments but not query strings.
 */
function post(path: string, init: RequestInit = {}) {
	return fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', ...init })
}

/** Everything under the temp parent, relative to it. */
function written() {
	return readdirSync(parent, { recursive: true, encoding: 'utf8' }).sort()
}

async function expectRejected(res: Response, status: number) {
	expect(res.status).toBe(status)
	expect(res.headers.get('content-type')).toBe('application/json')
	const body = (await res.json()) as { ok: unknown; error: unknown }
	expect(body.ok).toBe(false)
	expect(typeof body.error).toBe('string')
	return body
}

beforeEach(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => {})
	jest.spyOn(console, 'error').mockImplementation(() => {})

	parent = mkdtempSync(join(tmpdir(), 'capture-'))
	capturesDir = join(parent, 'captures')
	mkdirSync(capturesDir)

	const middleware = createCaptureMiddleware(capturesDir)
	server = createServer({ requireHostHeader: false }, (req, res) =>
		middleware(req, res, () => {
			res.statusCode = NEXT_STATUS
			res.end()
		})
	)
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
	port = (server.address() as AddressInfo).port
})

afterEach(async () => {
	server.closeAllConnections()
	await new Promise((done) => server.close(done))
	rmSync(parent, { recursive: true, force: true })
	jest.restoreAllMocks()
})

describe('session validation', () => {
	const routes = [
		['start', '/api/capture/start', '&fps=60'],
		['frame', '/api/capture/frame', '&frame=0'],
		['stop', '/api/capture/stop', ''],
	]
	const invalid = [
		['empty', 'session='],
		['../evil', 'session=../evil'],
		['..%2Fevil', 'session=..%2Fevil'],
		['%2e%2e%2fevil', 'session=%2e%2e%2fevil'],
		['/tmp/evil', 'session=/tmp/evil'],
		['a traversal after a valid prefix', `session=${SESSION}/../../evil`],
		['a trailing newline', `session=${SESSION}%0A`],
		['a trailing null byte', `session=${SESSION}%00`],
		['a date alone', 'session=2026-01-01'],
		['colons in the time', 'session=2026-01-01T00:00:00'],
	]
	const cases = routes.flatMap(([route, path, rest]) => [
		[route, 'missing', `${path}?${rest.slice(1)}`] as const,
		...invalid.map(([name, query]) => [route, name, `${path}?${query}${rest}`] as const),
	])

	it.each(cases)('%s rejects a session that is %s', async (_route, _name, url) => {
		const body = await expectRejected(await post(url), 400)
		expect(body.error).not.toContain('evil')
		expect(written()).toEqual(['captures'])
	})
})

describe('frame validation', () => {
	const inRoute = (frame: string) => `/api/capture/frame?session=${SESSION}${frame}`

	beforeEach(async () => {
		await post(`/api/capture/start?session=${SESSION}&fps=60`)
	})

	it.each([
		'',
		'&frame=',
		'&frame=-1',
		'&frame=1.5',
		'&frame=abc',
		'&frame=1e3',
		'&frame=0x10',
		'&frame=../x',
		'&frame=10000000',
	])('rejects "%s" and writes no file', async (query) => {
		await expectRejected(await post(inRoute(query), { body: new Uint8Array([1]) }), 400)
		expect(readdirSync(join(capturesDir, SESSION))).toEqual(['meta.json'])
		expect(written()).toHaveLength(3)
	})

	it.each([
		['0', '0000000.png'],
		['9999999', '9999999.png'],
	])('accepts %s', async (frame, filename) => {
		const res = await post(inRoute(`&frame=${frame}`), { body: new Uint8Array([1]) })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ ok: true })
		expect(existsSync(join(capturesDir, SESSION, filename))).toBe(true)
	})
})

describe('fps validation', () => {
	const inRoute = (fps: string) => `/api/capture/start?session=${SESSION}${fps}`

	it.each([
		'',
		'&fps=',
		'&fps=0',
		'&fps=-1',
		'&fps=abc',
		'&fps=Infinity',
		'&fps=NaN',
		'&fps=1e2',
		'&fps=241',
	])('rejects "%s" and creates no session directory', async (query) => {
		await expectRejected(await post(inRoute(query)), 400)
		expect(written()).toEqual(['captures'])
	})

	it.each(['1', '30', '48', '60', '29.97', '240'])('accepts %s', async (fps) => {
		const res = await post(inRoute(`&fps=${fps}`))
		expect(res.status).toBe(200)
		const meta: unknown = JSON.parse(readFileSync(join(capturesDir, SESSION, 'meta.json'), 'utf8'))
		expect(meta).toEqual({ fps: Number(fps) })
	})
})

describe('resolveSessionDir', () => {
	const dir = resolve('/tmp/captures')

	it.each(['../evil', '/tmp/evil', '.', '', '../captures-evil/x'])(
		'returns null for "%s"',
		(session) => {
			expect(resolveSessionDir(dir, session)).toBeNull()
		}
	)

	it('returns the joined path for a valid session', () => {
		expect(resolveSessionDir(dir, SESSION)).toBe(join(dir, SESSION))
	})
})

describe('origin check', () => {
	const url = `/api/capture/start?session=${SESSION}&fps=60`

	it.each<[string, () => string]>([
		['another site', () => 'http://evil.example'],
		['the same host on another port', () => `http://127.0.0.1:${port + 1}`],
		['another hostname on the same port', () => `http://localhost:${port}`],
		['null', () => 'null'],
		['an unparseable value', () => 'not a url'],
	])('rejects %s and writes nothing', async (_name, origin) => {
		await expectRejected(await post(url, { headers: { Origin: origin() } }), 403)
		expect(written()).toEqual(['captures'])
	})

	it('rejects an Origin when the request has no Host', async () => {
		const status = await new Promise((done, fail) => {
			const req = request({
				host: '127.0.0.1',
				port,
				path: url,
				method: 'POST',
				setHost: false,
				headers: { Origin: `http://127.0.0.1:${port}` },
			})
			req.on('response', (res) => {
				res.resume()
				done(res.statusCode)
			})
			req.on('error', fail)
			req.end()
		})
		expect(status).toBe(403)
		expect(written()).toEqual(['captures'])
	})

	it('accepts an Origin matching Host', async () => {
		const res = await post(url, { headers: { Origin: `http://127.0.0.1:${port}` } })
		expect(res.status).toBe(200)
	})

	it('accepts a request with no Origin', async () => {
		const res = await post(url)
		expect(res.status).toBe(200)
	})
})

describe('lifecycle', () => {
	it('records a session end to end', async () => {
		const session = localTimestamp()
		const bytes = new Uint8Array([137, 80, 78, 71])

		const start = await post(`/api/capture/start?session=${session}&fps=60`)
		expect(start.status).toBe(200)
		expect(await start.json()).toEqual({ ok: true, dir: join(capturesDir, session) })

		const frame = await post(`/api/capture/frame?session=${session}&frame=0`, { body: bytes })
		expect(frame.status).toBe(200)
		expect(await frame.json()).toEqual({ ok: true })

		const stop = await post(`/api/capture/stop?session=${session}`)
		expect(stop.status).toBe(200)
		expect(await stop.json()).toEqual({ ok: true, dir: join(capturesDir, session) })

		const dir = join(capturesDir, session)
		expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))).toEqual({ fps: 60 })
		expect(new Uint8Array(readFileSync(join(dir, '0000000.png')))).toEqual(bytes)
	})
})

describe('unknown session', () => {
	it.each([
		['frame', `/api/capture/frame?session=${SESSION}&frame=0`],
		['stop', `/api/capture/stop?session=${SESSION}`],
	])('%s returns 404 and creates nothing', async (_route, url) => {
		await expectRejected(await post(url, { body: new Uint8Array([1]) }), 404)
		expect(written()).toEqual(['captures'])

		const next = await post(`/api/capture/start?session=${SESSION}&fps=60`)
		expect(next.status).toBe(200)
	})
})

describe('filesystem failures', () => {
	it('start returns 500 when the session directory cannot be created', async () => {
		writeFileSync(join(capturesDir, SESSION), '')
		await expectRejected(await post(`/api/capture/start?session=${SESSION}&fps=60`), 500)
	})

	it('frame returns 500 when the write fails for a reason other than a missing directory', async () => {
		writeFileSync(join(capturesDir, SESSION), '')
		const url = `/api/capture/frame?session=${SESSION}&frame=0`
		await expectRejected(await post(url, { body: new Uint8Array([1]) }), 500)
	})
})

describe('routing', () => {
	it.each([
		['GET', `/api/capture/start?session=${SESSION}&fps=60`],
		['PUT', `/api/capture/frame?session=${SESSION}&frame=0`],
		['OPTIONS', `/api/capture/stop?session=${SESSION}`],
		['POST', `/api/capture/unknown?session=../evil`],
		['POST', `/api/capture/start/?session=${SESSION}&fps=60`],
		['POST', `/other?session=${SESSION}`],
	])('%s %s calls next()', async (method, url) => {
		const res = await post(url, { method })
		expect(res.status).toBe(NEXT_STATUS)
		expect(written()).toEqual(['captures'])
	})

	it('calls next() for an unknown path before checking the origin', async () => {
		const res = await post('/api/capture/unknown', { headers: { Origin: 'http://evil.example' } })
		expect(res.status).toBe(NEXT_STATUS)
	})
})
