import { test, expect } from '@playwright/test';

test.describe('GlobalWatch - Home Page', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('GlobalWatch');
  });

  test('should display the globe container', async ({ page }) => {
    await page.goto('/');
    // Wait for the globe container to be visible
    const globeContainer = page.locator('.cesium-viewer');
    await expect(globeContainer).toBeVisible({ timeout: 30000 });
  });

  test('should display visual mode selector', async ({ page }) => {
    await page.goto('/');
    // Check for visual mode buttons
    const standardButton = page.getByRole('button', { name: /standard/i });
    await expect(standardButton).toBeVisible();
    
    const nvgButton = page.getByRole('button', { name: /nvg|night/i });
    await expect(nvgButton).toBeVisible();
    
    const flirButton = page.getByRole('button', { name: /flir|thermal/i });
    await expect(flirButton).toBeVisible();
  });
});

test.describe('GlobalWatch - Visual Modes', () => {
  test('should switch to NVG mode', async ({ page }) => {
    await page.goto('/');
    
    // Wait for globe to load
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
    
    // Click NVG button
    const nvgButton = page.getByRole('button', { name: /nvg|night/i });
    await nvgButton.click();
    
    // Verify button is in active state (if we add active state styling)
    await expect(nvgButton).toHaveAttribute('data-active', 'true');
  });

  test('should switch to FLIR mode', async ({ page }) => {
    await page.goto('/');
    
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
    
    const flirButton = page.getByRole('button', { name: /flir|thermal/i });
    await flirButton.click();
    
    await expect(flirButton).toHaveAttribute('data-active', 'true');
  });

  test('should switch to CRT mode', async ({ page }) => {
    await page.goto('/');
    
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
    
    const crtButton = page.getByRole('button', { name: /crt|scanline/i });
    await crtButton.click();
    
    await expect(crtButton).toHaveAttribute('data-active', 'true');
  });

  test('should switch to Anime mode', async ({ page }) => {
    await page.goto('/');
    
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
    
    const animeButton = page.getByRole('button', { name: /anime|cel/i });
    await animeButton.click();
    
    await expect(animeButton).toHaveAttribute('data-active', 'true');
  });
});

test.describe('GlobalWatch - 3D Globe', () => {
  test('should render the Cesium globe', async ({ page }) => {
    await page.goto('/');
    
    // Wait for Cesium viewer to initialize
    const cesiumViewer = page.locator('.cesium-viewer');
    await expect(cesiumViewer).toBeVisible({ timeout: 30000 });
    
    // Check that the globe canvas exists
    const canvas = page.locator('.cesium-viewer canvas');
    await expect(canvas).toBeVisible();
  });

  test('should have zoom controls', async ({ page }) => {
    await page.goto('/');
    
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
    
    // Check for Cesium navigation controls
    const navigationHelp = page.locator('.cesium-navigation-help');
    // Navigation might not be visible by default, check for zoom buttons
    const zoomControls = page.locator('.cesium-button');
    await expect(zoomControls.first()).toBeVisible();
  });
});
