# AGENTS.md — Vulture Pass

Top-down car-combat trading game: drive the Cholla Basin, buy low / sell
high between two towns, fight bandit ambushes, upgrade, beat the boss.
Original IP — nothing may reference the 2005 game that inspired the genre.

## Commands

```bash
bun install            # deps
bun run dev            # vite dev server (HMR — data edits land live)
bun run build          # production build to dist/ (subpath-safe, base "./")
bun run test           # pure-logic unit suites (node)
bun run qa             # smoke: build + headless run (new game → combat → town → save)
bun run playthrough    # scripted end-to-end run of the whole game loop
```

Browser suites (`qa/check-*.mjs`) drive a real headless Chromium via
`playwright-core`; set your Chromium path in `qa/lib/browser.mjs`
(`CHROME_PATH`). They use `vite dev` on port 5199 — don't run two at once.

## Architecture (invariants)

- **Layering:** `src/engine` (loop/input/camera/audio/save) → `src/game`
  (state/combat/towns/data) → `src/ui` (DOM overlays). `src/game` never
  imports DOM; `src/ui` never mutates game state — it dispatches intents
  (`src/game/state.js`) and reads results. Keep it that way.
- **All tunables in `src/game/data/`** (`content.js`, `tuning.js`,
  `palette.js`). No magic numbers in systems. Tuning passes edit data only.
- **Fixed-timestep sim** (`engine/loop.js`, 60 Hz accumulator) — combat
  systems take intents in, state out; deterministic per seed
  (`game/rng.js`, mulberry32 + murmur3-finished hashes). Don't add
  `Math.random()` or `performance.now()` into sim paths — visuals only.
- **One Three renderer** (`main.js`), scenes swap via the flow functions;
  the overworld map, shops, HUD, cutscenes are DOM/SVG overlays.
- **Dual mounts are the signature:** `game/weapons/mounts.js` picks the
  weapon by the sign of the cross(heading, aim). Geometry is pinned by
  `qa/units/mounts.test.mjs` — don't "fix" the left/right convention
  without that test.

## Gotchas

- **RNG hashing:** `hashSeed` must avalanche (murmur3 fmix32) — consecutive
  seeds (day+1, trip+1) previously produced correlated ambush rolls.
- **Battle seeds** come from `(state.seed ^ trips…)` — never wall-clock;
  a non-deterministic seed sneaked in once and was caught in review.
- **HUD vs shops vs prompt bar** are separate DOM roots — hiding one must
  never hide the others.
- **Favicon** is an inline SVG data-URI (Pages has no favicon file).
- The smoke suite stages its own `vite preview` on port 4173.
