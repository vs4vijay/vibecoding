import { launchPage, spawnNpm, waitForPort } from './lib/browser.mjs';

const PORT = 5199;

const dev = spawnNpm(['run', 'dev', '--', '--port', String(PORT), '--strictPort']);
dev.stdout.on('data', () => {});
dev.stderr.on('data', () => {});

let failures = 0;
try {
  await waitForPort(PORT);
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(2500);
  const titleOk = await page.locator('#title-screen').count();
  if (!titleOk) {
    failures++;
    console.error('FAIL: title screen not found');
  }
  if (consoleErrors.length) {
    failures++;
    console.error('FAIL: console errors:', consoleErrors);
  }
  await browser.close();
} finally {
  dev.kill('SIGTERM');
}

if (failures) {
  console.error(`check-dev: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check-dev: OK — page served, title renders, no console errors');
