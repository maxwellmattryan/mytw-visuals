import { resolve } from 'path'
import { globSync } from 'glob'

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

	plugins: [sketchListPlugin()],

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
