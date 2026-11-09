// svelte-check 4 reads Svelte options from vite.config through a `vite-plugin-svelte:config`
// plugin, which @sveltejs/vite-plugin-svelte 5 doesn't have, so it falls back to this file. The
// Vite build ignores it (vite-plugin-svelte 5 only reads svelte.config.js), so the defaults apply
// to both.
import type { SvelteConfig } from '@sveltejs/vite-plugin-svelte'

const config: SvelteConfig = {}

export default config
