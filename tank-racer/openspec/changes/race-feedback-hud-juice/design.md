# Design

## Context

Tank Racer is a finished, tested (51/51) Three.js game with established patterns this change must slot into rather than reinvent:

- **Event wiring:** `WeaponsHooks` (`onShot`/`onHit`/`onWreck`) and `PowerupHooks` (`onPickup(tank, kind)`) are wired in `game.ts` ~L815; lap events flow through `handleProgressEvent` (`game.ts` L1262). No event bus exists — hooks are plain function fields.
- **Transient DOM:** `screens.ts` already has the replay-a-CSS-animation idiom (`replayAnimation`: swap text → force reflow → re-add `.show`).
- **Cached HUD:** `hud.ts` touches DOM only when a value changes, per panel (1 in 1P, 2 in 2P halves). Transient animations are a different lifecycle than this cache and must not fight it.
- **Juice:** `juice.ts` spawns short-lived meshes with *shared* geometry/materials; "fading" is a scale envelope because shared materials can't fade opacity per-mesh.
- **Audio:** `audio.ts` exposes a `sfx` object built on two primitives (`blip`, `noiseBurst`); `sfx.pickup()` doubles as menu-nav sound.
- **2P:** every HUD widget has a compact `.hud-half` variant; the split overlay is two scissor viewports, so a full-screen DOM vignette would cover both halves — vignettes must be per-half.

Constraints: pure client-side, no new dependencies, retro visual identity (Courier, flat colors, existing accent palette: cyan `#41d9ff`, orange `#ff8c00`, gold `#ffd23d`, cream `#ffe9b0`), `COUNTDOWN_STEP = 0.8s` must not change.

## Goals / Non-Goals

**Goals:**
- One fire-and-forget feedback API that `game.ts` calls at existing event sites; DOM/CSS owns all presentation.
- Full 2P parity with per-half isolation.
- All new VFX within the pooled-particle budget; zero steady-state per-frame allocation.
- Pure-logic pieces (wrong-way detection, position-callout rate limiting) extracted for headless unit tests.
- `prefers-reduced-motion` honored via CSS only.

**Non-Goals:**
- No race rules, physics, AI, scoring, or persistence changes.
- No title-screen restructuring, track dressing, or shell-trail work (trails exist).
- No new game modes, settings menus, or localStorage keys.

## Decisions

### D1 — Feedback API lives in `hud.ts`, fired imperatively from `game.ts`
Extend the object returned by `initHud()` with transient event methods: `onLap(tank, lapTime)`, `onPositionChange(tank, gained)`, `onHit(tank)`, `onWrongWay(tank, active)`, `onPickup(tank, kind)`.

*Why:* the vignette/callout elements must live inside the existing `.hud-half` containers and attach to panel elements `hud.ts` already owns; a second DOM module would have to re-query or split ownership of one subtree (the codebase keeps one DOM owner per `#`-root: `hud.ts` → `#hud`, `screens.ts` → `#screens`). An event-bus alternative was rejected — at most two call sites per event, and every existing hook in the codebase is a plain function field.

*Why fired from `game.ts`:* game.ts is already the only place that knows about laps (`handleProgressEvent`), standings deltas, and hook wiring; systems below it (`tank`, `track`) stay DOM-free per the existing layering.

### D2 — Pure event detectors in a new `src/race-events.ts`
- `createWrongWayDetector(): (t: number) => boolean` — state machine over per-frame spline-t samples; handles the 0↔1 wrap as forward, requires sustained reverse travel to arm and sustained forward travel to clear (hysteresis), so spin-outs and wall scrapes don't false-positive.
- `createPositionCalloutTracker(): (pos: number, now: number) => number | null` — returns `-1`/`+1` on a position change, `null` otherwise; enforces a per-player cooldown (~1.5s) so rapid swaps don't strobe.

Both are framework-free (SPEC.md convention: pure logic stays testable), unit-tested in a new `tests/race-events.test.ts`. Detectors run only for human tanks and only while `phase === "race"`.

### D3 — Countdown animation reuses the `replayAnimation` idiom
`screens.ts` gets a countdown-specific replay: per step, re-trigger a pop-in/fade-out keyframe sized to `COUNTDOWN_STEP` (0.8s); "GO!" additionally gets a `.go` class in an accent color. CSS duration and the TS constant are coupled by design — a comment on each side must point at the other.

*Alternative (JS-timed steps)* rejected: the sim already steps the countdown; duplicating timing in JS risks drift.

### D4 — Vignettes as per-half DOM overlays, class-driven
Each panel gets a dedicated vignette `<div>` (absolute, `inset: 0`, `pointer-events: none`, inset red glow via `box-shadow`/gradient): a one-shot `.flash` animation on hit, and a persistent `.low` pulsing state toggled while HP ≤ 30%. Elements are separate from cached-text elements, so the per-frame cache never writes to them and the two lifecycles can't fight.

In 1P the vignette div is a direct child of `#hud` (full-screen); in 2P one div per `.hud-half` — same element code, different parent, mirroring how panels are built today.

### D5 — Skid marks: per-mark cloned material, bounded pool
`juice.ts` gains a `skid(tank)` spawner. Marks are flat quads (shared geometry) with a *cloned* dark material per mark so each can fade opacity — the shared-material scale-envelope trick looks wrong on ground decals. Hard cap (~48 live marks, FIFO) with `material.dispose()` on removal; marks sit at a slight y-offset with `renderOrder` above the road to avoid z-fighting. Spawned rate-gated by distance traveled while (|steer| high ∧ speed above threshold) ∨ spin-out — humans and AI alike. Cleared by the existing `juice.reset()` on restart/track switch.

*Alternative (single dynamic BufferGeometry)* rejected: overkill for ≤48 quads and harder to dispose correctly.

### D6 — Boost flames reuse the existing fire particle pair
`juice.ts` gains `flame(tank)`, spawned from the hull rear opposite heading, reusing the module-shared `fireGeo`/`fireMat` already used by wreck bursts. `game.ts` rate-gates calls while `tank.boostTimer > 0` (same caller-gating pattern as `dust()`), so flames appear for pads, pickup boosts, and AI tanks with zero new state.

### D7 — Audio: new `sfx` entries, menus keep the generic chime
Add `sfx.lap()` (two-note rising chime, distinct from pickup), `sfx.wrongWay()` (short harsh buzz — played once on activation, not looping), and `sfx.shield()` / `sfx.triple()` (kind-distinct). `sfx.pickup()` stays for menu nav and boost consumption; in-race pickup calls re-point to the kind-specific sounds via the existing `onPickup` hook.

### D8 — Reduced motion is one CSS media block
`@media (prefers-reduced-motion: reduce)` re-points all new animation shorthands to opacity-only fades. No JS branching, no stored preference.

## Risks / Trade-offs

- [CSS↔TS timing coupling on countdown] → comment on `COUNTDOWN_STEP` and the keyframe block referencing each other; step duration is frozen by this design.
- [Transient classes vs per-frame cached HUD writes] → all transient state lives in dedicated elements/classes the cache never writes; verified by reading `updatePanel` write surface.
- [Per-mark material clones could churn GC] → FIFO cap + dispose on removal; cap sized so worst case is trivial (<50 small materials).
- [2P layout regressions from new elements] → new elements are absolutely positioned inside existing halves; no flow-affecting additions; manual 2P visual pass included in tasks.
- [Decal z-fighting on the road] → small y-offset + `renderOrder`; verified visually on all four tracks (Glacier ice patches are a different mesh — checked there specifically).
- [Wrong-way false positives at race start / during spins] → detector arms only after GO and requires sustained reverse travel; hysteresis on clear.
- [Pickup sounds re-pointed could surprise existing flows] → only the in-race `onPickup` call site changes; menu nav sound untouched.

## Migration Plan

Purely additive — no data format, API, or storage changes; rollback is reverting the commit. Ship order within the change doesn't matter for correctness; tasks are ordered so each leaves the build green.

## Open Questions

None — thresholds (skid speed, wrong-way sustain, cooldowns), colors, and durations are implementation-time tunables with initial values named in tasks.md.
