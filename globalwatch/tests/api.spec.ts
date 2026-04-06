import { test, expect } from '@playwright/test';

// Mock API responses for testing without external dependencies
test.describe('GlobalWatch - API Data', () => {
  test.beforeEach(async ({ page }) => {
    // Mock OpenSky API
    await page.route('**/opensky-network.org/api/states/all*', async route => {
      const json = {
        time: Date.now(),
        states: [
          ['abc123', 'FLIGHT1', 'UK', [Date.now() / 1000, 0.1278, 51.5074, 300, false, [280, 200, 0, null]],
          ['def456', 'FLIGHT2', 'US', [Date.now() / 1000, -0.1278, 51.6074, 350, false, [300, 220, 0, null]],
        ]
      };
      await route.fulfill({ json });
    });

    // Mock CelesTrak API
    await page.route('**/celestrak.org/NORAD/elements/gp.php*', async route => {
      const tleData = `ISS (ZARYA)
1 25544U 98067A   24123.12345678  .00012345  00000-0  12345-3 0  9993
2 25544  51.6400 150.0000 0005000 200.0000 100.0000 15.50000000437012`;
      await route.fulfill({ body: tleData });
    });
  });

  test('should fetch aircraft data on load', async ({ page }) => {
    await page.goto('/');
    
    // Wait for globe to load
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
    
    // Check that aircraft data was requested
    const openSkyRequest = page.waitForRequest(req => 
      req.url().includes('opensky-network.org')
    );
    await openSkyRequest;
  });

  test('should fetch satellite data on load', async ({ page }) => {
    await page.goto('/');
    
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
    
    // Check that satellite data was requested
    const celestrakRequest = page.waitForRequest(req => 
      req.url().includes('celestrak.org')
    );
    await celestrakRequest;
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Override mock to return error
    await page.route('**/opensky-network.org/api/states/all*', async route => {
      await route.fulfill({ status: 500, body: 'Server Error' });
    });

    await page.goto('/');
    
    // Page should still load even if API fails
    await expect(page.locator('h1')).toContainText('GlobalWatch');
    await page.locator('.cesium-viewer').waitFor({ timeout: 30000 });
  });
});
