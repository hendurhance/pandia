import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Config file for SvelteKit
/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	vitePlugin: {
		dynamicCompileOptions({ filename }) {
			// Let node_modules use auto-detection (undefined = infer from code)
			if (filename.includes('node_modules')) {
				return { runes: undefined };
			}
			// Enable runes for app source files
			return { runes: true };
		}
	},

	kit: {
		adapter: adapter({
			pages: 'dist',
			assets: 'dist',
			fallback: 'index.html',
			precompress: false,
			strict: false
		})
	}
};

export default config;