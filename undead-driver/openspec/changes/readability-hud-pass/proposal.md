# Proposal — Readability & HUD Pass

## Why

Threats are effectively invisible at the moment they matter. Reviewing the recorded session (`zh-gameplay.webm`, ~9 min, 3 runs): **all three runs ended in HEAD-ON COLLISION** against obstacles whose materials (`0x4a3a30` wrecks on `0x1c1c20` asphalt) sit below the contrast floor under the dusk lighting; the player car's rear faces an unlit camera and carries no tail lights, and zombies in `0x6b7d4f` green are nearly indistinguishable from the road. Separately, the game's core tension mechanic — weight build-up and the flip save-window — is displayed in the HUD's least legible element (an 84×44 px dim box), kills produce no on-screen score feedback, and the level-up/death screens undersell their moments. Deaths read as random rather than fair.

## What Changes

- **Obstacle readability** — brighter wreck/barrier materials, hazard chevrons on barriers, emissive brake lights on wrecks, and a proximity ground ring that fades in as an obstacle approaches the car.
- **Car readability** — red emissive tail lights, lifted body tone, and lighting so the rear (the side the chase camera sees) reads clearly.
- **Zombie readability** — brighter palette per type and an unmissable leap telegraph (red ground flash accompanying the existing crouch squash).
- **Global exposure lift** — hemisphere light, road albedo, and fog color tuned so every threat is readable at ~80 m without losing the dusk mood. All values as `config.ts` tunables.
- **Tilt gauge v2** — larger gauge with a green→amber→red ramp and per-side weight pips (capacity units occupied on each flank), plus a screen-edge glow on the heavier side.
- **Feedback moments** — floating score popups at kill positions (with streak multiplier), level-up banner with unlock subtitle ("RUNNERS UNLOCKED"), and a redesigned game-over card with larger type and tap-anywhere-to-retry.
- Plumbing: `HudState` gains per-side weights; `GameEvents.kill` gains the victim's world position for popup placement.

Out of scope (deferred): time-of-day arc, speed streaks/hit-stop, title-screen idle drive, menus' runs/best-distance display (discussed as Threads 3–4 in exploration).

## Capabilities

### New Capabilities

- `render/readability`: visual clarity requirements for obstacles, the player car, zombies, leap telegraphs, and overall scene exposure.
- `ui/hud`: in-run HUD legibility requirements — tilt gauge with weight pips, side-edge danger glow, kill score popups, level-up banner, and the game-over card.

### Modified Capabilities

(none — the project has no existing specs; `openspec/specs/` is empty)

## Impact

- `src/render/`: `obstacleMesh.ts`, `carMesh.ts`, `zombieMesh.ts`, `scene.ts` (lighting/fog), new small instanced ring/flash helpers. Draw budget must stay ≤120 calls (currently ~91; additions are 2–3 instanced draws).
- `src/ui/hud.ts`, `src/style.css`: gauge rebuild, weight pips, edge glow, popups layer, death card.
- `src/main.ts`: popup projection wiring; `src/game/session.ts`: `kill` event payload; `src/config.ts`: new tunables section.
- `HudState` consumers (tests/fixtures) updated for the two new fields; `GameEvents.kill` extra args are backward-compatible (existing handlers take fewer params).
- Verification per AGENTS.md: vitest for any touched logic, live headless-Chromium pass with pixel/DOM evidence for visuals, full suite + typecheck green.
