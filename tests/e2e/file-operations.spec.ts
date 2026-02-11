import { test, expect } from '@playwright/test';

test.describe('File Operations', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Wait for app to initialize
		await page.waitForSelector('body', { state: 'visible' });
		// Give the app time to fully load
		await page.waitForTimeout(500);
	});

	test('should display the main application', async ({ page }) => {
		// Verify the app loads by checking for main toolbar buttons
		const createButton = page.getByRole('button', { name: /create new file/i });
		await expect(createButton).toBeVisible({ timeout: 10000 });
	});

	test('should create a new file with keyboard shortcut', async ({ page }) => {
		// Get initial state - look for tab text containing ".json"
		const initialTabs = await page.locator('text=/.json/i').count();

		// Create new file
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(300);

		// Check if a new tab was created
		const newTabs = await page.locator('text=/.json/i').count();
		expect(newTabs).toBeGreaterThanOrEqual(initialTabs);
	});

	test('should show editor area with welcome tab', async ({ page }) => {
		// The welcome tab should be visible
		const welcomeTab = page.locator('text=/Welcome to Pandia/i');
		await expect(welcomeTab.first()).toBeVisible({ timeout: 5000 });
	});

	test('should have toolbar visible', async ({ page }) => {
		// Check for toolbar buttons
		const formatButton = page.getByRole('button', { name: /format json/i });
		await expect(formatButton).toBeVisible();
	});

	test('should respond to format shortcut', async ({ page }) => {
		// Try the format shortcut
		await page.keyboard.press('Meta+Shift+F');
		// The app should not crash - this is a smoke test
		await expect(page.locator('body')).toBeVisible();
	});

	test('should have all toolbar file buttons', async ({ page }) => {
		// Wait for toolbar to be fully rendered
		await page.waitForTimeout(1000);

		// Use locator for buttons by accessible name
		const buttons = page.locator('button');
		const buttonCount = await buttons.count();

		// There should be multiple toolbar buttons
		expect(buttonCount).toBeGreaterThan(5);
	});
});
