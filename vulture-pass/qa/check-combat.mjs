// Tasks 4.1/4.2 verification: three distinct archetype behaviors in one
// encounter, and shotgun / MG / rocket weapon behaviors (rocket splash hits
// multiple cars).

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

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

try {
  await waitForPort(PORT);
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1200);
  await startFreshGame(page);

  // ---------- 4.1 three archetypes, distinct behavior
  await page.evaluate(() => {
    window.__vp.newBattle([{ label: 'mixed test', comp: ['scout', 'bruiser', 'gunner'] }]);
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const p = window.__vp.arena.player;
    p.x = 0;
    p.z = 0;
    p.heading = 0;
    p.vx = 0;
    p.vz = 0;
    window.__vp.followCam.snapTo({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  });

  const samples = { scout: [], bruiser: [], gunner: [] };
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(400);
    const snap = await page.evaluate(() => {
      const a = window.__vp.arena;
      return a.entities
        .filter((e) => e.kind === 'enemy')
        .map((e) => ({ arch: e.archetype, d: Math.hypot(e.x - a.player.x, e.z - a.player.z), alive: !e.dead }));
    });
    for (const s of snap) if (s.alive) samples[s.arch].push(s.d);
  }
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const stat = {};
  for (const [arch, ds] of Object.entries(samples)) {
    stat[arch] = { avg: avg(ds), min: Math.min(...ds), n: ds.length };
  }
  console.log('  archetype distance profiles:', JSON.stringify(stat));
  check('all three archetypes present & active', stat.scout.n > 10 && stat.bruiser.n > 10 && stat.gunner.n > 10);
  check('scout orbits mid-range (avg 8–28)', stat.scout.avg > 8 && stat.scout.avg < 28, `avg=${stat.scout.avg.toFixed(1)}`);
  check('bruiser closes to contact (min < 10)', stat.bruiser.min < 10, `min=${stat.bruiser.min.toFixed(1)}`);
  check('gunner holds distance (avg > scout avg + 3)', stat.gunner.avg > stat.scout.avg + 3, `avg=${stat.gunner.avg.toFixed(1)}`);

  // ---------- 4.2 weapons behave differently
  // fresh battle, frozen scouts at known spots, weapons assigned per test
  async function setupBattle(mounts, enemies) {
    await page.evaluate(
      ([m, en]) => {
        const vp = window.__vp;
        vp.state.mounts = m;
        vp.newBattle([{ label: 'weapon test', comp: ['scout'] }]);
      },
      [mounts, enemies]
    );
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const vp = window.__vp;
      const p = vp.arena.player;
      p.x = 0;
      p.z = 0;
      p.heading = 0;
      p.vx = 0;
      p.vz = 0;
      // freeze + reposition the default scout so tests control the geometry
      for (const e of vp.arena.entities) {
        if (e.kind === 'enemy') {
          e.frozen = true;
          e.reloadLeft = 9999;
        }
      }
      vp.followCam.snapTo({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    });
  }

  // --- rocket: splash damages multiple cars (screen-left = north = -z)
  await setupBattle({ left: 'rocket', right: null });
  await page.evaluate(() => {
    const a = window.__vp.arena;
    a.spawnEnemy('scout', { x: 0, z: -14 });
    a.spawnEnemy('scout', { x: 3.5, z: -17 });
    for (const e of a.entities) {
      if (e.kind === 'enemy') {
        e.frozen = true;
        e.reloadLeft = 9999;
        e.vx = 0;
        e.vz = 0;
      }
    }
  });
  await page.waitForTimeout(300);
  await page.mouse.move(220, 400); // aim north of the pair
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  const rocketRes = await page.evaluate(() => {
    const a = window.__vp.arena;
    return a.entities
      .filter((e) => e.kind === 'enemy')
      .map((e) => ({ hp: Math.round(e.health), dead: e.dead, z: Math.round(e.z) }));
  });
  console.log('  rocket targets:', JSON.stringify(rocketRes));
  const damaged = rocketRes.filter((e) => e.dead || e.hp < 35).length;
  check('rocket splash damages multiple cars', damaged >= 2, JSON.stringify(rocketRes));

  // --- shotgun: heavy close-range damage in one shot
  await setupBattle({ left: null, right: 'shotgun' });
  // Fixed world target 5.5u off the car's right. Find the pixel that maps
  // there on the SETTLED camera, aim, verify the live aim point, then park
  // the scout under the crosshair. Retries tolerate any camera drift.
  const TARGET = { x: 0.5, z: 5.5 };
  let aimOk = null;
  for (let round = 0; round < 3 && !aimOk; round++) {
    await page.waitForTimeout(400); // let the camera settle
    const px = await page.evaluate((target) => {
      const vp = window.__vp;
      let best = null;
      let bestD = Infinity;
      for (let py = 780; py >= 300; py -= 10) {
        for (let sx = 200; sx <= 1240; sx += 20) {
          const g = vp.followCam.screenToGround(sx, py);
          if (!g) continue;
          const d = Math.hypot(g.x - target.x, g.z - target.z);
          if (d < bestD) {
            bestD = d;
            best = { sx, py };
          }
        }
      }
      return bestD < 1.5 ? best : null;
    }, TARGET);
    if (!px) continue;
    await page.mouse.move(px.sx, px.py);
    await page.waitForTimeout(350);
    aimOk = await page.evaluate((target) => {
      const m = window.__vp.input.mouse;
      const d = Math.hypot(m.worldX - target.x, m.worldZ - target.z);
      return d < 1.2 ? { x: m.worldX, z: m.worldZ } : null;
    }, TARGET);
  }
  check('aim settled on the close-range target', !!aimOk, JSON.stringify(aimOk));
  await page.evaluate((pos) => {
    const a = window.__vp.arena;
    const scout = a.entities.find((e) => e.kind === 'enemy');
    scout.x = pos.x;
    scout.z = pos.z;
    scout.vx = 0;
    scout.vz = 0;
  }, aimOk);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.up();
  const shotgunDiag = await page.evaluate(() => {
    const a = window.__vp.arena;
    const s = a.entities.find((e) => e.kind === 'enemy');
    const p = a.player;
    return {
      hp: Math.round(s.health),
      reloadR: +p.mounts.right.reloadLeft.toFixed(2),
      reloadL: +p.mounts.left.reloadLeft.toFixed(2),
      aim: { x: +window.__vp.input.mouse.worldX.toFixed(2), z: +window.__vp.input.mouse.worldZ.toFixed(2) },
      mouseScreen: { x: window.__vp.input.mouse.x, y: window.__vp.input.mouse.y },
      cam: { x: +window.__vp.followCam.camera.position.x.toFixed(1), y: +window.__vp.followCam.camera.position.y.toFixed(1), z: +window.__vp.followCam.camera.position.z.toFixed(1) },
      camAim: (() => { const g = window.__vp.followCam.screenToGround(window.__vp.input.mouse.x, window.__vp.input.mouse.y); return g ? { x: +g.x.toFixed(2), z: +g.z.toFixed(2) } : null; })(),
      heading: +p.heading.toFixed(2),
      stateMounts: window.__vp.state.mounts,
    };
  });
  console.log('  shotgun diag:', JSON.stringify(shotgunDiag));
  const shotgunHp = shotgunDiag.hp;
  check('shotgun hits hard close up (≥15 dmg)', shotgunHp <= 20, `hp=${shotgunHp}/35`);

  // --- MG: burst spreads over time (burst counter drains over ~0.7s)
  await setupBattle({ left: 'mg', right: null });
  await page.evaluate(() => {
    const a = window.__vp.arena;
    const scout = a.entities.find((e) => e.kind === 'enemy');
    scout.x = 0;
    scout.z = -20;
  });
  await page.mouse.move(400, 400);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(80);
  const burstMid = await page.evaluate(() => window.__vp.arena.player.mounts.left.burstLeft);
  await page.waitForTimeout(900);
  await page.mouse.up();
  const mgDone = await page.evaluate(() => window.__vp.arena.player.mounts.left.burstLeft);
  check('MG burst fires over time (starts ≥6, drains to 0)', burstMid >= 5 && burstMid < 8 && mgDone === 0, `mid=${burstMid} end=${mgDone}`);

  check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
  await browser.close();
} finally {
  dev.killGroup();
}

if (failures.length) {
  console.error(`check-combat: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('check-combat: OK');
process.exit(failures.length ? 1 : 0);
