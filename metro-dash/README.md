# 🚇 Metro Dash

A 3D endless runner — sprint down a subway track, dodge trains, vault barriers
and roll under signal gantries while the sky drifts from day to sunset to
night. Built with Three.js, Bun, Elysia, and PostgreSQL.

![Game Screenshot](https://img.shields.io/badge/Three.js-0.172-green) ![Bun](https://img.shields.io/badge/Bun-Latest-brightgreen) ![PWA](https://img.shields.io/badge/PWA-Ready-blue)

**Play online:** <https://vs4vijay.github.io/vibecoding/metro-dash/>
(static deploy; leaderboards need the optional API backend below)

> This is the full late-again build (modular engine + complete UI/UX pass),
> adopted from `projects/subway-surfers` and rebranded for the games hub.

## Features

- **3D Endless Runner** - Three.js powered game with lane switching, jumping, and rolling
- **Procedural World** - Infinite track with randomized obstacles, coins, buildings, and power-ups
- **3 Lanes** - Dodge subway cars, jump hazard barriers, roll under signal gantries
- **Animated Runner** - Procedural run cycle, jump tuck, roll tumble, lane-change lean, landing dust
- **Living Atmosphere** - Day → sunset → night sky ramp with lit building windows, billboard clouds
- **Touch-reachable pause** - On-screen pause (44×44 target) plus RESUME / RESTART / MENU actions
- **Safe resume** - A skippable ~1.2 s GET READY countdown on every unpause and tab return
- **Powerup HUD** - Magnet / ×2 chips with live drain bars (no fake chips for stub effects)
- **Results that contextualize** - Run TIME, gap-to-best, and a new-best celebration banner
- **Music & SFX toggles** - Separate persisted audio buses; master mute on top
- **First-run coaching** - One-time scheme-worded hints for lane/jump/roll, then never again
- **Scheme-aware hints** - Swipe/tap copy on touch devices, key copy on desktop, never mixed
- **Accessibility baseline** - Safe-area insets, visible focus, ≥44 px targets, reduced-motion kill
- **Screen-transition polish** - Token-driven fades that collapse to instant under `?freeze`
- **Combo System** - Build multipliers with consecutive actions
- **Player Profiles** - Persistent stats via PostgreSQL + Drizzle ORM (optional; the game falls back to local play)
- **Achievements** - 16 unlockable achievements (distance, coins, score, combos)
- **Leaderboard** - Global rankings by high score and total distance
- **Background Jobs** - Postgres LISTEN/NOTIFY with SKIP LOCKED for async processing
- **PWA** - Installable, fully offline (vendored Three.js, precached modules)
- **Deterministic QA** - 450+ headless checks, scripted acceptance walk, byte-identical `?freeze` captures

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Game Engine** | Three.js r172, vendored (WebGL, ES modules + importmap, no bundler) |
| **Backend** | Bun + Elysia (optional leaderboard API) |
| **Database** | PostgreSQL 17 |
| **ORM** | Drizzle ORM |
| **Validation** | Zod |
| **Jobs** | Postgres LISTEN/NOTIFY + SKIP LOCKED |
| **PWA** | Service Worker precache + Cache API |
| **QA** | Bun smoke suites + Playwright freeze captures |

## Quick Start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Copy and configure environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work for local dev)
```

### 3. Install dependencies

```bash
bun install
```

### 4. Push database schema & seed

```bash
bun drizzle-kit push
bun src/db/seed.ts
```

### 5. Build client files

```bash
bun run build
```

### 6. Start the server

```bash
bun run dev          # Development (watch mode)
bun run start        # Production
```

### 7. Start the job worker (optional)

```bash
bun run worker       # Runs in background, processes async jobs
```

### 8. Open in browser

Navigate to **http://localhost:37045**
(`37045` = METRO DASH in leetspeak: M**3**T**7**R**0** D**4**5**H)

The game also works with no database running — scores are kept locally.

## Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move Left | `←` or `A` | Swipe Left |
| Move Right | `→` or `D` | Swipe Right |
| Jump | `↑` or `W` or `Space` | Tap top half |
| Roll | `↓` or `S` | Tap bottom half |
| Pause / Resume | `Esc` or `P` | Pause button (bottom-left) |
| Skip resume countdown | `Esc` / `P` | Tap the countdown |
| Mute | `M` | Speaker button (bottom-right) |

## QA

```bash
bun run test:smoke             # wave2..wave6 + ui-ux headless suites (450+ checks)
bun .qa/ui-ux-acceptance.mjs   # scripted spec-by-spec acceptance walk
bun .qa/serve.mjs 8899         # static server for browser captures
bun .qa/shot.mjs "<url>" out.png   # deterministic ?freeze screenshot (needs playwright-core)
```

`?freeze=1&seed=N[&time=T][&screen=menu|pause|results]` renders settled,
byte-identical frames of any screen — the determinism guard for CI-style
comparisons (see `.qa/ui-ux-notes.md`).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/players/get-or-create` | Create or fetch player |
| `GET` | `/api/players/:id` | Get player profile + recent runs |
| `PATCH` | `/api/players/:id/stats` | Update player stats after run |
| `POST` | `/api/runs` | Save a completed run |
| `GET` | `/api/runs/player/:playerId` | Get player's runs (paginated) |
| `GET` | `/api/leaderboard/score` | Global leaderboard by high score |
| `GET` | `/api/leaderboard/distance` | Global leaderboard by distance |
| `GET` | `/api/leaderboard/rank/:playerId` | Get player's rank |
| `GET` | `/api/achievements` | List all achievements |
| `GET` | `/api/achievements/player/:playerId` | Player's unlocked achievements |
| `GET` | `/manifest.json` | PWA manifest |
