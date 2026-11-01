import { globSync } from 'glob'
import type { Plugin } from 'vite'

export interface SketchEntry {
	name: string
	path: string
}

export function sketchListPlugin(): Plugin {
	const VIRTUAL_PATH = '/__sketches.json'

	return {
		name: 'sketch-list',

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url !== VIRTUAL_PATH) return next()

				const entries: SketchEntry[] = globSync('sketches/*/index.html').map((p) => {
					const dir = p.split('/')[1]
					return { name: dir, path: `/${p}` }
				})

				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify(entries))
			})
		},
	}
}
