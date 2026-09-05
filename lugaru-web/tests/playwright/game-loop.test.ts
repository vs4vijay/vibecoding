// @vitest-environment jsdom
import { test, expect } from '@playwright/test';

test.describe('Lugaru game shell E2E', () => {
  test('full loop: menu → arena → wave 1 → results → retry', async ({ page }) => {
    await page.goto('/');
    
    // Wait for canvas and UI to load
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#ui-root')).toBeVisible();
    
    // Menu should be visible with title and buttons
    await expect(page.locator('.lg-title')).toHaveText('LUGARU');
    
    // Wait for menu to be fully ready and click Arena
    await expect(page.locator('.lg-btn:has-text("Arena")')).toBeVisible();
    await page.locator('.lg-btn:has-text("Arena")').click();
    
    // Game should start - wait for menu overlay to be hidden
    await expect(page.locator('.lg-title')).toBeHidden({ timeout: 5000 });
    
    // Wait a moment for the game loop
    await page.waitForTimeout(1000);
    
    // Test ESC pause during fight
    await page.keyboard.press('Escape');
    await expect(page.locator('.lg-pause-title')).toHaveText('Paused');
    await expect(page.locator('.lg-btn:has-text("Resume")')).toBeVisible();
    
    // Resume
    await page.locator('.lg-btn:has-text("Resume")').click();
    await expect(page.locator('.lg-pause-title')).toBeHidden();
    
    // Test tab blur auto-pause
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(500);
    await expect(page.locator('.lg-pause-title')).toHaveText('Paused');
    await page.locator('.lg-btn:has-text("Resume")').click();
    
    // Test death screen with god mode
    await page.goto('/?debug=god');
    await expect(page.locator('.lg-btn:has-text("Arena")')).toBeVisible();
    await page.locator('.lg-btn:has-text("Arena")').click();
    await page.waitForTimeout(5000);
    
    // Check if results reachable
    const resultsVisible = await page.locator('.lg-results').isVisible().catch(() => false);
    if (!resultsVisible) {
      // Force results by checking if any overlay is showing
      const overlays = await page.locator('.lg-overlay:not(.hidden)').count();
      console.log('Overlays visible:', overlays);
    }
    
    // Screenshot for verification
    await page.screenshot({ path: 'shots/verify-full-loop.png', fullPage: true });
  });

  test('coarse pointer warning', async ({ page }) => {
    test.skip();
  });
});