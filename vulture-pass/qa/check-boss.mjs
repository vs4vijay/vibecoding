// Tasks 8.1–8.3 verification: cutscene advance + skip, versus intro, boss
// wave ladder + phase change at 50%, victory → cutscene → routes unlock.

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
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1600);

  // ---------- 9.2 title screen + 8.1/8.2 opening cutscene
  await page.waitForTimeout(600);
  check('title screen on boot', await page.isVisible('#title-screen'));
  // fresh storage: no save → no Continue button, New Game starts directly
  check('no save: new game starts without confirm', (await page.locator('#title-continue').count()) === 0);
  await page.click('#title-new');
  await page.waitForTimeout(600);

  // ---------- opening cutscene after new game
  check('opening cutscene active after new game', await page.isVisible('#cutscene'));
  const caption1 = await page.textContent('#cut-caption');
  check('panel 1 caption types in', caption1.includes('Cholla Basin'), caption1);
  // advance through panels one by one
  const panelCount = await page.evaluate(async () => {
    const { cutscenes } = await import('/src/game/data/content.js');
    return cutscenes.opening.panels.length;
  });
  for (let i = 1; i < panelCount; i++) {
    await page.click('#cutscene', { position: { x: 400, y: 400 } });
    await page.waitForTimeout(1400); // let the caption finish typing
  }
  const captionLast = await page.textContent('#cut-caption');
  check('panels advance to last', captionLast.includes('Buzzard'), captionLast);
  // skip jumps to the end → map
  await page.click('#cut-skip');
  await page.waitForTimeout(400);
  check('skip ends cutscene → map', (await page.evaluate(() => window.__vp.flow)) === 'overworld');

  // ---------- 8.3 versus intro + boss ladder
  await page.evaluate(() => window.__vp.startBossBattle());
  await page.waitForTimeout(500);
  check('versus intro shows', await page.isVisible('#versus'));
  check('versus names the Buzzard', (await page.textContent('#versus')).includes('The Buzzard'));
  await page.click('#versus-fight');
  await page.waitForTimeout(400);
  check('fight begins after versus', (await page.evaluate(() => window.__vp.flow)) === 'combat');

  // phase change: clear minion waves until the boss himself spawns
  let bossSpawned = false;
  for (let i = 0; i < 6 && !bossSpawned; i++) {
    await page.evaluate(() => {
      const a = window.__vp.arena;
      for (const e of a.entities) if (e.kind === 'enemy' && !e.isBoss) a.combat.applyDamage(e, 9999, a.player);
    });
    await page.waitForTimeout(2200); // wave delay 1.6s + margin
    bossSpawned = await page.evaluate(() => window.__vp.arena.entities.some((e) => e.isBoss));
  }
  check('boss car spawns after minion waves', bossSpawned);
  await page.waitForTimeout(300);
  const phase1 = await page.evaluate(() => {
    const boss = window.__vp.arena.entities.find((e) => e.isBoss);
    return { speed: boss.drive.def.topSpeed, phase2: boss.phase2 };
  });
  check('boss at full health: phase 1 speed', phase1.speed === 33 && !phase1.phase2, JSON.stringify(phase1));
  await page.evaluate(() => {
    const a = window.__vp.arena;
    const boss = a.entities.find((e) => e.isBoss);
    a.combat.applyDamage(boss, boss.maxHealth * 0.55, a.player); // below 50%
  });
  await page.waitForTimeout(300);
  const phase2 = await page.evaluate(() => {
    const boss = window.__vp.arena.entities.find((e) => e.isBoss);
    return { speed: boss.drive.def.topSpeed, phase2: boss.phase2, hp: Math.round(boss.health) };
  });
  check('below 50%: phase 2 speed-up', phase2.phase2 === true && phase2.speed === 40, JSON.stringify(phase2));

  // kill boss → victory cutscene → unlock
  await page.evaluate(() => {
    const a = window.__vp.arena;
    const boss = a.entities.find((e) => e.isBoss);
    a.combat.applyDamage(boss, 9999, a.player);
  });
  await page.waitForTimeout(3000);
  check('victory cutscene plays', await page.isVisible('#cutscene'));
  const vcCaption = await page.textContent('#cut-caption');
  check('boss-victory beat authored', vcCaption.includes('Buzzard') || vcCaption.includes('Basin'), vcCaption);
  await page.click('#cut-skip');
  await page.waitForTimeout(400);
  check('back on the map after the beat', (await page.evaluate(() => window.__vp.flow)) === 'overworld');
  const unlocked = await page.evaluate(() => ({
    boss: window.__vp.state.bossDefeated,
  }));
  check('boss flag set', unlocked.boss === true);
  const noLockedLabels = await page.locator('text=(locked)').count();
  check('locked route labels gone after victory', noLockedLabels === 0);

  // no gates left: North Pass trip plans without block
  const passPlan = await page.evaluate(async () => {
    const { planTrip } = await import('/src/game/travel.js');
    const trip = planTrip(window.__vp.state, 'polvo'); // from wherever we are; use a town first
    window.__vp.state.location = { kind: 'town', townId: 'polvo' };
    const pass = planTrip(window.__vp.state, 'northPass');
    return { blocked: pass.blocked ?? false, days: pass.days };
  });
  check('North Pass plans freely after victory', passPlan.blocked === false && passPlan.days === 2, JSON.stringify(passPlan));

  check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 6)));
  await browser.close();
} finally {
  dev.killGroup();
}

if (failures.length) {
  console.error(`check-boss: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-boss: OK');
process.exit(failures.length ? 1 : 0);
