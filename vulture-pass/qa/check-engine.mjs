// Tasks 2.1–2.4 verification in a real browser: loop rate, input readout,
// camera follow, audio gesture gate — exercised through the current boot
// flow (title → new game → sparring arena).

import { launchPage, spawnNpm, waitForPort, startFreshGame } from './lib/browser.mjs';

const PORT = 5199;
const dev = spawnNpm(['run', 'dev', '--', '--port', String(PORT), '--strictPort']);
dev.stdout.on('data', () => {});
dev.stderr.on('data', () => {});

let failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.error(`  FAIL: ${name} ${detail}`);
  }
}

try {
  await waitForPort(PORT);
  const { browser, page, consoleErrors } = await launchPage(`http://localhost:${PORT}/`);
  await page.waitForTimeout(2000);

  // 2.1 — stepping counter advances ~60/s (any scene)
  const steps1 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__vp.loop.stats)));
  await page.waitForTimeout(1000);
  const steps2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__vp.loop.stats)));
  const sps = steps2.steps - steps1.steps;
  check('loop advances ~60 steps/s', sps >= 58 && sps <= 62, `got ${sps}`);
  check('stepsPerSecond stat reports 60', steps2.stepsPerSecond >= 58 && steps2.stepsPerSecond <= 62, `got ${steps2.stepsPerSecond}`);
  check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  // 2.4a — audio silent before any gesture (checked before synthetic key events)
  const locked = await page.evaluate(() => ({ unlocked: window.__vp.audio.unlocked }));
  check('audio locked before gesture', locked.unlocked === false);

  // 2.2 — mouse screen tracking + keyboard state work on the title screen
  await page.mouse.move(640, 300);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const mm = window.__vp.input.mouse;
    return { x: mm.x, y: mm.y };
  });
  check('mouse screen position tracked', Math.abs(m.x - 640) < 5 && Math.abs(m.y - 300) < 5, JSON.stringify(m));
  const keyDown = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    return window.__vp.input.isDown('KeyW');
  });
  check('keyboard state tracked', keyDown === true);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));

  // get through title + cutscene into a battle so the camera/aim have a world
  await startFreshGame(page);
  await page.evaluate(() => window.__vp.newBattle());
  await page.waitForTimeout(800);

  // 2.2b — mouse world-position aim resolves on the ground plane
  await page.mouse.move(640, 300);
  await page.waitForTimeout(300);
  const aim = await page.evaluate(() => {
    const mm = window.__vp.input.mouse;
    return { hasWorld: mm.hasWorld, wx: mm.worldX, wz: mm.worldZ };
  });
  check('aim world point resolved', aim.hasWorld === true, JSON.stringify(aim));
  const aim2 = await page.evaluate(() => window.__vp.input.mouse.worldX);
  await page.mouse.move(300, 600);
  await page.waitForTimeout(300);
  const aim3 = await page.evaluate(() => window.__vp.input.mouse.worldX);
  check('aim world point tracks mouse', Math.abs(aim3 - aim2) > 5, `${aim2} -> ${aim3}`);

  // 2.3 — follow camera sits above the scene and tracks the player
  const cam = await page.evaluate(() => {
    const c = window.__vp.followCam.camera.position;
    const p = window.__vp.arena.player;
    return { x: c.x, y: c.y, z: c.z, px: p.x, pz: p.z };
  });
  check('camera above scene', cam.y > 20, JSON.stringify(cam));
  const near = Math.hypot(cam.x - cam.px, cam.z - cam.pz);
  check('camera near the player', near < 40, `offset=${near.toFixed(1)}`);

  // 2.4b — audio plays after a real click
  await page.mouse.click(640, 400);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({
    unlocked: window.__vp.audio.unlocked,
    played: window.__vp.audio.sfx('uiClick'),
  }));
  check('audio unlocked after click', after.unlocked === true);
  check('sfx plays after gesture', after.played === true);

  await browser.close();
} finally {
  dev.killGroup();
}

process.exit(failures.length ? 1 : 0);
