# CS Clone - Browser-Based Counter-Strike Clone

A multiplayer first-person shooter built for the browser using Three.js, Bun, and PGLite.

## Tech Stack

- **Client**: Vite + TypeScript + Three.js (PWA)
- **Server**: Bun + Hono + WebSocket + Drizzle ORM + PGLite
- **Database**: PGLite (in-memory Postgres, swappable to real Postgres)
- **Protocol**: WebSocket (server-authoritative)

## Architecture

```
cs-clone/
├── packages/
│   ├── shared/        # Shared types, constants, messages
│   ├── server/        # Game server (WebSocket, game loop, database)
│   └── client/        # Browser FPS client (Three.js renderer, PWA)
├── .env.example       # Environment variables template
├── package.json       # Workspace root
└── README.md
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (1.0+)
- Node.js 20+ (for Vite dev server)

### Installation

```bash
# Clone the repo
cd cs-clone

# Install dependencies
bun install

# Copy environment variables
cp .env.example .env
```

### Development

```bash
# Start both server and client (dev mode)
bun run dev

# Or run separately:
bun run --filter server dev    # Server: http://localhost:3000, ws://localhost:3000/ws
bun run --filter client dev    # Client: http://localhost:5173
```

### Database

The server uses PGLite (in-memory Postgres) by default. For persistent storage, update `packages/server/src/db/index.ts`:

```typescript
// Persistent storage
export const client = new PGlite('./data/cs-db');
```

### Production Build

```bash
# Build both packages
bun run build

# Start production server
bun run start
```

## Game Controls

| Key | Action |
|-----|--------|
| W/A/S/D | Move |
| Mouse | Look (after clicking to lock) |
| Left Click | Fire |
| R | Reload / Respawn (when dead) |
| 1 | Primary weapon (AK-47) |
| 2 | Secondary weapon (Glock) |
| Space | Jump |
| Shift | Walk (sneak) |
| Tab | Scoreboard |

## Game Features

- 🎮 Multiplayer (up to 16 players)
- 🗺️ CS-inspired map (de_dust)
- 🔫 Two weapons (AK-47, Glock)
- ❤️ Health + Armor system
- 💀 Respawn system
- 📊 Scoreboard (Tab)
- 🗺️ Minimap
- ⏱️ Match timer
- 🎯 Kill feed
- 📱 PWA support (installable)

## Database Schema

```sql
-- Players (persistent stats)
players: id, username, total_kills, total_deaths, total_matches, wins, losses, headshots, shots_fired, shots_hit, damage_dealt, kd_ratio

-- Matches
matches: id, match_uuid, map_name, status, t_score, ct_score, winner, started_at, ended_at

-- Match Players (per-match stats)
match_players: id, match_id, player_id, team, kills, deaths, assists, headshots, shots_fired, shots_hit, damage_dealt, score

-- Kill Log
kills: id, match_id, killer_id, victim_id, weapon, headshot, created_at
```

## Network Protocol

### Client → Server

| Message | Description |
|---------|-------------|
| `join` | Join game with username and team |
| `input` | Send movement/fire input (60Hz) |
| `respawn` | Respawn after death |
| `switchTeam` | Change team |

### Server → Client

| Message | Description |
|---------|-------------|
| `snapshot` | Full game state (30Hz) |
| `joined` | Confirmation of joining + initial state |
| `playerJoined` | New player connected |
| `playerLeft` | Player disconnected |
| `kill` | Player killed another |
| `death` | You were killed |
| `matchStart` | Match started |
| `matchEnd` | Match ended with scores |

## Extending

### Adding Weapons

Edit `packages/shared/src/constants.ts` → `WEAPONS` object.

### Adding Maps

Edit `packages/shared/src/constants.ts` → `DEFAULT_MAP` object with spawn points and entities.

### Adding DB Queries

Use Drizzle ORM in `packages/server/src/db/` with the schema from `schema.ts`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_PORT` | Server HTTP port | `3000` |
| `SERVER_HOST` | Server bind address | `0.0.0.0` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | Database path | `:memory:` |
| `MAX_PLAYERS` | Max players per server | `16` |
| `TICK_RATE` | Server tick rate (Hz) | `60` |
| `MATCH_DURATION_MS` | Match duration | `120000` |
| `WARMUP_DURATION_MS` | Warmup duration | `30000` |

## Known Issues & TODO

- [ ] Client-side prediction and server reconciliation
- [ ] Lag compensation
- [ ] Better player models (skins, animations)
- [ ] Sound effects
- [ ] More maps
- [ ] Matchmaking system
- [ ] Persistent leaderboard
- [ ] Anti-cheat measures
- [ ] Voice chat
- [ ] Grenade/weapon attachments
- [ ] Bomb defusal mode
- [ ] Spectator mode
