import { resolve } from 'path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import pkg from './package.json'

export default defineConfig({
	// Relative URLs, so the build works from any static host at any sub-path.
	base: './',

	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},

	resolve: {
		alias: {
			'@lib': resolve('../../packages/lib'),
		},
	},

	plugins: [svelte()],

	build: {
		target: 'esnext',
	},
})
