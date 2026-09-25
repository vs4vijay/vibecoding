// Boot per ARCHITECTURE.md: WebGL2 renderer (antialias, ACESFilmic,
// SRGBColorSpace, pixelRatio clamp 2), scene + FogExp2 deep purple, camera,
// Photo API query params, window.__NR debug API. Renders directly unless
// fx/PostFX.js exists (guarded dynamic import — W1-FX drops it in).
import * as THREE from 'three';
import { Game } from './core/Game.js';
import { Input } from './core/Input.js';
import { UI } from './ui/UI.js';
import { bus } from './core/EventBus.js';
import { save } from './core/Save.js';
import { quality } from './core/Quality.js';
import { PhaseRegistry } from './phases/Phase.js';
import { COL } from './core/Palette.js';
import { makeSky } from './fx/Shaders.js'; // W1-VIS: real sky dome
import { Props } from './world/Props.js';  // W1-VIS: chunk dressing
import { Static } from './world/Static.js'; // W1-VIS: chaser wall
import { PostFX } from './fx/PostFX.js'; // [W1-FX] post stack
import { FX } from './fx/FX.js';         // [W1-FX] pooled particles
import { Audio } from './audio/Audio.js'; // [W1-AUDIO] synth engine (owns all bus wiring)
import { economy } from './game/Economy.js'; // [W1-UI] meta economy (shop/XP/boxes/settings)
import { missions } from './game/Missions.js'; // [W1-UI] 3 active missions, auto-refill
import { daily } from './game/Daily.js'; // [W1-UI] date-seeded daily runs + streaks
import { Feel } from './game/Feel.js'; // [W1-FEEL] hitstop/slow-mo/death cam/haptics/FOV kick

const params = new URLSearchParams(location.search);
const PHOTO = params.get('photo') || '';
const canvas = document.getElementById('game');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  const err = document.createElement('div');
  err.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#ff3355;font-family:monospace;z-index:99';
  err.textContent = 'NEON RUSH: WebGL2 unavailable — ' + e.message;
  document.body.appendChild(err);
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
quality.onApply = (flags) => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, flags.pixelRatio));
quality.adaptive = !PHOTO && !params.has('debug'); // deterministic screenshots
quality.apply();

const scene = new THREE.Scene();
scene.background = COL.deep.clone();
scene.fog = new THREE.FogExp2(COL.deep.getHex(), 0.0075);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1200);
camera.position.set(0, 4.4, 7.6);

// lights: cool key + magenta rim from ahead (player silhouettes against the sun)
scene.add(new THREE.HemisphereLight(0x9a6bff, 0x120a2a, 0.85));
const key = new THREE.DirectionalLight(0xbfe9ff, 1.5);
key.position.set(6, 14, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(COL.magenta.getHex(), 0.9);
rim.position.set(-5, 6, -12);
scene.add(rim);

// sky dome: multi-stop gradient, banded sun, stars, nebula (fx/Shaders.js — W1-VIS)
{
  const sky = makeSky();
  scene.add(sky);
  window.__NR_SKY = sky.material; // W1-VIS tweak handle; not part of the contract
}

const input = new Input(window);
const game = new Game({ scene, camera, renderer, input });
input.clock = game.time; // buffer presses in game-time so slow frames never eat input
const ui = new UI(game, save);

// --- W1-VIS world look registration (marked integration point) ----------------
// Props: per-chunk dressing (buildings, gates, billboards, ridges) hooked into
// Track.decorate — attaches pooled/prebuilt groups, recycles automatically.
// Static: chaser wall + top-edge static fringe, driven by bus events.
Props.register(game.track, scene);
Static.init(scene, bus, camera);

// --- PostFX registration point (W1-FX) ---------------------------------------
// fx/PostFX.js doesn't exist in W0, and probing it with fetch/import would log
// a 404 console error that trips the QA harness. So: render directly, and
// expose a registration hook. W1-FX integrates with ONE line anywhere after
// their module loads:   __NRRegisterPostFX(PostFX)   // PostFX.init/render/resize
let composer = null;
function registerPostFX(mod) {
  if (mod && mod.init) {
    mod.init(renderer, scene, camera);
    composer = mod; // expected surface: init(renderer,scene,camera), render(), resize(w,h)
  }
}
window.__NRRegisterPostFX = registerPostFX;

// --- [W1-FX] particle FX + post stack registration -----------------------------
FX.init(scene);            // pooled systems + bus wiring
FX.watch(game);            // gameplay reader for jump/land/slide dust + trail
registerPostFX(PostFX);    // init(renderer,scene,camera) → composer becomes active
bus.on('death', () => game.camRig.shake(0.55)); // [W1-FX] impact shake (PostFX does the flash/CA kick)

// --- [W1-AUDIO] audio registration ----------------------------------------------
Audio.init({ save, bus }); // unlock-on-gesture, music sequencer, SFX bank, mute, legacy provider

// --- [W1-UI] meta registration (marked integration point) ------------------------
economy.init({ game, save, bus, quality });   // shop catalog, XP levels, boxes, persisted settings
missions.init({ save, bus, economy });        // rolls 3 active missions, wires progress events
daily.init({ save, bus, economy });           // daily seed, one scored attempt/day, streaks

// --- [W1-FEEL] game-feel registration (marked integration point) ------------------
Feel.init(game); // near-miss hitstop/slow-mo, death cam, haptics, FOV kicks, fever event

function render() {
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer && composer.resize) composer.resize(w, h);
}
addEventListener('resize', resize);
resize();

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'RUN') game.pause();
});

// --- Photo API (kept in sync with tools/shot.mjs) -----------------------------
// ?photo=run|menu|death|...&at=<s>&m=<meters>&seed=<n>&tier=<combo-tier>
// Applied BEFORE the ready promise resolves so harness steps stack on top.
function photoSetup() {
  if (!PHOTO) return;
  const seed = parseInt(params.get('seed'), 10);
  if (Number.isFinite(seed)) game.seedForced = seed >>> 0;
  const at = parseFloat(params.get('at')) || 0;
  const m = parseFloat(params.get('m'));
  const tier = parseInt(params.get('tier'), 10);
  const begin = () => {
    game.forceState('RUN');
    if (Number.isFinite(m)) game.teleport(m);
    if (Number.isFinite(tier) && tier > 1) game.scoring.forceTier(tier);
    if (at > 0) game.warp(Math.min(at, 720));
  };
  if (PHOTO === 'menu') { game.forceState('MENU'); return; }
  if (PHOTO === 'run') { begin(); return; }
  if (PHOTO === 'death') { begin(); game.forceState('DEAD'); return; }
  // [W1-UI] meta screens (Photo API contract lists ?photo=shop)
  if (PHOTO === 'shop' || PHOTO === 'missions' || PHOTO === 'settings') {
    game.forceState('MENU');
    ui.show(PHOTO);
    return;
  }
  // phase photos: flight/drift/hopper/stack/orb (registered by later waves)
  if (PhaseRegistry.has(PHOTO)) {
    begin();
    game.forcePhase(PHOTO);
    if (at > 0) game.warp(Math.min(at, 720));
  }
}

// --- debug API (EXACT contract) --------------------------------------------------
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });

window.__NR = {
  ready,
  game,
  scene,
  camera,
  renderer,
  warp: (seconds) => game.warp(seconds),
  forceState: (name) => game.forceState(name),
  forcePhase: (id) => game.forcePhase(id),
  teleport: (meters) => game.teleport(meters),
  stats: () => game.stats(),
  ui,
  bus,
};

// boot: menu state → photo setup → first rendered frame → ready
game.toMenu();
photoSetup();
render();
readyResolve();

// Photo mode freezes realtime: after the deterministic photoSetup (+ any
// subsequent __NR.* calls from the harness), the RAF loop only renders. Same
// seed → identical state at screenshot time, regardless of page-load timing.
const PHOTO_FROZEN = !!PHOTO;

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = (now - last) / 1000;
  last = now;
  if (dt <= 0) return;
  if (!PHOTO_FROZEN) {
    input.poll(); // gamepad edges → buffered actions, before the sim consumes them (D5)
    game.update(dt);
  } else {
    game.camRig.apply();
  }
  ui.update(dt);
  // [W1-FX] particle update + post pulse decay; speed 12..40 → 0..1 for CA/streaks
  FX.update(dt);
  PostFX.update(dt);
  PostFX.setSpeed((game.ctx.speed - 12) / 28);
  Feel.update(dt); // [W1-FEEL] Time.scale decay, death cam, box bob (after camRig)
  const frac = game.ctx.speed * game.time.acc; // render = scroll + speed·acc (contract)
  game.track.applyRender(game.track.scroll + frac, game.time.gameTime);
  render();
}
requestAnimationFrame(loop);
