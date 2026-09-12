# AGENTS.md — Tiny Fighters (`tiny-fighters/`)

Browser remake of Little Fighter 2's VS mode: 6 archetypes, 2 stages, up to 4
local humans plus CPU bots (max 8 fighters). Bun + Vite 5 + TypeScript (strict)
+ Canvas2D + WebAudio. The sim is deterministic at a fixed 60 Hz and pinned by
a golden hash — that determinism is the project's spine; don't break it.

## Commands

```sh
bun install                          # bun ONLY — never npm/npx/yarn/pnpm
bun run dev                          # vite dev server (:2000, strict)
bun run build                        # tsc --noEmit + determinism gate + sprite-refs gate + vite build
bun test                             # Bun's built-in runner — full suite (208 tests)
bun test tests/golden/replay.test.ts # 1200-tick replay must hash to tests/golden/match-001.sha256
bun scripts/soak.ts                  # 40 × 8-bot FFA soak (termination + NaN guard)
bun scripts/ttk.ts                   # bot-duel length measurement
python3 scripts/e2e-smoke.py         # black-box browser pass — needs a RUNNING dev/preview server
```

For the e2e smoke: `python3 -m pip install playwright && python3 -m playwright
install chromium`, start the server (`bun run preview` or `bun run dev`), then
run the script.

Prefix shell commands with `rtk` per repo convention (`rtk bun test`,
`rtk git …`). Commit from the **repo root** (`vibecoding/`), not this folder.

## Layout

```
src/
  sim/           PURE deterministic simulation (spawnMatch, stepWorld) — no DOM,
                 no clocks, no Math.random; seeded mulberry32 PRNG carried in
                 WorldState; all tunables in sim/constants.ts
  data/          JSON character sheets + stage defs (interpreted by the sim)
  content/       fetch + validate + cross-link the JSON sheets (loader.ts/schema.ts)
  input/         poll-based keyboard (P1–P4), gamepads, composite router
  render/        sprite-atlas loading, camera, depth-sorted Canvas2D renderer
  audio/         gesture-unlocked WebAudio SFX bus
  ui/            SceneManager (6 scenes + pushed overlays), fixed-timestep loop
  main.ts        composition root
public/assets/   CC0 art/audio + atlas/*.json (frame names owned by src/data)
scripts/         build-atlases, check-determinism, check-sprite-refs, gen-replay,
                 soak, ttk, e2e-smoke
tests/           bun test; tests/golden/ pins sim determinism
```

## Invariants (enforced by gates/tests/reviews — do not break)

- **`src/sim/` purity:** no `Math.random`, `Date.now`, `performance.now`, DOM,
  or module-level mutable state — randomness is the seeded PRNG in
  `WorldState`. Enforced by `scripts/check-determinism.mjs`, which runs as
  part of `bun run build`.
- **Constants live only in `src/sim/constants.ts`** — magic numbers elsewhere
  are review rejections.
- **Golden hash:** `tests/golden/match-001.sha256` pins the sim. If it fails,
  determinism broke — never regenerate the hash to mask a failure. (Data edits
  legitimately change it: `GOLDEN_WRITE=1 bun test tests/golden/replay.test.ts`,
  and the diff must make sense.)
- **Atlas frame names:** the frames in `public/assets/atlas/*.json` are owned
  by `src/data` — enforced by `scripts/check-sprite-refs.mjs` in the build.
  Regenerate atlases via `scripts/build-atlases.ts`, not by hand.
- **Assets are CC0 only.** No ripped Little Fighter 2 art/audio, ever (locked
  decision). Provenance in `public/assets/CREDITS.txt`.
- **Persistence keys are exactly `tiny.bindings.v1`** (input remapping) **and
  `tiny.muted`** (audio). No other keys, no prefixes drift.
- **Logical canvas is 960×540** — the camera letterbox-fits that view; render
  scaling must not change sim coordinates.

## Gotchas (each one bit us once)

- **`DATA_BASE` in `src/content/loader.ts` is intentionally relative**
  (`"./assets-data/"`) so content fetches resolve against the document URL and
  load under the GitHub Pages subpath — do NOT make it absolute.
- **P3 keyboard fallback:** P3 shares `,`/`/` with P1; when P1 **and** P3 are
  both human, P3 falls back to `'` (Quote) jump and `Enter` defend.
- **e2e smoke needs a real (non-cmux) browser** — background/cmux panes
  throttle rAF to zero: black screenshots, frozen sims. Use a dedicated
  headless Chromium.
- **bun only** — no npm/npx/yarn/pnpm; this repo standardizes on bun.

## Deployment

Served from the shared Pages workflow
(`.github/workflows/games-pages-deploy.yml`) at
`https://vs4vijay.github.io/vibecoding/tiny-fighters/`. `vite.config.ts` sets
`base: "./"` and all asset/content paths are relative — that is load-bearing
for the subpath; don't switch to absolute URLs.
