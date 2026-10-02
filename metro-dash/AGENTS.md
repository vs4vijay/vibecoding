# AGENTS.md — Metro Dash

## Commands

```bash
bun run build       # stage client/ → dist/ (pure copy, no bundler)
bun run dev         # Elysia server, serves dist/ + leaderboard API (PORT in .env, default 37045)
bun install         # deps; CI installs with --frozen-lockfile
bun run test:smoke  # headless QA: .qa/wave2..wave6 + .qa/ui-ux-smoke.mjs (bun only, no browser)
bun .qa/ui-ux-acceptance.mjs   # spec-by-spec acceptance walk (22 scenarios)
bun .qa/serve.mjs 8899         # static server for browser captures (sends Service-Worker-Allowed)
```

Browser captures: `bun .qa/shot.mjs "<url>" out.png` (playwright-core; main-agent
tool — sub-agents work headless). Frozen screens:
`?freeze=1&seed=N[&time=T][&screen=menu|pause|results]`; pairs must stay
byte-identical (see `.qa/ui-ux-notes.md`).

## Provenance

Adopted from `projects/subway-surfers` (game name there: "Late Again") —
modular engine (`client/js/src/**`, ~30 ES modules) + the full ui-ux-pass
OpenSpec change (recorded in `openspec/changes/ui-ux-pass/`). Rebrand surface:
title/meta, manifest, package name, SW cache name, server banner. The
`late_again_*` localStorage keys are shared with the upstream build on purpose
(invisible to players; changing them would wipe saves for no benefit).

## Invariants

- **Client paths are RELATIVE** (`css/style.css`, `js/game.js`, `sw.js`,
  `"./js/src/…"` SW precache entries, `./vendor/three/…` importmap). The game
  deploys to GitHub Pages under `/vibecoding/metro-dash/`; absolute `/…`
  paths break there. Same convention as `neon-rush` (no bundler,
  subpath-safe by design).
- **Port 37045 = METRO DASH leetspeak** (M**3**T**7**R**0** D**4**5**H).
  Configured in `.env` / `.env.example` / `src/config/env.ts` default.
- **Service worker**: `client/sw.js` (game root, so the relative `register("sw.js")` scope covers the whole game) precaches every client asset (relative
  paths), cache-first with an activiation-time old-cache sweep. Cache name
  **must be bumped whenever any client asset changes content**
  (`metro-dash-v<N>`, currently v6), or installed PWAs go stale.
- **Three.js is vendored** (`client/vendor/three/`): the site must keep ZERO
  external network origins (no CDNs, no webfonts — system fonts only). The
  ui-ux smoke asserts this.
- **Lane → screen mapping**: the chase rig runs toward +Z looking +Z, so in
  right-handed Three.js screen-right = world −X. Input semantics are
  screen-space: "right" → lane −1, "left" → lane +1 (`run.js _applyAction`).
  wave3's direction check pins this — do not "fix" the sign.
- **`?freeze` determinism**: every captured frame must be byte-identical per
  seed. All animation needs a `.qa-freeze`/reduced-motion kill path; HUD
  writes are cached-DOM, transform/opacity-only; the grace countdown and
  shown results duration are pinned under freeze. If a new capture pair
  diffs, fix the code, not the test.
- **Collision semantics are gameplay**: hitbox/AABB code in `game/run.js` +
  `entities/` is tuned and pinned by the wave3/wave4 sim smokes. Changing
  bounds without rerunning `bun run test:smoke` is a gameplay change.

## Gotchas

- The Elysia static plugin caches file metadata at startup: after editing
  `client/`, restart `bun run dev` or rebuild (`bun run build`).
- After client edits: `bun run build`; the SW is cache-first, so a plain
  reload serves the old cache until CACHE_NAME is bumped — bump it whenever
  you change any client file.
- Playwright screenshots have multi-second latency — `?freeze` +
  `window.__QA.screenshotReady` (already wired in `shot.mjs`) is the
  deterministic path.
