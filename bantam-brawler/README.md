# Bantam Brawler

A browser remake of Little Fighter 2's VS mode: 6 original archetypes, 2 stages,
up to 4 local humans plus CPU bots (max 8 fighters). Deterministic 60 Hz
simulation, Canvas2D rendering, WebAudio, zero gameplay dependencies.

## Play online

The latest build is deployed to GitHub Pages:
<https://vs4vijay.github.io/vibecoding/bantam-brawler/>

## Run

    bun install
    bun run dev          # http://localhost:2000

Production: `bun run build` then `bun run preview`.

## Controls

Keyboard (physical key codes):

| | Attack | Jump | Defend | Move |
|---|---|---|---|---|
| P1 | `,` | `.` | `/` | Arrow keys |
| P2 | `F` | `G` | `H` | WASD |
| P3 | `;` | `,` | `/` | IJKL |
| P4 | Numpad `0` | Numpad `.` | Numpad `+` | Numpad 8456 |

P3 shares `,` (jump) and `/` (defend) with P1; when P1 **and** P3 are both
human, P3 automatically falls back to `'` (Quote) for jump and `Enter` for
defend.

Gamepads (standard mapping): X = Attack, A = Jump, B = Defend, left stick/dpad
= move. Press Attack on a pad in Character Select to join. Rebind keys from
Title → Controls → REMAP (persisted under `bantam.bindings.v1`).

Every character has LF2-style special moves typed as key sequences while
holding Defend, e.g. brawler's energy blast is `D>A` (hold Defend, tap toward,
Attack) and costs 25 MP — see each sheet's `moves` in `src/data/characters/`.
Many specials spawn projectiles: fire/ice casters apply burn/freeze on hit,
and the support-mage's heal wave heals allies. Weapons: melee/heavy weapons
swing with their own damage and durability (they break at 0); knife-kind
weapons throw; the boulder slows you down (`carrierSpeedMul`).

## Architecture

- `src/sim/` — pure deterministic simulation (`spawnMatch`, `stepWorld`).
  No DOM, no clocks, no `Math.random`; all randomness is a seeded mulberry32
  PRNG carried in `WorldState`, and state is verified with canonical-JSON
  hashing. Interprets JSON character sheets (`src/data/`).
- `src/content/` — fetch + validate + cross-link the JSON sheets
  (`loader.ts` / `schema.ts`).
- `src/input/` — poll-based keyboard (P1–P4 keymaps), gamepads via the
  standard mapping, pad-join, and a composite router feeding the sim.
- `src/render/` — sprite-atlas loading, camera, and the whole-arena
  depth-sorted Canvas2D renderer.
- `src/audio/` — gesture-unlocked WebAudio SFX bus.
- `src/ui/` — SceneManager with 6 scenes (title, mode, select, stage-select,
  battle, results) plus pushed scenes (Controls reference, About), the
  fixed-timestep loop (`loop.ts`), and DOM-overlay scene shell
  (`src/ui/scenes/`). `src/main.ts` is the composition root.
- `scripts/` — representative dev tooling: `build-atlases.ts`,
  `check-sprite-refs.mjs`, `check-determinism.mjs`, `gen-replay.ts`,
  `soak.ts`, `ttk.ts`, `e2e-smoke.py`.

## Testing & determinism

    bun test                            # full suite (208 tests)
    bun run build                       # typecheck + determinism gate + sprite gate + vite build
    bun scripts/soak.ts                 # 40 × 8-bot FFA soak (termination, NaN guard)
    bun scripts/ttk.ts                  # bot-duel length measurement
    python3 scripts/e2e-smoke.py        # black-box browser pass (needs python3 + Playwright
                                        #   and a running dev/preview server)
    bun test tests/golden/replay.test.ts  # 1200-tick replay must hash to the pinned sha256

`tests/golden/match-001.sha256` pins the sim: if it fails after a sim edit,
determinism broke — do not regenerate the hash without understanding why.

## Credits

All art and audio are CC0 — see `public/assets/CREDITS.txt` for pack provenance.
No ripped Little Fighter 2 assets are used.
