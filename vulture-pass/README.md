# Vulture Pass

An original, browser-based homage to top-down car-combat trading games — drive
the Cholla Basin, buy low, sell high, fight the Carrion Boys, and take down
the Buzzard. Built with Vite + three.js + vanilla ESM JavaScript.

![genre](https://img.shields.io/badge/genre-car%20combat%20%2F%20trading-b3541e)

## The loop

1. **Trade** — buy goods where they're cheap (each town prices goods
   differently, with daily seeded drift), haul them where they're dear.
2. **Travel** — pick a destination on the sepia overworld map. Every trip
   burns days, and richer cargo draws hungrier ambushes.
3. **Fight** — bandits ambush you on the road. Your car mounts two guns:
   aim **left** of the hood to fire the left gun, **right** for the right.
   Ammo is unlimited; hull damage is the real cost.
4. **Upgrade** — wins grant XP; levels grant points for three tracks
   (reload speed, post-victory field repair, map sight).
5. **Spend** — towns have a market, a job board (deliveries + bounties), a
   gun shop, and a garage (cars, repairs, insurance).
6. **Finish it** — when you're ready, ride on the Buzzard's Roost and end
   the toll gang's reign. After that, the Basin is an endless sandbox.

Death costs all cargo + 25% of your money — unless you bought insurance,
which waives the money hit once. The game autosaves on battle outcomes and
town entries, and you can save & quit from the map.

## Controls

| input | action |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` | brake / reverse |
| `A` `D` / `←` `→` | steer |
| mouse | aim (the gun on the aim's side of the car fires) |
| left click (hold) | fire |
| `E` / `Enter` | enter hotspot / leave town |
| `Space` | advance cutscene panels |
| `` ` `` | debug overlay |

## Dev commands

```bash
npm install
npm run dev       # vite dev server
npm run build     # production build to dist/
npm run preview   # serve the build
npm run qa        # smoke test: build + headless run (new game → combat → town → save)
```

### Verification harnesses

- `node qa/units/*.mjs` — pure-module checks (fixed-timestep loop, driving
  model, mount-side geometry, ambush scaling)
- `node qa/check-dev.mjs` — dev server boots with no console errors
- `node qa/check-engine.mjs` — loop rate / input / camera / audio gating
- `node qa/check-feel.mjs` — driving feel, dual-mount firing, HUD states
- `node qa/check-combat.mjs` — enemy archetypes, weapon behaviors, splash
- `node qa/check-flow.mjs` — map/travel/ambush/victory/defeat/insurance flow
- `node qa/check-eco.mjs` — sight gating, all four shops, upgrade tracks
- `node qa/check-boss.mjs` — cutscenes, versus intro, boss fight, unlock
- `node qa/check-save.mjs` — save triggers, resume, corrupt-save defense
- `node qa/playthrough.mjs` — scripted end-to-end run of the whole game loop

Browser checks use `playwright-core` with a local Chromium
(`qa/lib/browser.mjs` → `CHROME_PATH`); adjust the path if your Chromium
lives elsewhere.

## Project layout

```
src/
  engine/       loop (fixed-timestep sim), input, camera, audio, save
  game/
    data/       palette + all content/tuning (code-free balancing)
    combat/     arena, driving model, AI, meshes, fx
    weapons/    dual-mount firing resolution
    town/       town scene with hotspots
    state.js    GameState + intent-based mutations
    travel.js   trips, day counter, ambush rolls
    jobs.js     job board logic
    waves.js    ambush scaling + wave composition
  ui/           DOM overlays: HUD, map, shops, cutscenes, title, debug
qa/             verification harnesses
```

## Original IP notice

All names, characters, places, story text, art (programmatic three.js
primitives + SVG), and audio (synthesized WebAudio) are original to this
project. It is inspired by the *genre* of late-90s/2000s top-down
car-combat trading games, not by any specific game's content.
