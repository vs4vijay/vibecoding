# NEON RUSH: Hyperdrome — Architecture Contract

All agents MUST follow these contracts exactly. Interfaces here are stable; builders extend
them via registration, never by editing other owners' files.

## Runtime model

- **No build step.** `index.html` + ES modules + import map:
  `"three": "./vendor/three/three.module.js"`, `"three/addons/": "./vendor/three/addons/"`.
- Serve via `python3 tools/server.py [port]` (defaults 3050 — N30N RU5H leet digits). Root = project dir.
- three.js r170, WebGL2. Tone mapping ACESFilmic, `renderer.outputColorSpace = SRGBColorSpace`.
- **Coordinate system**: player runs toward **−Z**, stays near origin. World objects spawn at far
  −Z and move toward +Z as `track.scroll` (meters) increases. Lanes at x = −2.6, 0, +2.6.
  Ground at y = 0. Camera default at (0, 4.4, 7.6) looking at (0, 1.6, −6), FOV 60→75 with speed.
- **Fixed timestep**: 60 Hz logic accumulator (`Time.js`), clamp dt ≤ 0.1 s; render every RAF.
  World scroll interpolation: render uses `scroll + speed * acc` fraction.

## File map (ownership enforced — see TASKS.md per wave)

```
index.html                 import map, canvas, DOM UI root, fonts, styles link
public/styles.css          ALL UI styling (AAA bar: see UI section)
public/fonts/              self-hosted woff2 (Orbitron 600/800, Rajdhani 500/600/700)
src/main.js                boot: renderer, scene, camera, composer, Game, UI, audio, debug API
src/core/Game.js           state machine BOOT→MENU→RUN⇄PAUSE→DEAD; run lifecycle; wire bus
src/core/Time.js           fixed-step accumulator, gameTime, warp()
src/core/EventBus.js       on/off/emit; singleton `bus`
src/core/Input.js          keyboard/touch/gamepad → actions {left,right,up,down,drift,pause,confirm}
                           120 ms input buffer; held(), pressed(), consume()
src/core/RNG.js            mulberry32; RNG(seed) → fn; helpers: range, pick, weighted, chance
src/core/Save.js           localStorage "neonrush.save.v1": best, coins, xp, level, unlocks[],
                           missions[], daily{date,score,streak}, settings{mute,quality,bloom},
                           stats{runs,totalM,totalCoins}
src/core/Pool.js           Pool(create,reset): get/release; pre-allocated, zero loop allocs
src/core/Palette.js        colors: cyan #00f0ff magenta #ff2bd6 gold #ffd24a red #ff3355
                           orange #ff7a1a deep #0b0518 grid #2a1a5e; readability rule encoded
src/core/Quality.js        tiers ULTRA/HIGH/MED/LOW: bloom, shadows, pixelRatio, particle
                           density, draw distance; auto-drop if fps<50 for 3 s
src/world/Track.js         12 recycled chunks × 60 m; scroll; spawn via Patterns; despawn/recycle
src/world/Chunk.js         group + lane slots + decoration hooks (props attach here)
src/world/Patterns.js      pattern library, tags easy/med/hard, guaranteed clear path,
                           no spawn within 1.2 s of phase boundary
src/world/Obstacles.js     pooled obstacle meshes: barrier(jump), beam(slide), train(block),
                           wall(lane-block) + variants
src/world/Props.js         buildings, pylons, arches, billboards — chunk dressing (W1-VIS)
src/world/Static.js        "The Static" chaser wall shader behind player (W1-VIS)
src/player/Player.js       kinematics: lane lerp, jump v0≈9.2 g≈24, slide 0.62 s, hitboxes
                           (forgiving: 0.72× visual), near-miss expanded pass, deaths
src/player/Character.js    procedural low-poly characters, 12+ skins, run/jump/slide/flap anim
src/player/Camera.js       smooth-follow + lead, shake (trauma decay), FOV kick, phase dollies
src/phases/Phase.js        base class + PhaseRegistry.register(id, Cls)
src/phases/RunPhase.js     default runner rules
src/phases/FlightPhase.js  hold-to-rise, fuel, flappy gates            (W1-PHASES)
src/phases/DriftPhase.js   curved track, hold-to-drift, multiplier      (W1-PHASES)
src/phases/HopperPhase.js  top-down grid traffic/river crossing         (W1-PHASES)
src/phases/StackPhase.js   timing gates, perfect-zone combo tower       (W1-PHASES)
src/phases/OrbPhase.js     orb field, magnet, merge chips, slow-mo      (W1-PHASES)
src/fx/Textures.js         procedural canvas textures (grid, noise, gradients, scanlines)
src/fx/Shaders.js          sky dome, grid floor, glitch/static, dissolve, warp tunnel
src/fx/PostFX.js           EffectComposer: bloom+vignette+grain+CA; quality tiers
src/fx/FX.js               pooled particle systems: speedLines, coinBurst, crash, trail,
                           phaseWarp, popups; API: FX.burst(name, pos, opts)
src/audio/Audio.js         WebAudio synth engine: music (BPM 124, combo layers), SFX bank,
                           unlock on first gesture, mute; API: Audio.sfx('coin'), Audio.music.setTier(n)
src/game/Scoring.js        score = dist×speedTier + coins×combo + style; combo tiers/decay
src/game/Director.js       dynamic difficulty, fever phases, fairness rules, speed ramp 12→40
src/game/Economy.js        coins, mystery boxes, roulette revive, shop catalog
src/game/Missions.js       3 active missions, auto-fill
src/game/Daily.js          date-seeded daily run
src/ui/UI.js               screen manager: show('menu'|'hud'|'death'|'shop'|'missions'|'pause')
src/ui/*.js                per-screen builders (DOM)
tools/server.py            static file server (no-cache headers)
tools/shot.mjs             Playwright screenshot harness (see Photo API)
tools/perf.mjs             headless FPS/draw-call/memory probe
```

## Global singletons

`main.js` creates and exposes on `window.__NR` (debug API — REQUIRED for QA tooling):

```js
__NR = {
  ready: Promise,             // resolves after first rendered frame
  game, scene, camera, renderer,
  warp(seconds),              // fast-forward logic at max speed (no render), then render 1 frame
  forceState(name),           // 'MENU'|'RUN'|'DEAD'|'PAUSE'
  forcePhase(id),             // jump track into phase id at its start
  teleport(meters),           // set track.scroll
  stats()                     // {fps, drawCalls, triangles, geometries, programs, pools}
}
```

`bus` events (emit/consume, never poll): `run:start run:end death coin coin:x{tier}
near-miss box:open combo:change{tier} phase:transition{from,to} phase:start{id}
speed:change{v} style:{type} ui:toast{msg,kind} mission:complete{id} revive:offer`

## Phase contract

```js
class MyPhase extends Phase {
  id = 'myphase'; title = 'MY ZONE'; duration = 45;      // seconds, before Director scaling
  enter(ctx) {}                // ctx: {track, player, camera, fx, rng, bus}
  update(dt, ctx) {}
  exit(ctx) {}
  decorate(chunk, rng) {}      // optional per-chunk dressing
  cameraHint = { fov: 68, height: 4.4, dist: 7.6 };
}
PhaseRegistry.register(MyPhase);
```

Phase transitions: 1.5 s cinematic (warp tunnel + title card) handled by Game + FX;
no obstacle spawns in the final 1.2 reaction-seconds of any phase.

## Performance rules (non-negotiable)

- ≤ 150 draw calls steady state (ULTRA), ≤ 90 (MED). `renderer.info.render.calls` in stats().
- Zero `new`/allocs inside update loops. All spawnables pre-allocated in pools; reuse geometries/materials.
- `InstancedMesh` for coins, particles, repeated props. Merged geometry per static chunk dressing.
- Fog-limited draw distance; `frustumCulled` on; pixelRatio clamp ≤ 2.
- No console.log in game code (use `import.meta.env`-free guard: `const DEBUG = location.search.includes('debug')`).

## UI bar (AAA)

DOM overlay, `public/styles.css`. Fonts: Orbitron (display/numbers) + Rajdhani (body).
Neon-on-dark glassmorphism: 1px luminous borders, soft glows, backdrop-blur panels, animated
gradients, scanline shimmer on titles. Menu/death/shop screens must look like a shipped
console game, not a demo. Death screen: giant RETRY button, "SO CLOSE — 98.4% of your record!",
ghost record bar. Everything instant (<16 ms) — no layout thrash, transform/opacity animations only.

## Photo API (used by tools/shot.mjs — keep in sync)

Query params parsed by main.js into `__NR` calls after boot:
`?photo=run|menu|death|flight|drift|hopper|stack|orb|shop&at=<game-seconds>&m=<meters>&seed=<n>&tier=<combo-tier>`
Harness flow: goto → await `__NR.ready` → `__NR.warp(at)` (or scenario) → wait 2 RAFs → screenshot.
`warp` must be fully deterministic for a given seed (all gen through seeded RNG).
