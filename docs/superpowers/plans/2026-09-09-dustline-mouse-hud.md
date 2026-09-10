# Dustline Mouse + HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken mouse look/fire and ship a procedural-only HUD/game-feel pass with zero new asset files.

**Architecture:** Three sequential tasks. T1 fixes the view-axis swap, fire-through-UI, and lock fragility in the client renderer. T2 restyles HUD/DOM (markup, CSS, UI helpers). T3 adds procedural game feel and wires T1+T2 together, then verifies.

**Tech Stack:** Three.js + TypeScript client, Bun workspaces, `bun test`.

**Spec:** Approved in chat 2026-09-09 (procedural AAA, keep zero-asset invariant). No separate spec file — this plan is the authority.

## Global Constraints

- Zero new runtime dependencies; zero asset files (no images, models, fonts, audio). CSS/SVG-inline only. PWA precache set must not grow.
- Server-authoritative: no gameplay/damage/score logic in client changes. Do not touch `packages/shared/`, `packages/server/`, or `packages/client/src/movement.ts` (parity invariant).
- Shell commands use the `rtk` prefix (`rtk bun test`, `rtk git …`). Commits from the repo root (`vibecoding/`), scoped to `dustline/` paths only. Never force-push.
- One task's files are owned exclusively until its review is clean (T1+T3 share `game.ts` sequentially, never in parallel).

## Cross-task contracts (verbatim)

- `localStorage` key `dustline:sensitivity`, default `0.002`, clamp range `[0.0005, 0.01]`.
- DOM ids (T2 creates, T1/T3 consume lazily via `?.` so missing elements never throw): `lockHint`, `sensitivityInput`, `hitmarker`, `damageVignette`.
- `packages/client/src/look.ts` exports `cameraAnglesFromRotation(rot: { x: number; y: number }): { pitch: number; yaw: number }` with `pitch = rot.y`, `yaw = rot.x` (`rotation.x` is yaw per `@dustline/shared` types).
- `packages/client/src/ui.ts` exports `showHitmarker(): void` (T2). `game.ts handleHit` calls it (T3).

---

### Task 1: Mouse core fix

**Files:**
- Modify: `dustline/packages/client/src/game.ts`
- Create: `dustline/packages/client/src/look.ts`
- Test: `dustline/packages/client/src/look.test.ts` (bun discovers it; test files are excluded from tsc)

**Interfaces:**
- Produces: `look.ts` (`cameraAnglesFromRotation`, `clampSensitivity`), lock-hint toggling, sensitivity plumbing.
- Consumes: DOM ids `lockHint`, `sensitivityInput` (may not exist yet — always `?.`).

- [ ] **Step 1: Create `look.ts` with the pure helpers**

```ts
export function cameraAnglesFromRotation(rot: { x: number; y: number }): { pitch: number; yaw: number } {
  // rotation.x = yaw, rotation.y = pitch (see @dustline/shared types.ts)
  return { pitch: rot.y, yaw: rot.x };
}

export const DEFAULT_SENSITIVITY = 0.002;

export function clampSensitivity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SENSITIVITY;
  return Math.min(0.01, Math.max(0.0005, v));
}
```

- [ ] **Step 2: Write the failing test `look.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { cameraAnglesFromRotation, clampSensitivity, DEFAULT_SENSITIVITY } from './look.js';

describe('cameraAnglesFromRotation', () => {
  test('maps yaw to camera yaw and pitch to camera pitch', () => {
    expect(cameraAnglesFromRotation({ x: 1.5, y: -0.3 })).toEqual({ pitch: -0.3, yaw: 1.5 });
  });
  test('passes yaw through unbounded (no clamp client-side)', () => {
    expect(cameraAnglesFromRotation({ x: Math.PI * 3, y: 0 }).yaw).toBe(Math.PI * 3);
  });
});

describe('clampSensitivity', () => {
  test('clamps and falls back', () => {
    expect(clampSensitivity(0.005)).toBe(0.005);
    expect(clampSensitivity(99)).toBe(0.01);
    expect(clampSensitivity(NaN)).toBe(DEFAULT_SENSITIVITY);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `rtk bun test packages/client/src/look.test.ts` (from `dustline/`)
Expected: FAIL with "Cannot find module './look.js'"

- [ ] **Step 4: Implement `game.ts` changes**
  1. Import `look.ts`; `renderLoop` uses the helper: `camera.rotation.x = pitch`, `camera.rotation.y = yaw` (order stays `YXZ`). Delete the swapped assignment.
  2. Fire guard: `mousedown` sets `input.fire = true` only when `isPointerLocked`.
  3. `getSensitivity()` reads `#sensitivityInput` when present, else `localStorage`, through `clampSensitivity`; `mousemove` uses it instead of the `0.002` literal.
  4. `pointerlockchange` toggles `#lockHint` (visible only when joined = `#hud` not hidden, and not locked); `pointerlockerror` shows it. All element access null-safe.

- [ ] **Step 5: Run covering checks**

Run: `rtk bun test packages/client/src/look.test.ts` then `rtk bun run --filter @dustline/client build`
Expected: both PASS (exit 0).

- [ ] **Step 6: Commit (repo root, scoped)**

```bash
rtk git add dustline/packages/client/src/game.ts dustline/packages/client/src/look.ts dustline/packages/client/src/look.test.ts
rtk git commit -m "fix(dustline): correct mouse look axes, guard fire on pointer lock"
```

### Task 2: HUD DOM + CSS + UI helpers

**Files:**
- Modify: `dustline/packages/client/index.html`, `dustline/packages/client/src/styles.css`, `dustline/packages/client/src/ui.ts`, `dustline/packages/client/src/main.ts` (sensitivity-slider persistence ONLY)

**Interfaces:**
- Produces: DOM ids `lockHint`, `sensitivityInput`, `hitmarker`, `damageVignette`; `ui.ts showHitmarker()`.
- Consumes: `dustline:sensitivity` key and `[0.0005, 0.01]` range (T1 contract).

- [ ] **Step 1: Markup** — capture-hint pill (`#lockHint.hidden`, "Click to capture mouse — Esc releases"), sensitivity range slider (`#sensitivityInput`, min 0.0005 max 0.01 step 0.0005 value 0.002) + controls list on login screen, `#hitmarker` inside `#crosshair`, `#damageVignette` overlay div.
- [ ] **Step 2: Styles** — restyle HUD panels/crosshair/timer/killfeed/scoreboard/login with team accents; hitmarker X animation; red edge vignette (opacity driven from JS); hint pill; crosshair spread via CSS var `--spread` (JS sets px). No external fonts/assets.
- [ ] **Step 3: `ui.ts`** — export `showHitmarker()` (retrigger animation), damage-flash setter for `#damageVignette`, crosshair-spread setter. No gameplay logic.
- [ ] **Step 4: `main.ts`** — persist slider to `localStorage` on input; preload from storage on boot. Nothing else.
- [ ] **Step 5: Verify** — `rtk bun run --filter @dustline/client build` passes.
- [ ] **Step 6: Commit (repo root, scoped)** — `fix(dustline): procedural HUD restyle, capture hint, hitmarker`.

### Task 3: Game feel + wiring + verification

**Files:**
- Modify: `dustline/packages/client/src/game.ts` (effects + wiring ONLY — mouse code from T1 is settled)

**Interfaces:**
- Consumes: T1 (`look.ts`, lock state), T2 (`showHitmarker()`, `#damageVignette`, `--spread`).

- [ ] **Step 1: Effects** — muzzle-flash PointLight spike with frame decay on fire; tracer line segment per shot (pooled, fades); impact flash quad at hit point; weapon bob (`updateWeaponModel`, amplitude scales with movement, zero when dead) + small recoil kick on fire. Geometry/materials only.
- [ ] **Step 2: Wiring** — `handleHit` calls `showHitmarker()`; firing sets `--spread` from weapon state; damage taken flashes `#damageVignette`.
- [ ] **Step 3: Verify** — `rtk bun test packages/client/src/look.test.ts`, `rtk bun run build` (shared → client → server order), plus the repo e2e `rtk bun test test.e2e.test.ts` (spawns real server on :3099; run alone, never concurrently).
- [ ] **Step 4: Commit (repo root, scoped)** — `feat(dustline): procedural game feel, hitmarker wiring`.
