# AGENTS.md — a-wild-bug

Bug's-eye-view forage game: Pip the ant must deliver six grains to the anthill
before sunset while Hopper the grasshopper steals carried grain. Vite +
TypeScript strict + three.js, zero assets (procedural visuals/audio), fixed
60 Hz sim, seeded determinism with a pinned capture harness.

## Commands

```sh
bun install          # never npm/npx/yarn (in this monorepo)
bun run dev          # http://127.0.0.1:41189 (strict port; leetspeak "a-wild-bug")
bun run typecheck    # tsc --noEmit (also gates `bun run build`)
bun run build        # tsc && vite build → dist/ (relative base ./, subpath-safe)
bun run probe        # tools/probe-ui.mjs — 35 sections vs a running dev server
bun run shots        # tools/shoot.mjs — pinned scene captures
```

Probes/captures need the dev server up (`bun run dev &`, port 41189) and a
real headless Chromium; background/cmux panes throttle rAF and produce black
frames. SwiftShader software GL is fine (the harness launches it explicitly)
but slow — budget minutes, run long suites in the background. Console must be
clean (the only tolerated warning is SwiftShader's one-shot "GPU stall due to
ReadPixels" during capture readback; `shoot.mjs --strict-warnings` classifies
it).

## Architecture invariants

- **Fixed timestep 60 Hz** (`Game.stepFixed`): controller → ant → seeds →
  loop → hopper → grains → anthill → puffs, in that order. No wall clock in
  sim-driven visuals — animation clocks are `windTime`/sim fields, so pinned
  captures are byte-stable. Don't introduce `performance.now()`/`Date.now()`
  into anything the capture path renders.
- **The mode machine wraps the day; the loop owns it**
  (`Game.mode` = title/playing/paused/results; `ForageLoop.phase` =
  playing/winMoment/win/lose). Pausing gates the accumulator — no fixed steps,
  `windTime` frozen. `loop.stage()` (staging API) sets state directly and must
  NEVER fire side effects (audio, teaching, mode transitions happen in
  `stepFixed` after `loop.update`, not in phase setters).
- **Capture contract is authoritative**: `window.__wb.ready / shot(name) /
  grab() / info()`; `Game.pinned` is the kill-switch (shell + touch widgets
  get `.pinned` → `transition: none`, fades jump to end state; teaching and
  audio scheduling are inert while pinned). World scenes `run`/`orbit` are
  byte-identity references — `tools/probe-ui.mjs` regression sections fail if
  they drift. If a deliberate visual change lands, re-baseline explicitly and
  say so.
- **Touch is a synthetic input provider** (`TouchControls` → `Input`):
  widgets write into the same move/sprint/queue surface; the controller never
  learns about touch. Scene gestures bind to the WebGL canvas only; widgets
  stop propagation. `Input` stays mouse+keyboard+seams only.
- **One copy table for control hints** (`ui/Hints.ts`): key/touch variants +
  the latched scheme singleton (boot `(pointer: coarse)`, corrected by
  observed `pointerType`). Never hardcode a control string in Shell/Hud
  markup — mixed-scheme lines are a spec violation.
- **Camera-relative movement basis**: forward = (sin yaw, cos yaw); strafe
  right = (−cos yaw, sin yaw) — the NEGATIVE of naive `f×up` sign flips.
  `Q`/`E`/mouse-drag must agree: drag right looks right. If movement or orbit
  ever feels inverted, calibrate against `camera.matrixWorld` column 0
  (screen-right), not algebra (verified the hard way — see the 2026-09
  controls fix).
- **Audio is schedule-only and can never gate the sim**: one lazy
  AudioContext on first gesture, master/music/sfx gains, prebuilt envelopes.
  Everything WebAudio is try/catch'd (game runs with audio unsupported).
  Persistence keys: `wb.audio.music`, `wb.audio.sfx`, `wb.taught` (JSON,
  written only when a day actually starts).
- **HUD is a 2D canvas** redrawn per frame from sim state; compact layout
  (floored text scale), safe-area insets via a probe element, reduced-motion
  flattening all live in `ui/Hud.ts`. Debug seams (`hud.hudBoxes`,
  `hud.debugMotion`) are probe API — keep them allocation-free.

## Gotchas

- **Sim-time ≠ wall-time under SwiftShader** (~230 ms frames, accumulator
  clamped at 0.25 s): long key-hold measurements measure the camera's swing,
  not the input. Test directions over ONE manual `controller.update(1/60, 0)`
  or the first few frames only.
- **The hopper plays back**: probes that script gameplay must park it
  (`hopper.stageDefault()`) — a live chase steals carried grain and stuns the
  ant mid-assertion; a real chase completes in <1 s, so re-stage bait for
  multi-second sampling.
- **The dev port is strict** (41189): Vite 6 without `--host 127.0.0.1` binds
  IPv6-only and `127.0.0.1` URLs fail while `localhost` works — the config
  pins both host and port; don't "simplify" them away.
- **Cross-loop staging leaks in one shoot.mjs session** (the pipeline never
  unpins between shots): capture shell scenes and world scenes in separate
  invocations.
