# Snail Mail Web — Design Spec

Date: 2026-08-22
Status: Approved (brainstorming complete)
Path: Architectural (new project)

## 1. Overview

A web remake of *Snail Mail* (Alpha72 Games / Sandlot Games, 2004): an auto-forward
3D space-highway racer. The player steers Turbo, a jetpack-snail with a shell cannon,
down neon tracks to deliver Intergalactic Mail while dodging hazards and collecting
packages.

This is a **vertical slice**: one polished mode (~8–10 handcrafted levels), core
element roster only. Prove the loop; expand later.

### Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Scope | Vertical slice first (~8–10 levels, one mode) |
| Rendering | Three.js 3D, chase camera |
| Platform | Desktop-first (keyboard); touch later |
| Art | Code-built neon look — primitives + emissive materials, no external assets |
| Stack | Vite + TypeScript + Three.js, vanilla modules, bun as runner |

## 2. Original Feature Map (reference)

From the 2004 game ([Wikipedia](https://en.wikipedia.org/wiki/Snail_Mail_(video_game)),
[RealArcadeapedia](https://realarcadeapedia.fandom.com/wiki/Snail_Mail)):

- **Modes:** Postal (career, 50 levels), Time Trial, Challenge (endless score attack).
- **Core loop:** pseudo-3D highway racer; steer across the track, dodge hazards,
  collect mail packages for score.
- **Elements:** slugs, turrets, asteroids, salt, hearts, white/yellow/red rings,
  jump pods, jetpack flight sections.
- **Weapon ladder:** double shot → triple → laser → dual lasers → rocket → fast rocket
  → invincibility.
- **Meta:** package-count scoring, level unlock chain, best times.

Vertical slice keeps: Postal-style career on ~8–10 levels, packages, slugs, asteroids,
hearts, white/yellow/red rings, jump pods, full weapon ladder. Phase 2 candidates:
Time Trial + Challenge modes, turrets, salt, jetpack flight sections, touch controls,
multiplayer colors.

## 3. Game Core

### 3.1 Track model

- Each level's highway is a `THREE.CatmullRomCurve3` through control points from level JSON.
- Everything lives in **track coordinates**: `s` = distance along curve (0..length),
  `x` = lateral offset. World meshes are generated from the curve; all collision runs in
  `(s, x)` space — O(window) checks, no world-space math per frame.
- Ribbon road: flat cross-section swept along the curve; emissive edge rails;
  starfield points backdrop; fog for depth. `gap` features remove ribbon segments and
  place a chasm.

### 3.2 Speed & controls

- Auto-forward at the level's cruise speed. No manual throttle — steering is the game.
- Speed modifiers: asteroid hit −40% speed for 2 s; red ring −60% for 3 s —
  brutal right before a gap.

### 3.3 Camera

Chase camera lerp-following behind Turbo, banking slightly with steering input.

## 4. Elements

Health ("postal meter"): 3 pips. Depleted → game over. Falling into a gap → game over.

| Element | Behavior | In slice |
|---|---|---|
| Package | +100 pts; placed in chains/arcs that suggest the racing line | yes |
| Slug | Contact knocks Turbo off (fail); passable while invincible | yes |
| Asteroid | Blocks lane; slow + 1 damage; destructible by cannon | yes |
| Heart | Restores 1 pip (cap 3) | yes |
| White ring | Weapon ladder up: single → double → triple → laser → homing rocket → fast rocket → invincibility. Turbo starts at single; original started at double — intentional simplification | yes |
| Yellow ring | Smart bomb: destroys all enemies ahead within window | yes |
| Red ring | Trap: heavy speed cut — cruel when placed before gaps | yes |
| Jump pod | Trampoline over gap segments | yes |
| Turret | Blocks road, fires green lasers | phase 2 |
| Salt | Unshootable damage zone; pushes toward "going postal" | phase 2 |
| Jetpack section | Free-flight over unfinished track | phase 2 |

Weapon ladder is data-driven (tiers array in `Weapons.ts`).

## 5. Level Format & Progression

JSON per level under `levels/*.json`:

```jsonc
{
  "id": 3,
  "name": "Crater Run",
  "length": 2400,
  "cruiseSpeed": 42,
  "controlPoints": [[0,0,0], [40,5,-60]],
  "features": [
    { "type": "packageArc", "at": 200, "lane": -1, "count": 5 },
    { "type": "slug", "at": 340, "lane": 0 },
    { "type": "gap", "at": 800, "width": 60, "jumpPod": true }
  ]
}
```

- Loader validates features against a spawn registry; unknown type = load error.
- 8–10 handcrafted levels escalate: L1–2 steering + packages + slugs; L3–4 asteroids +
  shooting; L5–6 gaps + jump pods; L7–8 red-ring traps + combinations; L9–10 gauntlet.
- Sequential unlock: finishing level N unlocks N+1.
- Score = packages × 100 + finish bonus (1,000 × level id) + health bonus
  (250 per remaining pip). Per-level best time + best score tracked.
- Save (`localStorage`, key `snail-mail-save-v1`): `{ unlockedLevel, bestTimes, bestScores, muted }`.
  Single `SaveService`; corrupt data resets to defaults.

## 6. Architecture

Project root: `snail-mail-web/`.

```
snail-mail-web/
├── src/
│   ├── main.ts            // bootstrap, resize, RAF loop wiring
│   ├── core/
│   │   ├── GameState.ts   // menu | playing | paused | complete | gameover FSM
│   │   ├── Loop.ts        // fixed-timestep update, render
│   │   └── Save.ts        // localStorage service
│   ├── track/
│   │   ├── TrackCurve.ts  // spline + s→world math
│   │   ├── TrackMesh.ts   // ribbon + rails + gap builder
│   │   └── LevelLoader.ts // JSON → runtime level (validates features)
│   ├── systems/
│   │   ├── Collision.ts   // (s,x) proximity, sorted-by-s windows
│   │   ├── Weapons.ts     // ladder, projectiles, smart bomb
│   │   └── Spawner.ts     // activate entities near player, recycle behind
│   ├── entities/
│   │   ├── Entity.ts      // { type, s, x, mesh?, alive }
│   │   ├── SpawnRegistry.ts
│   │   └── factories.ts   // code-built meshes per element type
│   ├── player/
│   │   ├── Snail.ts       // Turbo mesh (primitives: shell torus + body capsule)
│   │   └── Controller.ts  // input, steering, speed, health
│   ├── systems/
│   │   ├── Collision.ts   // (s,x) proximity, sorted-by-s windows
|   |   ├── Weapons.ts     // ladder, projectiles, smart bomb
│   │   └── Spawner.ts     // activate entities near player, recycle behind
│   └── ui/
│       ├── HUD.ts         // DOM overlay: score, health pips, weapon tier, progress bar
│       └── Screens.ts     // menu, level select, pause, results
├── levels/*.json
└── tests/                 // vitest
```

- **Loop:** fixed-timestep simulation decoupled from render.
- **Streaming:** entities activate in an `s`-window around the player; recycled behind.
- **Testability:** track math, collision windows, weapon ladder, scoring, save
  round-trip covered by vitest; rendering verified via browser smoke tests.

## 7. Art & Audio

- All meshes Three.js primitives + emissive materials on dark background:
  snail (torus-shell spiral + capsule body), slugs (squashed capsules, magenta),
  packages (cyan boxes + ribbon), rings (color-coded tori),
  asteroids (noise-displaced icosahedra).
- Juice: pickup pop, hit screen shake, weapon-ladder flash, speed trail.
- Audio: WebAudio-synthesized SFX (blip/thud/zap/fanfare); mute toggle persisted in save.
- No external assets; everything version-controlled.

## 8. Testing

- vitest unit tests: curve math (`s→world` round-trip), collision windows,
  weapon ladder transitions, scoring, save serialization.
- Browser smoke test per milestone: boot → race L1 → collect package → take hit →
  die → retry → complete level.
