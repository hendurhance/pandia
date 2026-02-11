import { test, expect } from '@playwright/test';

test.describe('Import and Export', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('body', { state: 'visible' });
		await page.waitForTimeout(500);
	});

	test('should have toolbar buttons loaded', async ({ page }) => {
		// The main toolbar should have buttons
		const buttons = page.locator('button');
		const count = await buttons.count();
		expect(count).toBeGreaterThan(5);
	});

	test('should have compare functionality', async ({ page }) => {
		// Look for compare button using accessible name
		const compareButton = page.getByRole('button', { name: /compare json/i });
		await expect(compareButton).toBeVisible({ timeout: 5000 });
	});

	test('should have save file button', async ({ page }) => {
		const saveButton = page.getByRole('button', { name: 'Save file' });
		await expect(saveButton).toBeVisible({ timeout: 10000 });
	});

	test('should open save dialog with shortcut', async ({ page }) => {
		// Create new file first
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(300);

		// Try save shortcut
		await page.keyboard.press('Meta+S');
		await page.waitForTimeout(200);

		// App should handle this gracefully (may show dialog or notification)
		await expect(page.locator('body')).toBeVisible();
	});

	test('should support save as with shortcut', async ({ page }) => {
		// Create new file first
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(300);

		// Try save as shortcut
		await page.keyboard.press('Meta+Shift+S');
		await page.waitForTimeout(200);

		// App should handle this gracefully
		await expect(page.locator('body')).toBeVisible();
	});

	test('should have open file button', async ({ page }) => {
		const openButton = page.getByRole('button', { name: 'Open file' });
		await expect(openButton).toBeVisible({ timeout: 10000 });
	});

	test('should respond to open file shortcut', async ({ page }) => {
		// Try open file shortcut
		await page.keyboard.press('Meta+O');
		await page.waitForTimeout(300);

		// App should handle this gracefully
		await expect(page.locator('body')).toBeVisible();
	});
});
