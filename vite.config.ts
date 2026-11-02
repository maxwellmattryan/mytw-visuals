import { resolve } from 'path'
import { globSync } from 'glob'
import { defineConfig } from 'vite'
import { captureServerPlugin, sketchListPlugin } from './vite-plugins'

const sketchInputs = Object.fromEntries(
	globSync('sketches/*/index.html').map((p) => {
		const name = p.split('/')[1]
		return [name, resolve(p)]
	})
)

export default defineConfig({
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
})
