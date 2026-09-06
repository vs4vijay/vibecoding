# Dustline v1 Plan

Browser-based, Counter-Strike-inspired multiplayer FPS (formerly `cs-clone`). Stack: Three.js client (Vite + PWA), Bun + Hono + WebSocket server, Drizzle ORM + PGLite. Bun workspace with packages `shared`, `server`, `client`.

Current verified state: builds cleanly, 21 e2e tests pass (after building shared manually — build order is broken on fresh clone), single-shot generated codebase, one commit.

## Goal

Rename the project to **Dustline** and take it from "generated skeleton that tests green" to a v1 with the features that make it actually playable: client-side prediction, lag compensation, sound, and a persistent leaderboard. End state: fresh clone → install → build → test → play, all green, all documented.

## Out of Scope (recorded rulings)

- Matchmaking, anti-cheat, voice chat, grenades, bomb-defusal mode, spectator mode, new maps, new player models — separate milestones after v1.
- `docs/GAMES.md` / GitHub Pages workflow: NOT applicable to dustline (that pipeline is for static games; dustline requires its own server). Do not add dustline there.

## Global Constraints

1. **Runtime is Bun.** Never npm/node/python. Prefix shell commands with `rtk` per workspace AGENTS.md.
2. **Server-authoritative always.** The server is the sole authority for health, damage, hits, scores, and other players' positions. Client prediction must never let the client *decide* outcomes — only *render* them sooner.
3. **Green after every task.** From the project root: `bun run build` (shared → client → server order) and full `bun test` pass with pristine output before committing.
4. **Zero new runtime dependencies.** Everything needed is already present (three, hono, drizzle-orm, zod, @electric-sql/pglite, vite-plugin-pwa). Procedural/generated solutions over assets.
5. **PWA keeps working.** `manifest.json` valid, service worker still generates, no new precache asset churn.
6. **Scope of files:** only the project folder (Task 1: `cs-clone/**`, later tasks: `dustline/**`), this plan file, and monorepo docs that reference the project. Never touch other project folders or `.github/workflows/`.
7. **Commit hygiene:** conventional commits (`feat:`, `fix:`, `build:`, `docs:`, `test:`), ≤3 commits per task. Never commit the unrelated dirty file `DRFT/scripts/make.ps1`.
8. **TDD required** for Tasks 2, 3, 5 (new logic with testable contracts). Tests required (TDD optional) for Task 4. Tasks 1 and 6 are verification/renaming tasks — tests must pass, no TDD ceremony.

## Task 1: Rename to Dustline + build/test hygiene

Rename the project folder and all identifiers, and fix the broken fresh-clone flow discovered during assessment.

Exact values:
- New folder: `dustline` (monorepo root: `git mv cs-clone dustline`). Display name: `Dustline`.
- Package names: `@cs-clone/shared|server|client` → `@dustline/shared|server|client`; root package `"name": "cs-clone"` → `"dustline"`. Update every import of `@cs-clone/*` (grep to find them all: `rtk grep -ri "cs-clone\|cs clone\|CS Clone"` across the monorepo, excluding `.git`, `node_modules`, `.superpowers`, `docs/plans`, `bun.lock` files).
- After renaming packages, run `bun install` in `dustline/` to regenerate `bun.lock`, commit the result.
- Root `dustline/package.json` scripts become exactly:
  - `"build": "bun run --filter @dustline/shared build && bun run --filter @dustline/client build && bun run --filter @dustline/server build"`
  - `"dev": "bun run --filter @dustline/shared build && concurrently \"bun run --filter @dustline/shared dev\" \"bun run --filter @dustline/server dev\" \"bun run --filter @dustline/client dev\""`
  - `"test": "bun test test.e2e.test.ts"` (new — convenience)
  - keep `"start"`, `"db:generate"`, `"db:migrate"` (rename their filters to `@dustline/*`)
- Server startup log must contain the exact string `Dustline server running` (the e2e harness greps for it); update the harness (`test.e2e.test.ts`) to grep the new string. Update any other user-visible "CS Clone" strings (PWA `manifest.json` `name`/`short_name` → `Dustline`; `packages/client/index.html` `<title>` → `Dustline`; server health/version strings if any).
- `dustline/README.md`: retitle to `# Dustline — Browser Tactical FPS`; first line: "A Counter-Strike-inspired multiplayer FPS running fully in the browser." Update all command examples to `@dustline/*` filters and `cd dustline`. Do NOT touch the TODO list (Task 6 owns it).
- Test harness hardening (addresses an observed flaky run): the server-ready wait keeps its stdout sniff but adds a fallback poll of `GET /health` every 250 ms up to 10 s total before declaring ready.
- Make `PWA & Build Artifacts > client dist contains PWA files` skip (not fail) when `packages/client/dist/` does not exist: probe with `fs.stat(...).catch(() => null)` and use a conditional test registration.
- Verify the fresh-clone flow: `rm -rf node_modules packages/*/dist && bun install && bun run build && bun test` — all green. This is the acceptance test for the broken build order; report the observed output.

Acceptance: fresh-clone simulation green end-to-end; case-insensitive grep for `cs-clone` / `cs clone` / `CS Clone` returns zero hits in tracked files under `dustline/` and in monorepo docs that reference this project; `bun run test` script works from `dustline/`.

## Task 2: Client-side prediction + server reconciliation

Players should see their own movement immediately, with the server correcting drift — the single biggest feel improvement for the FPS.

Design (all exact values here):
- **Shared** (`packages/shared`): input message gains `seq: number` (client-assigned, monotonically increasing per connection, starting at 1); per-player snapshot state gains `lastInputSeq?: number` (highest input seq the server has processed for that player).
- **Server** (`game/engine.ts`, `websocket/connection.ts`): stamp/process inputs by seq; include each player's `lastInputSeq` in snapshots.
- **Client** — new module `packages/client/src/prediction.ts`, pure and DOM-free so bun can test it directly. Exports `createPredictor(applyInput, applyServerState)` plus constants imported from `@dustline/shared` (`CORRECTION_LERP_MS = 100` lives in `shared/constants.ts`). Semantics:
  - `pushLocalInput(seq, input)` queues the input for replay.
  - `onServerSnapshot(authoritativeState, ackedSeq)`: ignores snapshots whose ackedSeq is older than the last processed one (stale/reordered delivery); otherwise sets authoritative state and re-applies all queued inputs with `seq > ackedSeq` in order; trims the queue.
  - `getRenderState()`: returns predicted state with visual error eased over `CORRECTION_LERP_MS` so server corrections don't snap the camera.
- **Integration** (`game.ts`): local player movement predicted at input rate; inputs sent with seq from a monotonic counter; remote players keep the existing snapshot interpolation (unchanged).
- **TDD tests** — `packages/client/src/prediction.test.ts` (discovered automatically by `bun test`):
  1. no unacked inputs → predicted state equals server state
  2. N unacked inputs → server state advanced through exactly those inputs in order
  3. simulated RTT (inputs acked later) → converges to authoritative; zero drift once all inputs acked
  4. stale snapshot (older ackedSeq) does not regress state
  5. input queue is trimmed after ack (bounded memory)

Acceptance: full suite green; `bun run build` green; existing e2e suite still passes unchanged in behavior.

## Task 3: Server-side lag compensation

Hit registration should reflect what the shooter saw, not where targets are by the time the shot arrives.

Design (all exact values here):
- `shared/constants.ts`: `HISTORY_TICKS = 60` (≈1 s of history at the 60 Hz tick).
- New `packages/server/src/game/lagcomp.ts`: `PositionHistory` class — `record(tick, players)` captures `{pos, eyeHeight, radius}` per player each tick; `rewind(playerId, tick)` returns that player's hitbox at `tick` or `null` (unknown player / evicted tick). Ring buffer bounded by `HISTORY_TICKS`.
- `game/engine.ts`: record positions every tick; when processing a fire event, resolve the rewind tick = the tick at which the shooter's acked input (`lastInputSeq`) was processed, clamped to `[currentTick - HISTORY_TICKS, currentTick]`; fall back to `currentTick` if unknown. Rewind all potential targets to that tick, then run the existing raycast (`collision.ts intersectRayAABB`) against rewound hitboxes.
- `game/weapon.ts`: hit resolution accepts an optional rewound-targets parameter; default path (no rewind) keeps current semantics so existing tests stay valid.
- **TDD tests** — `packages/server/src/game/lagcomp.test.ts`: records and rewinds to older ticks; evicts beyond `HISTORY_TICKS`; returns null for unknown player/tick; engine-level test where the shooter fires at where the target WAS (target has since moved) and the hit registers.

Acceptance: full suite green; existing weapon tests pass unchanged (no-rewind default path).

## Task 4: Procedural sound effects

Zero-asset audio via the Web Audio API — no files, so the PWA precache stays stable.

Design (all exact values here):
- New `packages/client/src/audio.ts`: `createAudio(contextFactory?)` — lazy `AudioContext` creation (browser autoplay policy: create on first user gesture), oscillator/noise-buffer synthesis. Sounds and character:
  - `shot(weaponId)`: `ak47` — lower-frequency burst with noise tail; `glock` — snappier, higher-pitched crack
  - `reload()`, `hitMarker()`, `killConfirm()`, `death()`, `matchStart()`, `matchEnd()` — distinct, short
  - footsteps: only if trivially clean; otherwise omit and note it in the report (do not force it)
- Volume control: `setVolume(v)` (0..1), `toggleMute()`; persisted in `localStorage` key `dustline.audio` as JSON `{volume, muted}`.
- Wiring (`game.ts` / `ui.ts`): fire/reload/hit/kill/death/match events trigger sounds; `M` key toggles mute (add to Controls docs later — Task 6 owns README).
- Tests required (TDD optional) — `packages/client/src/audio.test.ts` with an injected fake AudioContext (plain-object node graph recorder): asserts nodes created per sound, mute suppresses output, persistence roundtrip works. Tests must not require a real WebAudio implementation.
- No new dependencies, no asset files.

Acceptance: full suite green; build green; no new files in the client `dist` precache beyond the existing set.

## Task 5: Persistent stats + leaderboard

Wire up the already-defined Drizzle schema (players, matches, match_players, kills) that currently sits unused.

Design (all exact values here):
- Server startup: ensure schema creation is idempotent at boot (`db/migrate.ts`) — inspect what exists before adding.
- On match end: write `matches` row (map, status, t_score, ct_score, winner, started/ended) and `match_players` rows per participant (kills, deaths, assists, headshots, shots_fired, shots_hit, damage_dealt, score); upsert each participant's `players` row accumulating totals and recomputing `kd_ratio`.
- On disconnect mid-match: best-effort persist that player's per-match stats (non-blocking; must never crash the game loop — swallow + log DB errors).
- HTTP: `GET /leaderboard?limit=20` (Hono route in `index.ts`) → JSON array ordered by `kd_ratio` desc, tie-break `total_kills` desc; entries: `{username, totalKills, totalDeaths, kd, headshots, matches, wins, losses, accuracy}` where `accuracy = shots_hit / shots_fired` (0 when no shots).
- Client: `L` key toggles a leaderboard panel (`ui.ts`) that fetches `/leaderboard` and renders a top-players table.
- **TDD tests** — new `test.persistence.test.ts` at the project root: PGLite in-memory; simulate a 2-player match end and assert the rows + kd math; hit the leaderboard endpoint (direct Hono `app.request()` preferred over spawning a second server — name the choice in the report).

Acceptance: full suite green; match end produces correct rows and leaderboard ordering; disconnect mid-match does not break the loop.

## Task 6: End-to-end verification + docs

Prove the whole thing works from scratch and leave the docs honest.

- Fresh-clone simulation: `rm -rf node_modules packages/*/dist && bun install && bun run build && bun test` — all green, output pristine; report exact commands and outputs.
- `dustline/README.md`: Features list updated (prediction, lag compensation, procedural audio, persistent leaderboard); Controls table gains `M` (mute) and `L` (leaderboard); prune TODO items this work completed; keep the remaining roadmap (bomb mode, matchmaking, anti-cheat, spectator, more maps, voice).
- Playwright smoke test (best-effort): run server + client dev, open the page, join, verify HUD renders, take a screenshot, confirm zero console errors. Use the existing `.playwright/` cache if present; if Playwright is unavailable in the environment, document exact manual verification steps instead and say so — do not install browsers without checking.
- Commit docs. Report includes every command run and its output.

Acceptance: fresh-clone flow green; README matches reality; smoke test or documented manual steps present.
