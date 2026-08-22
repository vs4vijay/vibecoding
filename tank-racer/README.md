# TANK RACER

A 3D tank racing game for the browser — a homage to *Tank Racer* (1997). Race
three AI tanks over three laps of a closed desert circuit: blast rivals with
your cannon, dodge incoming shells, grab power-up crates, and hit the boost
pads on the straights. Low-poly PS1-era look, pure client-side TypeScript +
Three.js, no assets (all audio is synthesized with WebAudio oscillators).

![screenshot placeholder — run `bun run dev` and take one!](public/screenshot-placeholder.png)

## Controls

| Key            | Action              |
| -------------- | ------------------- |
| `W` / `↑`      | Accelerate          |
| `S` / `↓`      | Brake / reverse     |
| `A` `D` / `←` `→` | Steer            |
| `Space`        | Fire shell          |
| `Enter`        | Start race (title)  |
| `R`            | Restart (results; also while paused) |
| `P` / `Esc`    | Pause / resume (race) |
| `M`            | Mute / unmute       |

## Pause

Press `P` or `Esc` during a race to freeze the entire simulation — physics,
timers, lap logic, AI, shells and power-up respawn clocks all stop, and all
audio suspends. The same key resumes exactly where you left off; `R` while
paused restarts the race.

## Touch controls

On touch devices (detected via `pointer: coarse` or the first touch), overlay
buttons appear during the countdown and race:

- **Auto-throttle** is always on — no accelerate button needed
- **◀ ▶** buttons (lower-left) steer; multi-touch safe, so you can steer and fire together
- **FIRE** button (lower-right) shoots one shell per press

Title/results screens are tappable (tap = Enter/R equivalent). Desktop keyboard
flow is completely unchanged.

Boost pads on the track give an automatic speed burst. Power-up crates grant a
random pickup: Speed Boost (auto), Shield (absorbs one hit), or Triple-Shot
(next 3 trigger pulls fire a spread).

## Run it

Requires [bun](https://bun.sh).

```sh
bun install     # install dependencies
bun run dev     # dev server with HMR
bun run build   # typecheck + production build into dist/
```

## Project layout

- `src/game.ts` — state machine (`title → countdown → race → results`),
  orchestration, chase/title cameras, camera juice
- `src/track.ts` — spline-defined circuit, road/walls mesh, boost pads, lap
  + checkpoint logic
- `src/spline.ts` — pure Catmull-Rom closed-loop math (point/tangent/closest)
- `src/tank.ts` — tank mesh factory + shared arcade driving physics
- `src/player.ts` — keyboard → tank input mapping
- `src/ai.ts` — spline-following driver brains with rubber-banding and firing
- `src/weapons.ts` — shells, hits, spin-outs, wrecks + respawns
- `src/powerups.ts` — crates, pickups, shield bubbles
- `src/hud.ts` — DOM HUD (speed, health, power-up slot, lap/pos/time, minimap)
- `src/screens.ts` — title / countdown / banner / results overlays
- `src/audio.ts` — WebAudio oscillator SFX + engine hum (created on first key
  press to satisfy autoplay policies), plus a procedural music loop and
  pause/resume via AudioContext suspension
- `src/juice.ts` — cheap particle juice: drift dust, impact sparks, wreck bursts

## scripts/sim-ai.ts

A headless sanity harness for the AI (no rendering): runs the three driver
brains against real tank physics on the real circuit and prints finish times,
per-lap splits, and wall-contact stats.

```sh
bun scripts/sim-ai.ts
```
