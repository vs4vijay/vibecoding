/**
 * Midtown Blitz — application entry point.
 *
 * Boots the renderer into #app, advances the loading bar (#loadbar) through
 * the six cost-weighted boot phases (renderer → city generation → city view
 * build → collision world → car + parked + traffic → ready), then fades the
 * loading screen (#loading) out via its "done" class once the city is
 * rendered. Each phase paints its step (a rAF yield) and lingers (STEP_MS)
 * so the bar visibly advances; total added boot time stays under ~2 s.
 *
 * Task 6.2 (performance + loading pass): the bar phases above are the
 * loading half. The perf half: behind ?debug, a wall-clock FPS sampler
 * (src/engine/fps-meter.js — avg fps over a rolling 5 s window + the worst
 * trailing 1 s) is shown as the bottom line of the quality panel and exposed
 * as `__game.fps` for the 60 s ≥ 55 fps profile run; the per-frame hot paths
 * (render hook, traffic/car/rig/marker view updates, HUD updates) are kept
 * allocation-free (statically enforced by scripts/perf-audit-test.mjs).
 *
 * Engine slices (tasks 1.2–1.5) live in `src/engine/` and are composed
 * here: the fixed-timestep loop (60 Hz sim, interpolated rendering), the
 * input manager, the audio manager (unlocked silently on the player's
 * first gesture), the renderer/quality-tier facade, and the smoothed
 * chase-camera rig — C (the `camera` action) cycles chase/hood views.
 *
 * Task 2.2 (city rendering): the placeholder boxes are gone — the scene is
 * now the real city. `generateCity()` (task 2.1) produces the layout data
 * and `createCityView()` (src/game/city-view.js) builds every visible
 * piece — ground/roads with lane markings, raised sidewalks, instanced
 * buildings/lamps/trees with per-instance color, the park, the landmark
 * tower, and daytime lighting — in ~10 draw calls. Fog and the camera far
 * plane come from the engine quality-tier table (`gfx.applyTierFog`);
 * the sun's shadow wiring is adopted per tier through
 * `cityView.applyTier`, so the ?debug quality panel's tier switches keep
 * working end to end.
 *
 * Task 3.2 (car visuals, camera, controls): the hover pod is gone — the
 * player's car is in. `createCollisionWorld()` (task 2.3) indexes the city,
 * `createCarPhysics()` (task 3.1) simulates the arcade car on it, and
 * `createCarView()` builds the low-poly stylized car mesh (spinning
 * wheels, steering fronts, brake lights). Controls are mapped from the
 * input manager's polled state each fixed tick (W/Up throttle, S/Down
 * brake-reverse, A/D + arrows steer, Space handbrake); R/reset stays
 * unmapped here until task 3.3. The chase rig follows the car (C cycles
 * chase/hood — the hood offset is retuned for a car body via the rig's
 * modeDefs data). Each tick snapshots the previous body origin so the
 * render side can interpolate position (the physics state carries only
 * `headingPrev`); `carView.update()` does the shortest-arc heading lerp
 * with the loop's alpha. Hard impacts (onImpact hook) fire a cheap
 * decaying camera shake, applied in the render hook after `rig.update()`
 * as a temporary position offset — kept out of the engine rig module on
 * purpose (main-owned presentation concern; the rig overwrites
 * camera.position each frame, so the shake cannot accumulate).
 *
 * Task 3.3 (reset and recovery): R now recovers the car — a press edge (the
 * input manager's once-per-press event) requests a reset that the next sim
 * tick consumes: `findNearestRoadPosition()` (src/game/recovery.js) maps the
 * car's current position to the nearest road centerline (clamped onto the
 * grid), `car.reset()` zeroes the velocity there, and the chase rig snaps so
 * the teleport is a cut, not a whoosh — all within one tick, well inside the
 * spec's ~1 s. The spec's "flipped" trigger cannot exist in this planar
 * physics, so `createStuckMonitor()` implements the equivalent stuck state:
 * throttle held while the car barely moves for ~2 s (wedged against a
 * wall), a sustained collision embed, or leaving the drivable world bounds
 * (immediate). While stuck, a bottom-center DOM overlay shows "Press R to
 * reset"; it hides on R. (Since task 5.3 the prompt is DRAWN by the HUD's
 * reset-prompt element — same triggers and styling, one prompt owned by
 * src/ui/hud.js.) Behind ?debug, F wedges the car nose-first against
 * the landmark tower wall (zero velocity) so the ~2 s prompt and the R
 * recovery can be tested on demand.
 *
 * Spawn (documented for the by-hand feel pass): right-hand lane of the
 * north-south road on the city's center x line — x = +`grid.laneOffsetM`
 * (3.5 m, the right-hand lane when heading +Z), z = -117 (mid-block
 * between the z = -156 and z = -78 centerlines), heading 0 = due +Z. The
 * lane is clear: buildings/props sit beyond the curbs.
 *
 * Task 4.2 (ambient traffic): after the car boots, `buildLaneGraph()` (task
 * 4.1) derives the road network and `createTraffic()` pools ~24 kinematic
 * AI cars on it — lane-keeping via arc-length waypoint following, seeded
 * straight/left/right junction choices with turn-speed slowdown, an ~18 m
 * ahead-probe that brakes for other traffic AND the player (stop-and-resume
 * with a short reaction delay), and recycling of cars beyond 260 m (the
 * medium tier's fog far) into a 100-180 m ring around the player, hidden
 * behind buildings/fog. The pool ticks once per fixed sim step after the
 * player's physics step (`traffic.update(dt, car.state)`); its poses are
 * plain data written into 3 InstancedMesh draw calls by
 * `createTrafficView()` each rendered frame (no per-car interpolation —
 * 60 Hz updates are smooth for ambient traffic; see the view's header).
 *
 * Task 4.3 (parked cars + car-car collisions): `createParkedCars()` places
 * ~48 parallel-parked cars along the block curbs (road-side strips, ≥ 2.6 m
 * from every lane centerline, ≥ 8 m from junction boxes) and registers each
 * as a static 'parked-car' AABB in the collision world — the player physics
 * treats them exactly like walls — while the group renders the rows in 2
 * instanced draw calls. After the player and traffic ticks,
 * `resolveCarCollisions()` (src/game/car-collisions.js) runs the physical
 * car-car layer: player-vs-traffic and traffic-vs-traffic contacts are
 * separated (player authority + decaying traffic offsets) with a
 * restitution momentum exchange — T-bones deflect the player, kick the
 * traffic car and spin it via its decaying yaw-rate field (traffic-view
 * renders `heading + yawOffset`), and the rate-limited `notifyImpact` hook
 * fires the same camera-shake response as wall hits.
 *
 * Task 5.1 (persistence + settings): the save blob (`midtown-blitz.save.v1`,
 * design Decision 10) is loaded at the very top of boot — before the renderer
 * and audio exist — so the saved quality tier seeds `createEngineRenderer`
 * (and through it the city view's tier adoption + fog) and the saved
 * volume/mute are applied to the audio manager right after creation (the
 * manager stores them pre-init; the lazy graph bakes them in on first use).
 * The settings screen (src/ui/settings-screen.js) is created on EVERY boot —
 * it works in normal play, though nothing in the normal-play UI opens it
 * until task 5.2's menu; behind ?debug a small top-left "Settings" button
 * calls open(). Every change applies live and funnels through ONE debounced
 * whole-blob writer (flushed on close); quality changes — from the settings
 * screen AND the ?debug panel's 1/2/3 keys — funnel through the single
 * `applyQuality()` path (renderer tier + scene adoption) before persisting.
 * Records ride along in every blob write untouched (task 5.5 writes them).
 *
 * Task 5.2 (mode state machine + menus): boot now ends in MENU mode, not in
 * a live world. `createModeMachine()` (src/game/modes.js) owns the single
 * active mode — menu / racing / paused / results — behind a legal-transition
 * table and a per-mode teardown registry: whatever a mode's enter hook opens
 * (screen, timer, audio content) registers a cleanup, and every exit
 * force-runs the whole registry LIFO (nested-safe) before the next mode's
 * enter hook, so a restart or quit-to-menu cannot leak overlays, timers, or
 * sound into the successor — the game-shell spec's cleanup requirement. The
 * main menu (src/ui/main-menu.js) shows the title, the three Blitz event
 * cards with best time/medal from the save records (display is live now;
 * task 5.5 writes real records), the cruise card, and a SETTINGS button into
 * the 5.1 settings screen. Esc pauses (racing) / resumes (paused); the pause
 * menu (src/ui/pause-menu.js) offers resume / restart / quit. The results
 * screen (src/ui/results-screen.js) shows real race endings since task 5.4
 * (`machine.enterMode('results', data)`; console: `__game.showResults`).
 * While not racing, the loop keeps RENDERING the frozen scene behind the
 * overlay — the sim tick is skipped, so the car sits parked, traffic is
 * frozen, and no timer moves; R/F and the stuck prompt are racing-only.
 * window.__game (exposed on every boot since this task) carries the machine,
 * the screens, and start/show helpers for console + harness automation.
 *
 * Task 5.3 (HUD + checkpoint guidance): the racing HUD overlay
 * (src/ui/hud.js — createHud) shows the speedometer (bottom-right big km/h
 * number), the race timer (top-center m:ss.t — real race timing since 5.4),
 * the giant center countdown (3 · 2 · 1 · GO), the checkpoint guidance (a
 * floating diamond marker at the projected checkpoint while on-screen, a
 * screen-edge arrow while off-screen — pure projection math in
 * src/ui/checkpoint-arrow.js), and the stuck-reset prompt — task 3.3's
 * separate overlay was absorbed here, so there is ONE prompt (same
 * triggers: racing-only, stuck-monitor state, hidden on R; same styling).
 * show(mode) runs at every mode entry: only 'racing' shows the HUD, every
 * other mode hides it. The countdown state itself is the pure tick-driven
 * controller src/game/countdown.js (sim-time only — pauses freeze it).
 * Passing the current checkpoint chimes through audio.blip() — a
 * placeholder until task 6.1's real synthesized chime (design Decision 8).
 * The checkpoint world marker (src/game/checkpoint-marker.js — additive
 * light beam + fog:false ring, 2 draws, 0 while hidden) sits at the live
 * target. Behind ?debug, key T (racing only, and only outside a Blitz
 * race's countdown/running phases — the race owns the guidance then)
 * still starts the 3-checkpoint test route near the spawn through the
 * same pieces; it is torn down through the mode machine's cleanup
 * registry on every racing-mode exit.
 *
 * Task 5.4 (Blitz races + Cruise): the placeholder free-drive mode is gone
 * — every menu card now starts its REAL event. The three Blitz routes
 * (src/game/races.js — design Decision 9 "races as data": frozen start
 * pose, ordered grid-intersection checkpoints, time limit, medal
 * thresholds) and Cruise all run through ONE race state machine,
 * createRaceController() (src/game/race-controller.js): begin() starts the
 * shared countdown (controls locked; the HUD timer shows the full limit
 * for Blitz, stays the dimmed placeholder for Cruise — a deliberate
 * choice: Cruise has nothing to time), the GO boundary starts the race
 * clock on pure sim time, each tick samples the ordered checkpoint
 * sequence (out-of-order impossible) + feeds the HUD the remaining time
 * (tinted red under 10 s), the final gate before zero finishes the race
 * (results screen with time + medal; 5.5 persists the record), and the
 * timer hitting zero fails it on that exact tick (immediate "TIME UP"
 * results — retry/menu). Cruise is the same controller with no gates and
 * no clock: it never finishes and only a pause-quit ends it. Pause-safety:
 * the controller is NOT destroyed by the racing-mode cleanup — pausing
 * freezes it mid-state (the sim stops ticking) and resume continues
 * exactly, countdown included; every path that truly ends a session (fresh
 * start / restart / retry, finish / fail into results, quit to menu via
 * teardownRaceSession()) disposes it and guarantees no callbacks after.
 * The ?debug T test route keeps its standalone implementation (test-route
 * controller + shared countdown) — deliberately not routed through the
 * race machine, so the 5.3 guidance loop stays verifiable in Cruise
 * independent of race results.
 * Records display on the menu passes through setRecords untouched (task
 * 5.5 writes real records; medal display on results rides the existing
 * slots).
 *
 * Task 6.1 (audio content, design Decision 8): everything the game sounds
 * is synthesized in src/game/game-audio.js on top of the engine audio
 * manager — a speed/throttle-driven engine drone, slip/handbrake tire skid,
 * lowpass-swept impact bursts, a two-note checkpoint chime, UI ticks, and a
 * look-ahead-scheduled music loop — all routed into the manager's master
 * gain, so the settings volume/mute apply to everything live. Wiring here:
 * `gameAudio.update(dt, car.state, controls)` each racing tick; the
 * onImpact hook adds `impact(intensity)` next to the existing camera shake;
 * `onCheckpointPassed` and the race controller's chime seam (a `{ blip }`
 * shim — the controller's contract is unchanged) now fire the real chime
 * instead of the audio.blip() placeholder; menu/pause/results/settings
 * buttons click through capture-phase uiClick listeners on each screen's
 * root; and the mode hooks own the audio policy — engine/skid voices drive
 * in racing only (setDriving(true)), pause/menu/results ramp them to 0
 * explicitly, and music plays in menu/racing/paused and stops on results.
 * The content graph is built lazily on the first sound, and music defers
 * until the player's first gesture, exactly like the manager's unlock.
 *
 * Task 5.5 (records + medals end-to-end): a won Blitz race now WRITES its
 * record. onFinish folds the finish into the live records map through
 * applyFinish() (src/game/records.js — pure: best time only when strictly
 * faster, highest medal kept independently of time so a slower run can
 * still upgrade gold>silver>bronze, unknown event ids ignored), reassigns
 * `records`, and queues a persist through the SAME debounced whole-blob
 * writer the settings use (design Decision 10: one { settings, records }
 * blob — records were already riding along, the finish is the first normal-
 * play writer of them). The results screen receives the standing best
 * (bestTimeMs) + isNewBest and renders the NEW RECORD badge; the menu's
 * enter hook re-reads the live `records` on every entry, so quitting to the
 * menu (or reloading — the blob is already on disk by the time the results
 * screen is up, well inside the writer's 250 ms debounce) shows the saved
 * best + medal on each card, with the medal chip rendered as a colored
 * glyph shared with the results screen's tinted medal slot.
 *
 * With `?debug` (or `#debug`) in the URL, a monospace overlay in the
 * bottom-left corner lists each action's keys, live held state, and
 * press-edge count, a bottom-right audio block offers a live volume slider,
 * mute toggle, and test blip, a top-left "Settings" button opens the settings
 * panel, and a top-right quality panel switches the tier with keys 1/2/3
 * (or clicks) and shows the live resolution scale, draw distance, shadow
 * flag, camera mode, and renderer draw stats. V toggles a high overhead view
 * of the whole city for inspection.
 */
import * as THREE from 'three';
import { createFixedTimestepLoop } from './engine/loop.js';
import { createInputManager, ACTIONS, ACTION_CODES } from './engine/input.js';
import { createAudioManager } from './engine/audio.js';
import {
  createEngineRenderer,
  QUALITY_TIERS,
  QUALITY_TIER_NAMES,
} from './engine/renderer.js';
import { createCameraRig } from './engine/camera-rig.js';
import { generateCity } from './game/city-gen.js';
import { createCityView, CITY_SKY_COLOR } from './game/city-view.js';
import { createCollisionWorld } from './game/collision.js';
import { buildLaneGraph } from './game/lane-graph.js';
import { createTraffic } from './game/traffic.js';
import { createTrafficView } from './game/traffic-view.js';
import { createParkedCars } from './game/parked-cars.js';
import { resolveCarCollisions } from './game/car-collisions.js';
import { createCarPhysics } from './game/car-physics.js';
import { createCarView } from './game/car-view.js';
import { createStuckMonitor, findNearestRoadPosition } from './game/recovery.js';
import { createRng } from './engine/rng.js';
import { KMH_PER_MS } from './game/config.js';
import { loadSave, saveSave, SAVE_KEY } from './game/save.js';
import { applyFinish } from './game/records.js';
import { createModeMachine } from './game/modes.js';
import { createCountdown } from './game/countdown.js';
import { createFpsMeter } from './engine/fps-meter.js';
import { createCheckpointMarker } from './game/checkpoint-marker.js';
import {
  createCheckpointSequence,
  buildTestRouteCheckpoints,
} from './game/test-route.js';
import {
  RACE_EVENTS,
  RACE_EVENT_BY_ID,
  CRUISE_EVENT,
  resolveRaceEvent,
} from './game/races.js';
import { createRaceController } from './game/race-controller.js';
import { createGameAudio } from './game/game-audio.js';
import {
  createSettingsScreen,
  createSettingsWriter,
} from './ui/settings-screen.js';
import { createHud } from './ui/hud.js';
import { createMainMenu, CRUISE_EVENT_ID } from './ui/main-menu.js';
import { createPauseMenu } from './ui/pause-menu.js';
import { createResultsScreen } from './ui/results-screen.js';

/**
 * Player-car spawn (task 3.2 — documented for the by-hand feel pass): the
 * right-hand lane of the north-south road on the city's center x line.
 * x = -`grid.laneOffsetM` (-3.5 m — heading +Z, the driver's right side is
 * -X, so this is the right-hand-traffic lane), z = -117 (mid-block between
 * the z = -156 and z = -78 road centerlines), heading 0 = due +Z (the
 * shared camera-rig/physics forward convention). Buildings and street
 * props sit beyond the curbs, so the lane is clear from the start.
 *
 * Steer sign note: the physics' positive steer/heading turns from +Z
 * toward +X, which projects to screen LEFT in the chase/hood views (world
 * +X is screen-left for a camera looking along +Z). The per-tick mapping
 * below therefore maps A/Left -> +1 and D/Right -> -1, so the keys steer
 * the way they read on screen.
 */
const SPAWN_X = -3.5; // = -layout.grid.laneOffsetM (right-hand lane heading +Z)
const SPAWN_Z = -117;
const SPAWN_HEADING = 0;

/**
 * Camera-shake tuning for the impact hook (task 3.2): `SHAKE_DECAY` is the
 * exponential decay rate (1/s) of the shake amplitude; `SHAKE_FREQUENCY`
 * the base phase speed (rad/s) of the jitter. The amplitude itself is set
 * per impact from its speed (see onImpact below) and hard-capped.
 */
const SHAKE_DECAY = 6;
const SHAKE_FREQUENCY = 31;
/** Maximum shake amplitude in m (a hard hit at any speed shakes by this). */
const SHAKE_MAX_AMPLITUDE = 0.4;

/**
 * Hood-view retune for the car body (task 3.2): the rig's built-in hood
 * offsets suit the generic pod, so main passes this override through the
 * rig's `modeDefs` data — camera just ahead of the windshield base
 * (cabin front face at z ≈ 0.7, roof top ≈ 1.34), looking down the road.
 * Data change, not an engine change.
 */
const CAR_HOOD_MODE_DEF = Object.freeze({
  position: Object.freeze(new THREE.Vector3(0, 1.12, 0.9)),
  look: Object.freeze(new THREE.Vector3(0, 1.0, 30)),
});

/**
 * The ?debug overhead inspection view (task 2.2 verification aid): a fixed
 * high vantage over the whole city. While it is active the chase rig is
 * paused and the fog/draw-distance overrides below apply — the tier table's
 * values are tuned for street level and far too tight to see the city from
 * 600 m up; leaving the view restores the tier values.
 */
const OVERHEAD_VIEW = Object.freeze({
  position: new THREE.Vector3(0, 620, 340),
  look: new THREE.Vector3(0, 0, 0),
  fogNear: 1100,
  fogFar: 2400,
  cameraFar: 3000,
});

/**
 * How long each artificial loading step lingers so the bar visibly advances
 * (task 6.2: five phase lingers + the final settle = 5 x 220 + 370 = 1470 ms
 * of deliberate stretch — modest, per the loading spec's "playable promptly"
 * the whole boot stays under ~2 s beyond module load).
 */
const STEP_MS = 220;

/**
 * Loading-phase step (task 6.2): paint the new bar width on the next frame,
 * then linger STEP_MS so the step is visible before the next phase's work
 * runs. Every phase boundary goes through here, so consecutive bar writes
 * are always separated by a frame yield (asserted by boot-integration) and
 * the bar's CSS width transition (0.3 s) animates each step.
 * @param {number} fraction Progress target for this phase (0..1, ascending).
 * @returns {Promise<void>} Resolves after the paint + linger.
 */
async function loadPhase(fraction) {
  setProgress(fraction);
  await nextFrame();
  await wait(STEP_MS);
}

/** Friendly labels for the physical keys shown in the ?debug input overlay. */
const DEBUG_KEY_LABELS = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Space: 'Space',
  KeyR: 'R',
  KeyC: 'C',
  Escape: 'Esc',
};

/**
 * Wait for a timeout.
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay.
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the next animation frame.
 * @returns {Promise<void>} Resolves on the next frame.
 */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Advance the loading bar to a fraction of its track (existing DOM API:
 * width percentage on #loadbar inside .bar).
 * @param {number} fraction Progress from 0 (empty) to 1 (full).
 * @returns {void}
 */
function setProgress(fraction) {
  const bar = document.getElementById('loadbar');
  if (!bar) return;
  const clamped = Math.min(1, Math.max(0, fraction));
  bar.style.width = `${Math.round(clamped * 100)}%`;
}

/**
 * Build the ?debug input overlay (task 1.3 verification): a fixed
 * bottom-left monospace panel listing every action with its keys, live held
 * (polled) state, and how many press edges have fired — one physical press
 * must increment the counter by exactly one, even while auto-repeating.
 * Refreshed once per frame from the loop's render hook.
 * @param {import('./engine/input.js').InputManager} input Input manager to watch.
 * @returns {{ update: () => void, el: HTMLPreElement }} Overlay handle.
 */
function createInputDebugOverlay(input) {
  const el = document.createElement('pre');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed',
    'left:12px',
    'bottom:12px',
    'z-index:50',
    'margin:0',
    'padding:10px 12px',
    'pointer-events:none',
    'font:11px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'color:#cfe0ec',
    'background:rgba(5,7,12,0.78)',
    'border:1px solid rgba(207,224,236,0.18)',
    'border-radius:6px',
    'white-space:pre',
    'text-align:left',
  ].join(';');
  document.body.appendChild(el);

  /** @type {Record<string, number>} Per-action press-edge counters. */
  const presses = {};
  for (const action of ACTIONS) presses[action] = 0;
  input.onEdge((edge) => {
    if (edge.type === 'press') presses[edge.action] += 1;
  });

  /**
   * Re-render the overlay text from the manager's current polled state.
   * @returns {void}
   */
  function update() {
    const lines = ['INPUT DEBUG  (?debug)', ''];
    for (const action of ACTIONS) {
      const keys = ACTION_CODES[action]
        .map((code) => DEBUG_KEY_LABELS[code] ?? code)
        .join('/');
      const held = input.isDown(action) ? '[x]' : '[ ]';
      lines.push(`${action.padEnd(10)} ${keys.padEnd(12)} ${held}  presses ${presses[action]}`);
    }
    el.textContent = lines.join('\n');
  }

  update();
  return { update, el };
}

/**
 * Build the ?debug audio control block (task 1.4 verification): a test-blip
 * button, a mute toggle, and a volume slider wired straight into the audio
 * manager, so volume/mute changes are audible immediately without a reload.
 * Sits in the bottom-right corner (the read-only input overlay owns the
 * bottom-left) and, unlike that overlay, accepts pointer events so the
 * controls are clickable — the first click doubles as the gesture that
 * unlocks the AudioContext.
 * @param {import('./engine/audio.js').AudioManager} audio Manager to drive.
 * @returns {{ update: () => void }} Handle; update() refreshes the state line.
 */
function createAudioDebugControls(audio) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'right:12px',
    'bottom:12px',
    'z-index:50',
    'padding:10px 12px',
    'pointer-events:auto',
    'font:11px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'color:#cfe0ec',
    'background:rgba(5,7,12,0.78)',
    'border:1px solid rgba(207,224,236,0.18)',
    'border-radius:6px',
    'text-align:left',
    'user-select:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'AUDIO DEBUG (?debug)';
  title.style.cssText = 'margin-bottom:4px;color:#ffd452;letter-spacing:1px';

  const state = document.createElement('div');
  state.style.cssText = 'margin-bottom:6px;color:#7a8299';

  /**
   * Small monospace debug button matching the panel styling.
   * @param {string} label Initial label.
   * @returns {HTMLButtonElement} The button.
   */
  function makeButton(label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = [
      'font:inherit',
      'color:#cfe0ec',
      'background:#1a2030',
      'border:1px solid rgba(207,224,236,0.25)',
      'border-radius:4px',
      'padding:2px 10px',
      'cursor:pointer',
    ].join(';');
    return b;
  }

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  const blipButton = makeButton('blip');
  const muteButton = makeButton('mute');
  buttonRow.append(blipButton, muteButton);

  const volRow = document.createElement('label');
  volRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  volRow.append('vol');
  const volSlider = document.createElement('input');
  volSlider.type = 'range';
  volSlider.min = '0';
  volSlider.max = '1';
  volSlider.step = '0.01';
  volSlider.value = String(audio.volume);
  volSlider.style.cssText = 'width:150px';
  volRow.append(volSlider);

  el.append(title, state, buttonRow, volRow);
  document.body.appendChild(el);

  blipButton.addEventListener('click', () => {
    audio.blip();
  });
  muteButton.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
  });
  volSlider.addEventListener('input', () => {
    audio.setVolume(Number.parseFloat(volSlider.value));
  });

  let lastText = '';
  /**
   * Refresh the state line and control labels (touches the DOM only when
   * something changed, so it is safe to call every frame).
   * @returns {void}
   */
  function update() {
    const text = `state ${audio.state} · vol ${audio.volume.toFixed(2)} · mute ${
      audio.muted ? 'on' : 'off'
    }`;
    if (text === lastText) return;
    lastText = text;
    state.textContent = text;
    muteButton.textContent = audio.muted ? 'unmute' : 'mute';
    if (document.activeElement !== volSlider) {
      volSlider.value = String(audio.volume);
    }
  }

  update();
  return { update };
}

/**
 * Whether a keydown target is a form control the user is typing in — the
 * quality hotkeys must not steal keys from it (mirrors input.js's guard).
 * @param {unknown} node Event target to inspect.
 * @returns {boolean} True if the target is an editable form control.
 */
function isEditableTarget(node) {
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return node.isContentEditable === true;
}

/**
 * Build the ?debug quality panel (task 1.5 verification): keys 1/2/3 (or
 * clicks on the chips) switch the engine renderer's quality tier live —
 * pixel ratio, shadowMap flag, and the placeholder scene's fog/draw
 * distance and sun shadows all re-apply immediately, no reload — and a
 * state line shows the current tier, resolution scale (drawing buffer
 * size), shadow flag, fog range, camera mode, and renderer draw stats so
 * a tier switch is observably effective (per the game-shell spec's
 * "Quality change applies immediately"). Sits top-right; accepts pointer
 * events for the chips.
 *
 * Since task 5.1 the panel does NOT apply the tier itself: `onApplyTier` is
 * the app's ONE quality path (renderer tier + scene adoption + save-blob
 * persistence — the same path the settings screen's quality chips use), so
 * a ?debug tier switch persists exactly like a settings-screen change.
 *
 * The panel also live-reads the scene's ACTUAL fog near/far, camera far
 * plane, and camera position each frame (next to the tier table's
 * configured values): tier switches and the overhead view both rewrite
 * those, so a rendered-image investigation can trust the panel to reflect
 * the render-time state rather than the tier table's intent.
 *
 * Task 6.2: the panel's BOTTOM line is the wall-clock FPS readout — avg fps
 * over the rolling 5 s window + the worst trailing 1 s, from the app's
 * `fpsMeter`. The panel feeds the meter one timestamp per rendered frame
 * (performance.now — NOT sim time) and re-reads it at ~4 Hz, so the meter's
 * O(n) scan never runs per frame. This is the number the "60 s profiler run
 * averages >= 55 fps" acceptance check reads (also via `__game.fps.read()`).
 * @param {object} deps Collaborators.
 * @param {import('./engine/renderer.js').EngineRenderer} gfx Engine renderer facade (state readouts).
 * @param {THREE.Scene} scene Scene whose live fog the state line shows.
 * @param {THREE.PerspectiveCamera} camera Camera whose live far plane and position the state line shows.
 * @param {(tierName: string) => void} onApplyTier The app's one quality path (apply + persist).
 * @param {() => string} getCameraMode Current camera-rig mode name.
 * @param {import('./engine/fps-meter.js').FpsMeter | null} fpsMeter The app's FPS sampler (null without ?debug).
 * @returns {{ update: () => void }} Handle; update() refreshes the state line per frame.
 */
function createQualityDebugPanel({ gfx, scene, camera, onApplyTier, getCameraMode, fpsMeter = null }) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'right:12px',
    'top:12px',
    'z-index:50',
    'padding:10px 12px',
    'pointer-events:auto',
    'font:11px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'color:#cfe0ec',
    'background:rgba(5,7,12,0.78)',
    'border:1px solid rgba(207,224,236,0.18)',
    'border-radius:6px',
    'text-align:left',
    'user-select:none',
  ].join(';');
  document.body.appendChild(el);

  const title = document.createElement('div');
  title.textContent = 'QUALITY DEBUG (?debug)';
  title.style.cssText = 'margin-bottom:4px;color:#ffd452;letter-spacing:1px';

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';

  /** @type {Record<string, HTMLButtonElement>} Tier name -> chip button. */
  const chips = {};
  for (const tierName of Object.keys(QUALITY_TIERS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${QUALITY_TIER_NAMES.indexOf(tierName) + 1} ${tierName}`;
    b.style.cssText = [
      'font:inherit',
      'color:#cfe0ec',
      'background:#1a2030',
      'border:1px solid rgba(207,224,236,0.25)',
      'border-radius:4px',
      'padding:2px 8px',
      'cursor:pointer',
    ].join(';');
    b.addEventListener('click', () => switchTier(tierName));
    chips[tierName] = b;
    buttonRow.appendChild(b);
  }

  const hint = document.createElement('div');
  hint.textContent =
    'keys 1/2/3 tier · V overhead view · F wedge car (stuck test) · R reset · T test route (racing) · fps avg/min (5 s) on the bottom line';
  hint.style.cssText = 'margin-bottom:6px;color:#7a8299';

  const state = document.createElement('div');
  state.style.cssText = 'white-space:pre;color:#cfe0ec';

  el.append(title, buttonRow, hint, state);

  /**
   * Switch tier live through the app's ONE quality path (renderer tier +
   * scene adoption + save-blob persistence, see main's applyQuality).
   * @param {string} tierName 'low' | 'medium' | 'high'.
   * @returns {void}
   */
  function switchTier(tierName) {
    if (onApplyTier) onApplyTier(tierName);
  }

  // Keys 1/2/3 (top row + numpad). Deliberately raw window listeners:
  // digits are not game actions in input.js, so they stay unmapped there.
  const KEY_TIER = {
    Digit1: 'low',
    Digit2: 'medium',
    Digit3: 'high',
    Numpad1: 'low',
    Numpad2: 'medium',
    Numpad3: 'high',
  };
  window.addEventListener('keydown', (event) => {
    const tierName = KEY_TIER[event.code];
    if (!tierName) return;
    if (isEditableTarget(event.target)) return; // typing in a form control
    event.preventDefault();
    switchTier(tierName);
  });

  const bufSize = new THREE.Vector2();
  let lastText = '';

  // Task 6.2: FPS readout state — the meter is fed every frame, read at
  // ~4 Hz into a reused object (no per-frame allocation beyond the panel's
  // existing change-gated text rebuild).
  const fpsOut = { avgFps: 0, minFps: 0, frames: 0 };
  let fpsLine = 'fps — warming up (needs ~1 s of frames)';
  let lastFpsReadMs = -1e12;
  const nowMs = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  /**
   * Refresh the chips' active highlight and the state line (DOM writes
   * only on change, safe to call every frame).
   * @returns {void}
   */
  function update() {
    const tier = gfx.getQualityTier();
    const t = QUALITY_TIERS[tier];
    for (const [name, chip] of Object.entries(chips)) {
      const active = name === tier;
      chip.style.color = active ? '#ffd452' : '#cfe0ec';
      chip.style.borderColor = active
        ? 'rgba(255,212,82,0.7)'
        : 'rgba(207,224,236,0.25)';
    }
    if (fpsMeter) {
      const ts = nowMs();
      fpsMeter.frame(ts);
      if (ts - lastFpsReadMs >= 250) {
        lastFpsReadMs = ts;
        fpsMeter.read(fpsOut);
        fpsLine =
          fpsOut.avgFps > 0
            ? `fps avg ${fpsOut.avgFps.toFixed(1)} · min ${fpsOut.minFps.toFixed(1)} (5 s window)`
            : 'fps — warming up (needs ~1 s of frames)';
      }
    }
    gfx.renderer.getDrawingBufferSize(bufSize);
    const info = gfx.renderer.info.render;
    const fog = scene.fog;
    const cam = camera.position;
    const text = [
      `tier ${tier} · scale ${gfx.getResolutionScale().toFixed(2)}x · buf ${bufSize.x}x${bufSize.y}`,
      `shadows ${t.shadows ? 'on' : 'off'} · fog ${t.fogNear}–${t.fogFar} · far ${t.cameraFar}`,
      `live fog ${
        fog && Number.isFinite(fog.near) && Number.isFinite(fog.far)
          ? `${fog.near.toFixed(0)}–${fog.far.toFixed(0)}`
          : String(fog)
      } · far ${camera.far} · cam ${cam.x.toFixed(1)},${cam.y.toFixed(1)},${cam.z.toFixed(1)}`,
      `cam ${getCameraMode()} · draws ${info.calls} · tris ${info.triangles}`,
      fpsLine,
    ].join('\n');
    if (text === lastText) return;
    lastText = text;
    state.textContent = text;
  }

  update();
  return { update };
}

/**
 * Build the ?debug "Settings" corner button (task 5.1 reachability shim):
 * the settings screen works in normal play, but nothing in the normal-play
 * UI opens it until task 5.2's menu — behind ?debug this small top-left
 * button (the only free corner; input overlay, audio block, and quality
 * panel own the other three) calls the screen's open(). Also a handy console
 * handle via window.__game.settings.
 * @param {() => void} onClick Invoked on click (opens the settings screen).
 * @returns {HTMLButtonElement} The button (already appended to body).
 */
function createDebugSettingsButton(onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'SETTINGS';
  b.setAttribute('aria-label', 'Open settings');
  b.style.cssText = [
    'position:fixed',
    'left:12px',
    'top:12px',
    'z-index:50',
    'pointer-events:auto',
    'font:600 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'letter-spacing:1px',
    'color:#ffd452',
    'background:rgba(5,7,12,0.78)',
    'border:1px solid rgba(255,212,82,0.45)',
    'border-radius:6px',
    'padding:6px 12px',
    'cursor:pointer',
    'user-select:none',
  ].join(';');
  b.addEventListener('click', () => {
    if (onClick) onClick();
  });
  document.body.appendChild(b);
  return b;
}

/**
 * Bootstrap the app: renderer into #app, city generation + city view build
 * staged across the loading bar, fade the loading screen out, then keep
 * rendering the live city.
 * @returns {Promise<void>} Resolves once the loading screen has been dismissed.
 */
async function main() {
  const host = document.getElementById('app');
  const loading = document.getElementById('loading');
  if (!host || !loading) {
    throw new Error('midtown-blitz: missing #app or #loading in the document');
  }

  // Task 6.2: the loading bar advances through SIX cost-weighted phases,
  // each painted (rAF yield) + lingered (STEP_MS) by loadPhase() before the
  // phase's work runs. Weights roughly track real cost (the city view build
  // ~9 ms is the heaviest single step; renderer context creation is the
  // slowest observable startup step; generation/collision/car+traffic are
  // ~1 ms each — the bar communicates ORDER, not milliseconds).
  // Phase 1 — save blob + renderer (boot ends in a visible 15% step).
  await loadPhase(0.15);
  // Task 5.1: load the save blob first — before the renderer and audio exist
  // — so the persisted settings seed them. Missing/corrupt data resolves to
  // defaults here (loadSave never throws), which is exactly the boot the
  // game-shell spec requires for corrupted storage.
  const saveData = loadSave();
  // Task 1.5: renderer + quality tiers live in the engine module (default
  // tier 'medium'; the ?debug panel switches tiers live). The saved tier
  // seeds the initial pixel ratio / shadow flag; the city view + fog adopt
  // it below via cityView.applyTier + gfx.applyTierFog.
  const gfx = createEngineRenderer({ host, tier: saveData.settings.quality });
  const renderer = gfx.renderer;

  // Phase 2 — pure-data city generation (task 2.1).
  await loadPhase(0.35);
  const layout = generateCity();

  // Phase 3 — build the city meshes (ground/roads with lane
  // markings, raised sidewalks, instanced buildings + props, park, tower,
  // lights). Sky background and fog share CITY_SKY_COLOR so distance fog
  // fades geometry into exactly the sky; the tier table owns the fog
  // near/far and camera far plane (gfx.applyTierFog — engine-owned, never
  // duplicated here), and the sun's shadows come from cityView.applyTier.
  await loadPhase(0.6);
  const cityView = createCityView(layout);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CITY_SKY_COLOR);
  scene.fog = new THREE.Fog(CITY_SKY_COLOR, 60, 260);
  // Boot aspect with the same degenerate-pane guard resizeRenderer uses
  // (a collapsed embed pane can boot with 0 / non-finite inner sizes): a
  // NaN/Infinity aspect here would degenerate the projection matrix before
  // the first render; gfx.attachResize keeps it in sync once the sizes are
  // real, but construction must already be safe. 16/9 matches the engine
  // renderer's 1280x720 fallback.
  const bootAspect =
    Number.isFinite(window.innerWidth) &&
    Number.isFinite(window.innerHeight) &&
    window.innerWidth > 0 &&
    window.innerHeight > 0
      ? window.innerWidth / window.innerHeight
      : 16 / 9;
  const camera = new THREE.PerspectiveCamera(60, bootAspect, 0.5, 340);
  scene.add(cityView.group);
  cityView.applyTier(gfx.getQualityTier());
  gfx.applyTierFog(scene, camera);

  // Phase 4 — collision world (task 2.3): index the generated city so the
  // car + parked + traffic phase can register/query against it.
  await loadPhase(0.75);
  const world = createCollisionWorld(layout);

  // Phase 5 — car + parked + traffic. Order inside the phase matters: the
  // parked-car AABBs (task 4.3) must be registered BEFORE the traffic pool
  // spawns (its 50-180 m ring checks parked-car clearance), and the car
  // view is posed once at the spawn state before the rig snaps below.
  await loadPhase(0.92);
  // Task 4.3: parked cars — rows along the block curbs (road-side strips,
  // deterministic from their own rng fork), every spot registered as a
  // static 'parked-car' AABB so the player physics (and traffic spawn /
  // recycle clearance) treats them as solid walls. The instanced group
  // renders the rows in 2 draw calls; parked cars never move after this.
  const parkedCars = createParkedCars({ layout, world, rng: createRng('parked-v1') });
  scene.add(parkedCars.group);
  let shakeAmplitude = 0;
  let shakePhase = 0;
  // Task 6.1: created after the audio manager below (the manager is created
  // after loading — the loading screen stays silent by design); the impact
  // closure references it through this binding, so a (theoretically possible)
  // pre-creation impact simply skips the sound.
  let gameAudio = /** @type {import('./game/game-audio.js').GameAudio | null} */ (null);
  const car = createCarPhysics(world, undefined, {
    onImpact: (impact) => {
      // Amplitude scales with impact speed (5 m/s rubs, big hits shake at
      // the cap); the phase restarts so each hit reads as a fresh jolt.
      shakeAmplitude = Math.min(SHAKE_MAX_AMPLITUDE, 0.1 + impact.speed * 0.012);
      shakePhase = 0;
      // Task 6.1: the audible half of the impact response — a lowpass-swept
      // noise burst + thump, scaled 0..1 from the impact speed (the physics
      // only fires onImpact above its 5 m/s rub threshold; ~35 m/s+ pegs it).
      if (gameAudio) {
        gameAudio.impact(Math.min(1, Math.max(0, (impact.speed - 5) / 30)));
      }
    },
  });
  car.reset({ x: SPAWN_X, z: SPAWN_Z, heading: SPAWN_HEADING });
  const carView = createCarView();
  scene.add(carView.group);
  const NEUTRAL_CONTROLS = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  carView.update(car.state, NEUTRAL_CONTROLS, 1);

  // Task 4.2: ambient traffic. The lane graph (4.1) derives from the same
  // layout; the pool spawns ~24 cars in a 50-180 m ring around the player
  // (fog-hidden pop-in, 40 m keep-out), each with its own forked rng stream
  // so the seeded junction choices stay deterministic. The view renders the
  // whole pool in 3 instanced draw calls (body/cabin/skirt boxes sharing
  // the player-car archetype, per-instance paint colors).
  const graph = buildLaneGraph(layout);
  const traffic = createTraffic({
    layout,
    graph,
    world,
    rng: createRng('traffic-v1'),
    player: { x: SPAWN_X, z: SPAWN_Z },
  });
  const trafficView = createTrafficView(traffic);
  scene.add(trafficView.group);

  // Phase 6 — ready: first real frame on screen, then the full bar. The
  // render + rAF yield lets the browser present the city BEFORE the bar
  // completes, so the fade to the menu never reveals a blank canvas.
  // Chase rig on the car; C (the `camera` action) cycles chase/hood below.
  // The hood mode is retuned for the car body via the rig's modeDefs data.
  const rig = createCameraRig(camera, {
    modes: ['chase', 'hood'],
    modeDefs: { hood: CAR_HOOD_MODE_DEF },
  });
  rig.setTarget(carView.group);
  rig.snap();
  renderer.render(scene, camera);
  await nextFrame();

  setProgress(1);
  await wait(STEP_MS + 150); // let the bar's width transition finish
  loading.classList.add('done');

  // Task 1.3 input manager: DOM key listeners keep its polled state fresh;
  // later tasks (car controls, pause) consume it via input.isDown()/onEdge.
  // Behind ?debug (or #debug), a small overlay shows held keys live and
  // press-edge counts.
  const input = createInputManager();
  const debugEnabled =
    new URLSearchParams(window.location.search).has('debug') ||
    /debug/i.test(window.location.hash);
  const inputOverlay = debugEnabled ? createInputDebugOverlay(input) : null;
  // Task 6.2: the ?debug FPS sampler — wall-clock rAF count over a rolling
  // 5 s window (sim-time-independent), fed from the render hook below and
  // displayed in the quality panel's bottom line. Created debug-only, so
  // normal play pays nothing for it.
  const fpsMeter = debugEnabled ? createFpsMeter() : null;

  // Task 2.2: behind ?debug, V toggles a static high overhead view of the
  // whole city for inspection. While active the chase rig is paused and
  // fog/draw-distance are opened up (the tier values target street level);
  // leaving the view restores them from the tier table.
  let overhead = false;
  const applyOverheadView = () => {
    camera.position.copy(OVERHEAD_VIEW.position);
    camera.lookAt(OVERHEAD_VIEW.look);
    scene.fog.near = OVERHEAD_VIEW.fogNear;
    scene.fog.far = OVERHEAD_VIEW.fogFar;
    camera.far = OVERHEAD_VIEW.cameraFar;
    camera.updateProjectionMatrix();
  };
  const exitOverheadView = () => {
    gfx.applyTierFog(scene, camera); // tier fog + far plane back
    rig.snap(); // carView poses fresh every frame, so this serves any pending viewNeedsSnap too
    viewNeedsSnap = false;
  };
  if (debugEnabled) {
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyV') return;
      if (isEditableTarget(event.target)) return; // typing in a form control
      event.preventDefault();
      overhead = !overhead;
      if (overhead) applyOverheadView();
      else exitOverheadView();
    });
  }

  // Task 1.5: the `camera` action (C) cycles the rig's view modes —
  // exactly one press edge per physical press, per the input manager
  // (unless the overhead view currently owns the camera).
  input.onEdge((edge) => {
    if (edge.type === 'press' && edge.action === 'camera' && !overhead) {
      rig.cycleMode();
    }
  });

  // Task 1.4 audio manager: created after loading completes (the loading
  // screen is silent by design); the WebAudio graph itself is only built
  // lazily on the first gesture via its pointerdown/keydown unlock
  // listeners, so a normal boot autoplays nothing. The saved volume/mute
  // (task 5.1) are applied immediately after creation — the manager stores
  // both pre-init and bakes them into the master gain when the graph is
  // later built. Behind ?debug, a small bottom-right control block exposes a
  // live volume slider, mute toggle, and test blip for the task's manual
  // verification.
  const audio = createAudioManager();
  audio.setVolume(saveData.settings.volume);
  audio.setMuted(saveData.settings.muted);
  const audioControls = debugEnabled ? createAudioDebugControls(audio) : null;
  // Task 6.1: the game audio content layer — engine/skid voices, impact
  // bursts, checkpoint chime, UI clicks, and the music loop — all routing
  // into the manager's master gain (settings volume/mute cover everything).
  // The graph builds lazily on the first sound this makes, and music defers
  // until the first gesture, so a silent boot stays silent (see the module
  // header in src/game/game-audio.js).
  gameAudio = createGameAudio(audio);

  // Scene-side tier adoption: the city view re-wires its sun (castShadow +
  // map size per the engine QUALITY_TIERS table); fog/camera-far are
  // re-applied from the tier table unless the overhead view owns them.
  const applyTierToScene = (tierName) => {
    cityView.applyTier(tierName);
    if (overhead) applyOverheadView();
    else gfx.applyTierFog(scene, camera);
  };

  // Task 5.1: the ONE quality path — every tier change (settings screen
  // chips, ?debug panel keys/clicks) funnels through here: renderer tier
  // first (scene passed so a shadow-flag flip recompiles materials live),
  // then the scene-side adoption above.
  const applyQuality = (tierName) => {
    gfx.setQualityTier(tierName, scene);
    applyTierToScene(tierName);
  };

  // Task 5.1 persistence plumbing. The live objects (audio getters + the
  // renderer's current tier) are the single source of truth for settings;
  // records ride along untouched until task 5.5 writes them. All writes go
  // through one debounced whole-blob writer (design Decision 10).
  const currentSettings = () => ({
    volume: audio.volume,
    muted: audio.muted,
    quality: gfx.getQualityTier(),
  });
  let records = saveData.records; // task 5.5: race records are written through here
  const settingsWriter = createSettingsWriter({
    save: (data) => {
      saveSave(data);
    },
  });
  const persistSettingsSoon = () => {
    settingsWriter.queue({ settings: currentSettings(), records });
  };

  // Task 5.1: behind ?debug, the quality panel switches tiers live
  // (keys 1/2/3 or clicks) and shows the current tier, resolution scale,
  // shadow flag, draw distance, camera mode, and draw stats (the city's
  // ~10 instanced draw calls plus the car — watch it double at high tier
  // when the shadow pass kicks in, still far under budget). Tier changes
  // funnel through the single applyQuality path AND persist to the save
  // blob, exactly like the settings screen's quality chips.
  const applyQualityAndPersist = (tierName) => {
    applyQuality(tierName);
    persistSettingsSoon();
  };
  const qualityPanel = debugEnabled
    ? createQualityDebugPanel({
        gfx,
        scene,
        camera,
        onApplyTier: applyQualityAndPersist,
        getCameraMode: () => (overhead ? 'overhead' : rig.getMode()),
        fpsMeter,
      })
    : null;

  // Task 5.1: the settings screen (volume / mute / quality / reset), created
  // on every boot — it works in NORMAL play. Until task 5.2's menu owns the
  // reachability, ?debug gets a small top-left "Settings" button that opens
  // it (the orchestrator's by-hand check enters through that button). Every
  // change applies live via the callbacks below and lands in the shared
  // debounced writer; closing flushes it so the change survives a reload.
  const settingsScreen = createSettingsScreen({
    settings: currentSettings(),
    getSettings: currentSettings,
    onApplyVolume: (v01) => {
      audio.setVolume(v01);
      persistSettingsSoon();
    },
    onApplyMuted: (muted) => {
      audio.setMuted(muted);
      persistSettingsSoon();
    },
    onApplyQuality: applyQualityAndPersist,
    persist: () => persistSettingsSoon(),
    onClose: () => settingsWriter.flush(),
  });
  if (debugEnabled) createDebugSettingsButton(() => settingsScreen.open());

  // Task 3.3: reset + recovery state. The stuck monitor implements this
  // planar game's reading of the spec's "flipped or immovably stuck" prompt
  // trigger (see src/game/recovery.js); the prompt itself is normal-play UI,
  // deliberately not ?debug-gated. Declared BEFORE the task 5.2 mode
  // machine so the mode hooks can drive both.
  const stuckMonitor = createStuckMonitor({ bounds: layout.world });
  /** Press-edge request flags, consumed at the top of the next sim tick. */
  let resetRequested = false;
  let flipRequested = false;
  /**
   * One-shot chase-rig snap after a teleport, consumed by the render hook
   * (after carView.update has applied the new pose, so the snap frames it).
   */
  let viewNeedsSnap = false;

  // ==========================================================================
  // Task 5.3: HUD + race-start countdown + checkpoint guidance. The HUD is
  // shown/hidden by the mode hooks below (show(mode): racing only); the
  // countdown is the pure tick-driven controller (src/game/countdown.js) —
  // sim-time only, so pauses freeze it — and its controlsLocked() gate is
  // applied to the car controls in the update hook. Since task 5.4 these
  // three pieces (countdown, world marker, ordered sequence) are DRIVEN by
  // the race controller (created in the racing enter hook below); they also
  // still back the standalone ?debug T test route.
  // ==========================================================================

  // The speedometer lifts above the ?debug audio block (bottom-right corner)
  // when that block is on screen; normal play tucks it into the corner.
  const hud = createHud({ speedoBottomPx: debugEnabled ? 132 : 16 });

  // Countdown display wiring: the controller only knows numbers; the HUD
  // maps 3/2/1/GO onto the center display and clears it when the GO window
  // closes (onEnd).
  const countdown = createCountdown({
    onTick: (n) => hud.showCountdown(n),
    onGo: () => hud.showCountdown('GO'),
    onEnd: () => hud.showCountdown(null),
  });

  // Checkpoint world marker (light beam + ring): one instance, moved onto
  // each target via set(); hidden by default so the boot draw-call budget
  // is untouched.
  const checkpointMarker = createCheckpointMarker(scene);

  /** Active ?debug test-route sequence, or null (T starts/stops it). */
  let testRoute = null;

  /**
   * Checkpoint pass chime — the real synthesized two-note chime since task
   * 6.1 (replaces the audio.blip() placeholder; design Decision 8).
   * @param {import('./game/test-route.js').RouteCheckpoint} [cp] Passed
   *   checkpoint (unused; the chime is the same for every gate).
   * @returns {void}
   */
  function onCheckpointPassed(cp) {
    void cp;
    gameAudio.checkpointChime();
  }

  /**
   * Start the ?debug T test route (racing only): three ordered grid
   * intersections, the world marker + HUD guidance on the first target, and
   * a fresh 3-2-1-GO countdown that locks the controls. Tearing it down is
   * registered in the racing mode's cleanup registry (see the mode machine
   * below), so any mode exit clears route + marker + guidance + countdown.
   * @returns {void}
   */
  function startTestRoute() {
    stopTestRoute();
    const checkpoints = buildTestRouteCheckpoints(layout);
    testRoute = createCheckpointSequence({
      checkpoints,
      passRadiusM: 12,
      onAdvance: (_index, next) => {
        onCheckpointPassed(next);
        checkpointMarker.set(next);
        hud.setCheckpoint(next);
      },
      onComplete: () => {
        // Final checkpoint passed: one last chime, then clear everything.
        onCheckpointPassed();
        stopTestRoute();
      },
    });
    const first = /** @type {import('./game/test-route.js').RouteCheckpoint} */ (checkpoints[0]);
    checkpointMarker.set(first);
    hud.setCheckpoint(first);
    countdown.start();
  }

  /**
   * Stop the ?debug test route: clear the sequence, world marker, and HUD
   * guidance (the countdown display is cleared with it when a countdown is
   * running). Idempotent.
   * @returns {void}
   */
  function stopTestRoute() {
    testRoute = null;
    checkpointMarker.set(null);
    hud.setCheckpoint(null);
  }

  // Shared per-tick control mapping and the body-origin snapshot the render
  // side interpolates from (task 3.2). Declared here so the task 5.2 respawn
  // helper can reset the snapshot alongside the body.
  const controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const prevPose = { x: SPAWN_X, z: SPAWN_Z }; // per-tick body origin snapshot
  /** Sim ticks actually executed — frozen outside racing (task 5.2). */
  let tickCount = 0;
  /** Event id whose racing session is active (restart/retry target). */
  let activeEventId = CRUISE_EVENT_ID;
  /** Entry payload of the last results transition (retry target, 5.4). */
  let lastEventData = null;
  /**
   * The active race session (task 5.4): a createRaceController handle for
   * BOTH Blitz routes and Cruise, or null outside racing. Survives a pause
   * (frozen mid-state — the sim stops ticking) and is disposed by
   * {@link teardownRaceSession} on every path that truly ends a session.
   * @type {import('./game/race-controller.js').RaceController | null}
   */
  let race = null;

  /**
   * Tear down the ACTIVE race session completely (task 5.4): dispose the
   * controller (no callbacks can fire afterwards), kill any countdown
   * state, and clear every piece of race HUD/world state. Idempotent —
   * safe to call when nothing is running. Called on every path that
   * genuinely ends a session: a fresh racing entry (menu start, pause-menu
   * RESTART, results RETRY — this is the "start a race while one is active"
   * guard), a race finish/fail (before the results screen), and any return
   * to the menu. Deliberately NOT part of the racing-mode cleanup: a pause
   * must keep the session alive (frozen) so resume continues exactly.
   * @returns {void}
   */
  function teardownRaceSession() {
    if (race) {
      race.dispose();
      race = null;
    }
    countdown.cancel();
    hud.showCountdown(null);
    hud.setTimer(null);
    hud.setCheckpoint(null);
    checkpointMarker.set(null);
  }

  /**
   * A Blitz race was WON (race-controller onFinish): fold the finish into
   * the records map (task 5.5 — pure {@link applyFinish} update: best time
   * only when strictly faster, highest medal independent of it), persist
   * the WHOLE blob through the shared debounced writer, and show the
   * results screen with the finish time + medal, the standing best, and the
   * NEW RECORD flag when this run set the best.
   * @param {import('./game/race-controller.js').RaceResult} result The win.
   * @returns {void}
   */
  function onRaceFinished(result) {
    const route = RACE_EVENT_BY_ID[result.eventId];
    const outcome = applyFinish(records, result);
    records = outcome.records;
    persistSettingsSoon(); // whole blob { settings, records } — records ride along
    const entry = records[result.eventId];
    teardownRaceSession();
    showResults({
      eventName: route ? route.name : result.eventId,
      eventId: result.eventId,
      timeMs: result.timeMs,
      medal: result.medal,
      bestTimeMs: entry && typeof entry.bestTimeMs === 'number' ? entry.bestTimeMs : undefined,
      bestMedal: entry && typeof entry.bestMedal === 'string' ? entry.bestMedal : undefined,
      isNewBest: outcome.isNewBest,
    });
  }

  /**
   * A Blitz race TIMED OUT (race-controller onFail — fired on the exact
   * tick the timer hit zero): tear the session down and show the failure
   * results variant immediately (TIME UP + retry/menu).
   * @param {import('./game/race-controller.js').RaceFailure} failure The timeout.
   * @returns {void}
   */
  function onRaceFailed(failure) {
    const route = RACE_EVENT_BY_ID[failure.eventId];
    teardownRaceSession();
    showResults({
      eventName: route ? route.name : failure.eventId,
      eventId: failure.eventId,
      timeMs: failure.elapsedMs,
      medal: null,
      failed: true,
    });
  }

  // ==========================================================================
  // Task 5.2: mode state machine + mode UI. Boot ends in MENU mode with the
  // sim frozen behind the menu; only racing ticks (see the loop below). The
  // screens are created once and shown/hidden by the hooks; each mode's
  // enter registers its teardown into the machine's cleanup registry, which
  // every exit force-runs (LIFO, nested-safe) BEFORE the next enter — so no
  // overlay/timer/audio state can survive a transition (game-shell spec).
  // ==========================================================================

  /**
   * Put the car at a pose and reset every mode-owned presentation flag.
   * The per-tick pose snapshot is reset with the body so the render side
   * cannot lerp the respawn across the map.
   * @param {number} x Spawn x (m).
   * @param {number} z Spawn z (m).
   * @param {number} heading Spawn heading (rad; 0 = +Z).
   * @returns {void}
   */
  function respawnCarAt(x, z, heading) {
    car.reset({ x, z, heading });
    stuckMonitor.reset();
    resetRequested = false;
    flipRequested = false;
    shakeAmplitude = 0;
    shakePhase = 0;
    prevPose.x = x;
    prevPose.z = z;
    viewNeedsSnap = true; // render hook snaps the rig: a cut, not a whoosh
  }

  /**
   * The canonical MENU idle (returning from play): the documented spawn
   * pose (see SPAWN_* above). Blitz races instead respawn at their route's
   * own start pose (races.js) via respawnCarAt.
   * @returns {void}
   */
  function respawnCarAtSpawn() {
    respawnCarAt(SPAWN_X, SPAWN_Z, SPAWN_HEADING);
  }

  // Task 5.2 screens (created once, shown/hidden per mode).
  const mainMenu = createMainMenu({
    records,
    onStartMode: (eventId) => startEvent(eventId),
    onOpenSettings: () => settingsScreen.open(),
  });
  const pauseMenu = createPauseMenu({
    onResume: () => {
      // Resume: re-enter racing WITHOUT a fresh entry — the sim never ticked
      // while paused, so car/traffic/camera are still in the exact prior
      // state (game-shell spec: "the exact prior race state, timer resuming").
      modes.enterMode('racing', { resume: true, event: activeEventId });
    },
    onRestart: () => {
      // Restart: a FRESH racing entry — respawn, flags cleared (works from
      // paused mid-run, the task's "mid-race restart").
      modes.enterMode('racing', { resume: false, event: activeEventId });
    },
    onQuit: () => {
      // Quit: full teardown back to MENU (the machine runs the paused mode's
      // registry, then menu's enter resets the world to its idle state).
      modes.enterMode('menu');
    },
  });
  const resultsScreen = createResultsScreen({
    onRetry: () => {
      // RETRY re-runs the event that produced the results — the race
      // result/failure data carries its eventId (task 5.4), falling back
      // to the last active event for the placeholder showResults path.
      const retryEventId =
        (lastEventData && typeof lastEventData.eventId === 'string' && lastEventData.eventId) ||
        activeEventId;
      modes.enterMode('racing', { resume: false, event: retryEventId });
    },
    onMenu: () => {
      modes.enterMode('menu');
    },
  });

  // Task 6.1: UI click ticks on every screen's buttons. Capture-phase
  // listeners on each screen's ROOT (no UI module changes): the tick fires
  // before the button's own handler even when that handler hides the
  // screen. Deliberately not wired to the settings volume slider's drag
  // events — clicking a slider still ticks once on release, which reads as
  // a confirmation.
  for (const screenRoot of [
    mainMenu.root,
    pauseMenu.root,
    resultsScreen.root,
    settingsScreen.root,
  ]) {
    screenRoot.addEventListener('click', () => gameAudio.uiClick(), true);
  }

  /**
   * Start a menu event (task 5.4): resolve the id against the REAL race
   * definitions (races.js) — a Blitz route, or the Cruise event — and
   * enter racing fresh. The route start / countdown / timer / checkpoints
   * are wired by the racing enter hook below; unknown ids are refused
   * (the machine stays untouched, the menu stays up).
   * @param {string} eventId Event id from the clicked menu card.
   * @returns {boolean} Whether the transition happened.
   */
  function startEvent(eventId) {
    const event = resolveRaceEvent(eventId);
    if (!event) return false;
    return modes.enterMode('racing', { resume: false, event: event.id });
  }

  /**
   * Show the results screen through the machine. Since task 5.4 the race
   * controller's finish/fail handlers feed it real data (the failure
   * variant included); console/automation can still preview arbitrary
   * payloads via `__game.showResults({...})`.
   * @param {object} [data] Results payload (see src/ui/results-screen.js).
   * @returns {boolean} Whether the transition happened (racing -> results).
   */
  function showResults(data) {
    return modes.enterMode('results', data ?? {});
  }

  const modes = createModeMachine({
    /**
     * Enter hooks: show the mode's UI, prepare the world for the mode.
     * @param {string} mode Mode being entered.
     * @param {{ from: string | null, data: unknown }} info Navigation context.
     * @returns {void}
     */
    onEnter(mode, { from, data: entry }) {
      switch (mode) {
        case 'menu': {
          mainMenu.setRecords(records); // live records view (5.5 writes them)
          mainMenu.show();
          // Task 6.1 audio policy: no driving voices in the menu (music +
          // UI clicks own it); music plays here — deferred automatically
          // until the first gesture when the player has not interacted yet.
          gameAudio.setDriving(false);
          gameAudio.startMusic();
          if (from !== null) {
            // Returning from play: the race session dies HERE (quit/retry
            // paths can only reach the menu through paused/results, and this
            // covers every one of them), then the world resets to the
            // canonical menu idle — car parked at the spawn, flags cleared.
            teardownRaceSession();
            respawnCarAtSpawn();
          }
          break;
        }
        case 'racing': {
          mainMenu.hide();
          pauseMenu.hide();
          resultsScreen.hide();
          // Task 6.1 audio policy: the engine/skid voices drive in racing
          // (fed per tick by gameAudio.update below); music keeps playing
          // through races. Resume re-arms the voices after a pause ramped
          // them down.
          gameAudio.setDriving(true);
          gameAudio.startMusic();
          if (!entry || !entry.resume) {
            // Fresh entry (menu start / restart / retry): any session that
            // survived into this transition dies first — the "start a race
            // while one is active" guard — then the new event owns the mode.
            teardownRaceSession();
            // Task 5.4: resolve the REAL event (a Blitz route or Cruise;
            // unknown/missing ids fall back to Cruise free-drive).
            const event = resolveRaceEvent(entry && entry.event) ?? CRUISE_EVENT;
            activeEventId = event.id;
            if (event.type === 'blitz' && event.start) {
              // Route start pose straight from the definition (right-hand
              // lane, heading along the road — races.js data, repeatable).
              respawnCarAt(event.start.x, event.start.z, event.start.heading);
            } else {
              respawnCarAtSpawn();
            }
            // The ONE race state machine (task 5.4, design Decision 9):
            // begin() starts the countdown (controls lock — race-events
            // spec "Countdown before control"); its GO boundary starts the
            // race clock; the final gate finishes, zero fails. Cruise is
            // the same controller with no gates and no timer.
            race = createRaceController({
              event,
              hud,
              countdown,
              // Task 6.1: the controller's chime seam is `audio.blip()`; the
              // shim routes it to the real synthesized checkpoint chime (the
              // placeholder audio.blip() is gone — the controller module is
              // untouched and its harness still exercises the same seam).
              audio: { blip: () => gameAudio.checkpointChime() },
              onFinish: onRaceFinished,
              onFail: onRaceFailed,
              // The controller moves the HUD guidance target; main moves
              // the world marker to match it.
              onCheckpoint: (progress) => checkpointMarker.set(progress.checkpoint),
            });
            const firstTarget = race.begin();
            checkpointMarker.set(firstTarget); // null for Cruise: marker hidden
          }
          // resume: touch NOTHING — the race session (timer, checkpoint
          // progress, a countdown frozen mid-number) survived the pause and
          // continues exactly (game-shell spec "timer resuming"; the frozen
          // sim never ticked while paused).
          break;
        }
        case 'paused':
          // Task 6.1 audio policy: the sim is frozen — ramp the engine/skid
          // voices to 0 explicitly (nothing else would, since update() stops
          // running); music keeps the menu-overlay vibe going.
          gameAudio.setDriving(false);
          gameAudio.startMusic();
          pauseMenu.show();
          break;
        case 'results':
          // Task 6.1 audio policy: results land in quiet — the music loop
          // stops so the outcome reads; retry/menu restart it.
          gameAudio.setDriving(false);
          gameAudio.stopMusic();
          lastEventData = entry && typeof entry === 'object' ? entry : null;
          resultsScreen.show(lastEventData ?? undefined);
          break;
        default:
          break;
      }
      // Mode-owned teardown: when THIS mode exits, the machine force-runs
      // these before the next mode's enter hook. Task 5.2's racing mode owns
      // the stuck prompt, the T route, and the impact shake; each screen owns
      // its visibility. The task 5.4 race session is deliberately NOT torn
      // down here (a pause must survive intact) — teardownRaceSession() owns
      // it on the paths that truly end a session; 6.1's race audio will
      // register here the same way as the cleanup above.
      if (mode === 'menu') {
        modes.onCleanup(() => mainMenu.hide());
      } else if (mode === 'racing') {
        modes.onCleanup(() => {
          // Task 5.3/5.4: the ?debug T route + stuck prompt are racing-mode
          // presentation — cleared on every racing exit. The RACE SESSION
          // (controller, countdown, timer, checkpoint HUD state) is
          // deliberately NOT torn down here: a pause must freeze it intact
          // so resume continues exactly (game-shell spec "timer resuming").
          // Every path that genuinely ends a session — fresh entry,
          // finish/fail into results, any return to the menu — goes through
          // teardownRaceSession() instead.
          stopTestRoute();
          hud.showResetPrompt(false);
          hud.hide();
          shakeAmplitude = 0;
        });
      } else if (mode === 'paused') {
        modes.onCleanup(() => pauseMenu.hide());
      } else if (mode === 'results') {
        modes.onCleanup(() => resultsScreen.hide());
      }
      // Task 5.3: the HUD follows the mode — visible in racing only (every
      // entry re-asserts it, so it can never leak into another mode).
      hud.show(mode);
    },
  });

  // Task 5.2: the `pause` action (Esc) finally gets its consumer — pause
  // from racing, resume from paused. The settings screen consumes Escape
  // itself while it is open (its own window listener, registered after the
  // input manager's), so the game backs off while settings is up.
  input.onEdge((edge) => {
    if (edge.type !== 'press' || edge.action !== 'pause') return;
    if (settingsScreen.isOpen()) return;
    if (modes.current === 'racing') {
      modes.enterMode('paused', { reason: 'esc', event: activeEventId });
    } else if (modes.current === 'paused') {
      modes.enterMode('racing', { resume: true, event: activeEventId });
    }
  });

  // R (the `reset` action) recovers the car — racing only since task 5.2
  // (no driving, no recovery, outside a racing session). The press edge only
  // raises a flag; the sim tick below does the teleport so it lands atomically
  // between physics ticks — well inside the spec's ~1 s recovery.
  input.onEdge((edge) => {
    if (edge.type !== 'press' || edge.action !== 'reset') return;
    if (modes.current !== 'racing') return;
    resetRequested = true;
  });

  // Task 3.3 debug helper (?debug only): F wedges the car nose-first against
  // the landmark tower's west wall with zero velocity. Full throttle there
  // cannot move the car, so the ~2 s stuck prompt and the R recovery can be
  // exercised on demand (documented in the quality panel's hint line).
  // Racing-only since task 5.2, like R.
  // Task 5.3 debug helper (?debug only): T starts the 3-checkpoint TEST
  // ROUTE — countdown + locked controls, world marker, edge-arrow guidance,
  // chime + advance on each pass (12 m radius), completion on the third.
  // Task 5.4 policy: T works during Cruise (free roam owns no guidance) but
  // is IGNORED while a Blitz race is counting down or running — the race
  // controller owns the countdown and the checkpoint guidance then.
  // Racing-only, and torn down by the racing mode's cleanup on any exit.
  if (debugEnabled) {
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyF' && event.code !== 'KeyT') return;
      if (modes.current !== 'racing') return;
      if (isEditableTarget(event.target)) return; // typing in a form control
      if (event.code === 'KeyT' && race && !race.isCruise() &&
          (race.phase() === 'countdown' || race.phase() === 'running')) {
        return; // a Blitz race owns the countdown + guidance right now
      }
      event.preventDefault();
      if (event.code === 'KeyF') flipRequested = true;
      else startTestRoute();
    });
  }

  // Diagnostic handle (verification aid): the live app objects exposed for
  // console/DevTools inspection — e.g. `__game.scene.fog`,
  // `__game.camera.position`, `__game.parkedCars.count` — plus the task 4.3
  // `resolve` handle (runs one car-car collision pass), the task 5.1 save
  // handle (`__game.save.key` for corrupting the blob in the console,
  // `__game.save.load()`/`save(data)` for round-trip checks), and — since
  // task 5.2 — the mode machine, the screens, the start/show helpers, and
  // the sim-tick counter the headless harnesses drive. Since task 5.3 it
  // also carries the HUD (with its `parts` DOM seam), the countdown
  // controller, the checkpoint world marker, and the T test-route
  // start/inspector helpers. Read-only by convention; nothing in the game
  // reads it back. Exposed on EVERY boot (not only behind ?debug) since
  // task 5.2: the mode flow is normal play.
  /** @type {{car: object, rig: object, camera: THREE.PerspectiveCamera, scene: THREE.Scene, renderer: THREE.WebGLRenderer, layout: object, graph: object, traffic: object, trafficView: object, parkedCars: object, resolve: Function, settings: object, save: object, modes: import('./game/modes.js').ModeMachine, menu: object, pauseMenu: object, resultsScreen: object, startEvent: Function, showResults: Function, getTickCount: Function, hud: import('./ui/hud.js').Hud, countdown: import('./game/countdown.js').Countdown, checkpointMarker: import('./game/checkpoint-marker.js').CheckpointMarker, startTestRoute: Function, getTestRoute: Function, fps: import('./engine/fps-meter.js').FpsMeter | null}} Debug aid. */
  window.__game = {
    car,
    rig,
    camera,
    scene,
    renderer,
    layout,
    graph,
    traffic,
    trafficView,
    parkedCars,
    resolve: () => resolveCarCollisions(car, traffic, { world }),
    settings: settingsScreen,
    save: {
      key: SAVE_KEY,
      load: () => loadSave(),
      save: (data) => saveSave(data),
    },
    modes,
    menu: mainMenu,
    pauseMenu,
    resultsScreen,
    startEvent,
    showResults,
    getTickCount: () => tickCount,
    hud,
    countdown,
    checkpointMarker,
    startTestRoute,
    getTestRoute: () => testRoute,
    races: RACE_EVENTS, // the task 5.4 route data (console/harness inspection)
    getRace: () => race, // the live race-controller session (null outside racing)
    // Task 6.2: the ?debug FPS sampler (null without ?debug) — read a
    // { avgFps, minFps, frames } snapshot via `__game.fps.read()` for the
    // 60 s >= 55 fps acceptance profile (see the module header).
    fps: fpsMeter,
  };

  // Fixed-timestep engine loop (task 1.2) driving the car (task 3.2): the
  // sim advances at 60 Hz with clamped catch-up; every tick maps the input
  // manager's polled state to car controls (throttle/brake-reverse/steer/
  // handbrake — held keys produce continuous responses per the
  // vehicle-control spec; R/reset is deliberately unmapped until 3.3),
  // snapshots the body origin, and steps the physics. Each render lerps
  // the car's pose between the previous and current tick states using the
  // interpolation alpha (carView handles the shortest-arc heading wrap).
  // The camera rig is a *render-side* consumer: it runs once per frame on
  // the real frame delta (skipped while the overhead view owns the
  // camera), then the impact shake is applied as a temporary camera
  // position offset — safe because rig.update() rewrites camera.position
  // from its own smoothed state every frame, so the offset never
  // accumulates. No per-frame allocations in the hot path — the city is
  // static, only the car moves (task 6.2: enforced for every per-frame
  // update/render function by scripts/perf-audit-test.mjs's static scan).
  //
  // Task 5.2: only RACING ticks the sim. In menu/paused/results the loop
  // keeps running purely for RENDERING (car view, rig smoothing, debug
  // panels) while the update hook returns immediately — the car sits
  // parked, traffic is frozen, and (from 5.4) race timers cannot move, so
  // a paused or menu session is preserved exactly.
  const loop = createFixedTimestepLoop({
    update: (dt) => {
      if (modes.current !== 'racing') return;
      tickCount += 1;
      // Task 3.3: consume press-edge requests inside the tick so a reset or
      // the debug wedge lands atomically before this tick's physics step.
      if (resetRequested) {
        resetRequested = false;
        // Upright on the nearest valid drivable surface (this planar model):
        // the nearest road centerline from wherever the car sits — wedged,
        // against a wall, or out of bounds — with reset() zeroing velocity.
        car.reset(findNearestRoadPosition(layout, car.state.x, car.state.z));
        stuckMonitor.reset(); // fresh stuck timing from the new position
        viewNeedsSnap = true; // render hook snaps the chase rig (a cut, no whoosh)
      }
      if (flipRequested) {
        flipRequested = false;
        // Nose against the tower's west face, a hair clear of the wall so the
        // body starts un-penetrated: holding throttle from here just pushes
        // into the building — the on-demand "immovably stuck" state.
        const tower = layout.landmark;
        const wall = layout.blocks[tower.blockIndex].buildings[tower.buildingIndex];
        const noseOffset = car.config.body.circleOffsetM + car.config.body.circleRadiusM;
        car.reset({
          x: wall.x - wall.w / 2 - noseOffset - 0.15,
          z: wall.z,
          heading: Math.PI / 2, // forward = (+1, 0): facing the tower
        });
        stuckMonitor.reset();
        viewNeedsSnap = true;
      }
      // Task 5.3: advance the countdown on SIM time (pauses freeze it — the
      // whole update hook is skipped outside racing). A GO fired by this
      // call unlocks the controls for THIS tick, so control begins exactly
      // at the GO boundary.
      countdown.update(dt);
      controls.throttle = input.isDown('throttle') ? 1 : 0;
      controls.brake = input.isDown('brake') ? 1 : 0;
      // Screen-correct steer sign: physics +steer turns toward +X, which is
      // screen-LEFT in the chase/hood views — so A/Left drives +1 and
      // D/Right drives -1 (see the SPAWN_* note above).
      controls.steer = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
      controls.handbrake = input.isDown('handbrake');
      // Task 5.3: while the countdown runs, the player "cannot accelerate
      // until it finishes" — throttle/brake/steer are zeroed (handbrake is
      // irrelevant while nothing moves).
      if (countdown.controlsLocked()) {
        controls.throttle = 0;
        controls.brake = 0;
        controls.steer = 0;
      }
      prevPose.x = car.state.x;
      prevPose.z = car.state.z;
      car.step(dt, controls);
      // Task 6.1: feed the engine/skid voices from the fresh post-step state
      // (racing ticks only — pause/menu/results ramp the voices down through
      // setDriving(false) in the mode hooks above).
      gameAudio.update(dt, car.state, controls);
      // Task 3.3: stuck detection samples the post-step state + controls
      // (zero-allocation: reads the live state object directly).
      stuckMonitor.update(dt, car.state, controls);
      // Task 4.2: ambient traffic ticks after the player's step so its
      // ahead-probe and recycle checks see the fresh player position.
      traffic.update(dt, car.state);
      // Task 4.3: the physical car-car layer, last in the tick so both the
      // player and the traffic pool are at their fresh poses: separation +
      // momentum exchange for player-vs-traffic and traffic-vs-traffic,
      // traffic kick/spin fields, and the player's rate-limited impact
      // hook (same channel as the wall-hit shake below).
      resolveCarCollisions(car, traffic, { world });
      // Task 5.4: advance the race session against the FRESH position —
      // the controller observes the countdown's GO boundary (ticked at the
      // top of this hook), then runs the race clock, the ordered checkpoint
      // sequence (out-of-order passes do nothing), the HUD timer, and the
      // expiry check (a timeout fails on this exact tick).
      if (race) race.update(dt, car.state);
      // Task 5.3: sample the ?debug test route against the FRESH position —
      // only the current target is ever tested, so out-of-order passes do
      // nothing (advances fire the chime + move the marker + HUD target).
      if (testRoute) testRoute.update(dt, car.state);
    },
    render: (alpha, info) => {
      carView.update(car.state, controls, alpha, prevPose);
      // Task 4.2: traffic instance matrices from the current sim state (no
      // per-car interpolation — see traffic-view.js's header for the call).
      trafficView.update();
      if (!overhead) {
        if (viewNeedsSnap) {
          // Teleports are cuts: frame the fresh pose immediately (above) so
          // the rig's smoothing resumes from there, with no whoosh.
          rig.snap();
          viewNeedsSnap = false;
        }
        rig.update(info.frameDelta);
        if (shakeAmplitude > 0) {
          // Cheap deterministic jolt: offset the just-updated camera by a
          // decaying multi-frequency wobble (no allocations, no state).
          shakePhase += info.frameDelta * SHAKE_FREQUENCY;
          camera.position.x += Math.sin(shakePhase * 1.13) * shakeAmplitude;
          camera.position.y += Math.sin(shakePhase * 1.71 + 1.3) * shakeAmplitude * 0.5;
          camera.position.z += Math.cos(shakePhase * 1.37 + 0.4) * shakeAmplitude;
          shakeAmplitude *= Math.exp(-SHAKE_DECAY * info.frameDelta);
          if (shakeAmplitude < 0.004) shakeAmplitude = 0;
        }
      }
      renderer.render(scene, camera);
      // Task 5.3 HUD updates (all change-gated, cheap when nothing moved):
      // speedometer from the live car state, the stuck prompt (racing only
      // since 5.2, drawn by the HUD now — one prompt), the checkpoint
      // guidance positioned from the camera's freshly-updated matrixWorld
      // (diamond on-screen / edge arrow off-screen), and the world marker's
      // pulse (wall-clock cosmetic; skips itself while hidden).
      hud.setSpeed(car.state.speed * KMH_PER_MS);
      hud.showResetPrompt(modes.current === 'racing' && stuckMonitor.promptVisible());
      hud.updateCheckpoint(camera);
      checkpointMarker.update(info.frameDelta, camera);
      if (inputOverlay) inputOverlay.update();
      if (audioControls) audioControls.update();
      if (qualityPanel) qualityPanel.update();
    },
  });
  // Task 5.2: boot lands in MENU mode — the menu overlay is up and the world
  // renders frozen behind it at the canonical idle (car parked at the spawn,
  // zero sim ticks). `from` is null here, so the enter hook skips the respawn
  // (the car is already at the spawn from the boot reset above).
  modes.enterMode('menu');
  loop.start();

  // Task 1.5: resize handling lives in the engine renderer module
  // (renderer size + camera aspect kept in sync on every window resize).
  gfx.attachResize(camera);
}

main();
