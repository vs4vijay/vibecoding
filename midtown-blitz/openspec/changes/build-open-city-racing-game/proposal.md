# Proposal

## Why

The `midtown-blitz` repo was scaffolded for an open-city arcade racing game in the spirit of Midtown Madness — it already has a loading shell (`index.html`), a `three` dependency, and empty `src/engine` / `src/game` / `src/ui` directories — but contains no game. This change delivers the end-to-end playable game that scaffold was created for.

## What Changes

- Add a browser-based 3D open-city arcade racing game ("Midtown Blitz") built with Three.js and Vite.
- Add a game engine layer: render loop (fixed-timestep simulation + interpolated rendering), asset/progress loading, input abstraction, camera rig, and an audio manager.
- Add a procedurally generated city world: road grid, city blocks with buildings, sidewalks, props, landmarks, sky/lighting, and a collision world.
- Add player vehicle control: arcade car physics (accelerate, brake/reverse, handbrake slides), keyboard input, chase camera, and stuck/flip reset.
- Add ambient traffic: AI cars that follow the road network plus parked cars, with car-to-car and car-to-world collisions.
- Add game modes and flow: Blitz checkpoint races (timed, checkpoint markers, directional guidance, medals) and Cruise free-roam; main menu, pause, results screens, settings, and local persistence of best times/medals/settings.
- Add synthesized audio (engine, skid, collision, checkpoint, UI, music bed) with master volume/mute — no external asset downloads; everything is generated in code.
- Record assumptions (not user-confirmed): desktop-first controls (keyboard primary, gamepad optional stretch); touch controls, pedestrians, police pursuit, vehicle damage modeling, and Circuit/multiplayer modes are out of scope for this change.

## Capabilities

### New Capabilities

- `game-shell`: Application bootstrap and shell — render loop contract, loading screen with progress, scene/mode state machine (menu → racing → paused → results), settings (volume, quality), and localStorage persistence of settings and records.
- `city-world`: The open city environment — deterministic procedural generation of the road grid, blocks, buildings, sidewalks, props, and landmarks; sky, lighting, fog; and the collision world the simulation queries.
- `vehicle-control`: The player car — arcade driving physics, input mapping, chase camera behavior, world/car collision response, and reset/respawn.
- `traffic`: Ambient life — AI cars that navigate the road network believably (lane keeping, intersections, avoidance) and parked cars; collision with the player.
- `race-events`: Playable structure — Blitz checkpoint races (route, timer, checkpoint markers with guidance, early-exit on timeout, medals, results) and Cruise free roam; best-time/medal records feeding the shell's persistence.

### Modified Capabilities

(none — the project has no existing specs)

## Impact

- **Code**: fills `src/engine/`, `src/game/`, `src/ui/`, and `src/main.js` (referenced by `index.html` but currently missing); minor edits to `index.html` only if wiring requires; assets under `public/` if needed.
- **Dependencies**: none added — `three` (~0.171) and `vite` (~6) already present. All content is procedurally generated (geometry via Three.js primitives/extrusion, audio via WebAudio synthesis).
- **Systems**: purely client-side; no backend, network calls, or build config changes expected. Performance budget: 60 fps on a mid-range laptop at default quality.
