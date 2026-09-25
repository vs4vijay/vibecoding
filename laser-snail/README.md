# Laser Snail

**Play online:** <https://vs4vijay.github.io/vibecoding/laser-snail/>

An original auto-forward 3D space-highway racer (born as a web homage to
*Snail Mail*, 2004): you are **Turbo**, a snail with a jetpack and a postal
cannon, hurtling down a neon highway in space. Steering is the whole game —
you auto-forward at the level's cruise speed while dodging slugs and
asteroids, jumping chasms off launch strips, collecting mail packages, and
upgrading the cannon through a seven-rung weapon ladder across a 10-level
campaign. Everything (art, audio) is synthesized in code: Three.js primitives
+ emissive materials feed a bloom pass, and every sound effect is a WebAudio
oscillator — there are zero assets.

Built with Vite 6 + TypeScript (strict) + three.js. Fixed-timestep simulation
(60 Hz) decoupled from rendering, so it plays identically on any refresh rate.

## Controls

| Action | Keys | Notes |
|---|---|---|
| Steer left / right | `←` `→` or `A` `D` | Both families work together; hold both directions = centered |
| Fire cannon (hold) | `Z` or `Space` | Autofires on the weapon's cooldown while held |
| Confirm (menu / retry / next) | `Enter` or click | Clicks also select level-select rows directly |
| Pause / back out | `Esc` | Playing → paused; paused/results/gameover → menu |
| Menu navigation | `↑` `↓` (or `W`/`S`, `←`/`→`) | Level-select cursor; any arrow on the title opens the list |
| Back (level select → menu) | `Backspace` | |
| Mute toggle | `M` | Persisted in the save; silences every voice |
| Auto-pause | — | Losing window focus (or hiding the tab) mid-race pauses instantly; held keys are dropped so Turbo never steers while you're gone |

There is no remap UI (out of scope) — the table above is the full key map.

## Running it

```sh
bun install          # deps (bun as the runner; npm/pnpm work too)
bun run dev          # dev server → http://localhost:5411
bun run test         # all vitest suites (headless, node environment)
bun run typecheck    # tsc --noEmit
bun run build        # production build (typecheck + vite) → dist/
bun run preview      # serve dist/ locally
```

The Vite build uses a relative `base: "./"`, so `dist/` deploys under any
subpath — it ships at `/vibecoding/laser-snail/` on the shared GitHub Pages
site (see [docs/GAMES.md](../docs/GAMES.md)).

## Design summary

**Track coordinates `(s, x)`** — the game's universal space. `s` is arc length
along the highway curve (0..length), `x` is lateral offset from the center
line. The track is a `THREE.CatmullRomCurve3` (centripetal) through each
level's `controlPoints`; `TrackCurve` is the only place that converts to/from
world space. All gameplay — spawning, collision, projectiles, the gap fall
check — runs in pure `(s, x)` with O(window) sliding-window scans (entities
are kept sorted by `s`), so cost is independent of level length.

**Fixed timestep** — `Loop` runs the simulation at 60 Hz with an accumulator,
clamped (`maxFrameTime`, `maxSteps`) so a stall can't spiral. Rendering runs
at display rate and interpolates the player between the last two sim steps
(alpha from the accumulator), so 120 Hz+ displays stay smooth.

**Pooling / streaming** — nothing allocates in steady state:
- `Spawner` builds the full entity pool once per level load (records + visuals
  sorted by `s`) and activates only an s-window ahead of the player (250 units
  default), recycling behind. Frame time is flat from L1 to L10.
- `ProjectileSystem` preallocates 48 slots (each a group with one mesh per
  weapon kind); firing reuses dead slots.
- `ParticleSystem` is one fixed 320-particle buffer on a single `THREE.Points`
  draw call; bursts claim dead slots, update compacts the draw range.
- `SpeedTrail` ring-buffers its ribbon samples. Geometry/materials for shared
  visuals are module-level singletons; reused scratch vectors everywhere.

**Render pipeline** — every brightness constant lives in one pure-data module,
`src/render/tuning.ts`: bloom (threshold/strength/radius), tone-mapping
exposure, light intensities, and a per-element HDR accent budget. Two-tier
bloom discipline: compact accents (rings, ribbons, pods, lip strips) stay
overdriven and glow; extended accents (the edge rails) stay below threshold in
luminance — the UnrealBloom mip chain floods the frame from any large-area
source, so rails read as solid self-luminous neon instead. A vitest guard
(`tests/RenderConstants.test.ts`) pins the whole envelope and fails with the
violated bound's name if the white-out's mechanism is reintroduced.

**Weapon ladder** (data-driven tiers in `systems/Weapons.ts`), one `whiteRing`
per rung: Single → Double → Triple → Laser (pierces 3) → Homing Rocket → Fast
Rocket → Invincible (slugs pass through harmlessly). A `yellowRing` is a smart
bomb that detonates every destructible enemy within 150 s-units ahead. A
`redRing` is the trap: −60% speed for 3 s (asteroid contact: −40% for 2 s) —
cruel when placed before a gap.

**Level format** — one JSON per level in `levels/`, loaded at build time via
`import.meta.glob` and validated against the feature registry (unknown type =
hard load error). Fields: `id`, `name`, `length` (declared arc length; the
built curve must match within 2%), `cruiseSpeed`, `controlPoints` (`[x,y,z]`
triples), `features` (`{ type, at, params }`). Feature types: `package`,
`packageArc` (a lane-sweeping chain — the racing line made of pickups), `slug`
(contact = game over), `asteroid` (lane-blocking, destructible, 1 damage),
`heart` (+1 pip), `whiteRing` / `yellowRing` / `redRing`, `jumpPod`, and `gap`
(road hole; `jumpPod: true` expands into the launch strip at its leading
edge). Level-design invariant, checked by test: **every gap is survivable at
cruise** — cleared by its pod arc, steering, or the cannon.

**Scoring & medals** — packages ×100, destruction bonus (asteroid 150, slug
100), finish bonus 1,000 × level id, health bonus 250/pip. The medal rule
(`systems/Medal.ts`) scores 0–100: packages up to 45 pts, postal meter 10/pip
(up to 30), time up to 25 pts (full at par, linear decay to 0 at 2× par, where
par = length/cruise × 1.1). Gold ≥ 90, Silver ≥ 75, Bronze ≥ 60.

**Save** — `localStorage` key `laser-snail-save-v1`:
`{ unlockedLevel, bestTimes, bestScores, muted }`. Finishing level N unlocks
N+1. Strict per-field validation; any corrupt/malformed payload silently
resets to defaults (a broken save never blocks boot). Storage is injectable;
environments without `localStorage` fall back to memory-only.

**Difficulty curve** — L1–2 steering + packages + slugs; L3–4 asteroids +
shooting; L5–6 gaps + jump pods; L7–8 red-ring traps + combinations; L9–10
gauntlet (everything, tighter timing, higher cruise speeds).

## Levels

| # | Name | Cruise speed | Length |
|---|---|---|---|
| 1 | Mail Run | 30 | 2,300 |
| 2 | Slug Alley | 35 | 2,971 |
| 3 | Crater Run | 38 | 2,934 |
| 4 | Belt Run | 42 | 3,385 |
| 5 | Chasm Run | 40 | 2,975 |
| 6 | Rift and Ruin | 45 | 3,489 |
| 7 | Trap Weave | 47 | 3,506 |
| 8 | Blind Crests | 50 | 3,776 |
| 9 | Gauntlet Gate | 54 | 3,887 |
| 10 | Postal Apex | 58 | 4,092 |

## Color / shape language

Consistent everywhere: **cyan = good** (packages, jump-pod strips), **magenta
= bad** (slugs, asteroids' hazard rim), **pink/red = health or danger**.

Color-blind players can also rely on **silhouette cues**, added per Phase 6:

| Element | Color | Shape cue |
|---|---|---|
| White ring (weapon ladder up) | white | smooth single rim |
| Yellow ring (smart bomb) | yellow | **dashed outer outline** (radial tick dashes around the rim) |
| Red ring (trap, −60%) | red | **double rim** (inner + outer torus), smaller and lane-placed so it is dodgeable, heartbeat pulse |
| Jump pod (launch strip) | cyan | flat glowing strip with three bobbing up-chevrons |
| Package | cyan | box with an overdriven ribbon cross |
| Heart | pink | extruded heart with a flat glow halo |

All three ring voices also have distinct *audio* contours: white rises, yellow
detonates, red falls.

## Repository layout

```
src/
  main.ts              bootstrap: renderer/composer, flow wiring, the fixed-step loop
  core/                Loop (fixed timestep), GameState (FSM), Input, Save
  render/              tuning.ts — the pinned bloom/light/HDR envelope (pure data)
  track/               TrackCurve (s,x <-> world), TrackMesh, TrackGaps, LevelLoader
  systems/             Spawner, Collision, Weapons, Projectiles, Particles,
                       SpeedMods, Score, Health, Medal
  player/              Snail (mesh), Controller (sim authority), ChaseCamera, SpeedTrail
  entities/            Entity records, SpawnRegistry, visual factories
  audio/Sfx.ts         WebAudio synth voices (no assets)
  ui/                  HUD (in-race), Screens (menus), LevelSelectModel
levels/                levels 1–10 JSON
tests/                 23 vitest suites, fully headless (node environment)
```

## Verified here vs. needs human eyes

**Verified in this environment** (headless CI, bun/node on Linux):

- `bun run typecheck`, `bun run test` (272 tests across 23 suites, including
  the render-constants guard), and `bun run build` all clean; `bun run
  preview` serves `/` and the bundle with 200s at devicePixelRatio 1 and 2.
- Readability: the in-race view was screenshot-verified on real GPU at fixed
  waypoints (L1 start + cruise, an L5/6 gap approach, an L9/10 dense cluster,
  plus a full fresh-save run: boot → race → game over → retry → pause → level
  select) against the render-pipeline checklist — matte road, every element
  silhouetting, gap reads as a drop, HUD legible, no banding/flicker.
- Sim performance, headlessly: stepping the exact main.ts playing-branch
  through all of level 10 with held fire and live particles averages
  ~0.05 ms per fixed step (budget asserted: < 2 ms; worst observed 1.7 ms).
  Entity-window budget asserted ≤ 60 active entities on every level
  (L10 peaks at 9); projectile and particle pools asserted bounded.
- Campaign path L1→L10 on a fresh save, both death paths (slug knock-off,
  gap fall) with retries, save-corruption recovery across eight hostile
  payloads, and mute persistence — all covered by `tests/Ship.test.ts`.
- Code-level cross-browser audit: `AudioContext` with `webkitAudioContext`
  fallback (Sfx.ts); no OffscreenCanvas, no Chrome-only APIs, no `navigator`
  dependencies; `import.meta.glob` is Vite-handled at build time; keyboard
  input uses `KeyboardEvent.code`; index.html carries the viewport meta and a
  system-ui font stack; CSS uses widely-supported `clamp()`/`inset`.

**Needs a human visual/interactive check on real browsers** (Chrome, Firefox,
Safari):

- Feel: bloom strength/exposure, HUD legibility at small window sizes, and
  the resize/zoom/monitor-switch path (pixel ratio re-clamps on `resize`).
- Audio unlocked on first gesture in each browser, and the muted flag
  silencing everything.
- Auto-pause on tab switch (`visibilitychange` + window `blur`) — implemented
  and unit-level sanity-checked, but blur timing quirks are platform-specific.
