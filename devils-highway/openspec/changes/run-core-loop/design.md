# Design

## Context

Slice 1 shipped the engine shell, world streaming, and a heavily art-tuned menu attract
diorama (see proposal.md — Why). The seams this change plugs into already exist:
`world.setPlan()` / `registerChunkType(name, factory(rng, ctx))` with pooled chunk groups,
the shambler dressing manager (a pooled InstancedMesh with per-instance anim — the pattern
to scale up for gameplay zombies), `recordBest()`/`currency` in the save, the `Mode`
contract named in the bible, and the QA gates (`screenshotReady`, staged settle). `js/` is
~205 KB raw today; the 150 KB bible budget was silently exceeded by the art slices.

## Goals / Non-Goals

**Goals:**

- RUN playable end-to-end inside the existing fixed-timestep loop and streaming world, with
  the shell UX loop (HUD → pause → gameover → instant retry) mode-agnostic from day one.
- Shared entity systems (zombies, obstacles, pickups, particles) built pooled and instanced
  so DRIVE/RIDE reuse them without forks.
- Attract/menu captures do not regress; all bible hard rules hold (zero console noise,
  determinism, config-only tunables, DOM-only UI).

**Non-Goals:**

- Guns/weapon system, health/damage model (instant death only), shop/economy spending,
  DRIVE and RIDE gameplay, ambient audio loops, settings screen, turn/crossroad mechanics
  (straight highway only this slice).

## Decisions

1. **State machine: `GAME` stays, PAUSED is a flag, GAMEOVER is a state.** The bible names
   PLAYING but the code and QA contract (`scene=game`) say GAME — renaming buys nothing.
   PAUSED is a boolean overlay state inside GAME (sim halts, world visible), not a machine
   state, so `?scene=paused` maps to `scene=game&paused=1`. GAMEOVER is a real state: the
   world keeps rendering behind it (dolly halts) for the death-reveal framing.
   *Alternative considered:* separate PAUSED state — rejected; it doubles every transition
   for no behavioral gain.

2. **Mode integration: the mode owns a "focus z"; main.js keeps owning world + camera.**
   `Mode.enter(ctx)` receives `{scene, world, input, audio, save, hud}`; `fixedUpdate(dt)`
   advances gameplay; the mode exposes its focus position each frame; main.js feeds
   `world.update(dt, focusZ)` and blends `cameraRig()` targets exactly as the menu dolly
   does today (same lerp path, run rig from `CONFIG.RIGS.run`). Menu attract becomes the
   degenerate case (focus z = dolly z), so the existing code path is preserved, not forked.

3. **Spawn director keyed to the chunk window, not to time.** Per-chunk spawns derive from
   `hashSeed(chunkIndex, runSeed)` with a dedicated tag (chunk builders use tags 1–3; spawns
   use 4 — sub-streams per feature: obstacles/zombies/pickups). `world.js` gains two
   callbacks (`onChunkActive(index, zStart)` / `onChunkInactive(index)`) fired from the
   existing spawn/despawn paths; the director pre-builds a chunk's entity set on activation
   and releases it on deactivation. Determinism is per-layout, not per-run (input changes
   outcomes; layout follows the seed).
   *Alternative considered:* distance-interval spawning — rejected; it fights the chunk
   streaming/recycling that already exists and breaks seed reproducibility per chunk.

4. **Gameplay-aware dressing via factory ctx, not a separate chunk plan.** `_spawnChunk`
   adds `gameplay: boolean` to the factory ctx; `chunks.js` buildWrecks shifts on-road wreck
   slots to the shoulders when set, so director-owned lane obstacles never visually collide
   with dressing vehicles. The CHUNK_PLAN stays identical, keeping RUN's look continuous
   with the menu. Corridor-clear (`CORRIDOR_CLEAR`) stays for attract mode only.

5. **Entities: pooled instanced systems in `js/entities/`.**
   - *Zombies*: dedicated gameplay manager (≤ 32 live instances) — CPU pose per fixed step,
     `InstancedMesh` matrix updates, per-instance color variance, emissive eyes as a second
     instanced mesh (≈ 2 draws total). Follows the proven shambler approach; the menu
     dressing manager is left untouched (regression risk stays near zero).
   - *Obstacles*: 3 archetypes — low barrier (jump), overhead gantry (slide), full-lane
     block (dodge) — each one instanced mesh (≈ 3 draws); collision via lane + z-window +
     height checks in fixed update (no physics engine).
   - *Pickups*: instanced amber supply markers with emissive pulse (1–2 draws), lane
     strands of 3–6.
   - *Player*: hierarchical low-poly rig (hips/torso/head/2 arms/2 legs, ≈ 1.5–2k tris,
     box/cylinder parts, library materials) with sinusoidal run cycle and lerped jump/slide
     poses — no skinning infra exists and instancing one character buys nothing.
   - *Particles*: one pooled Points system for pickup burst + death impact (1 draw).

6. **Input: action routing by state in main.js.** `InputManager` grows gameplay key
   bindings and touch swipe/tap detection (pointerdown/up delta, 24 px threshold, dominant
   axis) and emits the same action strings ("left/right/jump/slide/pause"); main.js routes
   actions to menu / active mode / shell depending on state. Pause is edge-triggered;
   gameplay actions are ignored while paused.

7. **Shell UI: three small DOM controllers.** `hud.js` (distance/score/pickups numerals +
   touch pause chip; placement class supplied by the mode's `hudLayout()`), `pause.js`
   (Resume/Restart/Quit), `gameover.js` (stats grid, NEW BEST flag, Retry primary/Menu).
   All follow the menu's pattern: `.screen` opacity transitions, staged reveal, hairline
   charcoal+amber styling. HUD text updates via `textContent` only (no layout thrash).

8. **Audio: first real output through `AudioManager`.** Master gain opens to ~0.8 on first
   gesture; tiny procedural synth helpers: pickup blip, lane whoosh (filtered noise), jump
   tick, death sting (pitch-drop + noise burst), UI confirm. Engine/ambient loops are
   explicitly out of scope this slice. Everything behind the existing lazy-context unlock.

9. **Scoring/save wiring.** `js/game/score.js`: score = distance + pickups ×
   `CONFIG.SCORE.pickup`; on death: `recordBest()` + currency credit + one `saveSave()`.
   Menu cards gain a per-mode "BEST — N M" line (footer's cross-mode best stays).

10. **Budget amendment: tracked 320 KB raw own-JS cap; draw-call restore task.** Art slices
    already put `js/` at ~205 KB raw; this change adds an estimated 70–85 KB (entities
    ~35 KB, mode ~15 KB, UI ~15 KB, input/audio/config/QA ~15 KB). The bible's 150 KB is
    unrecoverable without stripping tuned art code, so: QA reports gain a raw-bytes figure,
    the working cap becomes 320 KB, and a trim task merges chunk-scatter draws to bring
    gameplay scenes back under the 220 draw-call cap (attract menu measured 233 at dusk).

## Risks / Trade-offs

- [Menu/beauty capture regression] → attract path untouched (flag-gated gameplay systems
  only); QA pair captures (dusk+night menu, staged beauty) re-run every slice.
- [Draw-call cap exceeded with gameplay live] → trim task is part of this change's
  definition of done, with renderer.info per-material-group audit before/after.
- [SwiftShader capture fps far below the 18 fps bible target tonight (~4–5 fps observed)]
  → perf verification task lands first in the slice; if the gap is real (not capture
  overhead), quality-tier auto-down and chunk-dress trims are the levers — escalate to a
  budget discussion rather than shipping blind.
- [Zombie/obstacle visual overlap with dressing wrecks] → gameplay ctx shifts on-road
  dressing to shoulders; director reserves lane z-windows so spawns never straddle a
  shoulder wreck.
- [Instant retry feels slow if world reset rebuilds chunks] → retry reuses pooled chunks
  (`world.reset()` despawns; pools keep geometry) and entity pools — no allocation spike.
- [Esc-key muscle memory from attract mode] → Esc now pauses; QA adds a paused-scene
  capture so the change is deliberate and visible.

## Migration Plan

Purely additive on an unshipped app: new modules + gated extensions to `main.js`,
`input.js`, `world.js`, `chunks.js`, `qa/hooks.js`. No save-format change (v1 fields
already exist). Rollback = revert the slice commit; attract-only shell is restored.

## Open Questions

None blocking. The budget amendment (decision 10) is the one user-visible call — it
proceeds as the tracked 320 KB cap unless vetoed at proposal review.
