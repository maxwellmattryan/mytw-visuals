import { resolve } from 'path'
import { homedir } from 'os'
import { globSync } from 'glob'
import { mkdirSync, writeFileSync } from 'fs'

function sketchListPlugin() {
	const VIRTUAL_PATH = '/__sketches.json'

	return {
		name: 'sketch-list',

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url !== VIRTUAL_PATH) return next()

				const entries = globSync('sketches/*/index.html').map((p) => {
					const dir = p.split('/')[1]
					return { name: dir, path: `/${p}` }
				})

				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify(entries))
			})
		},

		transformIndexHtml: {
			order: 'pre',
			handler(html) {
				const entries = globSync('sketches/*/index.html').map((p) => {
					const dir = p.split('/')[1]
					return { name: dir, path: `/${p}` }
				})

				return html.replace('__SKETCH_LIST__', JSON.stringify(entries))
			},
		},
	}
}

function captureServerPlugin() {
	return {
		name: 'capture-server',

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.method !== 'POST' || !req.url.startsWith('/api/capture/')) return next()

				const url = new URL(req.url, 'http://localhost')
				const session = url.searchParams.get('session')
				const route = url.pathname

				if (route === '/api/capture/start') {
					const fps = url.searchParams.get('fps') || '60'
					const dir = resolve(homedir(), 'Downloads', 'mytw-captures', session)
					mkdirSync(dir, { recursive: true })
					writeFileSync(resolve(dir, 'meta.json'), JSON.stringify({ fps: Number(fps) }))
					console.log(`[capture] Session started: ${dir}`)
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ ok: true, dir }))
					return
				}

				if (route === '/api/capture/frame') {
					const frame = url.searchParams.get('frame') || '0'
					const dir = resolve(homedir(), 'Downloads', 'mytw-captures', session)
					const filename = String(frame).padStart(7, '0') + '.png'
					const chunks = []
					req.on('data', (chunk) => chunks.push(chunk))
					req.on('end', () => {
						writeFileSync(resolve(dir, filename), Buffer.concat(chunks))
						res.setHeader('Content-Type', 'application/json')
						res.end(JSON.stringify({ ok: true }))
					})
					return
				}

				if (route === '/api/capture/stop') {
					const dir = resolve(homedir(), 'Downloads', 'mytw-captures', session)
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

const sketchInputs = Object.fromEntries(
	globSync('sketches/*/index.html').map((p) => {
		const name = p.split('/')[1]
		return [name, resolve(p)]
	})
)

export default {
	publicDir: 'assets',

	resolve: {
		alias: {
			'@lib': resolve('lib'),
		},
	},

	plugins: [sketchListPlugin(), captureServerPlugin()],

	optimizeDeps: {
		include: ['ccapture.js-npmfixed'],
	},

	build: {
		target: 'esnext',
		rollupOptions: {
			input: {
				main: resolve('index.html'),
				...sketchInputs,
			},
		},
	},
}
