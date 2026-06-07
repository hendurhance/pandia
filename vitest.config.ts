import { defineConfig } from 'vitest/config';

// Vitest reads this instead of vite.config.ts, so the SvelteKit plugin stays out
// of the test runner. Phase 0 covers pure-logic modules (relative imports, no
// `$lib` alias needed). Component tests + jsdom land in Phase 2 if wanted.
export default defineConfig({
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node',
	},
});
