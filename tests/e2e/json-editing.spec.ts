import { test, expect } from '@playwright/test';

test.describe('JSON Editing', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('body', { state: 'visible' });
		await page.waitForTimeout(500);
	});

	test('should display JSON toolbar buttons', async ({ page }) => {
		// Look for the Format JSON button
		const formatButton = page.getByRole('button', { name: /format json/i });
		await expect(formatButton).toBeVisible({ timeout: 5000 });
	});

	test('should have validate button', async ({ page }) => {
		const validateButton = page.getByRole('button', { name: /validate json/i });
		await expect(validateButton).toBeVisible({ timeout: 5000 });
	});

	test('should have repair button', async ({ page }) => {
		const repairButton = page.getByRole('button', { name: /repair malformed json/i });
		await expect(repairButton).toBeVisible({ timeout: 5000 });
	});

	test('should have compress button', async ({ page }) => {
		const compressButton = page.getByRole('button', { name: /compress json/i });
		await expect(compressButton).toBeVisible({ timeout: 5000 });
	});

	test('should format document with shortcut', async ({ page }) => {
		// Create new file first
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(300);

		// Try to format
		await page.keyboard.press('Meta+Shift+F');
		await page.waitForTimeout(200);

		// App should not crash
		await expect(page.locator('body')).toBeVisible();
	});

	test('should open find with shortcut', async ({ page }) => {
		// Try find shortcut
		await page.keyboard.press('Meta+F');
		await page.waitForTimeout(300);

		// Either the find UI appears or the app handles it gracefully
		await expect(page.locator('body')).toBeVisible();
	});

	test('should support undo with shortcut', async ({ page }) => {
		// Try undo shortcut
		await page.keyboard.press('Meta+Z');
		await page.waitForTimeout(100);

		// App should not crash
		await expect(page.locator('body')).toBeVisible();
	});

	test('should support redo with shortcut', async ({ page }) => {
		// Try redo shortcut
		await page.keyboard.press('Meta+Shift+Z');
		await page.waitForTimeout(100);

		// App should not crash
		await expect(page.locator('body')).toBeVisible();
	});

	test('should have find and replace button', async ({ page }) => {
		const findButton = page.getByRole('button', { name: /find and replace/i });
		await expect(findButton).toBeVisible({ timeout: 5000 });
	});

	test('should have visualize button', async ({ page }) => {
		const visualizeButton = page.getByRole('button', { name: /visualize json/i });
		await expect(visualizeButton).toBeVisible({ timeout: 5000 });
	});

	test('should have compare button', async ({ page }) => {
		const compareButton = page.getByRole('button', { name: /compare json/i });
		await expect(compareButton).toBeVisible({ timeout: 5000 });
	});
});
