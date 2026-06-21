# 🏃 Subway Surfers Clone

A 3D endless runner game inspired by Subway Surfers, built with Three.js, Bun, Elysia, and PostgreSQL.

![Game Screenshot](https://img.shields.io/badge/Three.js-0.172-green) ![Bun](https://img.shields.io/badge/Bun-Latest-brightgreen) ![PWA](https://img.shields.io/badge/PWA-Ready-blue)

## Features

- **3D Endless Runner** - Three.js powered game with lane switching, jumping, and rolling
- **Procedural World** - Infinite track with randomized obstacles, coins, buildings, and power-ups
- **3 Lanes** - Dodge trains, jump barriers, roll under overheads
- **Collectibles** - Coins, magnet power-ups, jetpacks
- **Combo System** - Build multipliers with consecutive actions
- **Player Profiles** - Persistent stats via PostgreSQL + Drizzle ORM
- **Achievements** - 16 unlockable achievements (distance, coins, score, combos)
- **Leaderboard** - Global rankings by high score and total distance
- **Background Jobs** - Postgres LISTEN/NOTIFY with SKIP LOCKED for async processing
- **PWA** - Installable as a Progressive Web App with offline caching
- **Responsive** - Keyboard + touch/swipe controls for mobile

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Game Engine** | Three.js (WebGL) |
| **Backend** | Bun + Elysia |
| **Database** | PostgreSQL 17 |
| **ORM** | Drizzle ORM |
| **Validation** | Zod |
| **Jobs** | Postgres LISTEN/NOTIFY + SKIP LOCKED |
| **PWA** | Service Worker + Cache API |
| **Icons** | Procedurally generated PNG |

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

Navigate to **http://localhost:3001**

## Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move Left | `←` or `A` | Swipe Left |
| Move Right | `→` or `D` | Swipe Right |
| Jump | `↑` or `W` or `Space` | Swipe Up |
| Roll | `↓` or `S` | Swipe Down |

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

## Database Schema

```
players          → Player profiles (username, scores, coins)
runs             → Individual game runs with stats
achievements     → Achievement definitions (16 total)
player_achievements → Player-achievement unlocks
player_powerups  → Persistent power-up inventory
jobs             → Background job queue (LISTEN/NOTIFY)
```

## Project Structure

```
subway-surfers/
├── client/                  # Frontend files
│   ├── index.html           # Game HTML
│   ├── css/style.css        # UI styles
│   ├── js/
│   │   ├── game.js          # Three.js game engine
│   │   ├── pwa-register.js  # Service Worker registration
│   │   └── sw.js            # Service Worker (caching)
│   └── icons/               # PWA icons (generated)
├── src/
│   ├── config/
│   │   └── env.ts           # Zod-validated config
│   ├── db/
│   │   ├── database.ts      # Drizzle connection
│   │   ├── schema.ts        # Table definitions
│   │   ├── seed.ts          # Achievement seeder
│   │   └── migrations/      # SQL migrations
│   ├── api/routes/
│   │   ├── players.ts       # Player CRUD
│   │   ├── runs.ts          # Run tracking + job queuing
│   │   ├── leaderboard.ts   # Rankings
│   │   └── achievements.ts  # Achievement queries
│   ├── index.ts             # Elysia server
│   └── worker.ts            # Background job processor
├── docker-compose.yml       # PostgreSQL container
├── drizzle.config.ts        # Drizzle Kit config
├── .env.example             # Environment template
└── package.json
```

## Development Scripts

```bash
bun run dev              # Start server with watch mode
bun run start            # Start server (production)
bun run worker           # Run background job worker
bun run build            # Copy client files to dist/
bun drizzle-kit generate # Generate migration SQL
bun drizzle-kit push     # Push schema to database
bun drizzle-kit studio   # Open Drizzle Studio UI
bun src/db/seed.ts       # Seed achievements
```

## License

MIT
