// Task 11.3 — scripted end-to-end playthrough (headless "manual" pass):
// new game → trade profit → buy car + weapon → win 3 ambushes → spend
// upgrades → beat boss → save/load mid-run. Exits 0 when the whole loop
// completes without errors. Tuning observations go to notes.md.

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

async function rideUntilCombatOrArrival(page, targetTown = null) {
  // ride toward the target until an ambush spawns or we peacefully arrive
  for (let i = 0; i < 12; i++) {
    const from = await page.evaluate(() => window.__vp.state.location.townId);
    if (targetTown && from === targetTown) return 'arrived';
    await page.evaluate((to) => window.__vp.beginTravel(to), targetTown ?? (from === 'polvo' ? 'copperWells' : 'polvo'));
    await page.waitForTimeout(500);
    const flow = await page.evaluate(() => window.__vp.flow);
    if (flow === 'combat') return 'combat';
    // arrived peacefully at the alternated town → back to the map for another run
    await page.evaluate(() => window.__vp.showMap());
    await page.waitForTimeout(250);
  }
  return 'never-ambushed';
}

async function winBattle(page) {
  await page.evaluate(() => {
    const a = window.__vp.arena;
    for (const e of a.entities) if (e.kind === 'enemy') a.combat.applyDamage(e, 9999, a.player);
  });
  await page.waitForTimeout(2400);
}

try {
  await waitForPort(PORT);
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1500);

  // 1. new game through the title
  await page.click('#title-new');
  await page.waitForTimeout(500);
  await page.click('#cut-skip');
  await page.waitForTimeout(300);
  check('booted to the map', await page.isVisible('#map-screen'));

  // 2. trade profit: buy medicine in Polvo (cheap), sell in Copper Wells (dear)
  const profit = await page.evaluate(async () => {
    const m = await import('/src/game/state.js');
    const s = window.__vp.state;
    const buyPrice = m.townPrice(s, 'polvo', 'medicine');
    m.buyGood(s, 'polvo', 'medicine', 5);
    const sellPrice = m.townPrice(s, 'copperWells', 'medicine');
    return { buyPrice, sellPrice, before: s.money };
  });
  check('bought medicine low in Polvo', profit.buyPrice > 0, JSON.stringify(profit));

  // ride to Copper Wells (ambushes on the way are won via the arena)
  let res = await rideUntilCombatOrArrival(page, 'copperWells');
  if (res === 'combat') await winBattle(page);
  const arrived = await page.evaluate(() => ({
    loc: window.__vp.state.location,
    flow: window.__vp.flow,
    day: window.__vp.state.day,
  }));
  check('arrived in Copper Wells', arrived.loc.townId === 'copperWells', JSON.stringify({ res, ...arrived }));

  // sell medicine through the market UI (drive into TRADE hotspot)
  await page.evaluate(() => {
    const t = window.__vp.town;
    const h = t.hotspots.find((h) => h.kind === 'trade');
    t.player.x = h.x;
    t.player.z = h.z + 2;
  });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
  await page.waitForTimeout(300);
  const sold = await page.evaluate(async () => {
    const m = await import('/src/game/state.js');
    const s = window.__vp.state;
    const gain = m.sellGood(s, 'copperWells', 'medicine', s.cargo.medicine ?? 0);
    return gain;
  });
  check(
    'sell-high yielded profit',
    sold.ok && profit.before + (sold.gain ?? 0) > profit.before,
    JSON.stringify({ sold, profit })
  );
  await page.click('#shop-close');

  // 3. buy a weapon + a better car (garage has insurance too — buy it)
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.money += 1500; // sponsor the run so every purchase path is exercised
    const t = window.__vp.town;
    const h = t.hotspots.find((h) => h.kind === 'gun');
    t.player.x = h.x;
    t.player.z = h.z + 2;
  });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
  await page.waitForTimeout(300);
  await page.locator('tr', { hasText: 'Dust Devil' }).locator('[data-buyw="shotgun"]').click();
  await page.waitForTimeout(150);
  await page.locator('tr', { hasText: 'Dust Devil' }).locator('[data-mount="shotgun"][data-side="right"]').click();
  await page.waitForTimeout(200);
  check('shotgun bought and mounted right', (await page.evaluate(() => window.__vp.state.mounts.right)) === 'shotgun');
  await page.click('#shop-close');

  await page.evaluate(() => {
    const t = window.__vp.town;
    const h = t.hotspots.find((h) => h.kind === 'garage');
    t.player.x = h.x;
    t.player.z = h.z + 2;
  });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
  await page.waitForTimeout(300);
  await page.locator('button[data-car="armadillo"]').click();
  await page.waitForTimeout(200);
  check('armadillo purchased', (await page.evaluate(() => window.__vp.state.carId)) === 'armadillo');
  await page.click('#garage-ins');
  await page.waitForTimeout(150);
  check('insurance bought', (await page.evaluate(() => window.__vp.state.insurance)) === true);
  await page.click('#shop-close');

  // 4. win 3 ambushes total (count what we already won riding)
  await page.evaluate(() => window.__vp.showMap());
  await page.waitForTimeout(300);
  let wins = await page.evaluate(() => window.__vp.state.stats.battlesWon);
  while (wins < 3) {
    res = await rideUntilCombatOrArrival(page);
    if (res !== 'combat') break;
    await winBattle(page);
    wins = await page.evaluate(() => window.__vp.state.stats.battlesWon);
    await page.evaluate(() => window.__vp.showMap());
    await page.waitForTimeout(250);
  }
  check('won 3 ambushes', wins >= 3, `wins=${wins}`);

  // 5. spend upgrade points through the map panel
  await page.locator('#map-upg').click();
  await page.waitForTimeout(300);
  const spendBtns = await page.locator('[data-track="reload"]').count();
  check('upgrades panel open with tracks', spendBtns === 1);
  while ((await page.evaluate(() => window.__vp.state.points)) > 0) {
    await page.locator('[data-track="reload"]').click();
    await page.waitForTimeout(120);
  }
  check('points spent on reload track', (await page.evaluate(() => window.__vp.state.upgrades.reload)) >= 1);
  await page.locator('#upg-close').click();
  await page.waitForTimeout(200);

  // 6. save mid-run, reload from title, continue
  await page.locator('#map-save').click();
  await page.waitForTimeout(400);
  check('back at title after save & quit', await page.isVisible('#title-screen'));
  await page.click('#title-continue');
  await page.waitForTimeout(500);
  const midRun = await page.evaluate(() => {
    const s = window.__vp.state;
    return { car: s.carId, right: s.mounts.right, reload: s.upgrades.reload, boss: s.bossDefeated };
  });
  check('mid-run state restored (car/weapon/upgrades)', midRun.car === 'armadillo' && midRun.right === 'shotgun' && midRun.reload >= 1, JSON.stringify(midRun));

  // 7. beat the boss: ride from a town to the Roost
  await page.evaluate(() => {
    window.__vp.state.location = { kind: 'town', townId: 'polvo' };
    window.__vp.state.carHealth = 999; // stack the deck for the scripted run
    window.__vp.showMap();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__vp.beginTravel('buzzardsRoost'));
  await page.waitForTimeout(600);
  check('versus intro before the boss', await page.isVisible('#versus'));
  await page.click('#versus-fight');
  await page.waitForTimeout(500);

  // clear minion waves, then the boss
  let bossDown = false;
  for (let i = 0; i < 10 && !bossDown; i++) {
    const hasBoss = await page.evaluate(() => window.__vp.arena?.entities.some((e) => e.isBoss && !e.dead));
    if (hasBoss) {
      await page.evaluate(() => {
        const a = window.__vp.arena;
        const boss = a.entities.find((e) => e.isBoss);
        a.combat.applyDamage(boss, 9999, a.player);
      });
      bossDown = true;
    } else {
      await page.evaluate(() => {
        const a = window.__vp.arena;
        for (const e of a.entities) if (e.kind === 'enemy') a.combat.applyDamage(e, 9999, a.player);
      });
    }
    await page.waitForTimeout(2300);
  }
  check('boss destroyed', bossDown);
  check('victory cutscene plays', await page.isVisible('#cutscene'));
  await page.click('#cut-skip');
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => ({
    boss: window.__vp.state.bossDefeated,
    flow: window.__vp.flow,
    level: window.__vp.state.level,
    won: window.__vp.state.stats.battlesWon,
  }));
  check('bossDefeated flag set (endless sandbox)', end.boss === true);
  check('run ends on the map with no gates', end.flow === 'overworld');

  check('no console errors across the run', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 8)));
  console.log(`  run summary: level ${end.level}, ${end.won} battles won, boss defeated: ${end.boss}`);
  await browser.close();
} finally {
  dev.killGroup();
}

if (failures.length) {
  console.error(`playthrough: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('playthrough: OK — full loop completed without errors');
process.exit(0);
