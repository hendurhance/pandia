import { sveltekit } from '@sveltejs/kit/vite';
import { createLogger, defineConfig } from 'vite';

// Svelte 5 strips `$effect(() => {...})` bodies in the SSR build, so imports
// referenced only inside effects look unused to Rollup at SSR time — they're
// still used in the client bundle. SvelteKit's SSR build routes these as
// logger warnings (not Rollup `onwarn`), so we filter them at the logger.
// ESLint's `no-unused-vars` remains the source of truth for real unused imports.
const logger = createLogger();
const originalWarn = logger.warn;
logger.warn = (msg, options) => {
	if (
		typeof msg === 'string' &&
		/(is|are) imported from external module .* but never used/.test(msg)
	) {
		return;
	}
	originalWarn(msg, options);
};

export default defineConfig({
	plugins: [sveltekit()],
	customLogger: logger,

	// Don't obscure Rust errors during `tauri dev`.
	clearScreen: false,

	server: {
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ['**/src-tauri/**'],
		},
	},
});
