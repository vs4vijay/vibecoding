# AGENTS.md — Midtown Blitz

Open-city arcade checkpoint racing: drive a procedural downtown, beat medal
times on three Blitz routes, or free-roam in Cruise with ambient traffic.
Original game — no relation to the 2000 classic beyond genre affection.

## Commands

```bash
bun install            # deps
bun run dev            # vite dev server
bun run build          # production build to dist/ (subpath-safe, base "./")
bun run preview        # serve the built dist/
bun run test           # all 21 harnesses via scripts/run-all-tests.mjs (node)
```

Individual harnesses run standalone: `node scripts/<name>-test.mjs`. They are
pure-logic plain-node suites (no test framework, no DOM required) — one per
subsystem, plus `boot-integration-test.mjs`, which boots the REAL `src/main.js`
headlessly under DOM/WebAudio/rAF stubs and drives the full mode flow
(~204 checks — run it after any main.js change).

## Architecture (invariants)

- **Layering:** `src/engine` (game-agnostic: loop/input/audio/renderer/
  camera-rig/rng/fps-meter) → `src/game` (city, collision, physics, traffic,
  races, modes, save — pure logic, node-testable) → `src/ui` (DOM overlays:
  hud/menus) → `src/main.js` composes everything and owns the mode flow.
  Engine and game modules never import DOM; views/UI own all rendering.
- **Fixed-timestep sim** (`engine/loop.js`, 60 Hz accumulator, catch-up
  clamped at 5 ticks/frame) with render interpolation (`render(alpha)`).
  All gameplay timing (countdown, race clock) is SIM time, never wall clock,
  so pausing freezes everything for free.
- **Tunables live in one place:** car handling in `src/game/config.js`
  (JSDoc'd, unit-annotated), traffic behavior in `TRAFFIC_TUNING`
  (`src/game/traffic.js`), collisions in `CAR_COLLISION_TUNING`
  (`src/game/car-collisions.js`), quality tiers in `QUALITY_TIERS`
  (`src/engine/renderer.js`), routes/medal thresholds in `RACE_EVENTS`
  (`src/game/races.js`).
- **Deterministic city:** `src/game/city-gen.js` is a pure function of the
  versioned seed — byte-identical JSON dumps across processes (harness-enforced).
  RNG comes only from `src/engine/rng.js` (mulberry32 + forked streams).
- **Collision world** (`src/game/collision.js`): uniform spatial hash of AABBs;
  queries return world-owned scratch arrays (read immediately, never retain).
  Parked cars register via `addAabb` post-construction.
- **Debug surface:** `window.__game` exposes `{car, rig, camera, scene,
  renderer, layout, graph, traffic, modes, races, save, fps, …}` on every
  boot — the primary console-verification seam. `?debug` adds the input/audio/
  quality panels, an overhead view (V), a stuck-wedge helper (F), and a
  checkpoint test route (T).
- **Known embed-pane gotcha:** occluded webviews fire 0×0 resizes and freeze
  rAF. `resizeRenderer` ignores degenerate sizes and the camera constructor
  falls back to 16:9 — don't remove those guards (they fixed a "everything
  renders sky" bug). Verification in throttled panes: screenshots force
  compositor frames; sim can be driven manually via `__game.car.step()`.

## Testing notes

- Harnesses assert behavior, determinism (float-exact replays), and budgets
  (draw calls, per-tick cost, loading-phase sequence). `boot-integration` and
  `perf-audit` pin scene counters and loading phases — update the pins when a
  change legitimately alters them, as prior tasks did, with a comment.
- Console must stay clean in normal sessions: no `console.*` calls in src,
  favicon is an inline SVG data-URI, WebAudio unlocks lazily on first gesture.

Full design/implementation history: `openspec/changes/build-open-city-racing-game/`
(proposal, design decisions, per-task acceptance checks, delta specs).
