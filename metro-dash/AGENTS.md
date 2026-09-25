# AGENTS.md — Metro Dash

## Commands

```bash
bun run build   # stage client/ → dist/ (pure copy, no bundler)
bun run dev     # Elysia server, serves dist/ + optional leaderboard API (PORT in .env, default 37045)
bun install     # deps; CI installs with --frozen-lockfile
```

Live browser verification: build, then drive the game at `http://localhost:37045`
with `playwright-cli` (`open --browser chromium` — no Chrome channel installed).
Console must be clean; the only ignorable error is `POST /api/players/*` 500
when Postgres is down — the client catches it and plays locally.

## Invariants

- **Client paths are RELATIVE** (`css/style.css`, `js/game.js`, `sw.js`,
  `../fonts/…` in CSS, relative SW cache entries). The game is deployed to
  GitHub Pages under `/vibecoding/metro-dash/`; absolute `/…` paths break there.
  Same convention as `neon-rush` (no bundler, subpath-safe by design).
- **Port 37045 = METRO DASH leetspeak** (M**3**T**7**R**0** D**4**5**H).
  Configured in `.env` / `.env.example` / `src/config/env.ts` default.
- **Service worker**: lives at `client/sw.js` (repo-root scope), network-first
  for same-origin GETs, cache-first only for the cross-origin three.js CDN.
  Cache name **must be bumped whenever any client asset changes content**
  (`metro-dash-v<N>`), otherwise installs go stale.
- **Collision semantics are gameplay**: obstacle hitboxes (train group bounds,
  barrier group, gantry beam at y>2.5 with the roll-under exception) and the
  player rig's AABB (standing top ≈2.45, roll ≤1.2) were verified equivalent to
  the original box implementation. Changing visuals must not change bounds.
- **Lane → world mapping**: camera looks down +z from behind the player, so
  world +x renders on screen-left; lane +1 (ArrowRight/swipe right) maps to
  world −x via `targetX = -targetLane * LANE_WIDTH`. Do not "fix" the sign.
- **Atmosphere is a pure function of distance** (`visual/atmosphere.js`,
  day→sunset 0–1500m, sunset→night 1500–3000m, night held; thresholds are the
  `RAMP` constants). Same distance must always render the same sky.
- **No new network origins**: same-origin + the pinned jsdelivr three.js 0.172
  importmap only. Fonts are bundled locally (`client/fonts/`, OFL).

## Gotchas

- The Elysia static plugin caches file Content-Length at startup: after
  editing `client/index.html`, a server restart is required or `GET /` serves
  the file truncated to the old length.
- After client edits: `bun run build`, then force-fresh load (SW v5 is
  network-first for same-origin, so a plain reload suffices once v5 controls
  the page).
- Playwright screenshots have multi-second latency — use a page-side rAF
  capture hook (canvas `toDataURL` inside the game's rAF tick) for
  frame-exact evidence.
- `bun.lock` keeps the old root package name (`subway-surfers`) after the
  rename; `bun install --frozen-lockfile` still passes — leave it.
