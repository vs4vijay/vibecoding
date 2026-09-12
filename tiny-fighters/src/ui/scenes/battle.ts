// src/ui/scenes/battle.ts — the integration scene: builds SlotConfig[] →
// spawnMatch → router wiring → 60 Hz loop stepping stepWorld; events feed
// audio + HUD flashes; Esc opens the Pause overlay (Resume/Remap/Quit) which
// freezes stepping while mounted (spec §4); match end captures the final
// state and navigates to Results.
import { createLoop } from "../loop";
import { el } from "../kit";
import { spawnMatch, stepWorld } from "../../sim/world";
import type { SimContext } from "../../sim/world";
import type { InputFrame, SimEvent, WorldState } from "../../sim/types";
import { MAX_FIGHTERS } from "../../sim/constants";
import { createKeyboardSource, resolveKeymaps, type Source } from "../../input/keyboard";
import { systemSnapshot, type SnapshotProvider } from "../../input/gamepad";
import { createRouter, type RoutedSource } from "../../input/router";
import { createCompositeSource } from "../../input/composite";
import { createRenderer } from "../../render/renderer";
import type { Renderer } from "../../render/renderer";
import type { Assets } from "../../render/types";
import { loadAtlas } from "../../render/atlas";
import { buildPauseOverlay, buildRemapOverlay } from "../overlays";
import type { Scene, SceneCtx } from "../scene-manager";
import { createTouchSource, hasTouch, type TouchSource } from "../../input/touch";
import { mountTouchPad } from "../touchpad";
import type { MatchOutcome } from "./results";
import { buildSlotConfigs, type MatchSetup } from "../flow";

const TICK_MS = 1000 / 60;
const MAX_CATCH_UP_MS = 250;
const FLASH_TICKS = 10;

interface FlashState {
  strength: number;
  ticks: number;
}

export function createBattleScene(
  content: () => {
    ctx: SimContext;
    stages: Assets["stages"];
  },
  loadArt: () => Promise<Omit<Assets, "sheets" | "stages">>,
): Scene {
  const root = el("div", { cls: "scene battle" });
  let ctxRef: SceneCtx | undefined;
  let setup: MatchSetup | null = null;

  let world: WorldState | null = null;
  let simCtx: SimContext | null = null;
  let assets: Assets | null = null;
  let artPromise: Promise<void> | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let renderer: Renderer | null = null;
  let pollInputs: (() => InputFrame[]) | null = null;
  let detachEsc: (() => void) | null = null;
  let touch: TouchSource | null = null;
  let destroyTouchPad: (() => void) | null = null;
  let paused = false;
  let outcome: MatchOutcome | null = null;
  const kills = new Array<number>(MAX_FIGHTERS).fill(0);
  const deaths = new Array<number>(MAX_FIGHTERS).fill(0);
  const flashes: FlashState[] = Array.from({ length: MAX_FIGHTERS }, () => ({ strength: 0, ticks: 0 }));
  const padProviders: SnapshotProvider[] = [];

  // --- input wiring ---------------------------------------------------------

  /** Keyboard per joined human slot (resolved keymaps incl. P3 fallback);
   * gamepads by connection order; bots handled inside stepWorld. */
  function wireSources(): void {
    if (setup === null) return;
    const humans = setup.humans.length > 0 ? [...setup.humans] : [0];
    const keymaps = resolveKeymaps(humans);
    padProviders.length = 0;
    const routed: RoutedSource[] = [];
    for (const [i, slot] of humans.entries()) {
      const keyboard = createKeyboardSource(globalThis.document, keymaps[slot] ?? keymaps[0]!);
      const padIndex = setup.padsBySlot[slot];
      // Touch pad drives the first human slot; everywhere else it is absent.
      const touchSource = i === 0 ? touch : null;
      if (padIndex === undefined && touchSource === null) {
        routed.push({ slot, source: keyboard });
        continue;
      }
      const pads: SnapshotProvider[] = [];
      if (padIndex !== undefined) {
        const provider: SnapshotProvider = () => systemSnapshot(padIndex);
        padProviders.push(provider);
        pads.push(provider);
      }
      routed.push({ slot, source: createCompositeSource({ keyboard, pads, ...(touchSource !== null ? { touch: touchSource } : {}) }) });
    }
    pollInputs = createRouter(routed).poll;
  }
  // --- pause ----------------------------------------------------------------

  function togglePause(): void {
    if (ctxRef === undefined || world === null || paused || world.over) return;
    paused = true;
    ctxRef.sm.overlay(buildPauseOverlay({
      onResume() {
        ctxRef?.sm.closeOverlay();
        paused = false;
      },
      onRemap() {
        ctxRef?.sm.closeOverlay(); // swap pause → remap on the overlay stack
        openRemap();
      },
      onQuit() {
        ctxRef?.sm.closeOverlay();
        teardown();
        ctxRef?.goto("title");
      },
    }));
  }

  function openRemap(): void {
    if (ctxRef === undefined) return;
    ctxRef.sm.overlay(buildRemapOverlay({
    onClose() {
      // Pop the remap overlay first (it pushed itself onto the overlay stack),
      // then re-open pause so Resume stays reachable.
      ctxRef?.sm.closeOverlay();
      paused = false;
      togglePause();
    },
    }));
  }

  function attachEsc(): void {
    detachEsc?.();
    const listener = (ev: Event): void => {
      const e = ev as KeyboardEvent;
      if (e.code === "Escape") togglePause();
    };
    globalThis.document.addEventListener("keydown", listener);
    detachEsc = () => globalThis.document.removeEventListener("keydown", listener);
  }

  // --- match lifecycle ------------------------------------------------------

  function startMatch(): void {
    const c = content();
    simCtx = c.ctx;
    const stage = c.stages.get(setup!.stageId);
    if (stage === undefined) throw new Error(`battle: unknown stage "${setup!.stageId}"`);
    // Brief: battle builds SlotConfig[] from select state right here.
    const slots = buildSlotConfigs(setup!.selectSlots, setup!.mode);
    world = spawnMatch({ seed: setup!.seed, stage, slots, sheets: simCtx!.sheets });
    setup!.humans = slots.map((s, i): number => (s.isHuman ? i : -1)).filter((i) => i >= 0);
    kills.fill(0);
    deaths.fill(0);
    for (const f of flashes) {
      f.strength = 0;
      f.ticks = 0;
    }
    paused = false;
    outcome = null;
    destroyTouchPad?.();
    destroyTouchPad = null;
    touch = null;
    if (hasTouch()) {
      touch = createTouchSource();
      destroyTouchPad = mountTouchPad(root, touch, togglePause);
    }
    wireSources();
    attachEsc();
    renderer = createRenderer();
    loop = createLoop({ tickMs: TICK_MS, maxCatchUpMs: MAX_CATCH_UP_MS, update: tick, render: draw });
    loop.start();
    ctxRef?.audio.playMusic(setup!.stageId);
    loadArtAsync(c.stages);
  }

  function loadArtAsync(stages: Assets["stages"]): void {
    if (artPromise !== null || assets !== null) return;
    artPromise = loadArt()
      .then((art) => {
        assets = { ...art, sheets: simCtx !== null ? simCtx.sheets : new Map(), stages };
      })
      .catch(() => {
        assets = null; // §4 art-failure policy: magenta boxes, match continues.
      });
  }

  function tick(): void {
    if (world === null || simCtx === null || pollInputs === null || paused || world.over) return;
    const result = stepWorld(world, pollInputs(), simCtx);
    world = result.state;
    tally(result.events);
    for (const f of flashes) if (f.ticks > 0) f.ticks--;
    if (world.over) finish(result.events);
  }

  function tally(events: readonly SimEvent[]): void {
    let pendingAttacker: number | null = null;
    for (const e of events) {
      ctxRef?.audio.onEvent(e);
      if (e.type === "hit") {
        pendingAttacker = e.attacker;
        const f = flashes[e.victim];
        if (f !== undefined) {
          f.strength = e.heavy ? 1 : 0.5;
          f.ticks = FLASH_TICKS;
        }
      } else if (e.type === "ko") {
        const d = deaths[e.victim];
        if (d !== undefined) deaths[e.victim] = d + 1;
        if (pendingAttacker !== null && pendingAttacker !== e.victim) {
          const k = kills[pendingAttacker];
          if (k !== undefined) kills[pendingAttacker] = k + 1;
        }
        pendingAttacker = null;
      }
    }
  }

  function finish(events: readonly SimEvent[]): void {
    loop?.stop();
    const endEvent = events.find((e): e is Extract<SimEvent, { type: "matchEnd" }> => e.type === "matchEnd");
    outcome = {
      winnerTeam: endEvent !== undefined ? endEvent.winnerTeam : "draw",
      kd: (world?.fighters ?? []).map((f) => ({
        slot: f.slot,
        charId: f.charId,
        team: f.team,
        isHuman: !f.isBot,
        kills: kills[f.slot] ?? 0,
        deaths: deaths[f.slot] ?? 0,
      })),
    };
    ctxRef?.goto("results", { setup, outcome });
  }

  function draw(): void {
    if (world === null) return;
    const canvas = globalThis.document.querySelector<HTMLCanvasElement>("#game");
    if (canvas === null) return;
    const g = canvas.getContext("2d");
    if (g === null) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (renderer !== null && assets !== null) renderer.draw(world, g, assets);
  }

  // --- scene contract -------------------------------------------------------

  return {
    root,
    enter(c?: SceneCtx) {
      ctxRef = c ?? ctxRef;
      const arg = ctxRef?.gotoArg as MatchSetup | undefined;
      if (arg !== undefined && Array.isArray(arg.selectSlots)) {
        setup = arg;
        outcome = null;
        startMatch();
      }
    },
    exit() {
      teardown();
    },
    update() {},
  };

  function teardown(): void {
    loop?.stop();
    loop = null;
    detachEsc?.();
    detachEsc = null;
    destroyTouchPad?.();
    destroyTouchPad = null;
    touch = null;
    pollInputs = null;
    world = null;
    paused = false;
  }
}
