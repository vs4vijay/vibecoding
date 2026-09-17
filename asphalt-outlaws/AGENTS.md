# Asphalt Outlaws — agent notes

Road Rash–style pseudo-3D motorcycle racer with combat. Design spec +
implementation plan live in [`.plan.md`](./.plan.md); every gameplay number
lives in [`src/config.ts`](./src/config.ts).

## Commands (bun only — never npm/npx/yarn; prefix shell commands with `rtk`)

```bash
bun install            # deps
bun run dev            # vite dev server on :5212
bun run build          # tsc --noEmit && vite build (compiler gates the build)
bun run preview        # serve dist/ on :5212
bun run typecheck      # tsc --noEmit
bun test               # pure-logic suites (bun test, node env — no DOM)
bun test tests/combat.test.ts   # scope to one file
```

## Invariants

- **Sim is pure.** Everything under `src/sim/` is DOM-free, `Math.random`-free
  and imports no renderer. All randomness flows through `state.rng` (seeded
  per race, never per page load). If you break this, determinism tests fail.
- **Fixed timestep.** The sim steps at `SIM.step` (1/60) inside
  `core/loop.ts`; render reads state and never mutates it. Render passes may
  write only the segment projection caches (`p1/p2.camera`, `p1/p2.screen`,
  `clip`).
- **Config discipline.** No magic gameplay numbers outside `src/config.ts`.
  Render-only shape constants may live at the top of the render module that
  uses them, with a comment.
- **Zero binary assets.** All sprites/scenery/audio are procedural
  (Canvas2D + WebAudio). No external fonts, no images, no emoji in UI text.
- **Contracts.** `src/sim/types.ts` is types-only and must stay
  circular-import free (no imports from `config.ts`).

## Gotchas

- `raceMaxSpeed(state)` (in `sim/bike.ts`) is the only speed-cap source of
  truth — level `maxSpeedMul` × bike `topSpeedMul` × base MAX_SPEED. Don't
  recompute by hand.
- Combat `side` semantics: `"left"` means the **attacker** is left of the
  target (`attacker.x < target.x`). So the "punch left" key (J) maps to
  `tryAttack(state, player, "right")` — see `sim/world.ts`.
- `render/road.ts#renderWorld` draws the sky too — don't paint a background
  before it. `projectForSprite` must be called **after** `renderWorld` in the
  frame (it reuses that pass's cached projections).
- Per-frame draw order is fixed:
  `updateCamera → renderWorld → drawTraffic → drawRiders → fx.step/draw →
  renderHud`, all in logical 1280×720 coords (`main.ts` owns the transform).
- Bun test can't touch the DOM: keep canvas/audio behavior out of unit tests
  (they're verified live with `playwright-cli` against `bun run preview` —
  background tabs throttle rAF to zero, so use the dedicated headless
  browser, console must be clean).
- The sim never advances when `AppModel.phase` isn't `"race"` (pause/results
  freeze the frame; menus run the attract-mode demo world in `main.ts`).

## Verification before commit

`bun run typecheck` + `bun test` green, `bun run build` succeeds, then a live
`playwright-cli` pass on the preview server (title → select → race → HUD,
clean console). Deploy goes through the shared
`.github/workflows/games-pages-deploy.yml` (this folder is already registered).
