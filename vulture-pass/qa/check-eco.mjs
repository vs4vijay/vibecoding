// Tasks 5.3 / 6.2–6.5 / 7.1–7.2 verification: map sight gating, all four
// shop interfaces, upgrade tracks applying (reload shorter, victory heal,
// sight unlock), state coherence.

import { launchPage, spawnNpm, waitForPort, startFreshGame } from './lib/browser.mjs';

const PORT = 5199;
const dev = spawnNpm(['run', 'dev', '--', '--port', String(PORT), '--strictPort']);
dev.stdout.on('data', () => {});
dev.stderr.on('data', () => {});

let failures = [];
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures.push(name);
    console.error(`  FAIL: ${name} ${detail}`);
  }
}

async function pressE(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
  });
}

try {
  await waitForPort(PORT);
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1400);
  await startFreshGame(page);

  // ---------- 5.3 map sight: base level shows neither warnings nor prices
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.location = { kind: 'town', townId: 'polvo' };
    s.upgrades.sight = 0;
    window.__vp.showMap();
  });
  await page.waitForTimeout(300);
  // click Copper Wells node → no price table at sight 0
  await page.evaluate(() => window.__vp.showMap());
  await page.locator('.map-node', { hasText: 'Copper Wells' }).click();
  await page.waitForTimeout(250);
  const noPrices = await page.locator('.map-prices').count();
  check('sight 0: no distant prices', noPrices === 0);
  // plan trip → no warning line
  await page.locator('button', { hasText: 'Plan trip' }).click();
  await page.waitForTimeout(250);
  const noWarn = await page.locator('.map-warn').count();
  check('sight 0: no ambush warning', noWarn === 0);
  await page.locator('button', { hasText: 'Cancel' }).click();

  // sight 2: both appear
  await page.evaluate(() => {
    window.__vp.state.upgrades.sight = 2;
    window.__vp.showMap();
  });
  await page.waitForTimeout(250);
  await page.locator('.map-node', { hasText: 'Copper Wells' }).click();
  await page.waitForTimeout(250);
  check('sight 2: distant prices shown', (await page.locator('.map-prices').count()) === 1);
  await page.locator('button', { hasText: 'Plan trip' }).click();
  await page.waitForTimeout(250);
  check('sight 2: ambush warning shown', (await page.locator('.map-warn').count()) === 1);
  await page.evaluate(() => (window.__vp.state.upgrades.sight = 0));

  // ---------- 6.4 gun shop: buy + assign changes right mount
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.money = 3000;
    s.location = { kind: 'town', townId: 'polvo' };
    window.__vp.enterTown('polvo');
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const t = window.__vp.town;
    const h = t.hotspots.find((h) => h.kind === 'gun');
    t.player.x = h.x;
    t.player.z = h.z + 2;
  });
  await pressE(page);
  await page.waitForTimeout(300);
  check('gun shop opens', (await page.textContent('.shop-root .panel-title'))?.includes('Gun Shop'));
  // buy shotgun, then assign to right mount
  const shotRow = page.locator('tr', { hasText: 'Dust Devil' });
  await shotRow.locator('[data-buyw="shotgun"]').click();
  await page.waitForTimeout(200);
  await shotRow.locator('[data-mount="shotgun"][data-side="right"]').click();
  await page.waitForTimeout(250);
  const mountsNow = await page.evaluate(() => window.__vp.state.mounts);
  check('shotgun bought+assigned to right mount', mountsNow.right === 'shotgun', JSON.stringify(mountsNow));
  await page.click('#shop-close');

  // ---------- 6.3 garage: repair fee + insurance button + car purchase warn
  await page.evaluate(() => {
    const t = window.__vp.town;
    const h = t.hotspots.find((h) => h.kind === 'garage');
    t.player.x = h.x;
    t.player.z = h.z + 2;
    window.__vp.state.carHealth = 35; // half of Mule's 70
  });
  await pressE(page);
  await page.waitForTimeout(300);
  const feeShown = await page.textContent('#garage-repair');
  check('garage shows proportional repair fee', feeShown.includes('$'), feeShown);
  const money0 = await page.evaluate(() => window.__vp.state.money);
  await page.click('#garage-repair');
  await page.waitForTimeout(250);
  const repaired = await page.evaluate(() => ({ hp: window.__vp.state.carHealth, money: window.__vp.state.money }));
  check('repair restores hull + charges', repaired.hp === 70 && repaired.money < money0, JSON.stringify(repaired));
  await page.click('#garage-ins');
  await page.waitForTimeout(200);
  check('insurance purchasable at garage', await page.evaluate(() => window.__vp.state.insurance) === true);
  // car purchase with overflowing cargo → confirm-then-drop
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.cargo = { water: 8 }; // Mule holds 10, Sidewinder holds 5
  });
  const swBtn = page.locator('button[data-car="sidewinder"]');
  await swBtn.click();
  await page.waitForTimeout(200);
  check('overflow purchase asks first', (await swBtn.textContent()).includes('Lose cargo'));
  await swBtn.click();
  await page.waitForTimeout(250);
  const carSwap = await page.evaluate(() => {
    const s = window.__vp.state;
    return { car: s.carId, cargo: s.cargo, hp: s.carHealth };
  });
  check('car replaced, excess dropped', carSwap.car === 'sidewinder' && (carSwap.cargo.water ?? 0) === 5, JSON.stringify(carSwap));
  await page.click('#shop-close');

  // ---------- 6.5 job board: take delivery + bounty
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.carId = 'mule';
    s.carHealth = 70;
    s.cargo = {};
    s.insurance = false;
    const t = window.__vp.town;
    const h = t.hotspots.find((h) => h.kind === 'jobs');
    t.player.x = h.x;
    t.player.z = h.z + 2;
  });
  await pressE(page);
  await page.waitForTimeout(300);
  check('job board opens', (await page.textContent('.shop-root .panel-title'))?.includes('Job Board'));
  const firstTake = page.locator('[data-take]').first();
  const boardCount = await page.locator('[data-take]').count();
  if (boardCount > 0) {
    await firstTake.click();
    await page.waitForTimeout(250);
    const jobs = await page.evaluate(() => window.__vp.state.jobs.active.length);
    check('job accepted onto the books', jobs === 1);
  } else {
    check('job board has offers', false, 'empty board');
  }
  await page.click('#shop-close');

  // ---------- 7.2 upgrade tracks apply
  const tracks = await page.evaluate(() => {
    const vp = window.__vp;
    const s = vp.state;
    return import('/src/game/state.js').then((m) => {
      // reload track shortens cycles
      const base = m.reloadTime(s, 'pistol');
      s.points = 2;
      const r1 = m.spendPoint(s, 'reload');
      const r2 = m.spendPoint(s, 'repair');
      const after = m.reloadTime(s, 'pistol');
      return { base, after, r1, r2, repairLv: s.upgrades.repair, ok: r1.ok && r2.ok };
    });
  });
  check('reload track shortens reload', tracks.ok && tracks.after < tracks.base * 0.9, JSON.stringify(tracks));

  // victory heal from repair track (1 point = 16% of max)
  const heal = await page.evaluate(() => {
    const s = window.__vp.state;
    s.carHealth = 10;
    return import('/src/game/state.js').then((m) => {
      m.applyVictory(s, { xp: 5, heal: Math.round(0.16 * 1 * 70), kills: 1 });
      return s.carHealth;
    });
  });
  check('field repair heals after victory', heal === 10 + Math.round(0.16 * 70), `healed to ${heal}`);

  // ---------- 7.1 state coherence: debug dump reflects mutations
  await page.evaluate(() => window.__vp.showMap());
  await page.waitForTimeout(300);
  const coherent = await page.evaluate(() => {
    const s = window.__vp.state;
    return (
      typeof s.money === 'number' &&
      typeof s.day === 'number' &&
      s.location.kind === 'town' &&
      typeof s.carId === 'string' &&
      typeof s.insurance === 'boolean'
    );
  });
  check('GameState coherent after actions', coherent);

  check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 6)));
  await browser.close();
} finally {
  dev.killGroup();
}

if (failures.length) {
  console.error(`check-eco: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-eco: OK');
process.exit(failures.length ? 1 : 0);
