# Proposal

## Why

The game is mechanically complete but visually silent at the moments that matter: intermediate laps pass without a sound, position changes flicker by as plain text, getting hit shakes the camera but leaves no mark, and driving the wrong way is indistinguishable from driving the right way. The HUD reports state but never *celebrates* or *warns*, which is the gap between a playable racer and an exciting one. This change adds a race-feedback layer — DOM/HUD motion plus scene-space juice — while keeping the retro PS1 identity (Courier, flat colors): retro frame, modern motion.

## What Changes

- **Animated countdown** — 3 / 2 / 1 scale-pop in and out per step, GO! lands in an accent color with a punchier exit (today the text hard-swaps).
- **Lap-complete feedback** — the HUD lap counter flashes and the completed lap time pops on every lap, with a lap chime (today only the FINAL LAP banner exists; laps 1 and 2 are silent).
- **Position-change callout** — when a human's race position changes, the POS readout pulses and briefly shows ▲/▼ direction; per player in 2P.
- **Damage feedback** — a red vignette flashes at the screen edge on being hit, and a persistent pulsing vignette warns at low HP (≤30%); per half in 2P.
- **Wrong-way warning** — sustained backwards progress on the spline triggers a flashing "WRONG WAY!" banner until the driver turns around.
- **Skid marks** — pooled dark ground decals appear under hard turns / drifts and fade out.
- **Boost flames** — exhaust flame particles while a boost is active (pads and pickup boost).
- **Pickup feedback** — the HUD power-up slot pops in when armed, and each pickup kind gets a distinct sound identity (shield/triple vs boost) instead of one generic chime.

Out of scope: title-screen redesign, track dressing, shell trails (fading ghost trails already exist), game rules/physics changes, new game modes.

## Capabilities

### New Capabilities

- `race-feedback`: DOM/HUD feedback layer — countdown animation, lap/position/pickup HUD events, damage vignette, wrong-way warning; 1P and 2P parity.
- `race-vfx`: scene-space visual effects — skid-mark decals and boost-flame particles driven by tank state.

### Modified Capabilities

(none — the project has no main specs yet; this is the first captured change)

## Impact

- **`src/screens.ts`** — countdown element gains per-step animation classes; new wrong-way banner.
- **`src/hud.ts`** — per-panel lap flash, position pulse, pickup pop, vignette elements (1P root + compact 2P halves).
- **`src/style.css`** — all new keyframes/animations plus `.hud-half` compact variants; no layout rewrites.
- **`src/game.ts`** — event detection and wiring: lap events (exists), position deltas (standings already recomputed per frame), wrong-way detector (new pure helper), pickup hook (exists: `onPickup`), hit hook (exists: `onHit`).
- **`src/juice.ts`** — new `skid(tank)` and `boostFlame(tank)` spawners following the existing pooled-particle pattern.
- **`src/audio.ts`** — new/variant `sfx` entries (lap chime, wrong-way buzz, per-pickup sounds) using the existing `blip`/`noiseBurst` primitives.
- **Tests** — pure-logic additions (wrong-way detector, position-change detector) testable headless; existing 51 tests must stay green; `bun run build` stays clean.
