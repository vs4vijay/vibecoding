# ENDLESS — Project Bible (every agent: read fully before writing code)

**Game**: "ENDLESS" — a lightweight AAA-quality 3D endless PWA (Three.js) with three selectable
modes on one shared desert-highway apocalypse world:

- **RUN** — on-foot runner (Temple Run 2-like): 3 lanes, jump/slide/turns, obstacles.
- **DRIVE** — muscle-car highway survivor (Zombie Highway 2-like): steering, zombies latch onto
  the car, shoot them off, run hordes over, guardrails.
- **RIDE** — motorcycle combat (Road Rash-like): weave through traffic, melee + gun, don't dump the bike.

Shared fantasy: kill zombies with guns (upgradable) and by running them over; dodge obstacles;
go as far as possible; upgrade between runs.

---

## Hard rules (never violate)

1. **Git**: the workspace is ONE repo rooted at `/workspace`. Never `git init` here. Commits are
   made from this folder and apply to the shared repo. Don't touch sibling folders.
2. **No build step.** Vanilla ES modules + importmap. three.js **r172 vendored** in
   `vendor/three/` — `three.module.min.js` **plus `three.core.js`** (the slim wrapper imports it;
   missing it = dead page). Addons live under `vendor/three/addons/**` and import `"three"` via
   the importmap (`"three/addons/"` maps to `/vendor/three/addons/`).
3. **Zero console errors and zero warnings** in QA runs. No network at runtime (offline PWA):
   every asset procedural (canvas/shader-generated). No external fonts, no CDN, no analytics.
4. **Lightweight budgets** (QA reports must meet them): own JS under `js/` ≤ 150 KB raw total;
   ≤ 220 draw calls; ≤ 500k triangles on screen; procedural textures ≤ 1024² (512 default,
   shared MaterialLibrary); target 60 fps on a mid-tier mobile GPU; must stay ≥ 18 fps under
   SwiftShader capture at 1600×900.
5. **Simulation**: fixed timestep 60 Hz (`1/60`, dt clamp 0.1 s) + render interpolation;
   `visibilitychange` pauses. All gameplay numbers live in `js/core/config.js` — no magic
   numbers scattered in gameplay code.
6. **Persistence**: `localStorage` keys namespaced `endless.*` (best distances, currency,
   upgrades, settings). Save is versioned (`endless.save.v1`).
7. Determinism: gameplay randomness via seeded `mulberry32` (`js/core/rng.js`); per-chunk streams
   derived from `hashSeed(chunkIndex, runSeed)` so `?seed=` reproduces a run.

## Architecture (keep it; extend it; never fork it)

```
index.html            shell + importmap + DOM UI overlay roots
styles.css            all UI styling (no webfonts)
js/main.js            boot(), state machine LOADING→MENU→MODE_SELECT→PLAYING→GAMEOVER
js/core/config.js     every tunable + QUALITY_PRESETS {low,medium,high,ultra} + tier autodetect (?quality= override)
js/core/rng.js        mulberry32 + hashSeed
js/core/assets.js     TextureFactory (canvas PBR sets: albedo/normal-Sobel/rough/AO) + MaterialLibrary singleton
js/core/renderer.js   WebGLRenderer (ACES, PCFSoft) + PostPipeline (order below) + PerfMonitor → window.__PERF
js/core/sky.js        sky dome/scatter + sun light rig + fog color sampled from sky horizon + PMREM env
js/core/input.js      keyboard (WASD/arrows/Space/Esc) + touch (swipes + tap zones) + pointer aim (DRIVE)
js/core/audio.js      procedural WebAudio (lazy ctx on first gesture); engine loops, gunshots, impacts
js/core/save.js       versioned localStorage save/load
js/world/world.js     40 m chunk streaming: registerChunkType(), setPlan(), update(dt, playerZ); window.__WORLD
js/world/*            chunk builders: road, desert floor, mesas, wrecks, guardrails, city glow, props
js/entities/*         zombie factory (InstancedMesh + per-instance anim via shader or CPU pool),
                      vehicles (car/bike), projectiles, pickups, particles (pooled points/quads)
js/modes/run.js       Temple-Run-like mode
js/modes/drive.js     Zombie-Highway-like mode
js/modes/ride.js      Road-Rash-like mode
js/ui/*               menu, mode-select, HUD, gameover, shop (DOM overlay; no canvas UI)
qa/hooks.js           QA param driver + window.__QA (see contract)
```

- Modes implement `Mode` interface: `enter(ctx)`, `exit()`, `fixedUpdate(dt)`, `update(dt, alpha)`,
  `cameraRig()`, `hudLayout()`, `stagedScenarios()` (for QA). Shared systems (zombies, guns,
  particles, pickups, score) must be reusable across modes — zombies run at/beside the player in
  all three modes.
- Entities are pooled. Nothing allocates per frame in the hot path (no `new Vector3` in loops —
  reuse scratch vectors).

## Art direction bible (v1 — the bar every slice is judged against)

- **Setting**: Southwest-US interstate at dusk sliding into night. A burning metropolis glows on
  the horizon. Abandoned evacuation convoys, dead streetlights, dust devils, buzzards. Tone:
  quiet apocalypse road-movie, not cartoon.
- **Palette**: burnt-orange key light (~3200 K, low sun), deep teal-blue sky, asphalt greys with
  worn center-lane polish, zombie skin sickly olive/grey, blood dark crimson (restrained), amber
  emissive accents (taillights, sodium lamps, muzzle flash, city fire).
- **Lighting**: one directional key sun raking diagonally across the road (texel-snapped
  shadow follow, PCFSoft), cool hemisphere/sky fill, emissive accents. Night mode (?time=night):
  headlight cones, moonlight fill, deeper fog.
- **Grade/post** (SwiftShader-proven order — do NOT reorder): RenderPass → UnrealBloom
  (strength ~0.55–0.85, threshold ~0.6) → [SMAA only on low pixelRatio tiers] → OutputPass →
  **custom grade Pass last** (filmic S-curve, saturation 1.05–1.08, teal-shadow/warm-highlight
  split-tone, vignette 0.3–0.4, edge-only chromatic aberration, film grain ≤ 0.04).
- **Materials**: shared MeshStandardMaterial library; procedural canvas PBR sets; asphalt shows
  wear polish + tar snakes; everything dust-covered; rust on wrecks; rim light on characters.
- **Characters/vehicles**: stylized-realistic (not toy, not creepy-museum). Zombies 2–4k tris,
  instanced, silhouette-readable per type; emissive eyes. Car/bike: believable proportions,
  chrome/emissive details, wheel rotation + suspension lean.
- **UI**: charcoal + amber (#ffb24d), condensed uppercase system font stack, hairline rules,
  giant numerals, minimal HUD. Menu must feel like a AAA title screen: world visible behind,
  animated dust/light, title with restraint (no gradients-rainbow, no drop-shadow cheese).

## QA contract (every slice must keep this passing)

- **URL params**: `?qa=1` mandatory for captures; `&seed=N`; `&time=S` (seconds into run, or
  `dusk|night`); `&freeze=1` (stop motion after staging, still render); `&mode=run|drive|ride`;
  `&scene=menu|mode_select|game|gameover|shop`; `&staged=NAME` (per-mode staged action setups —
  see mode's `stagedScenarios()`; e.g. drive: `latched3`, `horde`; ride: `traffic`, `melee`;
  run: `gauntlet`); `&cam=close|side|front|beauty` (QA camera overrides).
- **window.__QA** = `{ screenshotReady: true /* only after ≥5 warm frames AND staged scene
  settled */, mode, scene, seed }`. **window.__PERF** = `{ fps, tier, drawCalls, tris }`.
  **window.__WORLD** = `{ chunks, drawCalls }`.
- Capture: `bun .qa/shot.mjs "<url>" out.png [--wait 5000] [--width 1600] [--height 900]`
  → saves PNG + prints JSON report (console errors must be `[]`).
- Serve: `node serve.mjs` (port 8123). Service worker must NOT intercept when `?qa=1` is present.

## Definition of done (per slice)

Playable end-to-end · zero console errors/warnings · budgets met (report __PERF numbers) ·
QA scenarios capture correctly at 1600×900 · passes the harsh visual critic's blind A/B vs
official reference screenshots · code committed with a descriptive message.

## Sub-agent working rules

- Do not start messages to the user; produce a final report: files changed, tunables added,
  QA params/staged scenarios implemented, perf numbers, known limitations.
- Match existing code style. Comments only for non-obvious constraints.
- If a dependency on a later slice is needed, stub it behind a config flag, don't half-build it.

## Deployment (vibecoding monorepo)

- Lives at `devils-highway/` in the vibecoding monorepo; Pages URL:
  `https://vs4vijay.github.io/vibecoding/devils-highway/`.
- It is the monorepo's **no-build exception** (adopted game; vendored-three
  importmap architecture). `.github/workflows/games-pages-deploy.yml` does NOT
  build it — the "Stage site" step copies the public surface verbatim
  (index.html, styles.css, sw.js, manifest.webmanifest, serve.mjs, js/, vendor/,
  icons/) like games-hub. Never add a Vite/bun build step for it.
- Everything user-served must stay relative (`./js/...`, `./vendor/...`,
  `./sw.js`) — the game mounts under a subpath, not a bare root.
- The internal codename `endless` is INTENTIONAL and stays: localStorage keys
  `endless.*`, save version, JS identifiers, QA hooks. Do not rename them.
  The SW cache name is `devils-highway-v1` because caches are origin-global
  across the shared Pages site.
