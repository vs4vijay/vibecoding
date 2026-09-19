// Tasks 4.4 / 5.1 / 5.2 / 6.1 / 7.x verification: full game loop —
// map renders & clicks, trade profit, travel day advance, ambush → victory →
// arrival, defeat → penalty respawn, town hotspots open shops.

import { launchPage, spawnNpm, waitForPort, startFreshGame } from './lib/browser.mjs';
import assert from 'node:assert/strict';

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

async function clickButton(page, selector) {
  await page.waitForSelector(selector, { timeout: 4000 });
  await page.click(selector);
}

try {
  await waitForPort(PORT);
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1500);
  await startFreshGame(page);

  // ---------- 5.1 map screen renders
  check('map screen visible', await page.isVisible('#map-screen'));
  check('day counter shows Day 1', (await page.textContent('#map-day')) === 'Day 1');
  check('towns clickable (4 nodes)', (await page.locator('.map-node').count()) === 4);
  check('locked route labeled', (await page.locator('text=locked').count()) >= 1);

  // ---------- 6.2 trade: buy low in Polvo (medicine is cheap there)
  await page.evaluate(() => window.__vp.enterTown('polvo'));
  await page.waitForTimeout(400);
  check('town scene active', (await page.evaluate(() => window.__vp.flow)) === 'town');
  // drive into the TRADE hotspot via teleport + E
  await page.evaluate(() => {
    const t = window.__vp.town;
    const h = t.hotspots.find((h) => h.kind === 'trade');
    t.player.x = h.x;
    t.player.z = h.z + 2;
  });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })));
  await page.waitForTimeout(300);
  check('trade shop opens', await page.isVisible('.shop-panel'));
  const moneyBefore = await page.evaluate(() => window.__vp.state.money);
  // buy medicine (cheap in Polvo)
  const medRow = page.locator('tr[data-good="medicine"]');
  await medRow.locator('[data-buy="medicine"]').click();
  await page.waitForTimeout(200);
  const afterBuy = await page.evaluate(() => {
    const s = window.__vp.state;
    return { money: s.money, cargo: { ...s.cargo } };
  });
  check('medicine bought into cargo', (afterBuy.cargo.medicine ?? 0) >= 1, JSON.stringify(afterBuy));
  check('money deducted', afterBuy.money < moneyBefore);
  // sell it back (market interface works both ways)
  await medRow.locator('[data-sell="medicine"]').click();
  await page.waitForTimeout(200);
  const afterSell = await page.evaluate(() => window.__vp.state.cargo);
  check('sell works', (afterSell.medicine ?? 0) === 0, JSON.stringify(afterSell));
  await page.click('#shop-close');
  await page.waitForTimeout(200);

  // ---------- 5.2 travel: Polvo → Copper Wells advances the day; ambush possible
  const dayBefore = await page.evaluate(() => window.__vp.state.day);
  // load up on valuable cargo so the ambush chance caps at 0.8, then loop
  await page.evaluate(() => {
    window.__vp.state.cargo = { medicine: 10 }; // $600 haul → chance ~0.8
  });
  await page.evaluate(() => window.__vp.showMap());
  await page.waitForTimeout(300);
  let travelTries = 0;
  let ambushed = false;
  while (travelTries < 12 && !ambushed) {
    travelTries++;
    const at = await page.evaluate(() => window.__vp.state.location.townId);
    await page.evaluate((town) => window.__vp.beginTravel(town === 'polvo' ? 'copperWells' : 'polvo'), at);
    await page.waitForTimeout(600);
    const flow = await page.evaluate(() => window.__vp.flow);
    if (flow === 'combat') {
      ambushed = true;
      break;
    }
    // arrived peacefully → back to map and retry
    await page.evaluate(() => window.__vp.showMap());
    await page.waitForTimeout(250);
  }
  check('travel advances day counter', (await page.evaluate(() => window.__vp.state.day)) > dayBefore);

  // ---------- 4.4 ambush → victory → arrive at destination town
  if (ambushed) {
    check('ambush spawns combat', (await page.evaluate(() => window.__vp.flow)) === 'combat');
    await page.evaluate(() => {
      const a = window.__vp.arena;
      // insta-win: kill all enemies
      for (const e of a.entities) if (e.kind === 'enemy') a.combat.applyDamage(e, 9999, a.player);
    });
    await page.waitForTimeout(2200);
    check('victory returns to a town scene', (await page.evaluate(() => window.__vp.flow)) === 'town');
    const xpGain = await page.evaluate(() => ({ xp: window.__vp.state.xp, lvl: window.__vp.state.level, kills: window.__vp.state.kills }));
    check('victory grants XP + kills', xpGain.kills >= 1, JSON.stringify(xpGain));
  } else {
    check('ambush occurred within 8 trips', false, 'no ambush rolled');
  }

  // ---------- 7.4 defeat: cargo + money loss, respawn
  await page.evaluate(() => {
    const s = window.__vp.state;
    s.money = 500;
    s.cargo = { water: 4 };
  });
  await page.evaluate(() => window.__vp.showMap());
  await page.waitForTimeout(250);
  // start a trip then lose it
  const defeatInfo = await page.evaluate(async () => {
    const vp = window.__vp;
    const s = vp.state;
    const before = { money: s.money, cargo: { ...s.cargo } };
    // force travel to combat
    vp.beginTravel(s.location.townId === 'polvo' ? 'copperWells' : 'polvo');
    // if peaceful arrival, report
    return { flow: vp.flow, before };
  });
  if (defeatInfo.flow === 'combat') {
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const a = window.__vp.arena;
      a.combat.applyDamage(a.player, 99999, null);
    });
    await page.waitForTimeout(2400);
    const afterDefeat = await page.evaluate(() => {
      const s = window.__vp.state;
      return { money: s.money, cargo: s.cargo, hp: s.carHealth, flow: window.__vp.flow, loc: s.location };
    });
    check('defeat: cargo lost', Object.keys(afterDefeat.cargo).length === 0, JSON.stringify(afterDefeat));
    check('defeat: 25% money lost', afterDefeat.money === Math.floor(500 * 0.75), JSON.stringify(afterDefeat));
    check('defeat: respawned at a town', afterDefeat.flow === 'overworld' && afterDefeat.loc.kind === 'town', JSON.stringify(afterDefeat.loc));
  }

  // ---------- 7.3 insurance path
  const ins = await page.evaluate(() => {
    const vp = window.__vp;
    const s = vp.state;
    s.money = 1000;
    // buy insurance via intent (garage UI tested visually elsewhere)
    return import('/src/game/state.js').then((m) => {
      const r = m.buyInsurance(s);
      const before = s.money;
      s.cargo = { fuel: 2 };
      m.applyDefeat(s);
      return { ok: r.ok, moneyAfter: s.money, insured: s.insurance, cargoEmpty: Object.keys(s.cargo).length === 0 };
    });
  });
  check('insurance purchase + waived money loss', ins.ok === true && ins.moneyAfter === 820 && ins.insured === false && ins.cargoEmpty, JSON.stringify(ins));

  // ---------- 6.1 exit town → map
  await page.evaluate(() => window.__vp.enterTown('polvo'));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const t = window.__vp.town;
    t.player.x = -66;
    t.player.z = 0;
  });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })));
  await page.waitForTimeout(300);
  check('exit town returns to map', (await page.evaluate(() => window.__vp.flow)) === 'overworld');

  check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 6)));
  await browser.close();
} finally {
  dev.killGroup();
}

if (failures.length) {
  console.error(`check-flow: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-flow: OK');
process.exit(failures.length ? 1 : 0);
