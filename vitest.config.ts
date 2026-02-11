import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
	plugins: [sveltekit(), wasm(), topLevelAwait()],
	resolve: {
		alias: {
			'@tauri-apps/api/core': path.resolve(__dirname, './tests/mocks/tauri.ts'),
			'@tauri-apps/plugin-dialog': path.resolve(__dirname, './tests/mocks/tauri-dialog.ts'),
			'@tauri-apps/plugin-fs': path.resolve(__dirname, './tests/mocks/tauri-fs.ts'),
			'@tauri-apps/plugin-store': path.resolve(__dirname, './tests/mocks/tauri-store.ts'),
			'@tauri-apps/plugin-http': path.resolve(__dirname, './tests/mocks/tauri-http.ts')
		}
	},
	test: {
		// Environment settings
		environment: 'jsdom',
		globals: true,

		// Setup files
		setupFiles: ['./tests/setup/vitest.setup.ts'],

		// Include patterns
		include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],

		// Exclude patterns
		exclude: ['tests/e2e/**', 'tests/benchmarks/**', 'node_modules/**'],

		// Coverage configuration
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			reportsDirectory: './coverage',
			include: [
				'src/lib/services/**/*.ts',
				'src/lib/stores/**/*.ts',
				'src/lib/utils/**/*.ts',
				'src/lib/constants/**/*.ts'
			],
			exclude: ['src/lib/components/**', '**/*.d.ts', '**/*.svelte'],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 75,
				statements: 80
			}
		},

		// Alias configuration for mocking Tauri APIs
		alias: {
			$lib: './src/lib'
		},

		// Timeout settings
		testTimeout: 10000,
		hookTimeout: 10000,

		// Reporter
		reporters: ['verbose'],

		// Pool options
		pool: 'threads',
		poolOptions: {
			threads: {
				singleThread: false
			}
		},

		// Benchmark configuration
		benchmark: {
			include: ['tests/benchmarks/**/*.bench.ts'],
			reporters: ['verbose'],
			outputFile: './benchmark-results.json'
		}
	}
});
