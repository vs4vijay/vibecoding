// Tasks 9.1/9.2 verification: versioned save triggers (town entry, battle
// outcome, explicit), reload restores full state, corrupt save → graceful
// new-game offer, overwrite confirmation.

import { launchPage, spawnNpm, waitForPort } from './lib/browser.mjs';

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

try {
  await waitForPort(PORT);
  let { browser, page } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1400);

  // new game, make a distinctive state, enter a town (save trigger)
  await page.click('#title-new');
  await page.waitForTimeout(500);
  await page.click('#cut-skip');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.money = 1234;
    s.day = 7;
    s.cargo = { scrap: 3 };
    s.upgrades.reload = 1;
    window.__vp.enterTown('copperWells');
  });
  await page.waitForTimeout(400);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vulture-pass-save-v1')));
  check('town entry wrote a versioned save', saved && saved.version === 1 && saved.money === 1234 && saved.day === 7, JSON.stringify(saved?.money));

  // battle outcome trigger: win a real travel ambush (victory → save)
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.location = { kind: 'town', townId: 'polvo' };
    s.cargo = { medicine: 10 }; // high ambush chance
    window.__vp.showMap();
  });
  await page.waitForTimeout(300);
  let inCombat = false;
  for (let i = 0; i < 12 && !inCombat; i++) {
    await page.evaluate(() => window.__vp.beginTravel(window.__vp.state.location.townId === 'polvo' ? 'copperWells' : 'polvo'));
    await page.waitForTimeout(500);
    inCombat = (await page.evaluate(() => window.__vp.flow)) === 'combat';
    if (!inCombat) {
      await page.evaluate(() => window.__vp.showMap());
      await page.waitForTimeout(200);
    }
  }
  check('travel ambush reached', inCombat);
  await page.evaluate(() => {
    const a = window.__vp.arena;
    for (const e of a.entities) if (e.kind === 'enemy') a.combat.applyDamage(e, 9999, a.player);
  });
  await page.waitForTimeout(2600);
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('vulture-pass-save-v1')));
  check('battle outcome updated the save', saved2 && saved2.stats.battlesWon >= 1, JSON.stringify(saved2?.stats));

  // explicit save & quit → title
  await page.evaluate(() => window.__vp.showMap());
  await page.waitForTimeout(300);
  await page.locator('#map-save').click();
  await page.waitForTimeout(400);
  check('save & quit returns to title', await page.isVisible('#title-screen'));
  check('continue offered when save exists', (await page.locator('#title-continue').count()) === 1);

  // new game over a save → confirm gate
  await page.click('#title-new');
  await page.waitForTimeout(300);
  check('overwrite confirmation appears', await page.isVisible('#title-yes'));
  await page.click('#title-no');
  await page.waitForTimeout(300);
  check('cancel keeps title (save untouched)', await page.isVisible('#title-screen'));
  await page.click('#title-continue');
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => {
    const s = window.__vp.state;
    return { money: s.money, day: s.day, cargo: s.cargo, upg: s.upgrades.reload, flow: window.__vp.flow };
  });
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem('vulture-pass-save-v1')));
  check(
    'continue restores latest money/day/cargo/upgrades',
    restored.money === latest.money && restored.day === latest.day && restored.cargo.medicine === latest.cargo.medicine && restored.upg === latest.upgrades.reload,
    JSON.stringify({ restored, latest })
  );
  check('continue lands on the map', restored.flow === 'overworld');

  // corrupt save → defensive load (fresh browser, same origin? new profile → instead write corrupt save first)
  await browser.close();

  // ---- second boot with a corrupt save planted before any page script runs
  const ctx2 = await launchPage('about:blank');
  page = ctx2.page;
  // plant corrupt payload on the target origin, then navigate
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' }).catch(() => {});
  await page.evaluate(() => localStorage.setItem('vulture-pass-save-v1', '{not json!'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  check('corrupt save: title still shows', await page.isVisible('#title-screen'));
  const corruptTitle = await page.evaluate(() => ({
    hasContinue: !!document.getElementById('title-continue'),
    hasActions: !!document.querySelector('.title-actions'),
  }));
  check('corrupt save: no continue offered (save ignored)', corruptTitle.hasContinue === false && corruptTitle.hasActions, JSON.stringify(corruptTitle));
  await page.click('#title-new');
  await page.waitForTimeout(400);
  if (await page.locator('#cut-skip').count()) await page.click('#cut-skip');
  const fresh = await page.evaluate(() => window.__vp.state.day);
  check('new game runs after corrupt save', fresh === 1, `day=${fresh}`);

  // unknown version → ignored too
  await page.evaluate(() => {
    localStorage.setItem(
      'vulture-pass-save-v1',
      JSON.stringify({ version: 99, money: 1, day: 1, location: { kind: 'town', townId: 'polvo' } })
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1400);
  check('unknown version: no continue offered', (await page.locator('#title-continue').count()) === 0);

  check('no console errors', ctx2.consoleErrors.length === 0, JSON.stringify(ctx2.consoleErrors.slice(0, 5)));
  await browser.close();
} finally {
  dev.killGroup();
}

if (failures.length) {
  console.error(`check-save: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-save: OK');
process.exit(failures.length ? 1 : 0);
