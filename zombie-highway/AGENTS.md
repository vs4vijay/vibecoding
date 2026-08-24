# AGENTS.md — Undead Highway (`zombie-highway/`)

Endless zombie-driving arcade web game (homage to *Zombie Highway*, 2010). Vite + TypeScript (strict) + three.js. Zero image/audio assets — all visuals are three.js primitives, all audio WebAudio synthesis. Design spec + implementation history live in `.plan.md`.

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
  config.ts      ← ALL tunables live here. No magic numbers elsewhere.
  main.ts        boot, RAF loop (tick() MUST self-schedule — see Gotchas), wiring
  core/          emitter (typed pub/sub), storage (zh.* localStorage, node-safe shim),
                 input (pointer+keys, testHooks mode), audio (WebAudio synth engine)
  game/          PURE logic — never import three.js here:
                 difficulty.ts (level curve 400·n^1.35 + Knobs), car.ts (steer/rails/
                 tilt/flip), scoring.ts (streaks; single source of score truth),
                 zombies.ts (pooled state machine lurk→telegraph→leap→cling/dead),
                 obstacles.ts + spawner.ts (rows guarantee ≥2.6m passable gap),
                 combat.ts (fireGun), session.ts (fixed-step orchestrator, GameEvents)
  render/        three.js scene, pooled meshes bound to game state, CameraRig
  ui/            HUD (#hud), Menus (#menus), Coach (#coach) — SEPARATE body roots
tests/           vitest, node env. DOM behavior can't be unit-tested here —
                 InputController has testHooks mode; verify UI live via headless
                 Chromium over CDP (the cmux browser reports hidden → rAF throttles).
```

## Invariants (enforced by reviews/tests — do not break)

- **Coordinate system**: +z is the car's travel direction; camera sits behind at negative offset.
- **Fixed step**: sim runs at exactly 1/60 s from a clamped accumulator (`CONFIG.sim.maxFrameDt`). Never advance gameplay on wall dt.
- **Pooling**: zero steady-state allocation in any update path. Reuse scratch objects; pools are preallocated at construct (`startRun()` resets flags, doesn't reallocate).
- **Weights**: session SETS `car.leftWeight/rightWeight` absolutely each step from `ZombiePool.attachedWeight(x, out)` — out-param, don't allocate.
- **Scoring**: `Scoring` is the single source of truth; floor distance meters before `addDistance`.
- **Spawner**: obstacle rows must always leave a ≥2.6 m gap (pinned by 200-seed test); zombie types filtered by `knobs.types` (L1 walkers only).
- **Storage**: keys go through `core/storage.ts` with `zh.` namespace (`zh.bestScore`, `zh.bestDist`, `zh.muted`, `zh.coachSeen`, `zh.runs`).
- **Deps allowlist**: `three` + dev `{vite, vitest, typescript, @types/three}`. Adding anything else is a spec violation.
- `ZombiePool.hit(z, dmg)` returns true iff the target **survives** (test-pinned polarity); applies recent-leap ×2 damage internally when `now < z.recentLeapUntil`.
- `stepCar` no-ops when dead; session stops driving after a flipped event.

## Gotchas (each one bit us once)

- **rAF loop**: `tick()` ends with `requestAnimationFrame(tick)`. If you restructure `main.ts`, verify the game animates for >3 s after PLAY — a deleted tail freezes after frame 1 and every test stays green (none exercise the loop).
- **style.css**: imported by `main.ts`. Dropping the import leaves zero stylesheets — the entire UI ships inert while tests pass.
- **UI roots**: HUD hide/show toggles ONLY `#hud`. Menus, coach, and `.toasts` live on their own body roots (toast layer carries `z-index:20` above the game-over card's `z-index:10`). Don't nest them back inside `#hud`.
- **Fire keys** match on `ev.code` (`Comma`/`Period`), not `ev.key`.
- **Camera rig** pre-settle pose mirrors `offset.z` sign so the camera spawns behind the car; `planSegmentRecycle` recycles forward-only and floors at `carZ − 30`.
- **Draw budget**: ≤120 calls steady-state (currently ~91). Static road scenery is merged per segment — keep it merged; add new repeated scenery via instancing or merged geometry.
- **Browser verification**: spawn a dedicated headless Chromium over CDP; background/cmux panes throttle rAF to zero (black screenshots, frozen sims).

## Verification expectations

Logic changes need vitest coverage that would fail on regression (see `tests/final-fixes.test.ts` for the mutation-tested pattern). Rendering/UI changes need a live browser pass with evidence (pixel sampling or DOM probes — vision models may be unavailable). Full suite + typecheck green before any commit.
