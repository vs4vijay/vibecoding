// Game flow (D2 state machine): TITLE ⇄ OVERWORLD ⇄ TOWN → COMBAT → outcomes.
// One renderer; scenes swap; DOM overlays (map/HUD/shops) ride above. All
// mutations run through state.js intents — UI never edits game fields.

import * as THREE from 'three';
import { createLoop } from './engine/loop.js';
import { createInput, readDrivingAxes } from './engine/input.js';
import { createFollowCamera } from './engine/camera.js';
import { createAudio } from './engine/audio.js';
import { createDebugPanel } from './ui/debug.js';
import { createHud } from './ui/hud.js';
import { createMapScreen } from './ui/map.js';
import { createShopManager, createUpgradesPanel } from './ui/shops.js';
import { setSfxHandler, sfxUi } from './ui/sfx.js';
import { createCutscenePlayer } from './ui/cutscene.js';
import { showVersus } from './ui/versus.js';
import { createTitleScreen } from './ui/title.js';
import { saveGame, loadGame } from './engine/save.js';
import { createArena } from './game/combat/arena.js';
import { createTownScene } from './game/town/townScene.js';
import {
  createInitialState,
  carDef,
  cargoValue,
  cargoUsed,
  applyVictory,
  applyDefeat,
  grantXp,
} from './game/state.js';
import { planTrip, rollTrip } from './game/travel.js';
import { composeWave, toWaveSpec } from './game/waves.js';
import { activeBounty, settleArrivals, settleBounties } from './game/jobs.js';
import { createRng } from './game/rng.js';
import { region, towns, boss as bossDef } from './game/data/content.js';
import { palette } from './game/data/palette.js';
import { camera as camTuning, combat as cbt } from './game/data/tuning.js';

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const input = createInput();
const audio = createAudio();
const followCam = createFollowCamera(camTuning);
const debug = createDebugPanel();
const hud = createHud();
setSfxHandler((name) => audio.sfx(name));

const state = createInitialState({ seed: Math.floor(Math.random() * 1e9) });

let arena = null;
let town = null;
let mapScreen = null;
let flow = 'title'; // title | overworld | town | combat
let battleTrip = null; // trip data for the current travel battle

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  followCam.resize();
});

// ------------------------------------------------------------- overlays

function toast(text, { small = false, ms = 2000 } = {}) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.getElementById('ui-root').appendChild(root);
  }
  const t = document.createElement('div');
  t.className = `toast${small ? ' small' : ''}`;
  t.textContent = text;
  root.appendChild(t);
  setTimeout(() => t.classList.add('fade'), ms);
  setTimeout(() => {
    t.remove();
    if (!root.children.length) root.remove();
  }, ms + 600);
}

// context prompt bar ("E — enter TRADE")
const promptBar = document.createElement('div');
promptBar.id = 'prompt-bar';
document.getElementById('ui-root').appendChild(promptBar);
function showPrompt(text) {
  if (text) {
    promptBar.innerHTML = text;
    promptBar.classList.add('visible');
  } else {
    promptBar.classList.remove('visible');
  }
}

// ------------------------------------------------------------- flow: map

function showMap() {
  flow = 'overworld';
  arena?.dispose();
  arena = null;
  town = null;
  hud.root.style.display = 'none';
  showPrompt(null);
  if (!mapScreen) {
    mapScreen = createMapScreen({
      state,
      actions: {
        enterTown,
        travel: beginTravel,
        openUpgrades: () => upgradesPanel.open(),
        saveQuit: () => quitToTitle(),
      },
    });
    document.getElementById('ui-root').appendChild(mapScreen.root);
  }
  mapScreen.root.style.display = 'flex';
  mapScreen.sideDefault();
  mapScreen.update();
  mapScreen.placeMarker(state.location.townId ?? state.location.nodeId ?? 'polvo');
}

function hideMap() {
  if (mapScreen) mapScreen.root.style.display = 'none';
}

// ------------------------------------------------------------- flow: town

function enterTown(townId = state.location.townId) {
  hideMap();
  flow = 'town';
  state.location = { kind: 'town', townId };
  arena?.dispose();
  arena = null;
  town?.dispose?.();
  town = createTownScene({
    state,
    townId,
    audio,
    onOpenShop: (kind) => shops.open(kind, townId),
    onExit: () => showMap(),
    onPrompt: (p) => {
      if (!p) return showPrompt(null);
      if (p.type === 'shop') return showPrompt(`<b>E</b> — enter ${p.label}`);
      return showPrompt('<b>E</b> — leave town');
    },
  });
  followCam.snapTo({ x: town.player.x, y: 0, z: town.player.z }, { x: Math.cos(town.player.heading), z: Math.sin(town.player.heading) });
  hud.root.style.display = '';
  const paid = settleArrivals(state, townId);
  for (const p of paid) toast(`Delivered: ${p.name} — +$${p.reward}`);
  saveHook('townEntry');
}

// ------------------------------------------------------------- flow: travel

function beginTravel(toId) {
  const trip = planTrip(state, toId);
  if (!trip || trip.blocked) {
    toast(trip?.reason ?? 'No road.', { small: true });
    return;
  }
  const rolled = rollTrip(state, trip);
  mapScreen.update();
  if (trip.isBossNode) {
    // the Buzzard fight always finds you: versus intro, then the ladder
    hideMap();
    startBossBattle();
    return;
  }
  if (!rolled.ambush) {
    // quiet road: ride straight through
    state.location = { kind: 'town', townId: toId };
    saveHook('travel');
    enterTown(toId);
    toast(`Arrived: ${destinationName(toId)} — the road held`, { small: true });
    return;
  }

  hideMap();
  flow = 'combat';
  battleTrip = { ...trip, ...rolled };

  const waves = buildTripWaves(battleTrip);
  startBattle(waves, {
    onVictory: () => finishTripVictory(),
    onDefeat: () => finishTripDefeat(),
  });
  toast(rolled.bountyName ? `AMBUSH — bounty: ${rolled.bountyName}` : 'AMBUSH!', { small: true });
}

function destinationName(toId) {
  const n = region.nodes[toId];
  if (n.kind === 'town') return towns[toId].name;
  if (n.kind === 'boss') return "Buzzard's Roost";
  return 'North Pass';
}

function finishTripVictory() {
  const trip = battleTrip;
  battleTrip = null;
  state.location = { kind: 'town', townId: trip.toId };
  if (trip.isBossNode) {
    state.bossDefeated = true;
    audio.sfx('victory');
    saveHook('battleWon');
    hideHudForCutscene();
    pendingAfterCutscene = 'boss';
    cutscene.play('bossVictory');
    return;
  }
  saveHook('battleWon');
  enterTown(trip.toId);
}

function hideHudForCutscene() {
  hud.root.style.display = 'none';
  showPrompt(null);
}

function finishTripDefeat() {
  const res = applyDefeat(state);
  battleTrip = null;
  // respawn at the last town (origin of the trip)
  toast(res.usedInsurance ? 'WRECKED — insurance covers the purse. Cargo gone.' : `WRECKED — the bandits take $${res.lostMoney} and all cargo.`, { ms: 3200 });
  audio.sfx('defeat');
  saveHook('battleLost');
  showMap();
}

// ------------------------------------------------------------- flow: battles

function buildTripWaves(trip) {
  if (trip.isBossNode) {
    // minion ladder from the boss script, then the boss car itself
    return [
      ...bossDef.waves.map((w) => toWaveSpec(w.comp, w.label)),
      toWaveSpec([{ archetype: 'boss' }], 'THE BUZZARD'),
    ];
  }
  const rng = createRng((state.seed ^ (state.trips * 2654435761)) >>> 0);
  const bounty = activeBounty(state);
  const forced = trip.forcedBounty && bounty ? [{ archetype: bounty.archetype, name: bounty.name }] : [];
  const comp = composeWave(trip.budget, rng, { forced });
  return [toWaveSpec(comp, trip.forcedBounty ? `Bounty: ${trip.forcedBounty}` : 'Bandits')];
}

function startBattle(waves, flowHooks = null, seed = null) {
  arena?.dispose();
  arena = createArena({
    state,
    seed: seed ?? (state.seed ^ (state.trips * 7919 + battleCount())) >>> 0,
    audio,
    waves,
    onEvent: (e) => {
      if (e.type === 'wave') toast(`WAVE ${e.index + 1} — ${e.label}`, { small: true });
      else if (e.type === 'phase2') toast('THE BUZZARD IS WOUNDED — he drives like a devil now', { ms: 2600 });
    },
    onOutcome: (res) => {
      if (flowHooks) {
        if (res.type === 'victory') applyBattleVictory(res, flowHooks.onVictory);
        else applyBattleDefeat(flowHooks.onDefeat);
        return;
      }
      // qa / free-play battles: respawn for endless sparring
      if (res.type === 'victory') {
        toast('CLEAR — another gang rolls in', { small: true });
        saveHook('battleWon');
        newBattle();
      } else {
        toast('WRECKED — patched up, try again', { small: true });
        state.carHealth = carDef(state).maxHealth;
        saveHook('battleLost');
        newBattle();
      }
    },
  });
  followCam.snapTo(
    { x: arena.player.x, y: 0, z: arena.player.z },
    { x: Math.cos(arena.player.heading), z: Math.sin(arena.player.heading) }
  );
  hud.root.style.display = '';
}

let battleCounter = 0;
function battleCount() {
  return ++battleCounter;
}

function applyBattleVictory(res, then) {
  const healShare = cbt.fieldRepairShare * state.upgrades.repair;
  const heal = Math.round(healShare * carDef(state).maxHealth);
  const bounty = res.bountyTarget ? settleBounties(state, res.bountyTarget) : null;
  const out = applyVictory(state, {
    xp: res.xp,
    heal,
    bountyReward: bounty?.reward ?? 0,
    kills: res.kills,
  });
  state.carHealth = arena.player.health; // carry battle damage into the world
  if (out.leveled.length) {
    toast(`LEVEL ${out.leveled[out.leveled.length - 1]} — upgrade point earned (spend it on the map)`, { ms: 3000 });
    audio.sfx('levelUp');
  }
  if (heal > 0) toast(`Tinkerer patches +${heal} hull`, { small: true });
  if (bounty) toast(`Bounty paid: ${bounty.name} +$${bounty.reward}`, { ms: 3000 });
  then?.();
}

function applyBattleDefeat(then) {
  then?.();
}

// raw battle entry (qa + debug)
function newBattle(waves = null) {
  battleTrip = null;
  flow = 'combat';
  hideMap();
  startBattle(waves ?? [{ label: 'Bandit scout', comp: ['scout'] }], null);
}

function startBossBattle() {
  flow = 'combat';
  hideMap();
  battleTrip = { isBossNode: true, toId: 'buzzardsRoost' };
  // versus intro first (8.3), fight begins on FIGHT
  showVersus({
    leftName: 'The Drifter',
    leftTitle: 'You',
    rightName: bossDef.name,
    rightTitle: bossDef.title,
    onStart: () => {
      startBattle(buildTripWaves({ isBossNode: true }), {
        onVictory: () => finishTripVictory(),
        onDefeat: () => finishTripDefeat(),
      });
    },
  });
}

// ------------------------------------------------------------- shops

const shops = createShopManager({
  state,
  onClose: () => town?.closeShop?.(),
});
const upgradesPanel = createUpgradesPanel({ state });
const cutscene = createCutscenePlayer({
  onDone: () => {
    if (pendingAfterCutscene === 'map') showMap();
    else if (pendingAfterCutscene === 'boss') {
      pendingAfterCutscene = null;
      showMap();
      toast('The wire gate at North Pass stands open — the Basin is endless now.', { ms: 3600 });
    }
    pendingAfterCutscene = null;
  },
});
let pendingAfterCutscene = null;

// ------------------------------------------------------------- save hook

function saveHook(_reason) {
  const res = saveGame(state);
  if (!res.ok) console.warn('save failed:', res.reason);
}

// ------------------------------------------------------------- title / new game

let titleScreen = null;

function showTitle() {
  flow = 'title';
  arena?.dispose();
  arena = null;
  town?.dispose?.();
  town = null;
  hideMap();
  hud.root.style.display = 'none';
  showPrompt(null);
  audio.setEngine(false);
  titleScreen?.destroy();
  titleScreen = createTitleScreen({
    onContinue: () => {
      const loaded = loadGame();
      if (loaded) {
        Object.assign(state, loaded);
        toast(`Welcome back — Day ${state.day}, $${state.money}`, { ms: 2600 });
      }
      showMap();
    },
    onNewGame: () => {
      Object.assign(state, createInitialState({ seed: Math.floor(Math.random() * 1e9) }));
      pendingAfterCutscene = 'map';
      cutscene.play('opening');
      audio.sfx('sting');
    },
  });
}

function quitToTitle() {
  const res = saveGame(state);
  toast(res.ok ? 'Saved. See you on the road.' : 'Save failed!', { small: true });
  showTitle();
}

// ------------------------------------------------------------- loop

const loop = createLoop({
  hz: cbt.simHz,
  update(step) {
    if (flow === 'combat' && arena) {
      const axes = readDrivingAxes(input);
      const aim = input.mouse.hasWorld ? { x: input.mouse.worldX, z: input.mouse.worldZ } : null;
      arena.update(step, { throttle: axes.throttle, steer: axes.steer, aim, fire: input.mouse.down });
    } else if (flow === 'town' && town) {
      const axes = readDrivingAxes(input);
      town.update(step, { throttle: axes.throttle, steer: axes.steer, interact: input.wasPressed('KeyE') || input.wasPressed('Enter') });
    }
  },
  render(dt, alpha) {
    if (flow === 'combat' && arena) {
      const aim = followCam.screenToGround(input.mouse.x, input.mouse.y);
      if (aim) {
        input.mouse.worldX = aim.x;
        input.mouse.worldZ = aim.z;
        input.mouse.hasWorld = true;
      }
      arena.render(dt, alpha, followCam);
      renderer.render(arena.scene, followCam.camera);
      hud.update(state, arena.player, dt);
    } else if (flow === 'town' && town) {
      town.render(dt, alpha, followCam);
      renderer.render(town.scene, followCam.camera);
      hud.update(state, town.player, dt);
    } else {
      // map/title: dim canvas idle
      renderer.clear();
    }
    debug.render();
    input.endFrame();
  },
});

// ------------------------------------------------------------- debug

debug.section('flow', () => `state: ${flow} | loc: ${JSON.stringify(state.location)} | day ${state.day} | trips ${state.trips}`);
debug.section('progress', () => `lvl ${state.level} · xp ${state.xp}/${35 + 15 * (state.level - 1)} · pts ${state.points}\ntracks: reload ${state.upgrades.reload} / repair ${state.upgrades.repair} / sight ${state.upgrades.sight}\ninsured: ${state.insurance ? 'yes' : 'no'} · boss: ${state.bossDefeated ? 'dead' : 'alive'}`);
debug.section('player', () => {
  const p = arena?.player ?? town?.player;
  if (!p) return '—';
  return (
    `pos: ${p.x.toFixed(1)},${p.z.toFixed(1)} | hp ${Math.round(p.health)}/${p.maxHealth}\n` +
    `speed: ${p.drive.speedFwd.toFixed(1)} (top ${p.drive.def.topSpeed}) | road: ${p.drive.onRoad}`
  );
});
debug.section('money', () => `$${state.money} · cargo ${cargoUsed(state)} ($${cargoValue(state)})`);

// ------------------------------------------------------------- boot

// Boot: title screen with continue/new-game (9.2). New game plays the
// opening beat, then the overworld.
boot();

function boot() {
  loop.start();
  showTitle();
}

// debug/qa hooks
window.__vp = {
  loop,
  input,
  audio,
  debug,
  followCam,
  get arena() {
    return arena;
  },
  get town() {
    return town;
  },
  newBattle,
  startBossBattle,
  showMap,
  enterTown,
  beginTravel,
  state,
  hud,
  get flow() {
    return flow;
  },
  setFlow(f) {
    flow = f;
  },
  showTitle,
  saveGame: () => saveGame(state),
  loadGame,
  quitToTitle,
};
