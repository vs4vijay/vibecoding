# AGENTS.md — laser-snail

Auto-forward 3D space-highway racer: steer **Turbo** the snail down a neon
skyway — dodge hazards, jump gaps, collect mail, climb the cannon ladder.
Vite + TypeScript strict + three.js, zero assets (procedural visuals/audio).

## Commands

```sh
bun install          # never npm/npx/yarn
bun run dev          # http://localhost:5411 (strict port)
bun run test         # vitest, 23 suites / 272 tests, node env, fileParallelism off
bun run typecheck    # tsc --noEmit (also gates `bun run build`)
bun run build        # tsc --noEmit && vite build → dist/
bun run preview      # serve dist/
```

Verify UI/rendering live with `playwright-cli` against a real headless
Chromium (not background/cmux panes — they throttle rAF to zero and produce
black screenshots). Console must be clean except favicon (inlined as SVG
data-URI, so even that shouldn't appear).

## Architecture invariants

- **All gameplay runs in `(s, x)` track space** (`s` = arc length via
  `TrackCurve`, `x` = lateral offset). Never compare world positions for
  gameplay; `TrackCurve` is the only s↔world converter.
- **Fixed timestep 60 Hz** (`core/Loop.ts`) with clamped accumulator;
  rendering interpolates between the last two sim steps. Don't move sim math
  into render code.
- **Steady state allocates nothing**: entity pools are prebuilt per level
  (`Spawner` activates an s-window only), projectiles 48 slots, particles a
  fixed 320-slot `THREE.Points`. `Perf.test.ts` asserts the budgets — if you
  add allocation to a per-frame path, the suite (rightly) fails.
- **Levels are data**: `levels/*.json` validated against the feature registry
  (`LevelLoader`); unknown feature = hard load error. Invariant, test-checked:
  every gap is survivable at cruise speed.
- **Save is `laser-snail-save-v1`** (`core/Save.ts`): strict per-field
  validation, corrupt payload silently resets. Storage injectable for tests.

## Render pipeline (the white-out incident)

`src/render/tuning.ts` is the single source of truth for every brightness
constant (bloom trio, exposure, light intensities, HDR accent budget). It is
pure data — **no three.js import, no `THREE.Color`**, plain `[r,g,b]` tuples —
so `tests/RenderConstants.test.ts` can pin the envelope in node.

- Two-tier bloom discipline: compact accents (rings, ribbons, pods, lip
  strips) sit above the bloom threshold and glow; **the edge rails must stay
  below it** — UnrealBloom's mip chain turns any large-area source into a
  full-screen white flood (verified empirically; see the
  `fix-render-readability` change archive in the old snailmail repo and
  design decision D5).
- Never retune brightness by editing literals in `main.ts`, `Lighting.ts`,
  `TrackMesh.ts`, or `factories.ts` — they only import from `tuning.ts`.
- If a retune is deliberate: adjust `tuning.ts`, re-run a browser screenshot
  pass across waypoints (L1 cruise, a gap on L5/6, a cluster on L9/10), then
  update the guard's named bounds in the same change.

## Gotchas

- `vite.config.ts` sets `base: "./"` — the build works under the shared
  Pages subpath `/vibecoding/laser-snail/`. Don't switch to absolute paths.
- `Perf.test.ts` is wall-clock sensitive: the config already runs suites
  serially (`fileParallelism: false`); don't re-enable parallelism.
- The dev port 5411 is strict (`strictPort: true`) — a stale server holding
  it fails `bun run dev` confusingly; kill the old process first.
- three.js + the whole game is one ~690 kB chunk (~180 kB gzip) on purpose
  (single-page game; splitting adds a round-trip for nothing) — the raised
  `chunkSizeWarningLimit` is intentional, don't "fix" the warning differently.
