# A Wild Bug

**Play online:** <https://vs4vijay.github.io/vibecoding/a-wild-bug/>

> *Six grains before sunset.*

A bug's-eye-view action-collecting game: you are **Pip**, an inventor ant
racing a sunset deadline to meet the grain quota demanded by Hopper's gang.
Forage grain nodes, haul them to the anthill, throw across gaps, ride spring
seed catapults up to the windfall crest — and watch the grasshopper, who
steals whatever you're carrying. The sinking sun is the timer; the meadow, the
storybook UI, and every sound are synthesized in code — zero assets.

Built with Vite + TypeScript (strict) + three.js. Fixed-timestep simulation
(60 Hz) decoupled from rendering, seeded determinism (`?seed=`), and a pinned
screenshot harness that keeps every capture byte-stable. The design/plan spec
lives in [.plan.md](./.plan.md).

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | `W`/`A`/`S`/`D` or arrows | Left joystick (push far to sprint) |
| Sprint | hold `Shift` | Full joystick deflection |
| Jump | `Space` | JUMP button |
| Pick up grain | `E` | ACTION button (label follows the verb) |
| Throw carried grain | `F` | ACTION button |
| Orbit camera | `Q`/`E` or mouse-drag | One-finger scene drag |
| Zoom | wheel | Pinch |
| Pause | `Esc` or `P` | ⏸ control (top-right) |
| Restart / confirm | `Enter` or quick tap | Buttons on menus |
| Mute (session) | — | 🔊 control (top-right) |

MUSIC / SFX toggles on the title screen persist across sessions; the in-run
speaker control mutes for the current session only.

## Running it

```sh
bun install          # deps (bun as the runner; npm works too)
bun run dev          # dev server → http://127.0.0.1:41189 (leetspeak port, strict)
bun run typecheck    # tsc --noEmit
bun run build        # typecheck + vite build → dist/
bun run preview      # serve dist/ (same port)
bun run probe        # Playwright UI probe suite (35 sections) against a running dev server
bun run shots        # deterministic screenshot harness (see tools/shoot.mjs --help)
```

The Vite build uses a relative `base: "./"`, so `dist/` deploys under any
subpath — it ships at `/vibecoding/a-wild-bug/` on the shared GitHub Pages
site (see [docs/GAMES.md](../docs/GAMES.md)).

## Verification harness

`tools/probe-ui.mjs` (Playwright) walks the full screen flow, touch
ingestion, scheme-aware hints, onboarding persistence, HUD layout/safe-area/
reduced-motion, audio graph state, and a 39-scenario spec acceptance walk —
all headless against a running dev server. `tools/shoot.mjs` captures the
pinned scene set (byte-stable across runs); `tools/perf-probe.mjs` compares
draw calls and heap drift against baselines. Captures land in `shots/`
(gitignored).
