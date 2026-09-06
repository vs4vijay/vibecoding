# AGENTS.md — Dustline (`dustline/`)

Browser-based, Counter-Strike-inspired multiplayer FPS (formerly `cs-clone`).
Bun workspace: Three.js client (Vite + PWA) · Bun + Hono + WebSocket server ·
Drizzle ORM + PGLite. Zero image/audio assets — the map is procedural geometry,
all sound is WebAudio synthesis. Server-hosted: this game does NOT deploy to
GitHub Pages (see the registration note in `docs/GAMES.md`).

## Commands

All from this folder (`dustline/`):

```sh
bun install                          # bun ONLY — never npm/npx/yarn/pnpm
bun run dev                          # shared build once, then server :3000 + client :5173 + shared watch
bun run test                         # bun test test.e2e.test.ts (spawns a REAL server on port 3099)
bun run build                        # shared → client → server, IN THAT ORDER (shared's dist/ must exist first)
bun run start                        # production server; needs NODE_ENV=production to also serve the built client
bun run --filter @dustline/server db:generate   # drizzle-kit generate
bun run --filter @dustline/server db:migrate    # raw-DDL schema ensure (idempotent)
```

Prefix shell commands with `rtk` per repo convention (`rtk bun test`, `rtk git …`).
Commit from the **repo root** (`vibecoding/`), not this folder.

## Layout

```
packages/
  shared/            types, wire messages, ALL gameplay constants (tick rate, weapons, map, lag-comp)
  server/src/
    index.ts         Hono app: /health, /leaderboard, static serving (NODE_ENV=production), ws upgrade
    game/engine.ts   60 Hz fixed tick, match state machine, bullets, history recording
    game/player.ts   player state, input processing, stats
    game/collision.ts  axis-separated AABB resolution + ground probe
    game/lagcomp.ts  PositionHistory ring buffer + rewind-tick selection
    game/rtt.ts      RTT EWMA from app-level ping/pong (server-measured, clamped)
    game/weapon.ts   fire rate, ammo, raycast hit resolution (optional rewound targets)
    websocket/connection.ts  per-connection ws lifecycle, tick loop, ping timer, message routing
    db/              drizzle schema, idempotent ensureSchema, repository (all DB writes)
    leaderboard.ts   side-effect-free GET /leaderboard route module
  client/src/
    main.ts          boot
    game.ts          render loop, input, camera, HUD wiring, scoreboard, events
    network.ts       ws client, message dispatcher, RTT pong reply
    prediction.ts    PURE predictor: input queue, reconciliation, eased corrections (DOM-free)
    movement.ts      client mirror of server movement+collision — MUST stay byte-identical (see Invariants)
    timestep.ts      fixed-timestep input accumulator (60 Hz regardless of display refresh rate)
    audio.ts         procedural WebAudio (lazy context, injectable factory + storage)
    ui.ts            HUD helpers, leaderboard panel, escapeHtml
test.e2e.test.ts     root-level e2e: spawns the real server (port 3099), drives it over WebSocket
```

## Invariants (breaking any of these is a bug)

1. **Server-authoritative, always.** The server is the sole authority for
   health, damage, hits, scores, and other players' positions. Client
   prediction only renders outcomes sooner — it never decides them.
2. **Client/server movement parity is load-bearing.** `client/src/movement.ts`
   must mirror `server/src/game/player.ts` + `collision.ts` operation-for-
   operation, in the same order. `movement-parity.test.ts` asserts bit-identity
   over a scripted run — any collision/movement change lands on BOTH sides in
   the same commit, or the suite breaks on purpose.
3. **Zero new runtime dependencies; zero asset files.** Procedural everything;
   the client's PWA precache set must not grow.
4. **Constants are single-sourced** in `@dustline/shared` (`TICK_INTERVAL_MS`,
   `HISTORY_TICKS`, `CORRECTION_LERP_MS`, `LAG_COMP_INTERP_MS`, weapons, map).
   Never restate a tuning value on the other side of the wire.
5. **`rttMs` is server-internal.** Never export it in snapshots; RTT comes only
   from the echoed-timestamp ping/pong round trip (samples clamped to
   [0, 400] ms — the cap is anti-abuse, not a bug).
6. **DB writes never break the game loop.** All persistence is best-effort:
   swallow + log (`[persistence]` tag), fire-and-forget from tick/ws paths.
7. **Lag-comp rewind margin assumes no client interpolation.** The client snaps
   remote players to each 30 Hz snapshot; `LAG_COMP_INTERP_MS = TICK_INTERVAL_MS`
   models the average age of the newest rendered snapshot. If you add client-side
   remote interpolation, revisit that constant in the same change.

## Gotchas (each one cost someone time)

- **Build order matters:** `@dustline/shared` resolves via `dist/`, so a fresh
  clone must build shared before server/client — `bun run build` and `bun run dev`
  at the workspace root already do this. Bypassing them hits
  "Cannot find module '@dustline/shared'".
- **`bun run start` serves the client only with `NODE_ENV=production`** (static
  serving is gated on it). Dev mode uses Vite :5173 + the server's :3000, wired
  by the Vite proxy (`/leaderboard`, `/api`).
- **The runtime DB is in-memory** (`new PGlite()`); data resets on restart.
  `DATABASE_URL` feeds drizzle-kit migrations, not the running server — swap
  `db/index.ts` to a file path to persist.
- **`bun test` spawns a real server** on port 3099 (and the readiness wait
  polls `/health`); don't run two test invocations concurrently.
- **Test files are excluded from tsc** in both client and server tsconfigs (bun
  discovers and runs them; they'd otherwise double-run via dist). They are not
  type-checked by the build.
- **Usernames are user-controlled input:** escape them for any innerHTML
  (`ui.ts` `escapeHtml`); prefer `textContent` (kill feed, death screen).
- **Concurrent sessions commit to main.** Never force-push; expect your push to
  carry other games' commits.

## Status

v1 complete (prediction, RTT-aware lag compensation, procedural audio,
persistent leaderboard, fixed-timestep input). Roadmap lives in `README.md`.
