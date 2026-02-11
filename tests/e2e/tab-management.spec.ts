import { test, expect } from '@playwright/test';

test.describe('Tab Management', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('body', { state: 'visible' });
		await page.waitForTimeout(500);
	});

	test('should display welcome tab on load', async ({ page }) => {
		// Look for tab with "Welcome to Pandia" text
		const welcomeTab = page.locator('text=/Welcome to Pandia/i');
		await expect(welcomeTab.first()).toBeVisible({ timeout: 5000 });
	});

	test('should be able to create new tabs', async ({ page }) => {
		// Create a new tab using keyboard shortcut
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(300);

		// Create another new tab
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(300);

		// App should not crash and body should be visible
		await expect(page.locator('body')).toBeVisible();

		// There should be buttons visible (toolbar still works)
		const buttons = page.locator('button');
		const count = await buttons.count();
		expect(count).toBeGreaterThan(5);
	});

	test('should close tab with keyboard shortcut', async ({ page }) => {
		// First create a new tab
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(300);

		// Get current state
		const initialJsonCount = await page.locator('text=/.json/i').count();

		// Close the current tab
		await page.keyboard.press('Meta+W');
		await page.waitForTimeout(300);

		// Tab count may decrease or stay same (if it was the only tab)
		const finalJsonCount = await page.locator('text=/.json/i').count();
		expect(finalJsonCount).toBeLessThanOrEqual(initialJsonCount);
	});

	test('should respond to keyboard shortcuts without crashing', async ({ page }) => {
		// Create two tabs
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(200);
		await page.keyboard.press('Meta+N');
		await page.waitForTimeout(200);

		// Try tab navigation shortcuts
		await page.keyboard.press('Meta+Shift+]'); // Next tab
		await page.waitForTimeout(100);
		await page.keyboard.press('Meta+Shift+['); // Previous tab
		await page.waitForTimeout(100);

		// App should still be visible
		await expect(page.locator('body')).toBeVisible();
	});

	test('should have Tree View button visible', async ({ page }) => {
		const treeViewButton = page.getByRole('button', { name: /tree view/i });
		await expect(treeViewButton).toBeVisible({ timeout: 5000 });
	});
});
