# Tasks

Initial tuning values (adjust by feel during implementation): wrong-way sustain 0.6s / clear 0.4s; position-callout cooldown 1.5s; skid trigger |steer| ≥ 0.85 ∧ speed ≥ 60% max, cap 48 marks; vignette threshold HP ≤ 30%.

## 1. Pure event detectors + tests

- [x] 1.1 Create `src/race-events.ts` with `createWrongWayDetector()` (wrap-aware, arm/clear hysteresis per design D2) — verify with new `tests/race-events.test.ts` cases: forward wrap 0.99→0.01 never arms, sustained reverse arms, forward again clears, brief reverse during spin does not arm (`bun test tests/race-events.test.ts` green)
- [x] 1.2 Add `createPositionCalloutTracker()` to the same module (returns ±1 on change, null otherwise, per-instance cooldown) — extend `tests/race-events.test.ts`: change fires once, rapid swaps within cooldown return null, change after cooldown fires again (`bun test tests/race-events.test.ts` green)

## 2. Audio identities

- [x] 2.1 Add `sfx.lap()`, `sfx.wrongWay()`, `sfx.shield()`, `sfx.triple()` to `src/audio.ts` using existing `blip`/`noiseBurst` primitives; leave `sfx.pickup()` untouched for menu nav — verify `bun run typecheck` clean and menu-nav sounds unchanged (grep call sites: title arrows/toggles still call `pickup()`)

## 3. Countdown animation

- [x] 3.1 In `src/screens.ts`, replace the countdown text swap with the `replayAnimation` idiom: per-step pop-in/fade-out keyframes sized to `COUNTDOWN_STEP` (0.8s), `.go` accent class for "GO!" — add the keyframes in `src/style.css` with a mutual cross-reference comment on `COUNTDOWN_STEP` (`game.ts` L113) — verify in `bun run dev`: 3/2/1 pop and fade per step, GO! lands in an accent color, race still unlocks on schedule

## 4. HUD feedback layer (`src/hud.ts` + `src/style.css`)

- [x] 4.1 Add a per-panel vignette `<div>` (1P: child of `#hud`; 2P: one per `.hud-half`), plus `Hud.onHit(tank)` firing a one-shot `.flash` edge-glow animation and `Hud` low-HP handling (`Hud.setLowHp(tank, boolean)` or equivalent) toggling a persistent `.low` pulse — verify in `bun run dev`: getting hit flashes only the hit player's view in 2P; vignette appears at ≤30% HP and clears on respawn
- [x] 4.2 Add `Hud.onLap(tank, lapTime)`: flash the lap counter and pop the completed lap time near it (transient element or class, never written by the per-frame cache) — verify: completing lap 1 of 3 flashes the counter and shows the lap time pop
- [x] 4.3 Add `Hud.onPositionChange(tank, gained)` pulsing the POS readout with a brief ▲/▼ direction chip — verify: overtaking an AI pulses the readout once with the gained indicator
- [x] 4.4 Add `Hud.onPickup(tank, kind)` popping the power-up slot on arm/consume — verify: shield pickup pops the slot in the picking player's half only
- [x] 4.5 Add the wrong-way banner element per view with a flashing state toggled by `Hud.onWrongWay(tank, active)` — verify: reversing down a straight for ~1s shows the flashing banner; turning around clears it
- [x] 4.6 Reduced motion: add one `@media (prefers-reduced-motion: reduce)` block re-pointing all new animations to opacity-only fades — verify by emulating the preference in devtools: countdown/callouts/vignettes fade without scale or strobe

## 5. Scene VFX (`src/juice.ts`)

- [x] 5.1 Add `juice.skid(tank)`: flat dark quads with per-mark cloned material, y-offset + `renderOrder` above the road, FIFO cap 48 with `material.dispose()` on removal, cleared by existing `reset()` — verify in `bun run dev`: hard corners at speed leave fading marks on all four tracks (check Glacier ice-patch mesh for z-fighting), marks vanish on restart
- [x] 5.2 Add `juice.flame(tank)` reusing the wreck-burst fire geometry/material pair, spawned at the hull rear opposite heading — verify: holding a boost pad produces a flame stream; flames stop when the boost expires

## 6. Wiring in `src/game.ts`

- [x] 6.1 Instantiate the pure detectors per human tank in `simulate()` (armed only while `phase === "race"`), feeding progress t each frame; on arm fire `sfx.wrongWay()` once + `hud.onWrongWay(tank, true)`, on clear `hud.onWrongWay(tank, false)` — verify: `bun run dev` wrong-way flow end-to-end; AI laps/reversals never trigger it
- [x] 6.2 Call `hud.onPositionChange` from the per-frame standings comparison via the cooldown tracker — verify: rapid position swaps in a tight AI pack produce at most one callout per ~1.5s
- [x] 6.3 Call `hud.onLap(tank, lapTime)` + `sfx.lap()` from `handleProgressEvent` for human non-finish laps (keep FINAL LAP / FINISHED banners), and `hud.onHit(tank)` from the existing `onHit` weapons hook — verify: intermediate lap celebrates with chime; FINAL LAP banner still shows; hit flash coexists with camera shake
- [x] 6.4 Re-point the in-race `onPickup` hook to `sfx.shield()`/`sfx.triple()` by kind + `hud.onPickup(tank, kind)`; drive `juice.flame(tank)` rate-gated while `tank.boostTimer > 0` and `juice.skid(tank)` rate-gated while cornering/spinning (humans and AI) — verify: each pickup kind sounds distinct, flames appear for pads AND pickup boosts on AI tanks too

## 7. Verification & docs

- [x] 7.1 Full gate: `bun test` (51 existing + new race-events tests, 0 fail), `bun run typecheck`, `bun run build` all clean
- [x] 7.2 Manual 1P + 2P pass in `bun run dev` on at least Dust Bowl and Metro Rush: every new feedback element fires in the right half, no layout shifts in the classic 1P HUD, pause/resume leaks nothing (freeze happens mid-flash), framerate steady during sustained skids + boosts (`scripts/sim-ai.ts` still prints clean laps as a regression check)
- [x] 7.3 Update `README.md` with a short "Race feedback" note (what feedback exists; reduced-motion behavior) — verify: README renders coherently and mentions no removed/renamed controls
