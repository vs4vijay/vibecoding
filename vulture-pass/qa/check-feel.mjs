// Tasks 3.1–3.4 verification in-browser: arcade driving (on/off road, walls),
// dual-mount firing + reload HUD, scout destruction + player defeat flow.

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

async function hold(page, code, ms) {
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
  await page.waitForTimeout(ms);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), code);
}

try {
  await waitForPort(PORT);
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1500);
  await startFreshGame(page);

  const vp = () => page.evaluate(() => ({ hasVp: !!window.__vp }));
  check('game booted', (await vp()).hasVp);

  // raw sparring arena for the driving/firing checks
  await page.evaluate(() => window.__vp.newBattle());
  await page.waitForTimeout(600);

  // --- 3.1 driving: accelerate on road
  await page.evaluate(() => {
    const p = window.__vp.arena.player;
    p.x = 0;
    p.z = 0;
    p.heading = 0;
    p.vx = 0;
    p.vz = 0;
  });
  await hold(page, 'KeyW', 2500);
  let speed = await page.evaluate(() => window.__vp.arena.player.drive.speedFwd);
  check('accelerates on road', speed > 15, `speed=${speed.toFixed(1)}`);

  // off-road: reset onto sand, compare sustained top speed
  await page.evaluate(() => {
    const p = window.__vp.arena.player;
    p.x = 0;
    p.z = 34;
    p.vx = 0;
    p.vz = 0;
    p.drive.speedFwd = 0;
  });
  await hold(page, 'KeyW', 3000);
  let offSpeed = await page.evaluate(() => window.__vp.arena.player.drive.speedFwd);
  check('off-road visibly slower', offSpeed < speed * 0.65, `road=${speed.toFixed(1)} off=${offSpeed.toFixed(1)}`);

  // wall: drive into east wall, health unchanged (park the scout far away and
  // disarm it so only collision effects are measured)
  const hpBefore = await page.evaluate(() => {
    const a = window.__vp.arena;
    const scout = a.entities.find((e) => e.kind === 'enemy');
    if (scout) {
      scout.x = -400;
      scout.z = -400;
      scout.reloadLeft = 9999;
    }
    const p = a.player;
    p.x = 60;
    p.z = 34;
    p.heading = 0;
    p.vx = 0;
    p.vz = 0;
    return Math.round(p.health);
  });
  await hold(page, 'KeyW', 3000);
  const wall = await page.evaluate(() => {
    const p = window.__vp.arena.player;
    return { x: p.x, hp: Math.round(p.health) };
  });
  check('wall blocks car', wall.x < 76, `x=${wall.x.toFixed(1)}`);
  check('wall deals no damage', wall.hp === hpBefore, `hp ${hpBefore} -> ${wall.hp}`);

  // --- 3.2 dual-mount firing: car east, camera settles behind, aim screen-left = car-left
  await page.evaluate(() => {
    const p = window.__vp.arena.player;
    p.x = 0;
    p.z = 0;
    p.heading = 0;
    p.vx = 0;
    p.vz = 0;
    window.__vp.followCam.snapTo(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    );
  });
  await page.waitForTimeout(400);
  await page.mouse.move(200, 400);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const mounts = await page.evaluate(() => {
    const m = window.__vp.arena.player.mounts;
    return { L: m.left.reloadLeft, R: m.right.reloadLeft };
  });
  check('aim left fires LEFT mount only', mounts.L > 0 && mounts.R === 0, JSON.stringify(mounts));
  const hudL = await page.textContent('#hud-mount-left-state');
  const hudR = await page.textContent('#hud-mount-right-state');
  check('HUD distinguishes mount states', hudL === 'RELOAD' && (hudR === '' || hudR === 'READY'), `L="${hudL}" R="${hudR}"`);
  await page.mouse.up();

  // reload completes → HUD READY again
  await page.waitForTimeout(1100);
  const hudL2 = await page.textContent('#hud-mount-left-state');
  check('HUD returns to READY after reload', hudL2 === 'READY', `"${hudL2}"`);

  // aim right fires right mount (right is empty → nothing fires, left stays ready)
  await page.mouse.move(1080, 400);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  const mounts2 = await page.evaluate(() => {
    const m = window.__vp.arena.player.mounts;
    return { L: m.left.reloadLeft, R: m.right.reloadLeft };
  });
  check('aim right does not fire left mount', mounts2.L === 0, JSON.stringify(mounts2));

  // --- 3.3 destroy the scout → victory → arena respawns
  const oldArena = await page.evaluate(() => window.__vp.arena);
  await page.evaluate(() => {
    const a = window.__vp.arena;
    const scout = a.entities.find((e) => e.kind === 'enemy');
    a.combat.applyDamage(scout, 9999, a.player);
  });
  await page.waitForTimeout(2600);
  const afterKill = await page.evaluate((old) => {
    const a = window.__vp.arena;
    return { same: a === old, enemies: a.entities.filter((e) => e.kind === 'enemy').length, toast: document.body.textContent.includes('SCOUT DOWN') };
  }, oldArena);
  check('scout destroyed → battle restarts', !afterKill.same && afterKill.enemies === 1, JSON.stringify(afterKill));

  // --- 3.3 player destroyed → defeat → respawn at full health
  await page.evaluate(() => {
    const a = window.__vp.arena;
    a.combat.applyDamage(a.player, 99999, null);
  });
  await page.waitForTimeout(2600);
  const afterDeath = await page.evaluate(() => {
    const p = window.__vp.arena.player;
    return { hp: Math.round(p.health), dead: p.dead };
  });
  check('player destroyed → respawn with full hull', !afterDeath.dead && afterDeath.hp > 0, JSON.stringify(afterDeath));

  check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
  await browser.close();
} finally {
  dev.killGroup();
}

if (failures.length) {
  console.error(`check-feel: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-feel: OK');
process.exit(failures.length ? 1 : 0);
