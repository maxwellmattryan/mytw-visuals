import { resolve } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync } from 'fs'
import type { Plugin } from 'vite'

export function captureServerPlugin(): Plugin {
	return {
		name: 'capture-server',

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.method !== 'POST' || !req.url?.startsWith('/api/capture/')) return next()

				const url = new URL(req.url, 'http://localhost')
				// Unvalidated and asserted to string below, kept as is: session validation is a security follow-up.
				const session = url.searchParams.get('session')
				const route = url.pathname

				if (route === '/api/capture/start') {
					const fps = url.searchParams.get('fps') || '60'
					const dir = resolve(homedir(), 'Downloads', 'mytw-captures', session as string)
					mkdirSync(dir, { recursive: true })
					writeFileSync(resolve(dir, 'meta.json'), JSON.stringify({ fps: Number(fps) }))
					console.log(`[capture] Session started: ${dir}`)
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ ok: true, dir }))
					return
				}

				if (route === '/api/capture/frame') {
					const frame = url.searchParams.get('frame') || '0'
					const dir = resolve(homedir(), 'Downloads', 'mytw-captures', session as string)
					const filename = String(frame).padStart(7, '0') + '.png'
					const chunks: Buffer[] = []
					req.on('data', (chunk: Buffer) => chunks.push(chunk))
					req.on('end', () => {
						writeFileSync(resolve(dir, filename), Buffer.concat(chunks))
						res.setHeader('Content-Type', 'application/json')
						res.end(JSON.stringify({ ok: true }))
					})
					return
				}

				if (route === '/api/capture/stop') {
					const dir = resolve(homedir(), 'Downloads', 'mytw-captures', session as string)
					console.log(`[capture] Session complete: ${dir}`)
					console.log(`[capture] Convert with: ./scripts/convert.sh ${dir}`)
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ ok: true, dir }))
					return
				}

				next()
			})
		},
	}
}
