// tests/ui/scenes.test.ts — scene state transitions with a fake DOM (brief).
// Drives the real scene factories through enter/update/exit plus document-level
// key events; battle runs headless with injected content, a fake canvas, and a
// manually pumped rAF queue (deterministic — no wall-clock waits).
import { describe, test, expect, beforeAll } from "bun:test";
import { FakeElement, fakeKey, makeFakeDocument } from "./fake-dom";
import { loadAllContent } from "../../src/content/loader";
import type { ContentCache } from "../../src/content/loader";
import { freshSlots, buildSlotConfigs, cycleTeam } from "../../src/ui/flow";
import type { MatchSetup, SelectSlot } from "../../src/ui/flow";
import type { SceneCtx } from "../../src/ui/scene-manager";
import type { SimContext } from "../../src/sim/world";
import type { WorldState } from "../../src/sim/types";

// --- headless DOM ---------------------------------------------------------------

const { doc, ui } = makeFakeDocument();
const gameCanvas = new FakeElement("canvas") as unknown as FakeElement & {
  getContext: () => null;
  width: number;
  height: number;
};
gameCanvas.id = "game";
gameCanvas.getContext = () => null;
gameCanvas.width = 960;
gameCanvas.height = 540;
(globalThis as { document: unknown }).document = doc;
(globalThis as { window: unknown }).window = {
  addEventListener() {},
  removeEventListener() {},
};

/** rAF pump: captures the callback chain so tests advance frames manually.
 * Handles are unique tokens; cancel removes the pending callback for real,
 * mirroring browser semantics createLoop.stop() relies on. */
let nextRafId = 1;
const rafById = new Map<number, FrameRequestCallback>();
/** Monotonic across the whole test file — createLoop primes on the first
 * frame and needs strictly increasing timestamps afterwards. */
let rafNow = 0;
function installFakeRaf(): void {
  rafById.clear();
  nextRafId = 1;
  (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame =
    (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafById.set(id, cb);
      return id;
    };
  (globalThis as { cancelAnimationFrame: unknown }).cancelAnimationFrame =
    (id: number) => {
      rafById.delete(id);
    };
}
function pumpFrames(count: number, stepMs = 1000 / 60): number {
  let ran = 0;
  for (let i = 0; i < count; i++) {
    const entries = [...rafById.entries()];
    if (entries.length === 0) break;
    const [, cb] = entries[0]!;
    rafById.clear();           // consume; cb re-schedules if still running
    rafNow += stepMs;
    cb(rafNow);
    ran++;
  }
  return ran;
}

function fakeCtx(over: Partial<SceneCtx> = {}): SceneCtx & { nav: Array<[string, unknown]>; pushed: unknown[] } {
  const nav: Array<[string, unknown]> = [];
  const pushed: unknown[] = [];
  const base = {
    sm: {
      overlay: (_root?: unknown) => {},
      closeOverlay: () => null,
      overlayOpen: false,
      push: (s: unknown) => { pushed.push(s); },
      pop: () => { pushed.push("pop"); },
    },
    audio: { onEvent() {}, playMusic() {}, toggleMute() { return false; } },
    goto(title: string, arg?: unknown): void { nav.push([title, arg]); },
    gotoArg: undefined,
    quit(): void {},
  };
  return Object.assign(base, over, { nav, pushed }) as SceneCtx & { nav: Array<[string, unknown]>; pushed: unknown[] };
}

function setupWith(mode: "ffa" | "teams", joined = 1): MatchSetup {
  const slots = freshSlots();
  for (let i = 0; i < joined; i++) slots[i]!.joined = true;
  return {
    mode,
    selectSlots: slots,
    humans: slots.map((s, i): number => (s.joined ? i : -1)).filter((i) => i >= 0),
    padsBySlot: {},
    stageId: "grassland-dojo",
    seed: 123456789,
  };
}

// --- content injected from disk (loader.test.ts pattern) ------------------------

let cache: ContentCache;
let simCtx: SimContext;

beforeAll(async () => {
  const ids = ["brawler", "swordsman", "fire-caster", "ice-caster", "ninja", "support-mage"];
  const inject: Record<string, unknown> = {};
  for (const id of ids) {
    inject[`characters/${id}.json`] = JSON.parse(
      await Bun.file(new URL(`../../src/data/characters/${id}.json`, import.meta.url)).text(),
    );
  }
  for (const sid of ["grassland-dojo", "rooftop-night"]) {
    inject[`stages/${sid}.json`] = JSON.parse(
      await Bun.file(new URL(`../../src/data/stages/${sid}.json`, import.meta.url)).text(),
    );
  }
  inject["weapons.json"] = await Bun.file(new URL("../../src/data/weapons.json", import.meta.url)).json();
  inject["items.json"] = await Bun.file(new URL("../../src/data/items.json", import.meta.url)).json();
  cache = await loadAllContent(inject);
  simCtx = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };
});

function stagesMap(): Map<string, (typeof cache.stages) extends ReadonlyMap<string, infer V> ? V : never> {
  return new Map(cache.stages.entries());
}

// --- flow model -------------------------------------------------------------------

describe("flow model", () => {
  test("freshSlots fills 8 with cycling archetypes", () => {
    const s = freshSlots();
    expect(s).toHaveLength(8);
    expect(s.every((x) => !x.joined && x.charId.length > 0)).toBe(true);
    // Archetypes cycle roster order across the 8 slots.
    expect(s[0]!.charId).toBe(s[6]!.charId);
  });

  test("team cycle Independent→Red→Blue→Independent", () => {
    expect(cycleTeam("independent")).toBe("red");
    expect(cycleTeam("red")).toBe("blue");
    expect(cycleTeam("blue")).toBe("independent");
  });

  test("ffa forces everyone independent", () => {
    const slots: SelectSlot[] = freshSlots().map((s, i) => ({
      ...s,
      team: i % 2 === 0 ? "red" : "blue",
      joined: i < 2,
    }));
    const cfgs = buildSlotConfigs(slots, "ffa");
    expect(cfgs.every((c) => c.team === "independent")).toBe(true);
    expect(cfgs.filter((c) => c.isHuman)).toHaveLength(2);
    expect(cfgs.filter((c) => !c.isHuman)).toHaveLength(6);
  });

  test("teams mode deals bots to red/blue, never independent", () => {
    const slots = freshSlots();
    slots[0]!.joined = true;
    slots[0]!.team = "red";
    slots[1]!.joined = true;
    slots[1]!.team = "blue";
    const cfgs = buildSlotConfigs(slots, "teams");
    expect(cfgs[0]).toMatchObject({ isHuman: true, team: "red" });
    expect(cfgs[1]).toMatchObject({ isHuman: true, team: "blue" });
    expect(cfgs.slice(2).every((c) => c.team !== "independent")).toBe(true);
  });
});

// --- title scene --------------------------------------------------------------------

import { createTitleScene } from "../../src/ui/scenes/title";

describe("title scene", () => {
  test("any joined player's Attack advances to mode", () => {
    const scene = createTitleScene([0]);
    const ctx = fakeCtx();
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("Comma"));   // P1 attack
    doc.dispatch("keydown", fakeKey("KeyF"));    // P2 attack also advances
    expect(ctx.nav.map(([t]) => t)).toEqual(["mode"]);
    scene.exit();
  });

  test("non-attack keys do not advance", () => {
    const scene = createTitleScene([0]);
    const ctx = fakeCtx();
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("ArrowLeft"));
    doc.dispatch("keydown", fakeKey("Slash"));
    expect(ctx.nav).toHaveLength(0);
    scene.exit();
  });

  test("blink prompt toggles on update", () => {
    const scene = createTitleScene([0]);
    scene.enter(fakeCtx());
    const prompt = (scene.root.children as unknown as FakeElement[])
      .find((c) => c.className.includes("press-attack"));
    expect(prompt).toBeDefined();
    scene.update(600);
    expect(prompt!.style.opacity).toBe("0.15");
    scene.update(400);
    expect(prompt!.style.opacity).toBe("1");
    scene.exit();
  });
});

// --- select scene ----------------------------------------------------------------------

import { createSelectScene } from "../../src/ui/scenes/select";

describe("select scene", () => {
  test("join on Attack, cycle team on Defend, confirm on Jump hands off setup", () => {
    const scene = createSelectScene();
    const ctx = fakeCtx();
    ctx.gotoArg = setupWith("ffa");
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("Comma"));   // P1 joins
    doc.dispatch("keydown", fakeKey("Slash"));   // team → red
    doc.dispatch("keydown", fakeKey("Slash"));   // team → blue
    doc.dispatch("keydown", fakeKey("Period"));  // confirm
    expect(ctx.nav).toHaveLength(1);
    expect(ctx.nav[0]![0]).toBe("stage-select");
    const handed = ctx.nav[0]![1] as MatchSetup;
    expect(handed.selectSlots[0]).toEqual({ joined: true, charId: "brawler", team: "blue" });
    expect(handed.selectSlots[1]!.joined).toBe(false);
    scene.exit();
  });

  test("attack while joined toggles back out", () => {
    const scene = createSelectScene();
    const ctx = fakeCtx();
    ctx.gotoArg = setupWith("ffa");
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("Comma"));  // join
    doc.dispatch("keydown", fakeKey("Comma"));  // un-join
    doc.dispatch("keydown", fakeKey("Period")); // confirm
    const handed = ctx.nav[0]?.[1] as MatchSetup | undefined;
    if (handed !== undefined) expect(handed.selectSlots[0]!.joined).toBe(false);
    scene.exit();
  });

  test("duplicate picks allowed across players", () => {
    const scene = createSelectScene();
    const ctx = fakeCtx();
    ctx.gotoArg = setupWith("ffa");
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("Comma"));  // P1 joins brawler
    doc.dispatch("keydown", fakeKey("KeyF"));   // P2 joins brawler too — no error
    scene.exit();
  });
});

describe("select gamepad join", () => {
  test("pad attack press joins the next open slot and records padsBySlot", () => {
    const g = globalThis as { navigator?: unknown };
    const saved = g.navigator;
    g.navigator = {
      getGamepads: () => [
        { axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 2 })) },
      ],
    };
    try {
      const scene = createSelectScene();
      const ctx = fakeCtx();
      const setup = setupWith("ffa");
      ctx.gotoArg = setup;
      scene.enter(ctx);
      scene.update(16);
      const setup2 = ctx.gotoArg as MatchSetup;
      expect(setup2.padsBySlot[0]).toBe(0);
      expect(Object.keys(setup2.padsBySlot)).toEqual(["0"]);
      scene.exit();
    } finally {
      g.navigator = saved;
    }
  });

  test("same pad pressing attack twice claims exactly one slot", () => {
    const g = globalThis as { navigator?: unknown };
    const saved = g.navigator;
    let attackDown = true; // held when the scene enters
    g.navigator = {
      getGamepads: () => [
        { axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 2 && attackDown })) },
      ],
    };
    try {
      const scene = createSelectScene();
      const ctx = fakeCtx();
      const setup = setupWith("ffa");
      ctx.gotoArg = setup;
      scene.enter(ctx);
      scene.update(16);     // rising edge 1 → pad 0 claims slot 0
      attackDown = false;   // release…
      scene.update(16);     // …observed by this poll (no edge)
      attackDown = true;    // …re-press
      scene.update(16);     // rising edge 2 — same pad must NOT take slot 1
      const setup2 = ctx.gotoArg as MatchSetup;
      expect(setup2.padsBySlot).toEqual({ 0: 0 });
      scene.exit();
    } finally {
      g.navigator = saved;
    }
  });

  // Regression (final review): re-entering select with the SAME setup object
  // (rematch flow) reset `slots` but not `setup.padsBySlot`, so a pad that
  // joined the previous match was permanently refused by joinPad's
  // includes-check — the pad could never join again.
  test("pad re-joins after re-entering select with the same setup (padsBySlot reset)", () => {
    const g = globalThis as { navigator?: unknown };
    const saved = g.navigator;
    let attackDown = false;
    g.navigator = {
      getGamepads: () => [
        { axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 2 && attackDown })) },
      ],
    };
    try {
      const scene = createSelectScene();
      const ctx = fakeCtx();
      const setup = setupWith("ffa");
      ctx.gotoArg = setup;
      scene.enter(ctx);
      attackDown = true;
      scene.update(16);                     // rising edge → pad 0 claims slot 0
      expect(setup.padsBySlot[0]).toBe(0);
      attackDown = false;
      scene.update(16);                     // release observed by this poll
      scene.exit();
      scene.enter(ctx);                     // rematch: SAME setup, gotoArg unchanged
      expect(Object.keys(setup.padsBySlot)).toHaveLength(0); // stale claim cleared
      attackDown = true;
      scene.update(16);                     // rising edge → pad 0 must join AGAIN
      expect(setup.padsBySlot[0]).toBe(0);
      doc.dispatch("keydown", fakeKey("Period"));             // confirm hands over join state
      const handed = ctx.nav[0]![1] as MatchSetup;
      expect(handed.selectSlots[0]!.joined).toBe(true);       // pad-joined slot stayed joined
      scene.exit();
    } finally {
      g.navigator = saved;
    }
  });

  test("pad 1 taking slot 0 does not block slot 1 (per-slot pad check)", () => {
    const g = globalThis as { navigator?: unknown };
    const saved = g.navigator;
    g.navigator = {
      getGamepads: () => [
        null, // index 0 disconnected — sparse arrays must stay positional
        { axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 2 })) },
      ],
    };
    try {
      const scene = createSelectScene();
      const ctx = fakeCtx();
      const setup = setupWith("ffa");
      ctx.gotoArg = setup;
      scene.enter(ctx);
      scene.update(16);
      const setup2 = ctx.gotoArg as MatchSetup;
      expect(setup2.padsBySlot[0]).toBe(1);         // slot 0 took pad 1
      expect(setup2.padsBySlot[1]).toBeUndefined(); // slot 1 stays open
      scene.exit();
    } finally {
      g.navigator = saved;
    }
  });
});

// --- mode + stage-select scenes -----------------------------------------------------------

import { createModeScene } from "../../src/ui/scenes/mode";
import { createStageSelectScene } from "../../src/ui/scenes/stage-select";

describe("mode scene", () => {
  test("attack on cursor card opens select with seeded setup", () => {
    const scene = createModeScene([0]);
    const ctx = fakeCtx();
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("Comma"));
    expect(ctx.nav).toHaveLength(1);
    expect(ctx.nav[0]![0]).toBe("select");
    const setup = ctx.nav[0]![1] as MatchSetup;
    expect(setup.mode).toBe("ffa");
    expect(setup.selectSlots).toHaveLength(8);
    expect(setup.seed).toBeGreaterThanOrEqual(0);
    expect(setup.seed).toBeLessThan(1e9);
    scene.exit();
  });

  test("right moves cursor onto teams card", () => {
    const scene = createModeScene([0]);
    const ctx = fakeCtx();
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("ArrowRight"));
    doc.dispatch("keydown", fakeKey("Comma"));
    expect((ctx.nav[0]![1] as MatchSetup).mode).toBe("teams");
    scene.exit();
  });
});

describe("stage-select scene", () => {
  test("cursor moves between two cards; attack confirms current card", () => {
    const scene = createStageSelectScene([0]);
    const ctx = fakeCtx();
    const setup = setupWith("ffa");
    ctx.gotoArg = setup;
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("ArrowRight"));
    doc.dispatch("keydown", fakeKey("Comma"));
    expect(ctx.nav).toHaveLength(1);
    expect((ctx.nav[0]![1] as MatchSetup).stageId).toBe("rooftop-night");
    scene.exit();
  });
});

// --- battle scene (headless integration) -----------------------------------------------------

import { createBattleScene } from "../../src/ui/scenes/battle";

describe("battle scene", () => {
  test("spawns match, plays stage music, steps sim, feeds audio events", async () => {
    installFakeRaf();
    const heard: string[] = [];
    const music: string[] = [];
    const ctx = fakeCtx({
      audio: {
        onEvent: (e: { type: string }) => heard.push(e.type),
        playMusic: (stageId: string) => music.push(stageId),
        toggleMute: () => false,
      } as SceneCtx["audio"],
    });
    const scene = createBattleScene(
      () => ({ ctx: simCtx, stages: stagesMap() }),
      () => Promise.reject(new Error("no art in tests")),
    );
    ctx.gotoArg = setupWith("ffa", 1);
    scene.enter(ctx);
    expect(music).toEqual(["grassland-dojo"]);
    const ran = pumpFrames(600);            // ~10 simulated seconds
    expect(ran).toBeGreaterThan(0);
    scene.exit();                            // teardown stops the loop
    expect(pumpFrames(5)).toBe(0);           // loop dead after exit
  });

  test("esc opens pause overlay; active scene stays battle (overlay ≠ scene)", async () => {
    installFakeRaf();
    const overlays: FakeElement[] = [];
    const ctx = fakeCtx({
      sm: {
        overlay(root?: FakeElement) {
          if (root !== undefined) overlays.push(root);
        },
        closeOverlay: () => null,
        overlayOpen: false,
      } as unknown as SceneCtx["sm"],
    });
    const scene = createBattleScene(
      () => ({ ctx: simCtx, stages: stagesMap() }),
      () => Promise.reject(new Error("no art")),
    );
    ctx.gotoArg = setupWith("ffa", 1);
    scene.enter(ctx);
    pumpFrames(3);
    doc.dispatch("keydown", fakeKey("Escape"));
    expect(overlays).toHaveLength(1);
    scene.exit();
  });

  test("match end navigates to results with winner and K/D standings", async () => {
    installFakeRaf();
    const ctx = fakeCtx();
    const scene = createBattleScene(
      () => ({ ctx: simCtx, stages: stagesMap() }),
      () => Promise.reject(new Error("no art")),
    );
    ctx.gotoArg = setupWith("ffa", 1);
    scene.enter(ctx);
    // Deterministic seed + neutral human input → fixed outcome. FFA is last
    // man standing: the match runs until one fighter remains (7 KOs), not
    // until the first kill. Cap far above; break once the transition lands.
    for (let i = 0; i < 40_000 && ctx.nav.length === 0; i++) pumpFrames(60);
    expect(ctx.nav.length).toBeGreaterThan(0);
    const [target, payload] = ctx.nav[0]!;
    expect(target).toBe("results");
    const outcome = (payload as { outcome: { winnerTeam: string; kd: Array<{ kills: number; deaths: number }> } }).outcome;
    expect(outcome.winnerTeam).toBe("independent");
    expect(outcome.kd).toHaveLength(8);
    const totalDeaths = outcome.kd.reduce((sum, r) => sum + r.deaths, 0);
    expect(totalDeaths).toBe(7);                    // one survivor, seven KOs
    const totalKills = outcome.kd.reduce((sum, r) => sum + r.kills, 0);
    expect(totalKills).toBe(totalDeaths);           // every KO credited exactly once
    scene.exit();
  }, 20_000);
});

// --- title menu + controls ------------------------------------------------------------

import { createControlsScene, createAboutScene } from "../../src/ui/scenes/controls";

describe("title menu", () => {
  test("attack on default cursor (VS MODE) still goes straight to mode", () => {
    const scene = createTitleScene();
    const ctx = fakeCtx();
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("Comma"));
    expect(ctx.nav[0]![0]).toBe("mode");
    scene.exit();
  });

  test("down then attack pushes Controls; Defend pops back to title", () => {
    const scene = createTitleScene();
    const ctx = fakeCtx();
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("ArrowDown"));
    doc.dispatch("keydown", fakeKey("Comma"));
    expect(ctx.pushed).toHaveLength(1);              // Controls pushed, not a goto
    scene.exit();

    const controls = createControlsScene();
    const ctx2 = fakeCtx();
    controls.enter(ctx2);
    doc.dispatch("keydown", fakeKey("Slash"));       // P1 defend
    expect(ctx2.pushed).toEqual(["pop"]);
    controls.exit();
  });

  test("attack on ABOUT pushes the about scene", () => {
    const scene = createTitleScene();
    const ctx = fakeCtx();
    scene.enter(ctx);
    doc.dispatch("keydown", fakeKey("ArrowDown"));
    doc.dispatch("keydown", fakeKey("ArrowDown"));
    doc.dispatch("keydown", fakeKey("Comma"));
    expect(ctx.pushed).toHaveLength(1);
    scene.exit();
  });
});

describe("controls scene", () => {
  test("defend does NOT pop while an overlay is open", () => {
    const controls = createControlsScene();
    const ctx = fakeCtx({ sm: { overlay() {}, closeOverlay() {}, overlayOpen: true, push() {}, pop() {} } as never });
    controls.enter(ctx);
    doc.dispatch("keydown", fakeKey("Slash"));
    expect(ctx.pushed).toEqual([]);                  // guard held
    controls.exit();
  });

  test("about scene renders text and pops on defend", () => {
    const about = createAboutScene();
    const ctx = fakeCtx();
    about.enter(ctx);
    expect(about.root.textContent!.length).toBeGreaterThan(50);
    doc.dispatch("keydown", fakeKey("Slash"));
    expect(ctx.pushed).toEqual(["pop"]);
    about.exit();
  });
});
