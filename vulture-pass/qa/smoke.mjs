// Task 11.2 — smoke test: boots `vite preview` (built dist), starts a new
// game, enters one combat, returns to a town, saves. Exits 0 on success.
// Run: npm run build && npm run qa   (build is run first by the script)

import { spawn } from 'node:child_process';
import { launchPage, waitForPort } from './lib/browser.mjs';

const PORT = 4173;

function run(cmd, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${cmd} timed out`));
    }, timeout);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out.slice(-1500)}`));
    });
  });
}

console.log('qa: building…');
await run('npx', ['vite', 'build']);
console.log('qa: build OK');

console.log('qa: starting vite preview…');
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
preview.stderr.on('data', () => {});

let failures = [];
try {
  await waitForPort(PORT, { timeout: 30000 });

  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1500);

  // 1. title → new game → opening cutscene → skip → map
  if (await page.locator('#title-screen').count()) {
    await page.click('#title-new');
    if (await page.locator('#title-yes').count()) await page.click('#title-yes');
    await page.waitForTimeout(500);
    if (await page.locator('#cut-skip').count()) await page.click('#cut-skip');
    await page.waitForTimeout(300);
  }
  if (!(await page.isVisible('#map-screen'))) failures.push('map did not appear after new game');

  // 2. enter one combat (loop trips until ambush; high cargo to force odds)
  await page.evaluate(() => {
    window.__vp.state.cargo = { medicine: 10 };
  });
  let fought = false;
  for (let i = 0; i < 12 && !fought; i++) {
    await page.evaluate(() => window.__vp.beginTravel(window.__vp.state.location.townId === 'polvo' ? 'copperWells' : 'polvo'));
    await page.waitForTimeout(500);
    fought = (await page.evaluate(() => window.__vp.flow)) === 'combat';
    if (!fought) {
      await page.evaluate(() => window.__vp.showMap());
      await page.waitForTimeout(200);
    }
  }
  if (!fought) failures.push('no ambush in 12 trips');
  else {
    // win it: kill everyone
    await page.evaluate(() => {
      const a = window.__vp.arena;
      for (const e of a.entities) if (e.kind === 'enemy') a.combat.applyDamage(e, 9999, a.player);
    });
    await page.waitForTimeout(2600);
    if ((await page.evaluate(() => window.__vp.flow)) !== 'town') failures.push('victory did not arrive at town');
  }

  // 3. back to map, save & quit (writes localStorage)
  await page.evaluate(() => window.__vp.showMap());
  await page.waitForTimeout(300);
  await page.locator('#map-save').click();
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => !!localStorage.getItem('vulture-pass-save-v1'));
  if (!saved) failures.push('no save written');
  if (!(await page.isVisible('#title-screen'))) failures.push('save & quit did not reach title');

  if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.slice(0, 4).join(' | ')}`);
  await browser.close();
} finally {
  preview.kill('SIGTERM');
}

if (failures.length) {
  console.error(`qa: FAILED — ${failures.join('; ')}`);
  process.exit(1);
}
console.log('qa: OK — new game → combat → town → save, no console errors');
process.exit(0);
