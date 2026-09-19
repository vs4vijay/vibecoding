import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

export const CHROME_PATH =
  '/Users/vijay/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

export async function launchPage(url, { timeout = 20000 } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  await page.goto(url, { timeout, waitUntil: 'load' });
  return { browser, page, consoleErrors };
}

export function spawnNpm(scriptArgs, cwd = process.cwd()) {
  // detached + negative-pid kill: npm spawns vite as a grandchild, and
  // SIGTERM to npm alone orphans vite (which then squats on the port and
  // holds our stdio pipe open, hanging the test process).
  const proc = spawn('npm', scriptArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  proc.killGroup = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill('SIGTERM');
    }
  };
  return proc;
}

export async function waitForPort(port, { timeout = 30000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok || res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`port ${port} never became ready`);
}

// From a freshly booted page: get through title (new game) + opening
// cutscene so tests land on the overworld map.
export async function startFreshGame(page) {
  await page.waitForTimeout(1000);
  if (await page.locator('#title-screen').count()) {
    await page.locator('#title-new').click();
    if (await page.locator('#title-yes').count()) {
      await page.locator('#title-yes').click();
    }
    await page.waitForTimeout(600);
    if (await page.locator('#cut-skip').count()) {
      await page.locator('#cut-skip').click();
    }
  }
  await page.waitForTimeout(300);
}
