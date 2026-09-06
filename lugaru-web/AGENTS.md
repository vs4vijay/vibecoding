# AGENTS.md — Lugaru Combat Prototype (`lugaru-web/`)

Third-person arena combat browser remake of *Lugaru's* core loop (3D rabbit combat — three context-sensitive buttons, timing-based reversals, simulated senses, ragdoll physics). Bun + Vite + TypeScript (strict) + three.js + Rapier (cosmetic dynamics only). Design spec lives in `docs/superpowers/specs/2026-08-22-lugaru-web-design.md`; task plan in `docs/superpowers/plans/2026-08-23-lugaru-web-combat-prototype.md`.

## Commands

```sh
bun install          # bun ONLY — never npm/npx/yarn/pnpm
bun run dev          # vite dev server (:5173)
bun run test         # vitest run (node env, no DOM)
bun run typecheck    # tsc --noEmit (strict)
bun run build        # static dist/ (base "./", deployable from any subpath)
```

Prefix shell commands with `rtk` per repo convention (`rtk vitest run`, `rtk git …`). Commit from the **repo root** (`vibecoding/`), not this folder.

## Layout

```
src/
  main.ts        boot: coarse-pointer guard → initErrorScreen → Game (no three/Rapier import)
  game.ts        Game class — owns sim + renderer + ui, mode state machine
                 (menu→tutorial→waves→results; R restart, Esc menu, F3 debug overlay)
  core/          loop.ts (FixedLoop, 16.667ms step, 4-step catch-up clamp),
                 timescale.ts (hitstop/slowmo), input.ts (pointer-lock, WASD, edge sampling),
                 rng.ts (seeded mulberry32 ONLY — no Math.random/Date.now in sim)
  data/          PURE data — ALL tunables: moves.ts, weapons.ts, tuning.ts, species.ts, waves.ts
  combat/        PURE logic — never import three/Rapier here:
                 resolver.ts (context moves), stateMachine.ts (move FSM + ledger),
                 reversal.ts, antirepetition.ts, injury.ts, scoring.ts, hitdetect.ts,
                 weaponsLogic.ts, stealth.ts, bodymoves.ts, types.ts
  ai/            PURE logic — perception.ts (sight cones/FOV/bushes), scent.ts,
                 brain.ts (FSM: patrol→investigate→circle→engage→flee/downed),
                 engage.ts (utility picker), difficulty.ts (Easy/Normal/Hard)
  actors/        skeleton.ts (procedural rig), clips.ts/clipsData.ts (pose clips),
                 controller.ts (kinematics), ragdoll.ts
  world/         terrain.ts (heightAt = THE terrain truth, analytic), physics.ts
                 (Rapier — cosmetic only: trimesh ground, ragdolls, knives),
                 wind.ts, bushes.ts, pickups.ts, projectiles.ts, walls.ts
  render/        scene.ts, camera.ts (chase cam), fx.ts (blood decals, dust, slow-mo), debugStats.ts
  ui/            dom.ts, menu.ts, tutorial.ts, waves.ts, results.ts, pause.ts,
                 persistence.ts (localStorage "lugaru-best-scores", guarded), errorScreen.ts
tests/           vitest, node env, mirrors src/ + tests/sim/harness.test.ts
                 + tests/perf.test.ts + tests/playwright/game-loop.test.ts
```

## Invariants (enforced by reviews/tests — do not break)

- **Sim/renderer separation (hard rule):** nothing under `src/combat/`, `src/ai/`, `src/core/`, `src/data/` may import three or Rapier. Renderer reads sim state; sim never renders. Rapier is cosmetic ONLY (ragdolls, thrown knives, corpses, dropped weapons) — fighters are kinematic capsules with analytic terrain height + circle-vs-box wall pushout.
- **Determinism:** no `Date.now()` or bare `Math.random()` inside the sim — inject `clockMs` and a seeded `mulberry32` RNG (`src/core/rng.ts`). Seeded RNG only; every run reproducible.
- **All tunables in `src/data/`:** gameplay timing/damage numbers live in `moves.ts`/`weapons.ts`/`tuning.ts` — magic numbers elsewhere are review rejections.
- **Fixed step:** 16.667 ms; catch-up clamp 4 steps/frame; zero heap allocations inside per-step update paths (preallocated scratch).
- **Blade reach resolves from WEAPONS at hit time:** resolver stance table is ordered crouched→legSweep, running→runningKick BEFORE armed→slash.
- **Controls (locked):** mouse-look via pointer lock; WASD move; LMB = attack, Space = jump, Shift = crouch/reverse/context. Nothing else.
- **Terrain:** `heightAt(x, z)` is THE single source of terrain truth — analytic, imported by sim AND mesh builder. Terrain collider is a TRIMESH (Rapier heightfields pass contacts non-deterministically even flat — empirically probed).

## Gotchas (each one bit us once)

- **Rapier heightfield broken:** rapier3d-compat 0.19.3 heightfields pass contacts non-deterministically even flat. Terrain collider = TRIMESH (planar triangles per 64×64 grid); `castGround` remains bilinear over the same grid.
- **Knife ground contact:** analytic `stick-where-it-lands` clamp (rapier CCD does not sweep trimeshes reliably).
- **RAPIER init:** `RAPIER.init()` must be awaited before first PhysicsWorld.create (server error: suns-vs-water symptom).
- **Browser verification:** spawn a dedicated headless Chromium over CDP; background/cmux panes throttle rAF to zero (black screenshots, frozen sims). Try `--ozone-platform=headless` / direct CDP attach.
- **Big vendor chunks:** Rapier + three are ~800 kB total — `vite.config.ts` raises `chunkSizeWarningLimit` to 900 and splits them via `build.rolldownOptions.output.codeSplitting` (not deprecated `manualChunks`).
- **Favicon:** inline SVG data-URI in `index.html` — no asset file, no 404 console error.
- **UI roots:** menus/tutorial/waves/results/pause live on separate DOM roots from the canvas; pause auto-triggers on Esc/blur/pointer-lock loss.

## Verification expectations

Logic changes need vitest coverage that would fail on regression (determinism suite with seeded RNGs; per-task test files `tests/<area>/<module>.test.ts`). Rendering/UI changes need a live browser pass with evidence (screenshots via playwright-cli — vision models may be unavailable). Full suite + typecheck green before any commit.