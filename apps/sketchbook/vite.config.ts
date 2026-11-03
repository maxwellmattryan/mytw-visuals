import { resolve } from 'path'
import { globSync } from 'glob'
import { defineConfig } from 'vite'
import pkg from './package.json'
import { captureServerPlugin, sketchListPlugin } from './vite-plugins'

const sketchInputs = Object.fromEntries(
	globSync('sketches/*/index.html').map((p) => {
		const name = p.split('/')[1]
		return [name, resolve(p)]
	})
)

export default defineConfig({
	publicDir: 'assets',

	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},

	resolve: {
		alias: {
			'@lib': resolve('../../packages/lib'),
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
