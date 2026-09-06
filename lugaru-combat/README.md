# Lugaru Web — Combat Prototype

A browser remake of the core of *Lugaru: The Rabbit's Foot* (Wolfire, 2005): a
3D third-person arena brawler whose depth comes from **timing and
positioning**, not button combos. Three context-sensitive buttons. Every attack
can be reversed; every reversal can be counter-reversed. Enemies simulate
senses — wolves smell blood and track wind, rabbits hear rustling bushes.

v1 is a combat prototype: one island arena, waves of AI opponents
(1v1 → 1v2 → 1v3), an interactive tutorial, and a score screen. No story
campaign, no multiplayer, no external art assets — everything is procedural.

## Run

```bash
bun install        # once
bun run dev        # Vite dev server (http://localhost:5173)
```

Play in a desktop browser (keyboard + mouse required — the game shows a
warning on coarse-pointer devices). Click the canvas to lock the pointer.

## Test

```bash
bun run test                  # vitest — headless unit/sim/combat suites
bunx playwright test          # E2E — menu → arena → results over the dev server
```

The vitest suite covers the pure combat logic (reversal windows, anti-repetition,
injury model, scoring, stealth), AI perception/brains, world systems, and the
ragdoll/FX perf invariants — no WebGL required. `tests/perf.test.ts` pins the
Task 20 polish contracts: ragdoll culling (>6 oldest settled removed), F3 p95
frame-time math, and the reversal window geometry that keeps a practiced-human
success rate in the winnable band.

## Build

```bash
bun run build      # tsc --noEmit strict + vite build
bun run preview    # serve the production bundle
```

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` / arrow keys | Move (run at full speed, sneak while crouched) |
| Mouse (pointer-locked) | Look |
| Left mouse button | Attack (punch → double-punch while held) |
| `Space` | Jump (leg cannon into a nearby enemy while running) |
| Left `Shift` (tap) | Crouch / **reverse** (timed press inside an enemy's attack window) |
| Left `Shift` (hold) | Sneak; near a grounded weapon → pick up; near a body → throw it |
| Left `Shift` + attack | Context move: blade cleaning, body throw, pickups |
| `Esc` | Pause (also auto-pauses on pointer-lock loss / window blur) |
| `R` | Restart wave after death |
| `F3` | Debug overlay: fps, frame-time p95, score, AI state, reversal counters (dev builds) |

Combat model: every attack has `startup → active → recovery` phases. A crouch
tap inside the attacker's `reversalWindow` (while facing them) converts their
move into a reversal; the original attacker then has a tighter window to
**counter-reversal** you with a downing throw. Repeating the same move grows
an anti-repetition penalty — vary your offense.

## Architecture

```
src/
├── core/      fixed 60Hz sim loop, input manager, timescale (hitstop/slow-mo)
├── combat/    character state machine, move table, context resolver,
│              reversal windows, injury model, scoring
├── ai/        perception (sight, hearing, scent), brain FSM, utility attacks
├── actors/    procedural skeletons, clip playback, ragdoll bridge
├── world/     heightfield terrain, bushes, boulder walls, weapon drops, wind
├── render/    three.js scene, chase camera, FX (particles, decals), debug overlay
├── ui/        menu, tutorial, wave/results screens, pause, persistence
└── data/      moves.ts + tuning.ts — every gameplay/timing number in one place
```

Principles:

- **Fixed-step simulation** (60Hz) with render interpolation; combat logic is
  pure functions over `(actorState, worldState)`, unit-testable headless.
- **Data-driven moves**: the state machine reads only the move table; adding a
  move = a new data row + pose clip.
- **Seeded randomness only**: every stochastic system (wind, fight rolls, FX
  jitter) uses seeded streams — no `Math.random`, no `Date.now` in logic, so
  replays and tests are deterministic.
- **Zero per-frame allocations** in the sim loop (pre-allocated scratch
  vectors, pooled particles/decals/ragdolls).
- **Sim/render separation**: logic never imports three.js; the render layer
  polls sim state each frame.

### Reference documents

- Design spec (binding authority):
  `docs/superpowers/specs/2026-08-22-lugaru-combat-design.md`
- Implementation plan (task breakdown + interfaces):
  `docs/superpowers/plans/2026-08-23-lugaru-combat-combat-prototype.md`

## Tuning pass notes (Task 20)

Final polish numbers, all in `src/data/tuning.ts`:

| Constant | Value | Rationale |
|---|---|---|
| `HITSTOP_MS` / `HITSTOP_KO_MS` | 90ms / 140ms | Hitstop freeze on a landed hit; KO-ing hits get 50% longer freeze so the finishing blow reads. |
| `KO_SLOWMO_SCALE` × `KO_SLOWMO_MS` | 0.25 × 900ms | Time dilation on KO, linear ease-out; 900ms is enough to see the ragdoll open without stalling the run. |
| `HEAVY_LAND_MIN_FALL_MPS` | 3.0 m/s | Fall speed at ground contact that kicks a dust ring — above per-step ground noise (~0.25), just under jump apex (~5.4). |
| `BLOOD_DECAL_POOL_SIZE` / `BLOOD_DECAL_FADE_MS` | 32 / 20 000ms | Ground decals persist ~20s then recycle; 32 planes cover even a long slugfest. |
| `VIGNETTE_HP_FRACTION` | 0.4 | Screen desaturation + edge vignette starts below 40% hp [spec §3.4]. |
| `MAX_RAGDOLLS` | 6 | Corpses beyond 6 are culled oldest-settled-first; keeps the physics world bounded in long runs. |
| `LEG_CANNON_FOV_KICK_DEG` / `_RECOVER_MS` | 6° / 500ms | Camera FOV punch on a landed leg cannon, linear recovery. |
| Reversal windows | 50–85% of `startup+active` | Geometry measured in `tests/perf.test.ts`; live rate visible via F3 `rev:` counters (successes/attempts). |

Feel pass (audio-free): hitstop/slow-mo timing, dust rings on heavy land,
blood puffs + fading ground decals on blade wounds, damage vignette +
desaturation, leg-cannon FOV kick, and KO slow-mo 0.25×900ms are the whole
impact vocabulary — the game has no audio assets, so the visual hits carry the
feedback.

## Performance budget

- Target: 60fps on integrated GPUs; p95 frame time < 16ms in a 3-enemy wave
  (F3 overlay reports `p95:` live).
- Pooled FX: 96 blood-puff points, 6 dust rings, 32 blood decals, 400 wind
  particles — all pre-allocated, zero per-step allocation.
- Zero allocations per sim step, verified by Chrome DevTools allocation
  sampling over a 60-second 3-enemy-wave capture.