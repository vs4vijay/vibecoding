# Section 1 — Architecture

Single-page TypeScript app: one `<canvas>` battlefield, a thin DOM overlay for menus/HUD chrome, and a deterministic simulation at the center. Per locked decision 6, the sim exposes `stepWorld(state, inputs[]) -> state'`, never hardcodes character behavior, and treats all gameplay content as interpreted data.

## Folder Layout

```
lf2-web/
├── index.html                 # canvas element + #ui overlay root, loads src/main.ts
├── package.json               # Bun-managed deps and scripts
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── assets/                # sprite atlases (PNG), fonts, audio files — served verbatim
└── src/
    ├── sim/                   # PURE deterministic simulation (no DOM, no clocks)
    │   ├── types.ts           # WorldState, Fighter, Projectile, InputFrame, SimEvent
    │   ├── world.ts           # stepWorld(), spawnMatch()
    │   ├── fighter.ts         # per-fighter FSM advance
    │   ├── physics.ts         # gravity, friction, arena bounds
    │   ├── hitdetect.ts       # AABB overlap + hit-resolution pipeline
    │   ├── specials.ts        # directional-sequence matcher over buffered inputs
    │   ├── bot.ts             # CPU botThink(): utility scorer -> InputFrame (pure)
    │   └── rng.ts             # seeded PRNG (mulberry32 — §2.5)
    ├── content/               # JSON sheets -> validated, sim-ready structures
    │   ├── loader.ts          # fetch, parse, validate against schema, cache
    │   └── schema.ts          # runtime validators mirroring CharacterSheet/StageDef
    ├── data/                  # ALL gameplay data (versioned, human-editable)
    │   ├── characters/        # brawler.json, swordsman.json, fire-caster.json, ...
    │   ├── stages/            # grassland-dojo.json, rooftop-night.json
    │   ├── weapons.json
    │   └── items.json
    ├── input/                 # devices -> per-slot InputFrame snapshots
    │   ├── keyboard.ts        # P1/P2 default key maps
    │   ├── gamepad.ts         # Standard Gamepad mapping, up to 4 pads
    │   └── router.ts          # merges devices into slots[0..3] (+ CPU slots flagged bot)
    ├── render/                # Canvas2D; READS WorldState, never mutates it
    │   ├── renderer.ts        # clear, depth-sort, blit sprites, draw HUD bars
    │   ├── atlas.ts           # atlas lookup: (sheet, frameId) -> source rect
    │   └── camera.ts          # fixed whole-arena framing, integer pixel snapping
    ├── audio/                 # WebAudio graph; plays SFX/music keyed on SimEvents
    │   └── audio.ts
    └── ui/                    # DOM overlay: menus, character select, pause, results
        ├── scene-manager.ts
        └── scenes/            # title.ts, mode.ts, select.ts, stage-select.ts, battle.ts, results.ts
```

## Separation Boundaries

- **sim/** is pure: equal `(state, inputs)` sequences produce identical states on every machine. Imports only its own modules; emits `SimEvent[]` (hit landed, weapon broke, KO) for presentation.
- **content/** depends inward on `sim/types.ts` only: converts raw JSON into frozen structures the sim interprets. The sim never fetches.
- **input/** knows the `InputFrame` shape (attack/jump/defend + direction bits, per tick), nothing about moves or characters.
- **render/, audio/, ui/** are consumers: they read state/events and perform side effects; none may mutate `WorldState`.

## Fixed-Timestep Game Loop (60 Hz accumulator)

`main.ts` runs the only clock in the app (`performance.now()` is legal *here* alone):

```ts
const TICK_MS = 1000 / 60;
let acc = 0, prev = performance.now();
function frame(now: number): void {
  acc += Math.min(now - prev, 250);      // clamp tab-switch stalls: no fast-forward spirals
  prev = now;
  while (acc >= TICK_MS) {
    const inputs: InputFrame[] = inputRouter.poll();  // one snapshot per slot, this tick
    const { state, events } = stepWorld(world, inputs);
    world = state;
    events.forEach((e) => { audio.onEvent(e); hud.onEvent(e); });
    acc -= TICK_MS;
  }
  renderer.draw(world, acc / TICK_MS);   // alpha reserved for future interpolation
  requestAnimationFrame(frame);
}
```

Sim advances only whole ticks per rAF; rendering happens once per frame. Replays reduce to logging `(seed, roster, stage, inputs[])`.

## Scene Management

`SceneManager` (in `ui/scene-manager.ts`) holds the active scene; each scene implements `enter(ctx)`, `exit()`, `update(dtMs)`, `draw()`:

| Scene | Responsibility | Transitions |
|---|---|---|
| `title` | logo, start, controls help | → mode |
| `mode` | free-for-all vs 2 teams, slot config (humans join, CPU fills) | → select |
| `select` | 6-char roster, per-slot human/CPU/team | → stage-select |
| `stage-select` | Grassland Dojo / Rooftop Night, seed display | → battle |
| `battle` | builds `WorldState`, runs match timer, win check | → results; ⇄ pause |
| `pause` | overlay; freezes sim stepping, keeps last frame | resume → battle; quit → title |
| `results` | winner banner, rematch / roster / quit | → battle, select, title |

Only `battle` steps the sim; `pause` stops feeding ticks while remaining mounted (state untouched).

## Toolchain Configuration

Bun manages installs and tests; Vite handles dev/build. `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "devDependencies": ["typescript", "vite"],
  "engines": { "bun": ">=1.1" }
}
```

`tsconfig.json` essentials: `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"strict": true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`. `vite.config.ts`: `base: "./"` so the bundle runs from any static host, plus path aliases (`@sim/*`, `@render/*`, `@content/*`) mirroring the folders.

## Determinism Guarantees

1. No `Math.random`, `Date.now`, or `performance.now` under `src/sim/`; all randomness flows through the seeded `rng.ts` instance carried inside `WorldState`.
2. Fighters live in a fixed slot array `[0..7]`; update and collision passes iterate slots ascending — no object-key iteration order.
3. Sim math is IEEE-754 doubles in fixed operation order; identical engines reproduce it bit-for-bit, keeping rollback netcode and golden replay tests viable.
4. Content sheets load before `spawnMatch()` and are frozen, so async loads never interleave with ticks.


## Module Dependency Rules
1. `sim/` imports nothing from `render/`, `input/`, `ui/`, `audio/`, or `content/`; no DOM or Bun APIs — pure TS only.
2. Dependencies point inward: `content → sim/types`, `render → sim/state` (read-only), `input → sim/types` (InputFrame); `audio` reacts to SimEvents via callback.
3. `ui/` may use `render/` and `input/`, but invokes `stepWorld` only through battle-scene loop hooks in `main.ts`.
4. `main.ts` is the sole cross-layer composition point; no import cycles.
