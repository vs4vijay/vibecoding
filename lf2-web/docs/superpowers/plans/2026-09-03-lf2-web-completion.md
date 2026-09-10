# LF2 Web Completion Plan — Vertical Slices

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the LF2 web remake from "Task 12 WIP that dead-ends at character select" to the shippable MVP defined by the original plan: playable matches in the browser, complete shell (gamepads, title menus, pause/remap), a pinned determinism gate, real CC0 art, balance, and a README.

**Architecture:** Unchanged from the original plan — pure deterministic `stepWorld` sim interpreted from JSON sheets; Canvas2D renderer and DOM-overlay UI are read-only consumers fed by `SimEvent`s. This plan is organized as **vertical slices**: every slice ends with the game demonstrably working end-to-end in a browser, not just more layers stacked up.

**Tech Stack:** TypeScript (strict), Vite 5, Bun 1.1+ (test runner + scripts), Canvas2D, WebAudio, ImageMagick 7 (art build only, present on this machine at `/opt/homebrew/bin/magick`), Python 3 + Playwright (browser smoke test only).

**Spec:** `docs/superpowers/specs/2026-08-24-lf2-web-design.md` (+ `sections/01–04`).
**Predecessor:** `docs/superpowers/plans/2026-08-24-lf2-web-mvp.md` — its Tasks 1–11 are **committed** (HEAD `0464519`). Its Task 12 (UI shell) exists as **uncommitted WIP** on the working tree. This plan supersedes Tasks 12–15; do not re-read them as pending work.

## Current State Baseline (verified 2026-09-03)

Working tree = 10 commits (plan Tasks 1–11) + uncommitted WIP: `src/ui/{scene-manager,flow,kit,overlays,loop}.ts`, `src/ui/scenes/{title,mode,select,stage-select,battle,results}.ts`, `src/input/composite.ts`, `src/headless-content.ts`, rewrites of `src/main.ts`/`index.html`, and tests. `bun test` = 138 pass / 0 fail; `bun run typecheck` and `bun run build` are clean.

Verified in headless Chromium against the production build — the app **boots to title but the flow dead-ends at character select**. Root causes, both confirmed:

1. **gotoArg wiring mismatch (blocks everything downstream of select).** `src/main.ts:59` writes the scene payload to `sm.gotoArg` (the SceneManager), but every scene reads `ctx.gotoArg` (the SceneCtx): `src/ui/scenes/select.ts:83`, `src/ui/scenes/stage-select.ts:39`, `src/ui/scenes/battle.ts:255`, `src/ui/scenes/results.ts:40`. SceneCtx.gotoArg is initialized `undefined` and never assigned, so select's Jump-confirm silently no-ops (`setup === null`) and battle/results would never receive their payloads either. Unit tests pass because the test harness assigns `ctx.gotoArg` directly (`tests/ui/scenes.test.ts:217` etc.) — the test wiring diverged from main wiring.
2. **Dev-mode boot crash.** `src/main.ts:16` evaluates `process.env.HEADLESS` unconditionally; in the browser dev server this throws `ReferenceError: process is not defined` before anything mounts (verified via `pageerror`). The production build survives only because of a Vite define artifact.
3. **UI scenes are never ticked.** Nothing calls `sm.update()` or `sm.draw()` — title's blink and all scene fades are dead. Needed functionally in Slice 2 (gamepad join polls in `select.update`).
4. **Battle never loads art.** `src/main.ts` passes `() => Promise.reject(new Error("atlas assets not wired"))` as battle's `loadArt`; the renderer skips drawing entirely when `assets === null`, so battle would be a black canvas even though placeholder atlases exist and **all 123 sprite references in `src/data` resolve against them (verified)**.

Also noted (fixed in this plan): dead `BattleServices` interface and `void nextPad` in `battle.ts`; dynamic-import-vs-static Vite warnings for `world.ts`/`overlays.ts`/`node:crypto`; `padsBySlot` never populated anywhere so gamepads can't join; title's "Controls · About" are static placeholder text.

## Global Constraints

- Bun ≥ 1.1 for install/test; `"typecheck": "tsc --noEmit"` gates every commit. Every commit passes `bun test && bun run typecheck`.
- `tsconfig.json` is already strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) — new code must compile under it untouched.
- Under `src/sim/`: NO `Math.random`, NO `Date.now`, NO `performance.now`, NO DOM/Bun imports. Enforced by `scripts/check-determinism.mjs` wired into `build`.
- Constants live verbatim in `src/sim/constants.ts` — never restate them elsewhere.
- Art: Kenney CC0 packs only. No ripped LF2 assets, ever (locked decision 4). `public/assets/CREDITS.txt` must list provenance before real art ships.
- Persistence keys exactly: `lf2.bindings.v1`, `lf2.muted`.
- Logical canvas 960×540, `image-rendering: pixelated`.
- Frequent commits, conventional messages (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- All tests run with `bun test`; no test framework beyond Bun's built-in.

## File Structure (this plan only; existing files keep their current responsibilities)

```
src/
├── main.ts                        [MODIFY] boot: ctx factory, boot guard, UI loop, atlas loading
├── sim/canonical.ts               [CREATE] canonicalReplacer shared by main.ts + golden test
├── ui/context.ts                  [CREATE] createSceneCtx — the ONE SceneCtx, delivers gotoArg
├── input/pad-join.ts              [CREATE] pad-join edge watcher for the select screen
├── input/gamepad.ts               [MODIFY] export systemSnapshot, countSystemPads, PAD_ATTACK_BUTTON
├── ui/scenes/title.ts             [MODIFY] real menu (VS MODE / CONTROLS / ABOUT) with cursor
├── ui/scenes/controls.ts          [CREATE] controls reference scene + About scene
├── ui/scenes/select.ts            [MODIFY] gamepad join in update(); padsBySlot bookkeeping
├── ui/scenes/battle.ts            [MODIFY] shared systemSnapshot, static remap import, dead code out
scripts/
├── e2e-smoke.py                   [CREATE] committed Playwright smoke: full flow → battle → pause
├── gen-replay.ts                  [CREATE] generates tests/fixtures/replay-001.json deterministically
├── soak.ts                        [CREATE] 8-bot FFA soak, seeds 1..20 × 2 stages
├── ttk.ts                         [CREATE] 1v1 bot-duel TTK measurement for the balance pass
├── build-atlases.ts               [CREATE] Kenney cells → production atlases via ImageMagick
├── check-sprite-refs.mjs          [CREATE] data sprite refs must resolve in atlas JSONs (build gate)
tests/
├── ui/context.test.ts             [CREATE]
├── input/pad-join.test.ts         [CREATE]
├── golden/replay.test.ts          [CREATE]
├── golden/match-001.sha256        [CREATE] golden hash (written once, then pinned)
├── fixtures/replay-001.json       [CREATE] generated by scripts/gen-replay.ts, committed
public/assets/atlas/               [OVERWRITE in Task 10] real CC0 atlases (placeholders kept in git history)
```

Dependency rule (unchanged): `sim/*` imports nothing above it; `content → sim/types`; `render/input/audio/ui` are read-only consumers.

---

## Slice 1 — Playable Core Loop (ship Task 12)

**Demo at slice end:** `bun run build`, open the built app in a browser, press P1 keys through title → mode → select → stage-select and watch a live match render placeholder art with music, pause with Esc, quit to title. `python3 scripts/e2e-smoke.py` does this automatically.

---

### Task 1: Deliver scene payloads through SceneCtx (unblocks the whole flow)

**Files:**
- Create: `src/ui/context.ts`, `tests/ui/context.test.ts`
- Modify: `src/main.ts` (goto block, ~lines 51–77), `src/ui/scene-manager.ts:46-47` (remove `gotoArg` field)
- Commit also includes: the entire existing Task-12 WIP (currently uncommitted) — it is atomic with this fix.

**Interfaces:**
- Consumes: `SceneManager` (`replace`, `mount`, `overlay`, `closeOverlay`, `overlayOpen`), `AudioBridge` from `src/ui/scene-manager.ts`; scene factories already present in `src/main.ts`.
- Produces: `createSceneCtx(sm: SceneManager, audio: AudioBridge, factories: SceneFactories): SceneCtx` and `type SceneFactories = Record<"title" | "mode" | "select" | "stage-select" | "battle" | "results", () => Scene>`. Scenes continue reading `ctx.gotoArg` in `enter()` — that contract now actually holds.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/context.test.ts
import { describe, test, expect } from "bun:test";
import { makeFakeDocument, FakeElement } from "./fake-dom";
import { SceneManager, type Scene, type SceneCtx } from "../../src/ui/scene-manager";
import { createSceneCtx, type SceneFactories } from "../../src/ui/context";

let ctxAtEnter: SceneCtx | undefined;
function trackingScene(): Scene {
  return {
    enter(c?: SceneCtx) { ctxAtEnter = c; },
    exit() {},
    update() {},
    root: { style: {} } as unknown as HTMLElement,
  };
}

function makeFactories(): SceneFactories {
  return Object.fromEntries(
    (["title", "mode", "select", "stage-select", "battle", "results"] as const)
      .map((k) => [k, trackingScene]),
  ) as unknown as SceneFactories;
}

describe("createSceneCtx payload delivery", () => {
  test("goto stores arg on the SAME ctx object the entering scene reads", () => {
    globalThis.document = makeFakeDocument() as unknown as Document;
    const sm = new SceneManager();
    const ctx = createSceneCtx(sm, { onEvent() {}, playMusic() {}, toggleMute() { return false; } }, makeFactories());
    sm.mount(new FakeElement("div") as unknown as HTMLElement, ctx);

    const setup = { seed: 7 };
    ctx.goto("select", setup);
    expect(ctxAtEnter?.gotoArg).toBe(setup);          // identity, not deep-equal
  });

  test("goto without arg clears the previous payload", () => {
    globalThis.document = makeFakeDocument() as unknown as Document;
    const sm = new SceneManager();
    const ctx = createSceneCtx(sm, { onEvent() {}, playMusic() {}, toggleMute() { return false; } }, makeFactories());
    sm.mount(new FakeElement("div") as unknown as HTMLElement, ctx);

    ctx.goto("battle", { seed: 1 });
    expect(ctx.gotoArg).toEqual({ seed: 1 });
    ctx.goto("title");
    expect(ctx.gotoArg).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ui/context.test.ts`
Expected: FAIL — module `../../src/ui/context` not found.

- [ ] **Step 3: Implement `src/ui/context.ts`**

```ts
// src/ui/context.ts — the ONE SceneCtx handed to every scene.
// goto(title, arg) delivers `arg` via ctx.gotoArg, which scenes read in
// enter(). History: main.ts used to write sm.gotoArg while scenes read
// ctx.gotoArg, so every payload (MatchSetup, MatchOutcome) was silently
// dropped and the flow dead-ended at character select. This factory makes
// the delivery path unit-testable so the two wirings cannot diverge again.
import type { AudioBridge, SceneManager, Scene, SceneCtx } from "./scene-manager";

export type SceneTitle = "title" | "mode" | "select" | "stage-select" | "battle" | "results";

export type SceneFactories = Record<SceneTitle, () => Scene>;

export function createSceneCtx(sm: SceneManager, audio: AudioBridge, factories: SceneFactories): SceneCtx {
  const ctx: SceneCtx = {
    sm,
    audio,
    gotoArg: undefined,
    goto(title, arg) {
      ctx.gotoArg = arg;
      sm.replace(factories[title]());
    },
    quit() {
      globalThis.window?.close();
    },
  };
  return ctx;
}
```

- [ ] **Step 4: Rewire `src/main.ts`**

Add the import:

```ts
import { createSceneCtx, type SceneFactories } from "./ui/context";
```

Replace the whole `const ctx: SceneCtx = { ... };` block and the trailing `sm.mount(host, ctx); ctx.goto("title");` with:

```ts
  const factories: SceneFactories = {
    title: () => createTitleScene(),
    mode: () => createModeScene(),
    select: () => createSelectScene(),
    "stage-select": () => createStageSelectScene(),
    battle: () => createBattleScene(
      () => ({ ctx: simContext, stages: cache.stages }),
      () => Promise.reject(new Error("atlas assets not wired")), // replaced in Task 4
    ),
    results: () => createResultsScene(),
  };
  const ctx = createSceneCtx(sm, audio, factories);
  sm.mount(host, ctx);
  ctx.goto("title");
```

(The `SceneCtx` import in `main.ts` may become unused after this — remove it if `tsc` flags it.)

Then remove the now-unused field from `src/ui/scene-manager.ts` (lines 46–47):

```ts
  /** Payload from the most recent goto(); scenes consume it via ctx.gotoArg. */
  gotoArg: unknown = undefined;
```

and delete the same field from the `SceneManager` class body. Update the `gotoArg` doc comment on `SceneCtx` (line 21–22) to read: `/** Payload delivered by the most recent goto() — set by createSceneCtx; scenes read it in enter(). */`

- [ ] **Step 5: Run everything, commit the WIP + fix together**

Run: `bun test && bun run typecheck`
Expected: all pass (138 existing + 2 new).

```bash
git add -A
git commit -m "feat(ui): complete scene flow title→mode→select→stage→battle→results

All Task-12 shell WIP plus the payload fix it needed: goto() now delivers
args through SceneCtx (createSceneCtx); it previously wrote SceneManager
.gotoArg which no scene reads, so the flow dead-ended at character select."
```

---

### Task 2: Guard the Bun-only HEADLESS branch (fix dev-server boot)

**Files:**
- Modify: `src/main.ts:11-16` (the `main().catch` + HEADLESS check)

**Interfaces:**
- Consumes: nothing new.
- Produces: browser boot with zero `process` evaluation outside `headlessMain()`; `HEADLESS=1 bun src/main.ts --replay <file>` behavior unchanged under Bun.

- [ ] **Step 1: Write the failing check (browser probe, not a unit test)**

```bash
bun run dev --port 5199 --strictPort >/tmp/dev.log 2>&1 &
sleep 3
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:5199/", wait_until="networkidle")
    page.wait_for_timeout(800)
    scene = page.evaluate("document.querySelector('#ui .scene')?.className ?? 'none'")
    print("scene:", scene); print("errors:", errors)
    b.close()
raise SystemExit(0 if scene.startswith("scene title") and not errors else 1)
EOF
```

Expected: FAIL — `scene: none`, errors contain `process is not defined`. Kill the server: `pkill -f "vite"`.

- [ ] **Step 2: Implement the guard**

In `src/main.ts`, replace:

```ts
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function main(): Promise<void> {
  if (process.env.HEADLESS === "1") {
    await headlessMain();
    return;
  }
```

with:

```ts
main().catch((e) => {
  console.error(e);
  if (typeof process !== "undefined") process.exit(1);
});

const IS_HEADLESS = typeof process !== "undefined" && process.env.HEADLESS === "1";

async function main(): Promise<void> {
  if (IS_HEADLESS) {
    await headlessMain();
    return;
  }
```

(`process` is typed via `@types/bun`, so `tsc` stays green; in the browser `typeof process` is `"undefined"` and short-circuits before any property access. `headlessMain()` itself may keep using `process`/`Bun` — it only runs under Bun.)

- [ ] **Step 3: Re-run the Step-1 probe**

Expected: PASS — `scene: scene title`, no errors. Also re-run the same probe against a production build:

```bash
pkill -f vite; bun run build && (bun run preview --port 4173 --strictPort >/tmp/preview.log 2>&1 &) && sleep 2
# rerun the probe with url http://localhost:4173/
```

Expected: PASS on the built app too. Then `pkill -f vite`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix(ui): guard Bun-only HEADLESS branch so the dev server boots in a browser"
```

---

### Task 3: Tick the scene manager from a UI loop

**Files:**
- Modify: `src/main.ts` (imports + ~6 lines after `sm.mount`)

**Interfaces:**
- Consumes: `createLoop(opts)` from `src/ui/loop.ts` (existing, already unit-tested); `SceneManager.update(dtMs)` / `SceneManager.draw()`.
- Produces: title blink animates and scene fades render; **`select.update(dtMs)` is called every frame**, which Task 5 relies on for gamepad polling.

- [ ] **Step 1: Failing check**

In a browser (dev server from Task 2), sample the title prompt's opacity 4 times, 400 ms apart:

```python
ops = [page.evaluate("document.querySelector('.press-attack')?.style.opacity") for _ in range(4)]
# blink period is 1000 ms (500 on / 500 off), samples span 1200 ms
assert len(set(ops)) >= 2, f"blink never animates: {ops}"
```

Expected: FAIL — opacity stays `"1"` forever because nothing ticks `sm.update`.

- [ ] **Step 2: Implement**

In `src/main.ts`, add `import { createLoop } from "./ui/loop";` and after `ctx.goto("title");` append:

```ts
  // UI ticker: scenes get update(dt) for animation/polling; the manager gets
  // draw() for its transition fade veil. The battle scene runs its own loop
  // for the sim — two rAF loops coexist (the browser coalesces frames).
  const uiLoop = createLoop({
    tickMs: TICK_MS,
    maxCatchUpMs: 250,
    update: () => sm.update(TICK_MS),
    render: () => sm.draw(),
  });
  uiLoop.start();
```

- [ ] **Step 3: Re-run the Step-1 probe**

Expected: PASS — at least two distinct opacity values.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "fix(ui): run SceneManager update/draw from a UI loop (title blink, transition fades)"
```

---

### Task 4: Wire the atlases into battle + committed e2e smoke

**Files:**
- Modify: `src/main.ts` (battle factory + new `loadBattleArt`)
- Create: `scripts/e2e-smoke.py`

**Interfaces:**
- Consumes: `loadAtlas(pngUrl, jsonUrl): Promise<Atlas>` from `src/render/atlas.ts`; battle's `loadArt: () => Promise<Omit<Assets, "sheets" | "stages">>` parameter (already declared in `src/ui/scenes/battle.ts:44`).
- Produces: `loadBattleArt(): Promise<Omit<Assets, "sheets" | "stages">>`; `scripts/e2e-smoke.py` becomes the reusable browser gate for every later slice (run it after each remaining task that touches UI).

Relative asset URLs (`assets/atlas/...`) are correct in both dev (public/ served at root) and build (`base: "./"`); `src/audio/audio.ts` already uses the same pattern for `assets/audio/...`.

- [ ] **Step 1: Implement `loadBattleArt` and swap the stub**

In `src/main.ts`, add:

```ts
import { loadAtlas } from "./render/atlas";
import type { Assets } from "./render/types";

async function loadBattleArt(): Promise<Omit<Assets, "sheets" | "stages">> {
  const [fighters, props, fx, bg] = await Promise.all([
    loadAtlas("assets/atlas/fighters.png", "assets/atlas/fighters.json"),
    loadAtlas("assets/atlas/props.png", "assets/atlas/props.json"),
    loadAtlas("assets/atlas/fx.png", "assets/atlas/fx.json"),
    loadAtlas("assets/atlas/bg.png", "assets/atlas/bg.json"),
  ]);
  return { fighters, props, fx, bg };
}
```

and change the battle factory line to:

```ts
    battle: () => createBattleScene(() => ({ ctx: simContext, stages: cache.stages }), loadBattleArt),
```

- [ ] **Step 2: Create the committed smoke script**

```python
#!/usr/bin/env python3
# scripts/e2e-smoke.py — black-box browser gate for the LF2 web shell.
# Drives P1 keyboard-only through title → mode → select → stage-select →
# battle, asserts the sim is rendering (non-black canvas), opens pause, and
# returns to title. Usage: python3 scripts/e2e-smoke.py [--url http://localhost:4173/]
import argparse
from playwright.sync_api import sync_playwright

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:4173/")
    args = ap.parse_args()
    errors: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.goto(args.url, wait_until="networkidle")
        page.wait_for_timeout(600)

        def scene() -> str:
            return page.evaluate("document.querySelector('#ui .scene')?.className ?? 'none'")

        def key(k: str) -> None:
            page.keyboard.press(k)
            page.wait_for_timeout(300)

        assert scene().startswith("scene title"), f"boot: {scene()}"
        key("Comma")   # title: attack -> mode
        assert scene().startswith("scene mode"), f"mode: {scene()}"
        key("Comma")   # mode: confirm FFA -> select
        assert scene().startswith("scene select"), f"select: {scene()}"
        key("Comma")   # select: P1 joins
        joined = page.evaluate("[...document.querySelectorAll('.chip')].some(c => c.style.display !== 'none')")
        assert joined, "P1 chip never appeared"
        key("Period")  # select: jump-confirm -> stage-select (requires ctx.gotoArg fix)
        assert scene().startswith("scene stage-select"), f"stage-select: {scene()}"
        key("Comma")   # stage-select: confirm -> battle
        assert scene().startswith("scene battle"), f"battle: {scene()}"

        page.wait_for_timeout(2500)  # let the sim run
        non_black = page.evaluate("""(() => {
          const c = document.getElementById('game');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 30) n++;
          return n;
        })()""")
        assert non_black > 1000, f"battle canvas is blank (non-black px = {non_black})"

        if scene().startswith("scene battle"):  # a bot FFA may have ended already
            key("Escape")
            assert page.evaluate("!!document.querySelector('#ui .overlay')"), "pause overlay did not open"
            page.get_by_text("QUIT TO MENU", exact=True).click()
            page.wait_for_timeout(400)
            assert scene().startswith("scene title"), f"quit-to-title: {scene()}"

        assert not errors, "browser errors:\n" + "\n".join(errors)
        b.close()
    print("E2E SMOKE: PASS")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Run the gate on both dev and production builds**

```bash
bun run build
(bun run preview --port 4173 --strictPort >/tmp/preview.log 2>&1 &) && sleep 2
python3 scripts/e2e-smoke.py                       # built app
pkill -f vite; bun run dev --port 5199 --strictPort >/tmp/dev.log 2>&1 & sleep 3
python3 scripts/e2e-smoke.py --url http://localhost:5199/   # dev app
pkill -f vite
```

Expected: both print `E2E SMOKE: PASS` — this is the first time a full match renders end-to-end. (`bun test`, typecheck, and build stay green.)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): wire atlas loading into battle; add Playwright e2e smoke gate"
```

---

## Slice 2 — Complete the Shell (gamepads, title menus, cleanup)

**Demo at slice end:** with a real gamepad plugged in, pressing its Attack button mid-select joins P2; the title screen has working Controls (with key remapping that persists) and About entries. No regressions in the smoke gate.

---

### Task 5: Gamepad join in character select

**Files:**
- Modify: `src/input/gamepad.ts` (export the private `systemSnapshot`, add `countSystemPads` and `PAD_ATTACK_BUTTON`)
- Create: `src/input/pad-join.ts`, `tests/input/pad-join.test.ts`
- Modify: `src/ui/scenes/select.ts` (poll in `update()`, `padsBySlot` bookkeeping)
- Modify: `src/ui/scenes/battle.ts:93-102` (drop the local `systemSnapshot` duplicate, import the shared one)
- Test: `tests/ui/scenes.test.ts` (append one integration test)

**Interfaces:**
- Consumes: `SnapshotProvider = () => GamepadSnapshot | null | undefined` from `src/input/gamepad.ts`; `MatchSetup.padsBySlot: Partial<Record<number, number>>` (already consumed by `battle.ts` `wireSources()` → `createCompositeSource`).
- Produces:
  - `PAD_ATTACK_BUTTON = 2` (const, `gamepad.ts`)
  - `countSystemPads(): number` (`gamepad.ts`)
  - `createPadJoinWatcher(providers: readonly SnapshotProvider[]): { poll(): number[] }` — returns indices of pads whose attack button **rose** this poll.

- [ ] **Step 1: Write failing tests**

```ts
// tests/input/pad-join.test.ts
import { describe, test, expect } from "bun:test";
import { createPadJoinWatcher } from "../../src/input/pad-join";
import type { SnapshotProvider } from "../../src/input/gamepad";

function attackProvider(state: { a: boolean }): SnapshotProvider {
  return () => ({ buttons: [{}, {}, { pressed: state.a }] });
}

describe("pad join watcher", () => {
  test("reports the rising edge once, then again after release+press", () => {
    const state = { a: false };
    const w = createPadJoinWatcher([attackProvider(state)]);
    expect(w.poll()).toEqual([]);          // up
    state.a = true;  expect(w.poll()).toEqual([0]);
    expect(w.poll()).toEqual([]);          // still held
    state.a = false; expect(w.poll()).toEqual([]);
    state.a = true;  expect(w.poll()).toEqual([0]);
  });

  test("tracks pads independently", () => {
    const a = { a: false }, b = { a: true };
    const w = createPadJoinWatcher([attackProvider(a), attackProvider(b)]);
    expect(w.poll()).toEqual([1]);
    a.a = true;
    expect(w.poll()).toEqual([0]);
  });

  test("missing snapshot counts as not pressed", () => {
    let snap: ReturnType<SnapshotProvider> = null;
    const w = createPadJoinWatcher([() => snap]);
    expect(w.poll()).toEqual([]);
    snap = { buttons: [{}, {}, { pressed: true }] };
    expect(w.poll()).toEqual([0]);
  });
});
```

Add to `tests/ui/scenes.test.ts` (inside a new `describe("select gamepad join")`; `fakeCtx`/`setupWith` already exist in that file):

```ts
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
      expect(setup2.selectSlots[0]!.joined).toBe(true);
      scene.exit();
    } finally {
      g.navigator = saved;
    }
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/input/pad-join.test.ts tests/ui/scenes.test.ts`
Expected: pad-join FAIL (module not found); the new select test FAILS (pad slot never recorded).

- [ ] **Step 3: Implement**

`src/input/gamepad.ts` — add `export` to the existing private `systemSnapshot`, and append:

```ts
/** Standard-mapping attack button (X), mirrored by src/input/pad-join.ts. */
export const PAD_ATTACK_BUTTON = 2;

/** Number of currently connected pads (nulls in getGamepads() skipped). */
export function countSystemPads(): number {
  const nav = globalThis.navigator;
  if (
    typeof nav === "object" && nav !== null && "getGamepads" in nav &&
    typeof nav.getGamepads === "function"
  ) {
    return (nav.getGamepads() as Array<GamepadSnapshot | null>).filter((p) => p != null).length;
  }
  return 0;
}
```

`src/input/pad-join.ts`:

```ts
// src/input/pad-join.ts — "press Attack to join" detection for the select
// screen. Watches raw pad snapshots for rising attack edges; select assigns
// each newly-pressed pad to the next open human slot and records it in
// MatchSetup.padsBySlot, which battle's composite source consumes.
import { PAD_ATTACK_BUTTON, type SnapshotProvider } from "./gamepad";

const THRESHOLD = 0.5; // mirrors gamepad.ts DEAD_ZONE

export interface PadJoinWatcher {
  /** Pad indices whose attack button rose this poll (was up, now down). */
  poll(): number[];
}

export function createPadJoinWatcher(providers: readonly SnapshotProvider[]): PadJoinWatcher {
  let prev = providers.map(() => false);
  return {
    poll(): number[] {
      const fresh: number[] = [];
      providers.forEach((provider, i) => {
        const btn = provider()?.buttons?.[PAD_ATTACK_BUTTON];
        const pressed = btn?.pressed === true || (btn?.value ?? 0) >= THRESHOLD;
        if (pressed && !prev[i]) fresh.push(i);
        prev[i] = pressed;
      });
      return fresh;
    },
  };
}
```

`src/ui/scenes/select.ts` — add imports and join logic:

```ts
import { createPadJoinWatcher, type PadJoinWatcher } from "../../input/pad-join";
import { countSystemPads, systemSnapshot } from "../../input/gamepad";
import type { SnapshotProvider } from "../../input/gamepad";
```

```ts
  let watcher: PadJoinWatcher | null = null;
  let watcherPadCount = -1;

  function ensureWatcher(): void {
    const count = countSystemPads();
    if (count === watcherPadCount) return;
    watcherPadCount = count;
    watcher = createPadJoinWatcher(
      Array.from({ length: count }, (_, i): SnapshotProvider => () => systemSnapshot(i)),
    );
  }

  /** First open human slot (not joined, no pad already assigned) takes the pad. */
  function joinPad(padIndex: number): void {
    if (setup === null) return;
    const taken = new Set(Object.values(setup.padsBySlot));
    const slot = HUMAN_SLOTS.find((s) => !slots[s]!.joined && !taken.has(s));
    if (slot === undefined) return;
    slots[slot]!.joined = true;
    setup.padsBySlot[slot] = padIndex;
    paint();
  }
```

In `handle()`, the un-join branch becomes:

```ts
    // Attack while joined toggles back out (un-join).
    else if (action === "attack") {
      s.joined = false;
      if (setup !== null) delete setup.padsBySlot[slot];
    }
```

In `enter()`, call `ensureWatcher();` after `paint();`. Replace `update() {}` with:

```ts
    update() {
      ensureWatcher();
      if (watcher === null) return;
      for (const pad of watcher.poll()) joinPad(pad);
    },
```

`src/ui/scenes/battle.ts` — delete the local `systemSnapshot` (lines 93–102) and instead:

```ts
import { systemSnapshot, type SnapshotProvider } from "../../input/gamepad";
```

(keep the `const provider: SnapshotProvider = () => systemSnapshot(padIndex);` line as-is).

- [ ] **Step 4: Run everything**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual + smoke verification, commit**

With a gamepad connected (if available): `bun run dev`, join P1 with keyboard, press the pad's X button → P2 chip appears and the pad controls P2 in battle. Run `python3 scripts/e2e-smoke.py` (dev URL) to confirm no regression.

```bash
git add -A && git commit -m "feat(input): gamepad join in character select via pad-join watcher"
```

---

### Task 6: Title menu — VS Mode / Controls / About, with remap reachable from title

**Files:**
- Modify: `src/ui/scenes/title.ts` (full rewrite below), `index.html` (title-menu CSS)
- Create: `src/ui/scenes/controls.ts` (Controls + About scenes)
- Modify: `tests/ui/scenes.test.ts` (fakeCtx gains `sm.push`/`sm.pop`; new tests)
- Spec: §4 screen flow — Options/Controls reachable from title **and** pause (pause remap already exists from Task-12 WIP).

**Interfaces:**
- Consumes: `SceneManager.push/pop/overlay/closeOverlay/overlayOpen`; `DEFAULT_KEYMAPS` from `src/input/keyboard.ts`; `buildRemapOverlay({ onClose })` from `src/ui/overlays.ts`.
- Produces: `createControlsScene(): Scene`, `createAboutScene(): Scene` (exported from `src/ui/scenes/controls.ts`). Title keeps its quick-start behavior: Attack on the default cursor (VS MODE) still goes straight to mode.

- [ ] **Step 1: Write failing tests**

First extend `fakeCtx` in `tests/ui/scenes.test.ts` — replace its `sm` stub and add a `pushed` array:

```ts
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
```

(Cast the object literal as needed to satisfy `SceneCtx` — follow the file's existing cast style. Existing tests keep compiling since they only touch the old fields.)

Then append:

```ts
// --- title menu + controls ------------------------------------------------------------

import { createTitleScene } from "../../src/ui/scenes/title";
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
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test tests/ui/scenes.test.ts`
Expected: FAIL — `createControlsScene` not found; title has no cursor navigation.

- [ ] **Step 3: Implement**

`src/ui/scenes/title.ts` (full rewrite):

```ts
// src/ui/scenes/title.ts — logo, blinking PRESS ATTACK, real menu.
// Up/Down move the cursor over VS MODE / CONTROLS / ABOUT; Attack selects.
// VS MODE keeps the one-press quick start; the other items push info scenes
// onto the scene stack so Defend pops back here.
import { el, onMenuKeys } from "../kit";
import type { Scene, SceneCtx } from "../scene-manager";
import { createControlsScene, createAboutScene } from "./controls";

const ITEMS = ["VS MODE", "CONTROLS", "ABOUT"] as const;

export function createTitleScene(humanSlots: number[] = [0]): Scene {
  const root = el("div", { cls: "scene title" });
  let ctx: SceneCtx | undefined;
  let disposeKeys: (() => void) | null = null;
  let blink = 0;
  let cursor = 0;

  const logo = el("div", { cls: "logo", text: "LF2 WEB" });
  const prompt = el("div", { cls: "press-attack blink", text: "PRESS ATTACK" });
  const menu = el("div", { cls: "menu-row title-menu" });
  const items = ITEMS.map((label) => {
    const item = el("div", { cls: "card title-item", text: label });
    menu.appendChild(item);
    return item;
  });

  function paint(): void {
    for (const [i, item] of items.entries()) item.classList.toggle("selected", i === cursor);
  }

  function choose(): void {
    if (ctx === undefined) return;
    if (cursor === 0) ctx.goto("mode");
    else if (cursor === 1) ctx.sm.push(createControlsScene());
    else ctx.sm.push(createAboutScene());
  }

  return {
    root,
    enter(c) {
      ctx = c ?? ctx;
      if (root.children.length === 0) {
        root.appendChild(logo);
        root.appendChild(prompt);
        root.appendChild(menu);
      }
      paint();
      disposeKeys = onMenuKeys(globalThis.document, humanSlots, (_slot, action) => {
        if (action === "up" && cursor > 0) cursor--;
        else if (action === "down" && cursor < ITEMS.length - 1) cursor++;
        else if (action === "attack") choose();
        else return;
        paint();
      });
    },
    exit() {
      disposeKeys?.();
      disposeKeys = null;
    },
    update(dtMs: number) {
      blink += dtMs;
      prompt.style.opacity = Math.floor(blink / 500) % 2 === 0 ? "1" : "0.15";
    },
  };
}
```

`src/ui/scenes/controls.ts`:

```ts
// src/ui/scenes/controls.ts — Controls reference (per-player keymaps + gamepad
// mapping, REMAP opens the capture overlay) and the About panel. Both pop back
// to title on Defend/Esc; the pop is suppressed while an overlay (remap
// capture) is open so binding capture keys can't navigate away.
import { el, onMenuKeys } from "../kit";
import { DEFAULT_KEYMAPS } from "../../input/keyboard";
import { buildRemapOverlay } from "../overlays";
import type { Scene, SceneCtx } from "../scene-manager";

const ACTION_LABELS: Record<string, string> = {
  attack: "Attack", jump: "Jump", defend: "Defend",
  up: "Up", down: "Down", left: "Left", right: "Right",
};

/** Shared behavior: Defend or Esc pops the scene, unless an overlay is open. */
function popOnBack(scene: Scene, ctxRef: { ctx?: SceneCtx }, register: (fn: () => void) => void): void {
  const back = (): void => {
    const ctx = ctxRef.ctx;
    if (ctx === undefined || ctx.sm.overlayOpen) return;
    ctx.sm.pop();
  };
  const keys = onMenuKeys(globalThis.document, [0], (_slot, action) => {
    if (action === "defend") back();
  });
  const onEsc = (ev: Event): void => {
    if ((ev as KeyboardEvent).code === "Escape") back();
  };
  globalThis.document.addEventListener("keydown", onEsc);
  register(() => {
    keys();
    globalThis.document.removeEventListener("keydown", onEsc);
  });
}

export function createControlsScene(): Scene {
  const root = el("div", { cls: "scene controls" });
  const ctxRef: { ctx?: SceneCtx } = {};
  let dispose: (() => void) | null = null;

  const table = el("div", { cls: "controls-table" });
  DEFAULT_KEYMAPS.forEach((map, slot) => {
    const row = el("div", { cls: "controls-row" });
    row.appendChild(el("div", { cls: "controls-player", text: `P${slot + 1}` }));
    const binds = Object.entries(map)
      .map(([code, action]) => `${code} = ${ACTION_LABELS[action] ?? action}`)
      .join(" · ");
    row.appendChild(el("div", { cls: "controls-binds", text: binds }));
    table.appendChild(row);
  });
  table.appendChild(el("div", {
    cls: "hint",
    text: "Gamepad (standard mapping): X = Attack · A = Jump · B = Defend · left stick / dpad = move. Press Attack on a pad in Character Select to join.",
  }));

  const remapBtn = el("div", { cls: "card action", text: "REMAP KEYS" });
  remapBtn.addEventListener("click", () => {
    const ctx = ctxRef.ctx;
    if (ctx === undefined) return;
    ctx.sm.overlay(buildRemapOverlay({ onClose: () => ctx.sm.closeOverlay() }));
  });

  return {
    root,
    enter(c) {
      ctxRef.ctx = c ?? ctxRef.ctx;
      if (root.children.length === 0) {
        root.appendChild(el("div", { cls: "panel-title", text: "CONTROLS" }));
        root.appendChild(table);
        root.appendChild(remapBtn);
        root.appendChild(el("div", { cls: "hint", text: "Defend / Esc = back" }));
      }
      popOnBack(this, ctxRef, (fn) => { dispose = fn; });
    },
    exit() {
      dispose?.();
      dispose = null;
    },
    update() {},
  };
}

export function createAboutScene(): Scene {
  const root = el("div", { cls: "scene about" });
  const ctxRef: { ctx?: SceneCtx } = {};
  let dispose: (() => void) | null = null;

  const body = el("div", { cls: "controls-binds", text:
    "A web remake of Little Fighter 2's VS mode: 6 original archetypes, 2 stages, " +
    "up to 4 local humans plus CPU bots (max 8 fighters). The simulation is fully " +
    "deterministic — every match is driven by JSON character sheets at a fixed 60 Hz, " +
    "seeded PRNG, and replayable hash-for-hash. All art and audio are CC0." });

  return {
    root,
    enter(c) {
      ctxRef.ctx = c ?? ctxRef.ctx;
      if (root.children.length === 0) {
        root.appendChild(el("div", { cls: "panel-title", text: "ABOUT" }));
        root.appendChild(body);
        root.appendChild(el("div", { cls: "hint", text: "Defend / Esc = back" }));
      }
      popOnBack(this, ctxRef, (fn) => { dispose = fn; });
    },
    exit() {
      dispose?.();
      dispose = null;
    },
    update() {},
  };
}
```

Note on `popOnBack(this, ...)`: the first parameter is unused inside the helper — drop it and call `popOnBack(ctxRef, ...)` if `tsc --noUnusedParameters` complains (it is not enabled; keep whichever compiles cleanly).

`index.html` — add inside the existing `<style>` (after the `.menu-row` rule):

```css
    .title-menu { flex-direction: column; align-items: center; gap: 10px; margin-top: 8px; }
    .title-item { min-width: 240px; }
    .controls-table { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
    .controls-row { display: flex; gap: 16px; font-size: 14px; }
    .controls-player { min-width: 36px; color: #FFD24A; }
    .controls-binds { opacity: 0.85; word-break: break-word; }
```

- [ ] **Step 4: Run everything + smoke**

Run: `bun test && bun run typecheck`, then `python3 scripts/e2e-smoke.py` (dev URL; smoke starts at title and presses Attack immediately — still passes because VS MODE is the default cursor).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): title menu with Controls (remap from title) and About scenes"
```

---

### Task 7: Cleanup — static imports, dead code, silent build

**Files:**
- Modify: `src/ui/scenes/battle.ts`, `src/main.ts`

**Interfaces:**
- Consumes: existing modules only.
- Produces: `bun run build` with **zero** Vite externalization/chunking warnings; HEADLESS hash computed with `Bun.CryptoHasher` instead of `node:crypto`.

- [ ] **Step 1: battle.ts**

Replace the dynamic remap loader (`openRemap`, ~lines 126–139) with a static import and direct call:

```ts
import { buildPauseOverlay, buildRemapOverlay } from "../overlays";
```

```ts
  function openRemap(): void {
    if (ctxRef === undefined) return;
    ctxRef.sm.overlay(buildRemapOverlay({
      onClose() {
        // Returning from remap re-opens pause so Resume stays reachable.
        paused = false;
        togglePause();
      },
    }));
  }
```

Delete the unused `BattleServices` interface (lines 29–32) and the `let nextPad = 0;` / `nextPad = Math.max(...)` / `void nextPad;` lines in `wireSources()`.

- [ ] **Step 2: main.ts headless branch**

Move the dynamic imports to the top of the file as static imports and swap the hasher:

```ts
import { spawnMatch, stepWorld } from "./sim/world";
import fetchInject from "./headless-content";
```

In `headlessMain()`, delete the `const [{ spawnMatch, stepWorld }, { default: fetchInject }, { createHash }] = await Promise.all([...])` block, and replace the hashing tail:

```ts
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(json);
  process.stdout.write(hasher.digest("hex") + "\n");
```

(The HEADLESS branch still only runs under Bun — guarded in Task 2 — so `Bun.*` there is safe. The browser bundle already contains `world.ts` via battle, so static imports cost nothing and silence both "dynamically imported but also statically imported" warnings.)

- [ ] **Step 3: Verify**

Run: `bun test && bun run typecheck && bun run build 2>&1 | tee /tmp/build.log`
Expected: no `[plugin vite:resolve]` externalization line, no "dynamically imported" warnings, build succeeds.
Also re-verify the HEADLESS path still hashes identically to before the hasher swap:

```bash
HEADLESS=1 bun src/main.ts --replay /tmp/replay-001.json   # any existing replay file; note the hash
```

(If no replay file exists yet, skip this check — Task 8 pins the hash permanently.)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(ui): static imports and Bun.CryptoHasher; drop dead code; silent build"
```

---

## Slice 3 — Determinism Gate + Bot Soak

**Demo at slice end:** `bun test` includes a golden 1200-tick replay whose hash fails loudly on any nondeterministic sim change (verified by a deliberate tamper), and `bun scripts/soak.ts` runs 40 eight-bot matches clean.

---

### Task 8: Golden replay fixture + hash pin

**Files:**
- Create: `src/sim/canonical.ts`, `scripts/gen-replay.ts`, `tests/golden/replay.test.ts`, `tests/golden/match-001.sha256` (generated), `tests/fixtures/replay-001.json` (generated)
- Modify: `src/main.ts` (import `canonicalReplacer` from the shared module, delete its local copy)

**Interfaces:**
- Consumes: `spawnMatch({ seed, stage, slots, sheets })`, `stepWorld(prev, inputs, ctx)` from `src/sim/world.ts`; `loadAllContent(inject)` from `src/content/loader.ts`; `fetchInject()` from `src/headless-content.ts`.
- Produces: `canonicalReplacer(key, value): unknown` (shared, in `src/sim/canonical.ts` — allowed there: pure function, no banned tokens, passes `check-determinism.mjs`). The replay file format is `{ seed: number; stageId: string; slots: SlotConfig[]; inputs: Array<[Partial<InputFrame>, Partial<InputFrame>]> }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/golden/replay.test.ts
// Golden determinism pin: run the committed replay through the PUBLIC sim API
// and hash the canonical final state. If this test fails after a sim edit,
// determinism broke — do NOT regenerate the hash without understanding why.
// Expected-failure check (run once after first creating the pin): flip the
// priority sort in src/sim/hitdetect.ts to ascending → this test must FAIL →
// revert with `git checkout -- src/sim/hitdetect.ts`.
import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { spawnMatch, stepWorld } from "../../src/sim/world";
import type { SimContext } from "../../src/sim/world";
import { loadAllContent } from "../../src/content/loader";
import fetchInject from "../../src/headless-content";
import { canonicalReplacer } from "../../src/sim/canonical";
import type { InputFrame } from "../../src/sim/types";

const HASH_PATH = "tests/golden/match-001.sha256";

async function runReplay(): Promise<string> {
  const cache = await loadAllContent(await fetchInject());
  if (cache.errors.length > 0) throw new Error("content errors: " + JSON.stringify(cache.errors));
  const replay = (await Bun.file("tests/fixtures/replay-001.json").json()) as {
    seed: number; stageId: string;
    slots: Parameters<typeof spawnMatch>[0]["slots"];
    inputs: Array<Array<Partial<InputFrame>>>;
  };
  const stage = cache.stages.get(replay.stageId);
  if (stage === undefined) throw new Error(`unknown stage ${replay.stageId}`);
  let w = spawnMatch({ seed: replay.seed, stage, slots: replay.slots, sheets: cache.sheets });
  const ctx: SimContext = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };
  const neutral: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };
  for (const tickInputs of replay.inputs) {
    if (w.over) break;
    const inputs = tickInputs.map((f): InputFrame => ({
      a: f.a ?? false, j: f.j ?? false, dHeld: f.dHeld ?? false,
      dir: { x: (f.dir?.x ?? 0) as -1 | 0 | 1, z: (f.dir?.z ?? 0) as -1 | 0 | 1 },
    }));
    while (inputs.length < w.fighters.length) inputs.push(neutral);
    ({ state: w } = stepWorld(w, inputs, ctx));
  }
  return createHash("sha256").update(JSON.stringify(w, canonicalReplacer)).digest("hex");
}

describe("golden replay", () => {
  test("1200-tick scripted brawler-vs-swordsman match hashes stably", async () => {
    const hash = await runReplay();
    if (process.env.GOLDEN_WRITE === "1") {
      await Bun.write(HASH_PATH, hash + "\n");
      console.log("golden hash written:", hash);
    }
    expect(hash).toBe((await Bun.file(HASH_PATH).text()).trim());
  });

  test("HEADLESS runner agrees with the pinned hash", async () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "src/main.ts", "--replay", "tests/fixtures/replay-001.json"],
      env: { ...process.env, HEADLESS: "1" },
      stdout: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe((await Bun.file(HASH_PATH).text()).trim());
  });
});
```

- [ ] **Step 2: Create the shared canonical replacer + generator**

`src/sim/canonical.ts` — move `canonicalReplacer` verbatim out of `src/main.ts` (it is at the bottom of the file; keep the exact body):

```ts
// src/sim/canonical.ts — canonical JSON form for state hashing: Sets become
// sorted arrays, buffer-like objects serialize via .serialize(), object keys
// are sorted at every depth. Shared by the HEADLESS runner and the golden
// test so both hash byte-identically.
export function canonicalReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value].sort();
  if (value !== null && typeof value === "object" && typeof (value as { serialize?: unknown }).serialize === "function") {
    return canonicalReplacer(_key, (value as { serialize(): unknown }).serialize());
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort((x, y) => x[0].localeCompare(y[0])),
    );
  }
  return value;
}
```

In `src/main.ts`: `import { canonicalReplacer } from "./sim/canonical";` and delete the local `canonicalReplacer` function.

`scripts/gen-replay.ts`:

```ts
// scripts/gen-replay.ts — generates tests/fixtures/replay-001.json with fully
// scripted inputs (no bots, no RNG beyond the seeded spawn): P1 walks in,
// punches a 3-hit chain, casts energyBlast (D>A, 25 MP), jumps at t=500.
// P2 idles and jumps once. Output is committed; regenerate only when the
// scenario itself should change — never to mask a determinism failure.
import type { InputFrame } from "../src/sim/types";

type Partial4 = Partial<InputFrame>;
const N = (over: Partial4 = {}): Partial4 =>
  ({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 }, ...over });

const TICKS = 1200;
const p1: Partial4[] = Array.from({ length: TICKS }, () => N());
const p2: Partial4[] = Array.from({ length: TICKS }, () => N());

for (let t = 0; t <= 119; t++) p1[t] = N({ dir: { x: 1, z: 0 } });   // walk right
for (const t of [120, 130, 140]) { p1[t] = N({ a: true }); p1[t + 1] = N({ a: true }); }
for (let t = 295; t <= 306; t++) p1[t] = N({ dHeld: true });          // hold Defend
p1[300] = N({ dHeld: true, dir: { x: 1, z: 0 } });                    // ">" edge
p1[305] = N({ dHeld: true, dir: { x: 1, z: 0 }, a: true });           // D>A complete
p1[500] = N({ j: true });                                             // jump
p2[500] = N({ j: true });

const replay = {
  seed: 20260824,
  stageId: "grassland-dojo",
  slots: [
    { isHuman: true, charId: "brawler", team: "red" },
    { isHuman: true, charId: "swordsman", team: "blue" },
  ],
  inputs: p1.map((f, i) => [f, p2[i]!]),
};

await Bun.write("tests/fixtures/replay-001.json", JSON.stringify(replay));
console.log("wrote tests/fixtures/replay-001.json");
```

- [ ] **Step 3: Generate fixture, write golden hash honestly, pin**

```bash
bun scripts/gen-replay.ts
GOLDEN_WRITE=1 bun test tests/golden/replay.test.ts     # writes match-001.sha256 on first run
bun test tests/golden/replay.test.ts                     # now passes without the flag
```

Expected: both golden tests pass, including the HEADLESS parity check.

- [ ] **Step 4: Verify the guard catches tampering**

Edit `src/sim/hitdetect.ts`: change its priority sort comparator to ascending (`a.box.priority - b.box.priority`). Run `bun test tests/golden/replay.test.ts` → expect FAIL (hash mismatch). Revert: `git checkout -- src/sim/hitdetect.ts` → re-run → PASS. Record "tamper check done <date>" in the commit message.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(golden): 1200-tick replay hash pins simulation determinism (tamper check done 2026-09-03)"
```

---

### Task 9: Eight-bot soak

**Files:**
- Create: `scripts/soak.ts`

**Interfaces:**
- Consumes: same sim API as Task 8; `MAX_FIGHTERS` from `src/sim/constants.ts`.
- Produces: a committed soak tool; exit code 0 only if every match terminates, emits `matchEnd`, and never produces NaN fighter state.

- [ ] **Step 1: Write the script**

```ts
// scripts/soak.ts — 8-bot FFA soak over seeds 1..20 on both stages.
// Surfaces stuck-in-wall, infinite-grab, and never-ending-match bugs
// deterministically: any failure prints (stage, seed, tick) so the exact
// match can be replayed via HEADLESS=1 bun src/main.ts --replay <fixture>.
import { spawnMatch, stepWorld } from "../src/sim/world";
import type { SimContext } from "../src/sim/world";
import { loadAllContent } from "../src/content/loader";
import fetchInject from "../src/headless-content";
import { MAX_FIGHTERS } from "../src/sim/constants";
import type { Team } from "../src/sim/types";

const CHAR_IDS = ["brawler", "swordsman", "fire-caster", "ice-caster", "ninja", "support-mage"];
const TICK_CAP = 9000; // 150 s of game time per match

const cache = await loadAllContent(await fetchInject());
if (cache.errors.length > 0) throw new Error("content errors: " + JSON.stringify(cache.errors));
const ctx: SimContext = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };

const lengths: Array<{ stage: string; seed: number; ticks: number }> = [];
let failures = 0;

for (const stageId of ["grassland-dojo", "rooftop-night"]) {
  const stage = cache.stages.get(stageId)!;
  for (let seed = 1; seed <= 20; seed++) {
    const slots = Array.from({ length: MAX_FIGHTERS }, (_, i) => ({
      isHuman: false, charId: CHAR_IDS[i % CHAR_IDS.length]!, team: "independent" as Team,
    }));
    let w = spawnMatch({ seed, stage, slots, sheets: cache.sheets });
    let sawMatchEnd = false;
    let ticks = 0;
    for (; ticks < TICK_CAP && !w.over; ticks++) {
      const r = stepWorld(w, [], ctx);
      w = r.state;
      if (r.events.some((e) => e.type === "matchEnd")) sawMatchEnd = true;
      for (const f of w.fighters) {
        const bad = [f.x, f.y, f.z, f.vx, f.vy, f.vz, f.hp, f.mp].some((v) => !Number.isFinite(v));
        if (bad) {
          console.error(`FAIL ${stageId} seed=${seed} tick=${ticks} fighter=${f.id}: non-finite state`);
          failures++;
        }
      }
    }
    if (!w.over) { console.error(`FAIL ${stageId} seed=${seed}: no matchEnd within ${TICK_CAP} ticks`); failures++; }
    else if (!sawMatchEnd) { console.error(`FAIL ${stageId} seed=${seed}: ended without matchEnd event`); failures++; }
    else lengths.push({ stage: stageId, seed, ticks });
  }
}

const sorted = lengths.map((l) => l.ticks).sort((a, b) => a - b);
const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : NaN;
console.log(`completed=${lengths.length}/40 failures=${failures} medianTicks=${median} (${(median / 60).toFixed(1)}s)`);
for (const l of lengths) console.log(`  ${l.stage} seed=${l.seed}: ${l.ticks} ticks`);
if (failures > 0) process.exit(1);
```

- [ ] **Step 2: Run it**

Run: `bun scripts/soak.ts`
Expected (healthy sim): `completed=40/40 failures=0`, median in the 1500–4500 tick band (out-of-band medians are Task 11's problem, not a failure here).

- [ ] **Step 3: If anything fails, debug deterministically**

For each failure line `(stageId, seed, tick)`: reproduce with the public API in a scratch test (`spawnMatch` with that seed/stage/8-bot slots, loop `stepWorld(w, [], ctx)` to the failing tick, dump `w.fighters` around the tick). Known-risky paths to inspect first: the grab chain in `src/sim/hitdetect.ts` + `src/sim/fighter.ts` (grabbed→grabbing→thrown handoff), wall folding in `src/sim/physics.ts`, and `bot.ts` decision lock. Fix the sim, add a regression unit test next to the affected module's existing test file, re-run soak until `failures=0`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(soak): 8-bot FFA seed sweep tool; sim clean across 40 matches"
```

---

## Slice 4 — Real Art, Balance, README

**Demo at slice end:** the same e2e smoke, but the match renders real Kenney CC0 sprites; README documents everything; final gates all green.

---

### Task 10: Production atlases from Kenney CC0 packs

**Files:**
- Create: `scripts/build-atlases.ts`, `scripts/check-sprite-refs.mjs`
- Overwrite: `public/assets/atlas/{fighters,props,fx,bg}.{png,json}`, `public/assets/CREDITS.txt`
- Modify: `package.json` (add sprite check to `build`)

**Interfaces:**
- Consumes: placeholder atlas JSON schema (`AtlasFrame[]` with `name/x/y/w/h/pivotX/pivotY` — identical shape, `src/render/atlas.ts` unchanged); the frame names are frozen: **every `sprite` reference in `src/data` must keep its exact name** (123 references, verified resolving today).
- Produces: real atlases in the same format; `node scripts/check-sprite-refs.mjs` as a build gate.

- [ ] **Step 1: Download and verify the CC0 packs**

```bash
mkdir -p /tmp/kenney && cd /tmp/kenney
curl -L -o tiny-dungeon.zip "https://kenney.nl/media/pages/assets/tiny-dungeon/*/kenney_tiny-dungeon.zip"
curl -L -o roguelike-rpg.zip "https://kenney.nl/media/pages/assets/roguelike-rpg-pack/*/kenney_roguelike-rpg-pack.zip"
curl -L -o particle-pack.zip "https://kenney.nl/media/pages/assets/particle-pack/*/kenney_particle-pack.zip"
curl -L -o pixel-platformer.zip "https://kenney.nl/media/pages/assets/pixel-platformer/*/kenney_pixel-platformer.zip"
for z in *.zip; do unzip -o -q "$z" -d "${z%.zip}"; done
grep -ril "CC0" ./*/License* >/dev/null && echo "LICENSE OK: CC0 confirmed" || { echo "LICENSE CHECK FAILED — do not ship"; exit 1; }
```

If a kenney.nl link 404s (they rotate): open `https://kenney.nl/assets/<name>`, copy the current zip URL from the page. Any path is fine as long as the unzipped `License.txt` states CC0 1.0.

- [ ] **Step 2: Create the atlas builder (mechanical pipeline, manifest-driven)**

`scripts/build-atlases.ts` — packs curated cells row-major into power-of-two PNGs with a 1px gutter and writes twin JSONs:

```ts
// scripts/build-atlases.ts — compose production atlases from curated Kenney
// CC0 cells via ImageMagick 7 (`magick` must be on PATH). Pipeline per atlas:
// crop cell → optional uniform scale → optional palette tint → composite at
// its packed slot → emit PNG + twin JSON (AtlasFrame[] shape). Frame NAMES
// are frozen by src/data — never rename, only re-source.
//
// Workflow: run `bun scripts/build-atlases.ts --contact-sheet` to emit
// /tmp/kenney/contact-<pack>.png grids of candidate cells with coordinates,
// fill MANIFEST entries from it, then build and verify with the smoke test.
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { $ } from "bun";

const K = "/tmp/kenney";
const OUT = "public/assets/atlas";
const CELL = 48;   // uniform cell size: 16px Kenney cells scaled ×3
const GUTTER = 1;

interface Cell { name: string; src: string; x: number; y: number; w: number; h: number; tint?: string }
interface AtlasSpec { out: string; cells: Cell[] }

/** Example entry — extend each atlas's cells[] from the contact sheets. */
const MANIFEST: AtlasSpec[] = [
  {
    out: "fighters",
    cells: [
      // { name: "br_idle_0", src: `${K}/Tiny Dungeon/Spritesheet/spritesheet.png`, x: 16, y: 0, w: 16, h: 16, tint: "#8a8a8a" },
      // ... ~120 fighter cells (idle ×2, walk ×4, windup/active/recover per
      // move, hitstun, knockdown, getup, jump/fall, cast, grab) per archetype,
      // tinted per palette: brawler gray, swordsman brown, fire-caster red,
      // ice-caster blue, ninja green, support-mage white.
    ],
  },
  // props: weapons/items from Roguelike/RPG pack (~12 cells, knife/baseball-bat/boulder/box/milk/beer)
  // fx: Particle Pack blasts/hits (~16 cells)
  // bg: Pixel Platformer tiles composited into layer strips; names must match
  //     each stage's layers[].atlasKey values (bg_dojo_sky, bg_dojo_hills,
  //     bg_dojo_floor, ... — read src/data/stages/*.json, don't guess)
];

function pack(spec: AtlasSpec): void {
  if (spec.cells.length === 0) throw new Error(`atlas ${spec.out}: no cells in MANIFEST`);
  const slots = Math.ceil(Math.sqrt(spec.cells.length));
  const size = 1 << Math.ceil(Math.log2(slots * (CELL + GUTTER) + GUTTER));
  const frames: Array<Record<string, number | string>> = [];
  const tmp = "/tmp/kenney/cells";
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const canvas = `${tmp}/${spec.out}-canvas.png`;
  await $`magick -size ${size}x${size} xc:none ${canvas}`.quiet();
  spec.cells.forEach((cell, i) => {
    const col = i % slots, row = Math.floor(i / slots);
    const px = GUTTER + col * (CELL + GUTTER);
    const py = GUTTER + row * (CELL + GUTTER);
    const scaled = `${tmp}/scaled-${i}.png`;
    if (cell.tint !== undefined) {
      await $`magick ${cell.src} -crop ${cell.w}x${cell.h}+${cell.x}+${cell.y} +repage -scale ${CELL}x${CELL}! -fuzz 35% -fill ${cell.tint} -opaque gray(128) ${scaled}`.quiet();
    } else {
      await $`magick ${cell.src} -crop ${cell.w}x${cell.h}+${cell.x}+${cell.y} +repage -scale ${CELL}x${CELL}! ${scaled}`.quiet();
    }
    frames.push({ name: cell.name, x: px, y: py, w: CELL, h: CELL, pivotX: px + CELL / 2, pivotY: py + CELL });
    await $`magick ${canvas} ${scaled} -geometry +${px}+${py} -composite ${canvas}`.quiet();
  });
  await $`magick ${canvas} ${OUT}/${spec.out}.png`.quiet();
  writeFileSync(`${OUT}/${spec.out}.json`, JSON.stringify(frames, null, 1));
  console.log(`${spec.out}: ${spec.cells.length} cells → ${size}x${size}`);
}

for (const spec of MANIFEST) {
  if (process.argv.includes("--contact-sheet")) continue;
  await pack(spec);
}
if (process.argv.includes("--contact-sheet")) {
  // Contact sheets: label each candidate cell with its sheet coordinates so
  // MANIFEST entries can be filled from the image directly.
  for (const pack of ["Tiny Dungeon/Spritesheet/spritesheet.png", "Roguelike RPG/Spritesheet/spritesheet.png"]) {
    const src = `${K}/${pack}`;
    if (existsSync(src)) {
      const name = pack.split("/")[0]!.replace(/\s+/g, "-").toLowerCase();
      await $`magick ${src} -scale 300% -gravity center -background white /tmp/kenney/contact-${name}.png`.quiet();
      console.log(`contact sheet: /tmp/kenney/contact-${name}.png (grid = 16px cells ×3)`);
    }
  }
}
```

Notes for the implementer: top-level `await`s are fine under Bun; run only from the repo root so relative `OUT` resolves. The tint recipe (`-fuzz 35% -opaque gray(128)`) recolors Tiny Dungeon's neutral gray clothing — tune per archetype if the result is muddy.

- [ ] **Step 3: Curate cells and build**

1. `bun scripts/build-atlases.ts --contact-sheet` and open the emitted PNGs.
2. Fill `MANIFEST` cell-by-cell. Required coverage per fighter archetype (names must match `src/data/characters/*.json` sprite fields exactly — read them, don't guess): idle ×2, walk cycle, per-move windup/active/recover, hitstun, knockdown, getup, jump/fall, cast, grab poses. Props need every weapon/item sprite; fx needs every projectile sprite; bg needs every `layers[].atlasKey` from `src/data/stages/*.json` (e.g. `bg_dojo_sky`, `bg_rooftop_floor`).
3. `bun scripts/build-atlases.ts`

- [ ] **Step 4: Add the sprite-coverage gate**

`scripts/check-sprite-refs.mjs`:

```js
// Build gate: every `sprite` string anywhere under src/data must resolve in a
// public/assets/atlas/*.json frame list. Prevents shipping data that renders
// as magenta boxes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const frames = new Set();
for (const f of readdirSync(join(ROOT, "public/assets/atlas"))) {
  if (!f.endsWith(".json")) continue;
  for (const fr of JSON.parse(readFileSync(join(ROOT, "public/assets/atlas", f), "utf8"))) frames.add(fr.name);
}
let missing = 0;
function walk(node, file) {
  if (Array.isArray(node)) { node.forEach((v) => walk(v, file)); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const isRef = (k === "sprite" || k === "atlasKey") && typeof v === "string";
      if (isRef && !frames.has(v)) {
        console.error(`missing frame: "${v}" (referenced in ${file})`);
        missing++;
      } else walk(v, file);
    }
  }
}
for (const dir of ["characters", "stages"]) {
  const d = join(ROOT, "src/data", dir);
  for (const f of readdirSync(d)) walk(JSON.parse(readFileSync(join(d, f), "utf8")), `${dir}/${f}`);
}
for (const f of ["weapons.json", "items.json"]) {
  walk(JSON.parse(readFileSync(join(ROOT, "src/data", f), "utf8")), f);
}
if (missing > 0) { console.error(`sprite check: ${missing} missing frame(s)`); process.exit(1); }
console.log("sprite check: clean");
```

Update `package.json`:

```json
"build": "tsc --noEmit && node scripts/check-determinism.mjs && node scripts/check-sprite-refs.mjs && vite build",
```

- [ ] **Step 5: Visual pass + verify**

```bash
bun run build                       # gate must pass on the new atlases
bun run dev --port 5199 & sleep 3
python3 scripts/e2e-smoke.py --url http://localhost:5199/
pkill -f vite
```

Then manually (`bun run dev`, join P1, let the 7 bots fight ~30 s) and confirm: six visually distinct fighter palettes, no magenta boxes, depth sort visibly correct when fighters cross z bands, backgrounds match the stage. Iterate on MANIFEST crops until clean. The golden replay test must STILL pass (art never touches the sim).

- [ ] **Step 6: Rewrite CREDITS.txt provenance and commit**

Replace the placeholder-art section of `public/assets/CREDITS.txt` with the real provenance (keep the audio section):

```
ART — Kenney game assets, CC0 1.0 Universal (https://kenney.nl)
================================================================
Fighter sprites ....... Tiny Dungeon     (kenney.nl/assets/tiny-dungeon)
Weapon/item icons ..... Roguelike/RPG pack (kenney.nl/assets/roguelike-rpg-pack)
Blast/hit FX .......... Particle Pack    (kenney.nl/assets/particle-pack)
Stage tiles/backdrops . Pixel Platformer (kenney.nl/assets/pixel-platformer)
Packed by scripts/build-atlases.ts on <DATE>; frame names owned by src/data.
License: https://creativecommons.org/publicdomain/zero/1.0/
Locked decision 4: no ripped LF2 sprites or portraits.
```

```bash
git add -A && git commit -m "feat(art): CC0 Kenney atlases for fighters/props/fx/backgrounds with provenance"
```

---

### Task 11: Balance pass to the TTK target

**Files:**
- Create: `scripts/ttk.ts`
- Modify (data only): `src/data/characters/*.json`, `src/data/stages/*.json`
- Constraint: **data files only** — engine changes need explicit justification in the commit message.

**Interfaces:**
- Consumes: sim API as in Task 8/9.
- Produces: median 1v1 match length in the 1500–4500 tick band (25–75 s), measured, not vibes.

- [ ] **Step 1: Write the measurement script**

```ts
// scripts/ttk.ts — median 1v1 bot-duel length across seeds; the balance dial.
// Target band from the plan: 1500–4500 ticks (25–75 s at 60 Hz).
import { spawnMatch, stepWorld } from "../src/sim/world";
import type { SimContext } from "../src/sim/world";
import { loadAllContent } from "../src/content/loader";
import fetchInject from "../src/headless-content";

const PAIRS: Array<[string, string]> = [
  ["brawler", "swordsman"], ["fire-caster", "ice-caster"], ["ninja", "support-mage"],
];

const cache = await loadAllContent(await fetchInject());
const ctx: SimContext = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };
const stage = cache.stages.get("grassland-dojo")!;

const all: number[] = [];
for (const [a, b] of PAIRS) {
  const ticks: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    let w = spawnMatch({ seed, stage, slots: [
      { isHuman: false, charId: a, team: "red" }, { isHuman: false, charId: b, team: "blue" },
    ], sheets: cache.sheets });
    let t = 0;
    for (; t < 9000 && !w.over; t++) w = stepWorld(w, [], ctx).state;
    ticks.push(t);
  }
  const sorted = [...ticks].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  all.push(...ticks);
  console.log(`${a} vs ${b}: median ${median} ticks (${(median / 60).toFixed(1)}s) min ${sorted[0]} max ${sorted[sorted.length - 1]}`);
}
const sorted = [...all].sort((x, y) => x - y);
const median = sorted[Math.floor(sorted.length / 2)]!;
console.log(`OVERALL median ${median} ticks — target 1500–4500: ${median >= 1500 && median <= 4500 ? "OK" : "OUT OF BAND"}`);
```

- [ ] **Step 2: Measure, then tune data only**

Run `bun scripts/ttk.ts`. Tuning rules (apply to `src/data/**/*.json` only):
- Median **< 1500**: raise `maxHp` toward 260 or cut ~10% off the highest-`damage` hitboxes (`moves.*.frames[].hitbox.damage`) of the fastest pair.
- Median **> 4500**: lower `maxHp` toward 200 or raise damage ~10% on the primary chain moves.
- Change one variable class at a time; re-run `bun scripts/ttk.ts` and `bun scripts/soak.ts` after each pass. Also re-run `bun test` — the golden hash WILL change with any data edit; that is expected and legitimate here: regenerate once with `GOLDEN_WRITE=1 bun test tests/golden/replay.test.ts` and commit hash + data together.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(content): balance pass — median bot TTK inside the 1500-4500 tick band"
```

---

### Task 12: README + final gates

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

```markdown
# LF2 Web

A browser remake of Little Fighter 2's VS mode: 6 original archetypes, 2 stages,
up to 4 local humans plus CPU bots (max 8 fighters). Deterministic 60 Hz
simulation, Canvas2D rendering, WebAudio, zero gameplay dependencies.

## Run

    bun install
    bun run dev          # http://localhost:5173

Production: `bun run build` then `bun run preview`.

## Controls

Keyboard (physical key codes):

| | Attack | Jump | Defend | Move |
|---|---|---|---|---|
| P1 | `,` | `.` | `/` | Arrow keys |
| P2 | `F` | `G` | `H` | WASD |
| P3 | `;` | `,` | `/` | IJKL (falls back to `'`/`Enter` when P1 is active) |
| P4 | Numpad `0` | Numpad `.` | Numpad `+` | Numpad 8456 |

Gamepads (standard mapping): X = Attack, A = Jump, B = Defend, left stick/dpad
= move. Press Attack on a pad in Character Select to join. Rebind keys from
Title → Controls → REMAP (persisted under `lf2.bindings.v1`).

Specials are LF2-style sequences, e.g. hold Defend, tap toward, Attack (`D>A`).

## Architecture

- `src/sim/` — pure deterministic simulation (`spawnMatch`, `stepWorld`).
  No DOM, no clocks, no `Math.random`; all randomness is a seeded PRNG in
  `WorldState`. Interprets JSON character sheets (`src/data/`).
- `src/content/` — fetch + validate + cross-link the JSON sheets.
- `src/input/`, `src/render/`, `src/audio/`, `src/ui/` — read-only consumers
  fed by `SimEvent`s; `src/main.ts` is the composition root.
- Fixed-timestep loop (`src/ui/loop.ts`), whole-arena camera, depth-sorted
  Canvas2D renderer, DOM-overlay scene shell (`src/ui/scenes/`).

## Testing & determinism

    bun test                          # full suite
    bun run build                     # typecheck + determinism + sprite gates + vite build
    bun scripts/soak.ts               # 40 × 8-bot FFA soak (termination, NaN guard)
    bun scripts/ttk.ts                # bot-duel length measurement
    bun test tests/golden/replay.test.ts   # 1200-tick replay must hash to the pinned sha256

`tests/golden/match-001.sha256` pins the sim: if it fails after a sim edit,
determinism broke — do not regenerate the hash without understanding why.

## Credits

All art and audio are CC0 — see `public/assets/CREDITS.txt` for pack provenance.
No ripped Little Fighter 2 assets are used.
```

- [ ] **Step 2: Manual human play pass (~30 min)**

Run `bun run dev` and walk the original Task-15 checklist; fix any failure before the README commit (data-file fixes follow Task 11's rules):

- P1 + P2 keyboard simultaneous play (P1 `,`/`.`/`/` + arrows, P2 `F`/`G`/`H` + WASD) — no input cross-talk.
- Gamepad joins mid-select and drives its fighter in battle.
- Every character's special fires with correct MP gating (brawler `D>A` costs 25; watch the blue bar).
- Grab → throw → knockdown → i-frame getup chain reads correctly.
- Weapon durability breaks; milk heals; rooftop-night drops more weapons than grassland-dojo.
- Pause (Esc) freezes the sim; Resume continues; Remap from pause works; Quit returns to title.
- Results → REMATCH keeps the roster and stage with a new seed; CHARACTER SELECT returns with a fresh join state.

- [ ] **Step 3: Final gates**

```bash
bun test && bun run typecheck && node scripts/check-determinism.mjs && bun run build && bun scripts/soak.ts && python3 scripts/e2e-smoke.py
```

Expected: every gate green, soak `failures=0`, smoke `PASS`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: README, MVP complete"
```

---

## Task dependency graph

```
Slice 1:  T1 (gotoArg + WIP commit) → T2 (boot guard) → T3 (UI loop) → T4 (atlases + e2e)
Slice 2:  T5 (pad join; needs T3's ticking update) → T6 (title menu) → T7 (cleanup)
Slice 3:  T8 (golden pin) → T9 (soak)          [after T4; T8 needs T7's CryptoHasher swap]
Slice 4:  T10 (art) → T11 (balance; regenerates golden hash) → T12 (README)
```

Every slice leaves the tree green and the game playable; run `python3 scripts/e2e-smoke.py` after any task that touches UI, and `bun test tests/golden/replay.test.ts` after anything that touches `src/sim/` or `src/data/`.

## Non-goals (unchanged from the spec)

Netplay/rollback, more stages or characters than the 6+2 roster, ripped LF2 assets (locked decision 4), mobile/touch input, saving matches.
