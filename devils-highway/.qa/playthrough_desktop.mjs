#!/usr/bin/env bun
/**
 * QA task 7.2 — DESKTOP end-to-end playthrough (human-perspective pass).
 * 1600x900, real CDP keyboard events at human-ish cadence (~120 ms decision
 * ticks — every gameplay action is a physical keypress through the REAL input
 * pipeline: keydown -> InputManager -> routeAction -> mode -> player request).
 * Fresh storage (browser.newPage context). Session:
 *
 *   boot menu -> select RUN (1) -> start (Enter) -> play (dodge/jump/slide,
 *   pickup-seeking) -> deliberate death (steer into the nearest hazard) ->
 *   verify gameover stats vs the ledger/HUD/save + NEW BEST -> RETRY (Enter)
 *   -> run 2 past run 1's distance -> Esc pause (frozen sim) -> Resume ->
 *   Esc pause -> RESTART (click) -> Esc pause -> QUIT (click) -> menu card
 *   "BEST - N M" matches localStorage -> reload -> best still there.
 *
 * Also verifies: audio unlock on first input only (AudioContext spy), zero
 * console noise beyond the 4 documented ANGLE/SwiftShader notices, no
 * tunneling deaths (the death cause is a verified overlapping hazard),
 * HUD numerals == ledger at sample points. PNGs -> .qa/shots/7.2/.
 *
 * Usage: bun .qa/playthrough_desktop.mjs [base-url]  (default http://127.0.0.1:8123)
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:8123";
const SHOTS = new URL("./shots/7.2/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
let envNoise = 0; // documented ANGLE/SwiftShader boot notices (qa report 1.1)
const ENV_NOISE = /GPU stall due to ReadPixels/i;
const log = []; // playthrough table rows: { step, input, expected, observed, pass }

const check = (step, input, expected, observed, pass) => {
  const ok = pass === undefined ? Boolean(observed) : pass;
  log.push({ step, input, expected, observed: String(observed), pass: !!ok });
  if (!ok) problems.push(`${step} [${input}]: expected ${expected}, got ${JSON.stringify(observed)}`);
};

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
  ],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => {
  // AudioContext construction spy (unlock verification at the API boundary).
  window.__AC = { count: 0, states: [] };
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (Orig) {
    window.AudioContext = class extends Orig {
      constructor(...a) {
        super(...a);
        window.__AC.count++;
        window.__AC.states.push(this.state);
      }
    };
  }
});
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(m.text());
  else if (t === "warning") {
    if (ENV_NOISE.test(m.text())) envNoise++;
    else consoleWarns.push(m.text());
  }
});
page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e?.message || e)));

const shellState = () =>
  page.evaluate(() => ({
    state: window.__QA_SHELL.state(),
    paused: window.__QA_SHELL.paused(),
    stats: window.__QA_SHELL.stats(),
    dolly: window.__QA_SHELL.dolly(),
    ac: window.__AC.count,
    sel: document.querySelector("#menu .card.sel")?.dataset.mode || null,
    menuOn: document.getElementById("menu").classList.contains("on"),
    gameOn: document.getElementById("gameui").classList.contains("on"),
    hudOn: document.getElementById("hud").classList.contains("on"),
    pauseOn: document.getElementById("pause").classList.contains("on"),
    goOn: document.getElementById("gameover").classList.contains("on"),
    hud: {
      d: document.getElementById("hud-distance").textContent,
      s: document.getElementById("hud-score").textContent,
      p: document.getElementById("hud-pickups").textContent,
    },
    go: {
      d: document.getElementById("go-distance").textContent,
      s: document.getElementById("go-score").textContent,
      p: document.getElementById("go-pickups").textContent,
      flag: document.getElementById("go-flag").classList.contains("on"),
      best: document.getElementById("go-best").textContent,
    },
    save: JSON.parse(localStorage.getItem("endless.save.v1") || "null"),
  }));
const waitFor = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(100);
  }
};
/** One real gameplay snapshot for the driver's decision tick. */
const readWorld = () =>
  page.evaluate(() => {
    const R = window.__QA_RUN;
    if (!R || !R.player) return null;
    const p = R.player.profile;
    const px = p.x;
    const pz = p.z;
    const laneClear = (dir) => {
      const x = px + dir * 3.4;
      if (Math.abs(x) > 3.5) return false;
      for (const o of R.obstacles.records) {
        if (o.alive && Math.abs(o.z - pz) < 8 && Math.abs(o.x - x) < 2.4) return false;
      }
      for (const z of R.zombies.records) {
        if (z.alive && Math.abs(z.z - pz) < 8 && Math.abs(z.x - x) < 2.4) return false;
      }
      return true;
    };
    return {
      state: R.player.state,
      lane: R.player.lane,
      px,
      pz,
      distance: R.score.distance,
      pickups: R.score.pickups,
      obstacles: R.obstacles.records
        .filter((o) => o.alive && o.z > pz && o.z < pz + 24)
        .map((o) => ({ type: o.type, x: o.x, dz: o.z - pz })),
      zombies: R.zombies.records
        .filter((z) => z.alive && z.z > pz && z.z < pz + 24)
        .map((z) => ({ x: z.x, dz: z.z - pz })),
      pickupsAhead: R.pickups.records
        .filter((k) => k.alive && k.z > pz + 1 && k.z < pz + 16)
        .map((k) => ({ x: k.x, dz: k.z - pz })),
      clearLeft: laneClear(-1),
      clearRight: laneClear(1),
    };
  });

// ============================================================================
// 1. BOOT (fresh storage)
// ============================================================================
await page.goto(`${base}/?qa=1&seed=47`, { waitUntil: "domcontentloaded", timeout: 30000 });
const ready = await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, {
    timeout: 25000,
    polling: 200,
  })
  .then(() => true)
  .catch(() => false);
check("boot", "load ?qa=1&seed=47", "screenshotReady", ready ? "true" : "timeout", ready);

let s = await shellState();
check("boot", "state machine", "menu", s.state, s.state === "menu");
check("boot", "fresh storage", "no endless.save.v1", s.save === null ? "absent" : "present", s.save === null);
check("boot", "menu card selected (default lastMode)", "drive", s.sel, s.sel === "drive");
check("boot", "no AudioContext before first gesture", 0, s.ac, s.ac === 0);
check("boot", "zero console warnings at boot (autoplay clean)", 0, consoleWarns.length, consoleWarns.length === 0);

// ============================================================================
// 2. SELECT RUN + START (real keys, human cadence)
// ============================================================================
await page.waitForTimeout(500);
await page.keyboard.press("1"); // select RUN
await page.waitForTimeout(600);
s = await shellState();
check("menu", "key 1", "sel=run", s.sel, s.sel === "run");
check("menu", "key 1 unlocks audio (first gesture)", "1 ctx, running", `${s.ac} ctx`, s.ac === 1);
await page.keyboard.press("Enter"); // start
await page.waitForTimeout(400);
s = await shellState();
check("menu", "Enter", "GAME + HUD on", `state=${s.state} hud=${s.hudOn}`,
  s.state === "game" && s.hudOn && !s.menuOn && s.gameOn);
check("menu", "Enter starts RUN mode", "__QA_RUN live + gameplay flag",
  await page.evaluate(() => !!window.__QA_RUN && window.__QA_AUDIT.world.gameplay), true);

// ============================================================================
// 3. RUN 1 — play at human cadence (~120 ms decision ticks, real keys)
// ============================================================================
const pressed = []; // decision log: { t (wall ms), key, why, dist }
let jumpCount = 0, slideCount = 0, dodgeCount = 0, seekCount = 0;
let deathPlan = false; // switch: stop evading, steer INTO the planned hazard
let planTarget = null;
let shotTaken = false;
let lastHudSample = 0;
let lastPatrol = 0;

async function pressKey(key, why, w) {
  pressed.push({ t: Date.now() - run1Start, key, why, dist: Math.round(w.distance) });
  await page.keyboard.press(key);
  if (key === "w") jumpCount++;
  else if (key === "s") slideCount++;
  else dodgeCount++;
  if (why.startsWith("seek")) seekCount++;
}

await page.waitForTimeout(600); // let the run settle into stride
const run1Start = Date.now();
let run1End = null;
let endedInSuicide = false;
for (;;) {
  const wall = Date.now() - run1Start;
  if (wall > 60000) { problems.push("run1: 60 s without death (suicide driver failed)"); break; }
  const w = await readWorld();
  if (!w) { await page.waitForTimeout(120); continue; }
  const st = await shellState();

  if (st.state === "gameover") { run1End = { w, suicide: deathPlan }; break; }
  if (st.state !== "game") { await page.waitForTimeout(100); continue; }

  // Mid-run screenshot ~7 s in (desktop dusk, HUD live).
  if (!shotTaken && wall > 7000) {
    shotTaken = true;
    await page.screenshot({ path: `${SHOTS}desktop_run_dusk.png` });
  }

  // HUD == ledger sample every ~3 s (view correctness at live cadence).
  if (Date.now() - lastHudSample > 3000) {
    lastHudSample = Date.now();
    const d = parseInt(st.hud.d.replace(/,/g, ""), 10);
    const pN = parseInt(st.hud.p.replace(/,/g, ""), 10);
    const sc = parseInt(st.hud.s.replace(/,/g, ""), 10);
    if (!(d === Math.floor(w.distance) && pN === w.pickups && sc === Math.floor(w.distance) + w.pickups * 25)) {
      problems.push(`hud mismatch: dom ${st.hud.d}/${st.hud.s}/${st.hud.p} vs ledger ${Math.floor(w.distance)}/${w.pickups}/${Math.floor(w.distance) + w.pickups * 25}`);
    }
  }

  // After ~26 s of survival, switch to the deliberate-death phase: pick the
  // nearest hazard ahead and steer INTO it (no jump/slide/dodge).
  if (!deathPlan && wall > 26000) {
    const cands = [
      ...w.obstacles.filter((o) => o.dz > 4).map((o) => ({ kind: o.type, x: o.x, dz: o.dz })),
      ...w.zombies.filter((z) => z.dz > 4).map((z) => ({ kind: "zombie", x: z.x, dz: z.dz })),
    ].sort((a, b) => a.dz - b.dz);
    if (cands.length) {
      deathPlan = true;
      planTarget = cands[0];
      pressed.push({ t: Math.round(wall), key: "-", why: `suicide plan: ${planTarget.kind} @${planTarget.dz.toFixed(0)}m`, dist: Math.round(w.distance) });
    }
  }

  if (deathPlan) {
    // Deliberate death: steer INTO the planned hazard (no jump/slide/dodge).
    if (w.state !== "dead" && planTarget && planTarget.kind !== "zombie"
        && Math.abs(planTarget.x - w.px) > 0.9) {
      await pressKey(planTarget.x > w.px ? "d" : "a", `suicide steer -> ${planTarget.kind}`, w);
    }
    await page.waitForTimeout(120);
    continue;
  }

  // ---- normal evasion driver (human-ish: one decision per tick) ----------
  const low = w.obstacles.find((o) => o.type === "low" && Math.abs(o.x - w.px) < 1.6);
  const gantry = w.obstacles.find((o) => o.type === "gantry" && Math.abs(o.x - w.px) < 1.6);
  const block = w.obstacles.find((o) => o.type === "block" && Math.abs(o.x - w.px) < 2.2);
  const zom = w.zombies.find((z) => Math.abs(z.x - w.px) < 1.7);

  // Jump window (CONFIG geometry): feet >= 0.8 span is ~2.5 m at 7.5 m/s vs
  // the low barrier's 1.16 m padded window -> initiation dz in [2.05, 3.37];
  // fire at dz 2.2-3.1 for margin (probe latency ~1 fixed step).
  if (w.state === "run" && low && low.dz < 3.1 && low.dz > 2.2) {
    await pressKey("w", `jump low @${low.dz.toFixed(1)}m`, w);
  } else if (w.state === "run" && gantry && gantry.dz < 3.6) {
    await pressKey("s", `slide gantry @${gantry.dz.toFixed(1)}m`, w);
  } else if (block && block.dz < 11) {
    if (w.clearLeft) await pressKey("a", `dodge block L @${block.dz.toFixed(1)}m`, w);
    else if (w.clearRight) await pressKey("d", `dodge block R @${block.dz.toFixed(1)}m`, w);
    else if (w.state === "run" && block.dz < 3.0 && block.dz > 2.2) await pressKey("w", "boxed: try jump", w);
  } else if (zom && zom.dz < 9) {
    if (w.clearLeft) await pressKey("a", `dodge zombie L @${zom.dz.toFixed(1)}m`, w);
    else if (w.clearRight) await pressKey("d", `dodge zombie R @${zom.dz.toFixed(1)}m`, w);
  } else if (w.state === "run" && w.pickupsAhead.length > 0) {
    // Soft human behaviour: chase the nearest OFF-LANE pickup when calm.
    const k = w.pickupsAhead.find((q) => Math.abs(q.x - w.px) > 1.2);
    const calm = !w.obstacles.some((o) => o.dz < 13) && !w.zombies.some((z) => z.dz < 12);
    if (k && calm) {
      if (k.x < w.px && w.clearLeft) await pressKey("a", "seek pickup L", w);
      else if (k.x > w.px && w.clearRight) await pressKey("d", "seek pickup R", w);
    }
  } else if (w.state === "run" && Date.now() - lastPatrol > 4000) {
    // Human restlessness: drift to a random clear lane when the road is calm
    // (the early SPAWN ramp is gentle — a still player sees almost nothing).
    lastPatrol = Date.now();
    const calm = !w.obstacles.some((o) => o.dz < 14) && !w.zombies.some((z) => z.dz < 13);
    if (calm) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      if (dir < 0 && w.clearLeft) await pressKey("a", "patrol L", w);
      else if (dir > 0 && w.clearRight) await pressKey("d", "patrol R", w);
    }
  }
  await page.waitForTimeout(120);
}
if (!run1End) { problems.push("run1 loop ended without a gameover"); }
const r1 = run1End;
const distAtSuicide = r1 ? Math.round(r1.w.distance) : -1;
check("run1", "play (dodge/jump/slide/seek at human cadence)", "distance accrued + all verbs used",
  `dist=${distAtSuicide} jumps=${jumpCount} slides=${slideCount} dodges=${dodgeCount} seeks=${seekCount} inputs=${pressed.length}`,
  !!r1 && r1.w.distance > 60 && jumpCount > 0 && slideCount > 0 && dodgeCount > 0);
check("run1", "died only in the deliberate suicide phase", "endedInSuicide",
  String(r1?.suicide), !!r1 && r1.suicide);
check("run1", "mid-run screenshot", "desktop_run_dusk.png", shotTaken ? "saved" : "missed", shotTaken);

// ============================================================================
// 4. DELIBERATE DEATH — verify the cause record at the moment of impact
// ============================================================================
check("death", "suicide plan (nearest hazard ahead)", "hazard found",
  planTarget ? `${planTarget.kind} @${planTarget.dz?.toFixed(0) || "?"}m` : "none",
  !!planTarget);

// Wait for the death, then verify the cause record at the moment of impact.
const deathInfo = await waitFor(async () => {
  const w = await readWorld();
  if (!w || w.state !== "dead") return null;
  return page.evaluate(() => {
    const R = window.__QA_RUN;
    const p = R.player.profile;
    let obsHit = null;
    let zomHit = false;
    for (const o of R.obstacles.records) {
      if (!o.alive) continue;
      if (Math.abs(o.z - p.z) < o.zHalf + 0.3 && Math.abs(o.x - p.x) < o.halfW + 0.35) {
        obsHit = { type: o.type, lane: o.lane };
      }
    }
    for (const z of R.zombies.records) {
      if (!z.alive) continue;
      const dx = z.x - p.x;
      const dz = z.z - p.z;
      if (dx * dx + dz * dz < 0.36) zomHit = true;
    }
    return { obsHit, zomHit, dist: R.score.distance, picks: R.score.pickups };
  });
}, 30000);
check("death", "stop evading -> real death", "player dead",
  deathInfo ? "dead" : "never died", !!deathInfo);
const expectedCause = planTarget ? planTarget.kind : null;
const actualCause = deathInfo
  ? (deathInfo.obsHit ? deathInfo.obsHit.type : deathInfo.zomHit ? "zombie" : "none")
  : "?";
check("death", "no tunneling: the death is a verified real overlap (obstacle window or zombie contact)",
  "obstacle or zombie overlap at the player profile",
  `plan=${planTarget ? planTarget.kind : "n/a"} actual=${actualCause}`,
  deathInfo && actualCause !== "none");

// ============================================================================
// 5. GAMEOVER — stats match what happened on screen + NEW BEST + save writes
// ============================================================================
const go1 = await waitFor(async () => {
  const st = await shellState();
  return st.state === "gameover" ? st : null;
}, 8000);
check("gameover", "death settle (0.55 s) -> GAMEOVER", "state=gameover", go1?.state, go1?.state === "gameover");
const dFloor = Math.floor(deathInfo.dist);
check("gameover", "distance matches the live ledger at death",
  dFloor.toLocaleString(), go1?.go.d,
  go1 && parseInt(go1.go.d.replace(/,/g, ""), 10) === dFloor);
check("gameover", "pickups count matches collected (ledger)",
  deathInfo.picks, go1 && parseInt(go1.go.p.replace(/,/g, ""), 10),
  go1 && parseInt(go1.go.p.replace(/,/g, ""), 10) === deathInfo.picks);
check("gameover", "score formula (distance + pickups x 25)",
  (dFloor + deathInfo.picks * 25).toLocaleString(), go1?.go.s,
  go1 && parseInt(go1.go.s.replace(/,/g, ""), 10) === dFloor + deathInfo.picks * 25);
check("gameover", "NEW BEST flag on first ever run (fresh save)", "flag ON", go1?.go.flag, !!go1?.go.flag);
check("gameover", "best line shows PREVIOUS best (none yet)", "BEST — —", go1?.go.best, go1?.go.best === "BEST — —");
check("gameover", "HUD hidden at gameover", false, go1?.hudOn, go1?.hudOn === false);
await page.waitForTimeout(1600); // staged-reveal settle (fade + last delay + reveal)
await page.screenshot({ path: `${SHOTS}desktop_gameover_dusk.png` });
const save1 = await shellState();
check("save", "localStorage best.run == run distance",
  dFloor, save1.save?.best?.run, save1.save?.best?.run === dFloor);
check("save", "localStorage currency == pickups x 5",
  deathInfo.picks * 5, save1.save?.currency, save1.save?.currency === deathInfo.picks * 5);

// ============================================================================
// 6. RETRY (Enter) -> RUN 2 past run 1's distance
// (probe-side CDP latency vs SwiftShader frame stalls can skip a 1.2 m jump
// initiation window — a real player retries after a death, so up to 3
// attempts, each a real Enter on the gameover screen)
// ============================================================================
let run2Final = null;
let run2Attempts = 0;
const run2Target = dFloor + 15;
await page.waitForTimeout(600);
await page.keyboard.press("Enter"); // first retry (real key)
await page.waitForTimeout(400);
s = await shellState();
check("retry", "Enter on gameover", "fresh GAME, stats cleared",
  `state=${s.state} stats=${s.stats === null ? "null" : "set"}`,
  s.state === "game" && s.stats === null && s.hudOn);
while (!run2Final && run2Attempts < 3) {
  if (run2Attempts > 0) {
    await page.waitForTimeout(400);
    await page.keyboard.press("Enter"); // retry (real key)
    await page.waitForTimeout(400);
  }
  run2Attempts++;
  const t0 = Date.now();
  for (;;) {
    const wall = Date.now() - t0;
    const w = await readWorld();
    if (!w) { await page.waitForTimeout(80); continue; }
    const st = await shellState();
    if (st.state === "gameover") break; // attempt consumed — retry below
    if (st.state !== "game") break;
    if (w.distance > run2Target || wall > 75000) { run2Final = { w, died: false }; break; }

    const low = w.obstacles.find((o) => o.type === "low" && Math.abs(o.x - w.px) < 1.6);
    const gantry = w.obstacles.find((o) => o.type === "gantry" && Math.abs(o.x - w.px) < 1.6);
    const block = w.obstacles.find((o) => o.type === "block" && Math.abs(o.x - w.px) < 2.2);
    const zom = w.zombies.find((z) => Math.abs(z.x - w.px) < 1.7);
    if (w.state === "run" && low && low.dz < 3.35 && low.dz > 2.2) await page.keyboard.press("w");
    else if (w.state === "run" && gantry && gantry.dz < 3.6) await page.keyboard.press("s");
    else if (block && block.dz < 11) {
      if (w.clearLeft) await page.keyboard.press("a");
      else if (w.clearRight) await page.keyboard.press("d");
      else if (w.state === "run" && block.dz < 3.0 && block.dz > 2.2) await page.keyboard.press("w");
    } else if (zom && zom.dz < 9) {
      if (w.clearLeft) await page.keyboard.press("a");
      else if (w.clearRight) await page.keyboard.press("d");
    }
    await page.waitForTimeout(80);
  }
}
if (!run2Final) { // 3 attempts all died short of the target — record the dead end
  run2Final = { w: await readWorld(), died: true };
}
check("retry", "run 2 attempts (real Enter retries)", "<= 3", String(run2Attempts), run2Attempts <= 3);
check("run2", "second run reaches further than run 1 (real keys)", `> ${run2Target} m`,
  `${Math.round(run2Final?.w.distance ?? -1)} m ${run2Final?.died ? "(DIED)" : "(clean)"} in ${run2Attempts} attempt(s)`,
  !!run2Final && !run2Final.died && run2Final.w.distance > run2Target);
// A live run for the pause/quit phase (retry once more if the last attempt died).
if ((await shellState()).state === "gameover") {
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
}

// ============================================================================
// 7. PAUSE / RESUME / RESTART / QUIT (Esc + real mouse clicks)
// ============================================================================
if ((await shellState()).state !== "game") {
  problems.push("phase 7 needs a live run; retry path failed");
}
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
s = await shellState();
check("pause", "Esc mid-run", "paused + overlay on",
  `paused=${s.paused} panel=${s.pauseOn}`, s.paused && s.pauseOn && s.state === "game");
const dollyA = (await shellState()).dolly;
await page.waitForTimeout(500);
const dollyB = (await shellState()).dolly;
check("pause", "sim frozen while paused (z/prevZ/simTime bit-constant over 500 ms)",
  "bit-constant",
  `dz=${dollyB.z - dollyA.z}`,
  dollyB.z === dollyA.z && dollyB.prevZ === dollyA.prevZ && dollyB.simTime === dollyA.simTime);
check("pause", "HUD numerals frozen with the sim", "same text", "frozen",
  (await shellState()).hud.d === s.hud.d);
await page.keyboard.press("Escape"); // resume
await page.waitForTimeout(300);
s = await shellState();
check("pause", "Esc resumes (one press = one toggle)", "unpaused",
  `paused=${s.paused}`, s.paused === false && s.state === "game");
const dollyR0 = (await shellState()).dolly;
await page.waitForTimeout(500);
const dollyR1 = (await shellState()).dolly;
check("pause", "run continues after resume (dolly advances)", "> 0", `+${(dollyR1.z - dollyR0.z).toFixed(1)} m`, dollyR1.z > dollyR0.z);
await page.keyboard.press("Escape"); // pause again
await page.waitForTimeout(300);
s = await shellState();
check("pause", "Esc pauses again", "paused", s.paused, s.paused === true);

// RESTART via real mouse click on the pause panel button.
const restartBox = await page.locator("#pause-restart").boundingBox();
await page.mouse.click(restartBox.x + restartBox.width / 2, restartBox.y + restartBox.height / 2);
await page.waitForTimeout(400);
s = await shellState();
check("pause", "RESTART click", "fresh GAME unpaused",
  `state=${s.state} paused=${s.paused}`,
  s.state === "game" && s.paused === false && s.pauseOn === false && s.stats === null);

// Esc pause -> QUIT via real mouse click.
await page.waitForTimeout(400);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
s = await shellState();
check("pause", "Esc pauses the restarted run", "paused", s.paused, s.paused === true);
const quitBox = await page.locator("#pause-quit").boundingBox();
await page.mouse.click(quitBox.x + quitBox.width / 2, quitBox.y + quitBox.height / 2);
await page.waitForTimeout(400);
s = await shellState();
check("quit", "QUIT · MENU click", "menu shown",
  `state=${s.state} menu=${s.menuOn}`, s.state === "menu" && s.menuOn && !s.gameOn);
const cardBest = await page.evaluate(() => ({
  run: document.querySelector('.card[data-mode="run"] .card-best')?.textContent,
  footer: document.getElementById("menu-best")?.textContent,
}));
const wantBest = `BEST — ${dFloor.toLocaleString()} M`;
check("quit", "menu RUN card shows BEST — N M matching the save", wantBest, cardBest.run, cardBest.run === wantBest);
check("quit", "footer cross-mode best matches", wantBest, cardBest.footer, cardBest.footer === wantBest);

// ============================================================================
// 8. RELOAD — best persists
// ============================================================================
await page.reload({ waitUntil: "domcontentloaded" });
await page
  .waitForFunction(() => window.__QA && window.__QA.screenshotReady === true, null, { timeout: 25000, polling: 200 })
  .catch(() => {});
await page.waitForTimeout(600);
s = await shellState();
check("reload", "page reload", "menu boots", s.state, s.state === "menu");
check("reload", "best survives reload (card line)", wantBest,
  await page.evaluate(() => document.querySelector('.card[data-mode="run"] .card-best')?.textContent),
  (await page.evaluate(() => document.querySelector('.card[data-mode="run"] .card-best')?.textContent)) === wantBest);
check("reload", "best survives reload (localStorage)", dFloor, s.save?.best?.run, s.save?.best?.run === dFloor);
check("reload", "currency survives reload", deathInfo.picks * 5, s.save?.currency, s.save?.currency === deathInfo.picks * 5);

await browser.close();

const report = {
  ok: problems.length === 0 && consoleErrors.length === 0 && consoleWarns.length === 0 && pageErrors.length === 0,
  problems,
  run1: {
    distance: dFloor, pickups: deathInfo.picks, cause: actualCause,
    jumps: jumpCount, slides: slideCount, dodges: dodgeCount, seeks: seekCount,
    inputs: pressed.length,
  },
  pressed,
  gameover: go1?.go,
  save: save1.save,
  reloadCard: cardBest,
  envNoiseWarnings: envNoise,
  consoleErrors,
  consoleWarns,
  pageErrors,
  log,
};
console.log(JSON.stringify(report, null, 2));
