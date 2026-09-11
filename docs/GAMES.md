# Games — Playbook & Knowledge Base

How browser games in this monorepo are built, tested, and deployed. Every new
game should follow this flow so it lands on the shared GitHub Pages site
without breaking the others.

---

## Live games

| Game | Play URL | Source | Stack | Tests |
|---|---|---|---|---|
| Undead Driver | <https://vs4vijay.github.io/vibecoding/undead-driver/> | [`undead-driver/`](../undead-driver) | TypeScript, Vite, three.js | vitest (node env) |
| Tank Racer | <https://vs4vijay.github.io/vibecoding/tank-racer/> | [`tank-racer/`](../tank-racer) | TS strict · Vite 8 · three.js | bun test (pure logic) |
| Lugaru Combat | <https://vs4vijay.github.io/vibecoding/lugaru-combat/> | [`lugaru-combat/`](../lugaru-combat) | TypeScript, Vite, three.js, Rapier | vitest |
| Dave Dangerous | <https://vs4vijay.github.io/vibecoding/dave-dangerous/> | [`dave-dangerous/`](../dave-dangerous) | TS strict · Vite 5 | vitest |
| Bantam Brawler | <https://vs4vijay.github.io/vibecoding/bantam-brawler/> | [`bantam-brawler/`](../bantam-brawler) | TS strict · Vite 5 · Canvas2D · WebAudio | bun test (208) |

**In development** (not deployed yet; check each folder's README/AGENTS.md for
status): [`subway-surfers/`](../subway-surfers).

[`dustline/`](../dustline) is the registered exception: complete and playable,
but it needs its own WebSocket game server, so it can't ship as a static Pages
site — it gets a hub cabinet with a "Run locally" link instead of a Play URL.

Each game folder is self-contained: its own `package.json` + lockfile, its own
`AGENTS.md` (commands, invariants, gotchas), `README.md` (controls, quickstart,
"Play online" link), and usually a `.plan.md` (design spec + implementation
plan).

---

## Deployment architecture — read this first

**ONE workflow owns the whole site:**
[`.github/workflows/games-pages-deploy.yml`](../.github/workflows/games-pages-deploy.yml)

- It builds **every** game, stages each `dist/` under `site/<game-slug>/`,
  uploads one artifact, and deploys once.
- **Why one workflow:** each GitHub Pages deployment *replaces the entire
  site*. Two per-game workflows would clobber each other's URLs on every run.
  Never create a second workflow that deploys Pages — add your game to this
  one instead.
- Pages is enabled repo-wide with `build_type: workflow`, serving from
  `https://vs4vijay.github.io/vibecoding/`.
- **URL pattern:** `https://vs4vijay.github.io/vibecoding/<game-slug>/`
- **Site root** (`/`) is the games hub — a static landing page in
  [`games-hub/index.html`](../games-hub/index.html) (no build step; the
  workflow copies it to `site/`). Every deployed game gets a card there.
- Triggers: push to `main` touching any game's files, the hub, or the
  workflow itself, plus manual `workflow_dispatch`. New games **must** be
  added to the `paths:` filter or their pushes won't deploy.

### Base-path handling (two equivalent options)

| Option | How | Used by |
|---|---|---|
| Relative base (recommended) | `vite.config.ts`: `base: "./"` — emits `./assets/...`, works under any subpath, no env needed | undead-driver |
| `BASE_PATH` env | `vite.config.ts` reads `process.env.BASE_PATH`; CI sets `BASE_PATH=/vibecoding/<slug>/` | tank-racer |

Relative base is simpler; prefer it unless the game needs absolute URLs
(routers, service workers).

---

## Adding a new game — checklist

1. **Scaffold** `<game-slug>/` in the monorepo: bun + Vite + TypeScript
   strict. Keep deps minimal (`three` only if 3D). Zero binary assets —
   procedural visuals/audio keeps builds tiny and license-clean.
2. **`package.json` scripts:** `dev` / `build` / `preview` / `test` /
   `typecheck`. Make `build` gate on the compiler (`tsc && vite build` or
   `tsc --noEmit && vite build`).
3. **Config discipline:** all gameplay tunables in one config file
   (e.g. `src/config.ts`) — no magic numbers elsewhere.
4. **Tests:** pure-logic suites only (vitest node env or `bun test`). DOM
   behavior can't be unit-tested here — verify UI live with `playwright-cli`
   against a dedicated headless Chromium (background/cmux panes throttle rAF
   to zero: black screenshots, frozen sims). Console must be clean.
5. **Docs:** write the project `AGENTS.md` (commands, invariants, gotchas)
   and `README.md` (quickstart, controls table, "Play online" link once
   deployed). Design spec + task plan in `.plan.md`.
6. **Verify before commit:** full test suite + typecheck green, and a live
   browser pass with evidence for any rendering/UI change. Use bun only
   (never npm/npx/yarn), prefix commands with `rtk`, commit from repo root.
7. **Deploy** — edit `games-pages-deploy.yml`:
   - add a build step: `working-directory: <slug>` running
     `bun install --frozen-lockfile` + `bun run build`
   - add `cp -r <slug>/dist site/<slug>` to the "Stage site" step
   - add `<slug>/**` to `paths:`
8. **Verify the deploy:** `gh run watch <id>`, then `curl` the page URL and
   every referenced asset (expect HTTP 200 + correct `<title>`), and confirm
   the other games still return 200 (clobber detection).
9. **Register the game:** add a card to
   [`games-hub/index.html`](../games-hub/index.html) (match the existing
   card structure — inline SVG motif, accent colors, play URL), a row to the
   table at the top of this file, and to the Games section of the root
   `README.md`.

---

## Renaming a game — checklist

Rename a game folder, its brand, and its URLs in one sweep. This happened
twice (zombie-highway → undead-driver, lugaru-web → lugaru-combat); both
missed something on the first pass, so follow every line:

1. **Rename the folder + commit the move first**, on its own:
   `git mv <old-slug> <new-slug>` (or plain `mv` + `git add -A`). Do **not**
   push a bare delete followed by a later add — the shared workflow checks out
   each pushed commit, and a commit whose `working-directory: <old-slug>`
   no longer exists fails CI (`No such file or directory`) and breaks the
   whole site deploy.
2. **Update the workflow** (`.github/workflows/games-pages-deploy.yml`): the
   build step's `working-directory:`, the `cp -r <slug>/dist site/<slug>`
   line, and any `<old-slug>/**` entry in `paths:`. Same commit as the move.
3. **Update the hub card** in `games-hub/index.html`: the `<a class="play">`
   href, `aria-label`, motif SVG `aria-label`, and the cabinet class
   (`cab--<slug>`). The first rename **dropped the whole Undead card** from
   the hub without anyone noticing — diff the hub file across the rename
   commit and count cards.
4. **Update the game's own title** — `index.html` `<title>` (browser tab +
   share previews) and `package.json` `name`. Both renames shipped the old
   title on first pass.
5. **Update docs:** the live-games table in this file, the Games section of
   root `README.md`, and any cross-references elsewhere in the repo
   (`grep -r "<old-slug>" .` should return nothing).
6. **Verify end-to-end:** `gh run watch <id>`, then check the new play URL
   and the hub return 200 with the new `<title>` / card, and the old URL
   404s (it must — no redirect exists yet).

Keep the old `<old-slug>` URL broken deliberately — nothing should still
link to it. If you want continuity, add a redirect page under the old slug
(one static HTML + one `cp` + one `paths:` entry), but that's optional.

---

## Gotchas (each one cost someone time)

- **HTML breaks silently in CI.** The hub lost its `<header class="hero">`
  opening tag once (`45a1da62`); every build/deploy still passed because the
  hub has no build step — it's copied verbatim. The page just rendered
  unstyled. After any hub edit, check the structure live (browser, not
  curl): hero block present, correct number of cards, title centered. The
  curl "verify the deploy" step catches 404s, not CSS/HTML regressions.

- **Server-backed games can't ship on Pages.** dustline runs its own
  WebSocket game server (Bun + Hono), so no static `dist/` can represent it.
  Register it anyway — hub cabinet with a "Run locally" link, table row with a
  local-run entry — and don't add it to `games-pages-deploy.yml`.
- **One Pages site per repo.** `upload-pages-artifact` puts artifact contents
  at the site root — that's why builds are staged into `site/<slug>/`
  subdirectories. A bare `dist/` artifact breaks subpath asset URLs (404s).
- **Concurrent sessions commit to `main`.** Expect your push to carry other
  games' commits; never rewrite history / force-push (evidence artifacts like
  gameplay recordings live in history by design). Don't commit large binaries
  for new work — keep screenshots/recordings in `/tmp` or external storage.
- **three.js bundle size:** split it into its own vendor chunk (Vite 8 is
  rolldown-based — use `build.rolldownOptions.output.codeSplitting`, not the
  deprecated `manualChunks`) and raise `chunkSizeWarningLimit` to just above
  the vendor chunk size. See `undead-driver/vite.config.ts`.
- **Favicon 404:** the browser always requests it. Use an inline SVG data-URI
  `<link rel="icon">` — no asset files, no console errors.
- **HUD/menus layering:** keep toasts/coach/menus on separate DOM roots from
  the HUD so hiding one can't hide the others; check z-index layering on the
  game-over card (see undead-driver history).
- **Determinism:** seed RNGs per run (not per page load), or every run plays
  the same level. Obstacle/spawn cadence fixed in *distance* makes crash
  points quasi-deterministic even with random patterns — don't mistake that
  for a seeding bug.
- **Pages deploy lags the run success.** `gh run watch` green ≠ bytes live.
  The CDN edge can serve the previous deploy for a minute or two after
  "Deploy to GitHub Pages" completes — a single immediate check can
  false-negative on the exact fix you shipped. Retry with a cache-busting
  query (`?cb=<timestamp>`) before assuming the deploy failed.
