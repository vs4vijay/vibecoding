# Dustline Fixed-Timestep Input Plan

Follow-up to Dustline v1 (merged to main). Branch: `feat/dustline-fixed-timestep`.

## Problem

`packages/client/src/game.ts` `renderLoop` sends one input per rAF frame and the predictor steps the local simulation by `SIMULATION_DT` (1/60 s) per input — so simulation rate equals display refresh rate. On a 144 Hz display players move ~2.4× faster than on 60 Hz (and send 2.4× more input messages). The server already runs a fixed 60 Hz tick applying each input with `TICK_INTERVAL_MS/1000` dt, so this is purely a client-side defect — but a fairness-critical one for a multiplayer FPS.

## Task 1: Fixed-timestep input accumulator

- New DOM-free module `packages/client/src/timestep.ts`: `createTicker(stepFn, tickDtMs, opts?)` with `advance(frameDeltaMs)` — accumulates elapsed time, runs `stepFn()` once per accumulated `tickDtMs`, bounded:
  - `MAX_TICKS_PER_FRAME = 5` (catch-up cap; excess accumulation discarded, not banked)
  - `FRAME_DELTA_MAX_MS = 250` (clamp for tab-background returns; rAF halts in background)
  - `reset()` — clears the accumulator (call when input becomes inactive so returning never bursts)
- `game.ts` integration: per frame, call `ticker.advance(clock.getDelta() * 1000)`; the step callback performs exactly the current per-frame input body (`input.seq++`, build inputState with current yaw/pitch, `predictor.pushLocalInput`, `sendInput`). Per-frame visuals (camera, minimap, HUD) stay on the rAF clock unchanged. When input is inactive (not pointer-locked / dead / no player id), do not step inputs and `reset()` the ticker.
- Constants live in the client (`timestep.ts` exports), named exactly as above; tick period derives from the existing `SIMULATION_DT` (× 1000).
- Server unchanged. Movement-parity guarantee holds by construction (same inputs, same dt, same order — parity tests must still pass unmodified).
- **TDD required** — `packages/client/src/timestep.test.ts`: (1) 1000 ms → exactly 60 steps; (2) sub-tick frame deltas accumulate and step on crossing; (3) catch-up capped at `MAX_TICKS_PER_FRAME` with excess discarded; (4) huge delta clamped via `FRAME_DELTA_MAX_MS`; (5) long-run drift bound (steps within ±1 of elapsed/tick).
- README: prune the roadmap line "Fixed-timestep input accumulator (movement speed currently scales with display refresh rate)" once shipped.
- Green gate: `bun run build` + `bun test` (baseline 94) with pristine output; conventional commits ≤3; never commit the untracked stub dir `cs-clone/` or `DRFT/scripts/make.ps1`; `rtk` prefix + bun per workspace AGENTS.md.

## Out of scope

Server tick changes, input message format changes, interpolation of remote players, deploy/push actions.
