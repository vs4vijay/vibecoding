import { BIKES, ECONOMY, LEVELS, SIM, VIEW } from "./config";
import { MAX_SPEED } from "./config";
import { GameLoop } from "./core/loop";
import { InputManager } from "./core/input";
import type { UiAction } from "./core/input";
import { clamp } from "./core/math";
import { AudioEngine } from "./audio/audio";
import { AppModel } from "./ui/state";
import { ScreenManager } from "./ui/screens";
import { projectForSprite, renderWorld, updateCamera } from "./render/road";
import type { CameraView } from "./render/road";
import { drawRiders, drawTraffic } from "./render/rider-view";
import { renderHud } from "./render/hud";
import { ParticleSystem } from "./render/fx";
import { createWorld, drainEvents, stepWorld } from "./sim/world";
import type { RaceEventType, RaceState } from "./sim/types";
import type { InputState } from "./core/input";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const overlayRoot = document.getElementById("overlay-root") as HTMLElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const input = new InputManager();
input.attach();
const audio = new AudioEngine();
const fx = new ParticleSystem();
const app = new AppModel(ECONOMY.startMoney);
const screens = new ScreenManager(overlayRoot, app);

let race: RaceState | null = null;
let demo: RaceState | null = null;
let demoCount = 0;
let lastCam: CameraView | null = null;
let resultsShown = false;

const DEMO_INPUT: InputState = {
  throttle: true,
  brake: false,
  left: false,
  right: false,
  attackL: false,
  attackR: false,
};

// Unlock audio on the first gesture (browser autoplay policy).
const unlock = (): void => audio.unlock();
window.addEventListener("keydown", unlock, { once: true });
window.addEventListener("pointerdown", unlock, { once: true });

app.onDidChange(() => screens.show());
screens.show();

function makeDemo(): RaceState {
  // Attract mode behind the menus: cycle the ladder so every palette shows.
  const levelIdx = demoCount % LEVELS.length;
  demoCount += 1;
  return createWorld({
    levelIdx,
    level: LEVELS[levelIdx]!,
    bike: BIKES[0]!,
    seed: 9001 + demoCount * 7919,
  });
}

function raceMax(state: RaceState): number {
  return MAX_SPEED * state.cfg.level.maxSpeedMul * state.cfg.bike.topSpeedMul;
}

function handleIntent(): void {
  const it = app.intent;
  if (!it) return;
  app.intent = null;
  if (it.type === "start-race") {
    const levelIdx = clamp(it.levelIdx, 0, LEVELS.length - 1);
    race = createWorld({
      levelIdx,
      level: LEVELS[levelIdx]!,
      bike: BIKES[clamp(it.bikeIdx, 0, BIKES.length - 1)]!,
      // Fresh seed per run, not per page load (GAMES.md determinism gotcha).
      seed: (Date.now() & 0x7fffffff) >>> 0,
    });
    resultsShown = false;
    fx.clear();
    app.setPhase("race");
  } else if (it.type === "quit-to-title") {
    race = null;
    demo = makeDemo();
  }
}

function eventAnchor(state: RaceState, cam: CameraView | null, z: number, x?: number): { x: number; y: number } {
  if (cam) {
    const p = projectForSprite(state, cam, z, x ?? 0);
    if (p) return p;
  }
  return { x: VIEW.width / 2, y: VIEW.height * 0.82 };
}

function handleEvents(state: RaceState, cam: CameraView | null): void {
  for (const ev of drainEvents(state)) {
    const at = eventAnchor(state, cam, ev.z, ev.x);
    switch (ev.type as RaceEventType) {
      case "swing":
        audio.play("punch");
        break;
      case "hit-given":
        audio.play("hit");
        fx.emit("sparks", at.x, at.y);
        break;
      case "hit-taken":
        audio.play("hit");
        fx.emit("sparks", at.x, at.y);
        break;
      case "knockdown":
        audio.play("knockdown");
        fx.emit("stars", at.x, at.y);
        break;
      case "crash":
      case "traffic-hit":
      case "wrecked":
        audio.play("crash");
        fx.emit("debris", at.x, at.y);
        fx.emit("sparks", at.x, at.y);
        break;
      case "remount":
        audio.play("remount");
        fx.emit("smoke", at.x, at.y);
        break;
      case "near-miss":
        audio.play("near-miss");
        fx.emit("speedlines", VIEW.width / 2, VIEW.height / 2);
        break;
      case "countdown-beep":
        audio.play("beep");
        break;
      case "go":
        audio.play("go");
        break;
      case "finish":
        audio.play("finish");
        break;
      default:
        break;
    }
  }
}

const UI_ACTIONS: UiAction[] = ["confirm", "back", "pause", "menu-left", "menu-right"];

function update(dt: number): void {
  for (const a of UI_ACTIONS) {
    if (!input.wasPressed(a)) continue;
    // Mid-race both Esc and P open the pause menu; menus handle "back" as quit.
    if ((a === "pause" || a === "back") && app.phase === "race") {
      app.setPhase("paused");
    } else {
      app.handleAction(a);
    }
  }
  if (input.wasPressed("mute")) {
    app.toggleMute();
    audio.setMuted(app.muted);
  }
  input.consumeActions();
  handleIntent();

  // Leaving to the title retires any frozen race; attract mode takes over.
  if (app.phase === "title" && race) {
    race = null;
    demo = makeDemo();
  }

  if (race && (app.phase === "race" || app.phase === "paused")) {
    if (app.phase === "race") {
      stepWorld(race, input.snapshot());
      handleEvents(race, lastCam);
      if (race.results && !resultsShown) {
        resultsShown = true;
        audio.setSiren(false);
        app.showResults(race.results);
      }
    }
    const max = raceMax(race);
    const rpm = clamp(race.player.speed / max, 0, 1);
    audio.setEngine(rpm, app.phase === "race" && input.snapshot().throttle ? 1 : 0.25);
    const copNear = race.rivals.some(
      (r) => r.kind === "cop" && Math.abs(r.z - race!.player.z) < 15000,
    );
    audio.setSiren(copNear && race.phase === "racing");
  } else {
    audio.setEngine(0, 0);
    audio.setSiren(false);
    if (app.phase === "title" || app.phase === "select" || app.phase === "credits") {
      if (!demo || demo.results !== null || demo.phase === "busted" || demo.phase === "wrecked") {
        demo = makeDemo();
      }
      stepWorld(demo, DEMO_INPUT);
      drainEvents(demo); // menus are silent
    }
  }
}

function fitCanvasTransform(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0710";
  ctx.fillRect(0, 0, w, h);
  const scale = Math.min(w / VIEW.width, h / VIEW.height);
  const ox = (w - VIEW.width * scale) / 2;
  const oy = (h - VIEW.height * scale) / 2;
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
}

function render(frameDt: number): void {
  fitCanvasTransform();
  const inRace = race !== null && (app.phase === "race" || app.phase === "paused" || app.phase === "results" || app.phase === "gameover");
  const state = inRace ? race : demo;
  if (!state) return;

  const cam = updateCamera(state, VIEW.width, VIEW.height);
  lastCam = cam;
  renderWorld(ctx, state, cam);
  drawTraffic(ctx, state, cam);
  drawRiders(ctx, state, cam);

  if (state.cfg.level.weather === "snow") {
    fx.emitAmbientSnow(VIEW.width, VIEW.height, frameDt);
  }
  fx.step(frameDt);
  fx.draw(ctx);

  if (inRace) {
    renderHud(ctx, state, { muted: app.muted, levelName: state.cfg.level.name });
  }
}

const loop = new GameLoop(SIM.step, update, render);
loop.start();
