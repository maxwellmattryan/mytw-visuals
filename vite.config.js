import { resolve } from 'path'
import { globSync } from 'glob'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { homedir } from 'os'

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
				const match = req.method === 'POST' && req.url.startsWith('/api/capture/convert')
				if (!match) return next()

				const url = new URL(req.url, 'http://localhost')
				const fps = url.searchParams.get('fps') || '60'
				const name = url.searchParams.get('name') || 'recording'

				const chunks = []
				req.on('data', (chunk) => chunks.push(chunk))
				req.on('end', () => {
					const tarData = Buffer.concat(chunks)
					const outDir = resolve('output')
					mkdirSync(outDir, { recursive: true })

					const tarPath = resolve(outDir, `${name}.tar`)
					writeFileSync(tarPath, tarData)
					console.log(`[capture] Saved ${tarPath}`)

					const script = resolve('scripts/convert.sh')
					const dlDir = resolve(homedir(), 'Downloads')
					const dlPath = resolve(dlDir, `${name}.mp4`)
					execFile(script, ['-r', fps, '-o', dlDir, tarPath], (err, stdout, stderr) => {
						res.setHeader('Content-Type', 'application/json')
						if (err) {
							console.error('[capture] Convert failed:', stderr || err.message)
							res.statusCode = 500
							res.end(JSON.stringify({ ok: false, error: stderr || err.message }))
						} else if (!existsSync(dlPath)) {
							console.error('[capture] Convert succeeded but MP4 not found')
							res.statusCode = 500
							res.end(JSON.stringify({ ok: false, error: 'MP4 not found after conversion' }))
						} else {
							rmSync(tarPath)
							console.log(`[capture] Converted → ${dlPath}`)
							res.end(JSON.stringify({ ok: true, mp4: dlPath }))
						}
					})
				})
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
