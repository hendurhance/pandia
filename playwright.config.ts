import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',

	// Run tests in parallel
	fullyParallel: true,

	// Fail the build on CI if you accidentally left test.only
	forbidOnly: !!process.env.CI,

	// Retry on CI only
	retries: process.env.CI ? 2 : 0,

	// Number of parallel workers
	workers: process.env.CI ? 1 : undefined,

	// Reporter
	reporter: [
		['html', { outputFolder: 'playwright-report' }],
		['json', { outputFile: 'test-results/results.json' }],
		['list']
	],

	// Timeout settings
	timeout: 60000,
	expect: {
		timeout: 10000
	},

	// Shared settings for all projects
	use: {
		// Base URL for the Tauri app (dev server)
		baseURL: 'http://localhost:1420',

		// Collect trace on failure
		trace: 'on-first-retry',

		// Screenshot on failure
		screenshot: 'only-on-failure',

		// Video on failure
		video: 'on-first-retry'
	},

	// Projects for different browsers/platforms
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] }
		}
	],

	// Web server for development mode testing
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:1420',
		reuseExistingServer: !process.env.CI,
		timeout: 120000
	},

	// Output directory
	outputDir: 'test-results'
});
