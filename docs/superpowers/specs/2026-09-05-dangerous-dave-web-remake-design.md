# Dangerous Dave Web Remake — Design Spec

> **Date:** 2026-09-05
> **Status:** Approved (all 7 sections)
> **Approach:** Plain Canvas 2D + TypeScript, zero framework dependencies

---

## 1. Clarifying Decisions

| Question | Decision |
|----------|----------|
| Fidelity level | **Faithful clone** — replicate original 10 levels + 4 bonus rooms, CGA palette, exact mechanics |
| Controls / target platform | **Desktop keyboard only** — arrow keys + Ctrl (jetpack) + Alt (fire) |
| First-milestone scope | **Small playable slice** — build core engine + Level 1 + bonus room, then expand |

---

## 2. Architecture

### High-Level Structure

```
src/
├── main.ts                 # Entry: canvas init, game loop, state machine
├── core/
│   ├── GameLoop.ts         # Fixed timestep (60 Hz), accumulator, interpolation
│   ├── Input.ts            # Keyboard buffer → action map
│   ├── AssetLoader.ts      # Image/audio/JSON loading with Promise.all + progress
│   ├── RNG.ts              # Seeded PRNG (deterministic enemy behavior)
│   └── Events.ts           # Typed event bus
├── entities/
│   ├── Dave.ts             # Player state machine, physics, animation, collision
│   ├── Enemy.ts            # Base + per-type subclasses
│   ├── Projectile.ts       # Bullet (player) + enemy projectiles
│   ├── Item.ts             # Collectibles
│   └── ExitDoor.ts         # Opens when trophy collected
├── world/
│   ├── TileMap.ts          # 2D array of tile IDs, collision masks, special tiles
│   ├── LevelData.ts        # JSON schema + parser for level files
│   └── Camera.ts           # Flip-screen camera
├── render/
│   ├── Renderer.ts         # Canvas 2D draw calls, integer scaling
│   ├── SpriteSheet.ts      # Frame atlas + animation definitions
│   ├── Palette.ts          # CGA 4-color mapping + CRT shader
│   └── DebugOverlay.ts     # Hitboxes, FPS, Dave state (toggle with backtick)
├── audio/
│   └── AudioEngine.ts      # Web Audio context, synthesized SFX
├── state/
│   ├── GameState.ts        # Lives, score, fuel, ammo, current level, high score
│   └── SaveState.ts        # localStorage persistence
└── levels/
    ├── 1.json .. 10.json   # Level definitions
    └── bonus.json          # Bonus room definitions
```

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Fixed timestep (60 Hz) | Deterministic physics, frame-perfect reproduction, easy debug/replay |
| Flip-screen camera | Original has no scrolling; each level = 1–N static screens |
| Lightweight entity-component | Dave/Enemy/Projectile share `update(dt)`, `render(ctx)`, `collidesWith(other)` |
| TileMap as source of truth | Collision, climbable, warp, illusory all encoded in tile metadata |
| Zero global mutable state | `GameState` object passed explicitly; testable, serializable |
| Asset manifest JSON | Single `assets.json` lists all images/audio/levels |

---

## 3. Components & Data Models

### Core Types (TypeScript)

```ts
// core/types.ts

// ───────────────── Input ─────────────────
type Action = "left" | "right" | "jump" | "jetpack" | "fire";
type InputState = Record<Action, boolean>;
type InputBuffer = Record<Action, number>;

// ───────────────── Physics ─────────────────
const PHYSICS = {
  GRAVITY: 0.45,
  MAX_FALL: 8,
  WALK_ACCEL: 0.35,
  WALK_DECEL: 0.85,
  WALK_MAX: 2.5,
  JUMP_VELOCITY: -7.2,
  JUMP_VARIABLE: true,
  JETPACK_THRUST: -0.38,
  JETPACK_FUEL_MAX: 60,
  BULLET_SPEED: 6,
} as const;

interface Vec2 { x: number; y: number; }
interface Rect { x: number; y: number; w: number; h: number; }

// ───────────────── TileMap ─────────────────
type TileId = number;
type TileFlags = {
  solid: boolean;
  climbable: boolean;
  lethal: boolean;
  warp: boolean;
  illusory: boolean;
  collectible?: ItemType;
};

interface TileDef { id: TileId; flags: TileFlags; src: Rect; }

interface ScreenMap {
  width: number;
  height: number;
  tiles: TileId[];
  entities: EntitySpawn[];
  warps?: WarpDef[];
}

interface LevelData {
  id: number;
  name: string;
  screens: ScreenMap[];
  startScreen: number;
  musicTrack?: string;
}

// ───────────────── Entities ─────────────────
type EntityType =
  | "dave" | "spider" | "blade" | "sun" | "baton"
  | "cloud" | "ufo" | "blobby" | "disc"
  | "bullet" | "enemyBullet"
  | "orb" | "blueDiamond" | "redDiamond" | "ring" | "crown" | "scepter" | "trophy"
  | "gun" | "jetpack" | "oneUp"
  | "exitDoor";

interface EntitySpawn {
  type: EntityType;
  x: number; y: number;
  props?: Record<string, unknown>;
}

interface Entity {
  id: number;
  type: EntityType;
  pos: Vec2;
  vel: Vec2;
  hitbox: Rect;
  state: EntityState;
  animation: AnimationState;
}

type EntityState =
  | { kind: "idle" }
  | { kind: "walk"; dir: -1 | 1 }
  | { kind: "jump"; rising: boolean }
  | { kind: "climb"; dir: -1 | 1 }
  | { kind: "jetpack"; fuel: number }
  | { kind: "shoot"; cooldown: number }
  | { kind: "dead"; timer: number }
  | { kind: "patrol"; range: [number, number]; dir: -1 | 1 }
  | { kind: "spin"; radius: number; angle: number; speed: number };

interface DaveState {
  lives: 1 | 2 | 3 | 4;
  score: number;
  jetpackFuel: number;
  hasGun: boolean;
  currentScreen: number;
  invincibleFrames: number;
}

// ───────────────── Rendering ─────────────────
interface SpriteFrame { src: Rect; duration: number; }
interface Animation { frames: SpriteFrame[]; loop: boolean; }
type Animations = Record<string, Animation>;

interface DrawCall {
  img: HTMLImageElement | OffscreenCanvas;
  src: Rect;
  dst: Rect;
  flipX?: boolean;
}
```

### Component Responsibilities

| Component | Owns | Key Methods |
|-----------|------|-------------|
| `Dave` | Player physics, state machine, animation, input response | `update(input, tileMap, entities)`, `render(ctx)`, `takeDamage()`, `collect(item)` |
| `Enemy` (base) | Patrol/spin AI, collision with tiles/bullets, death | `update(tileMap, dave, entities)`, `render(ctx)`, `onHit()` |
| `TileMap` | Tile lookup, collision query, special-tile behavior | `getTile(px, py)`, `testCollision(rect, flags)`, `isClimbable(px, py)`, `isLethal(px, py)` |
| `Renderer` | Draw call batching, sprite sheet slicing, integer scaling, palette | `begin()`, `draw(drawCall)`, `end()`, `setPalette(palette)` |
| `AudioEngine` | SFX pool, music loop | `play(sfxId)`, `setMusic(track)`, `toggleMute()` |
| `GameLoop` | Timestep, accumulator, interpolation alpha | `run(update, render)`, `stop()` |

---

## 4. Data Flow (Frame Pipeline)

### 60 Hz Fixed-Timestep Loop

```ts
const DT = 1 / 60;
const MAX_ACCUM = DT * 5;  // spiral-of-death guard

let accum = 0;
let last = performance.now();

function frame(now: number) {
  const delta = Math.min((now - last) / 1000, MAX_ACCUM);
  last = now;
  accum += delta;

  while (accum >= DT) {
    update(DT);
    accum -= DT;
  }

  const alpha = accum / DT;
  render(alpha);
  requestAnimationFrame(frame);
}
```

### Per-Tick `update(dt)` Order (Deterministic)

```
1. Input.read()                    → InputState (pressed this tick)
2. Dave.update(input, world)       → new pos/vel/state, emits events
3. Entities.update(world, dave)    → enemies, projectiles, items
4. Collision.resolve(all)          → tile vs entity, entity vs entity
5. World.update()                  → screen transitions, warp triggers, exit check
6. GameState.update()              → score, lives, fuel, level complete?
7. AudioEngine.update()            → update spatial/looping sounds
```

### Event Bus (Typed)

```ts
type GameEvent =
  | { type: "dave:collect"; item: ItemType; value: number }
  | { type: "dave:hurt"; source: "enemy" | "lethal" | "fall" }
  | { type: "dave:die" }
  | { type: "enemy:die"; enemy: Entity }
  | { type: "level:complete"; level: number; score: number }
  | { type: "level:warp"; fromScreen: number; toScreen: number }
  | { type: "gun:pickup" }
  | { type: "jetpack:pickup"; fuel: number }
  | { type: "oneup:pickup" };

const listeners = new Map<GameEvent["type"], Set<(e: GameEvent) => void>>();

export function on<T extends GameEvent["type"]>(type: T, fn: (e: Extract<GameEvent, {type: T}>) => void) { /* ... */ }
export function emit(e: GameEvent) { /* ... */ }
```

### Determinism Guarantees

| Property | How |
|----------|-----|
| Same seed → same playthrough | `RNG` seeded at level start; all AI uses it |
| Frame-perfect replay | Input buffer recorded per tick; `update` is pure given `(state, input, RNG)` |
| No frame-rate drift | Fixed `DT`; render interpolates, never simulates |
| Serializable state | `GameState` + `Entity[]` + `currentScreen` + `RNG` state = full snapshot |

---

## 5. Controls & Physics Detail

### Input Mapping (Desktop Keyboard)

| Key | Action | Notes |
|-----|--------|-------|
| `ArrowLeft` / `A` | Left | Hold to walk; release → decel |
| `ArrowRight` / `D` | Right | Hold to walk; release → decel |
| `ArrowUp` / `W` / `Space` | Jump | Variable height: hold = higher arc |
| `Control` (Left/Right) | Jetpack | Consumes fuel (60 units max); hold to hover |
| `Alt` (Left/Right) / `Shift` | Fire | One bullet on screen max; consumes gun pickup |

### Dave Physics

```ts
const PHYSICS = {
  WALK_ACCEL: 0.35,
  WALK_DECEL: 0.85,
  WALK_MAX: 2.5,
  GRAVITY: 0.45,
  MAX_FALL: 8,
  JUMP_VELOCITY: -7.2,
  JUMP_CUTOFF: 0.5,
  JETPACK_THRUST: -0.38,
  JETPACK_FUEL_PER_FRAME: 1/15,
  HITBOX: { x: 4, y: 2, w: 16, h: 30 },
  PUSHBACK: 2,
} as const;
```

### State Machine (Dave)

```
IDLE
  ├─ left/right → WALK
  ├─ jump → JUMP (rising=true)
  ├─ jetpack + fuel → JETPACK
  ├─ climbable tile + up → CLIMB
  └─ fire + gun → SHOOT (12-frame cooldown)

WALK
  ├─ no input → IDLE (decel)
  ├─ jump → JUMP
  ├─ jetpack + fuel → JETPACK
  ├─ climbable + up → CLIMB
  ├─ fire + gun → SHOOT
  └─ edge → fall → JUMP (rising=false)

JUMP
  ├─ rising + release jump → vy *= JUMP_CUTOFF
  ├─ vy ≥ 0 → rising=false
  ├─ jetpack + fuel → JETPACK
  ├─ climbable + up (at apex) → CLIMB
  ├─ land on solid → IDLE or WALK (per input)
  └─ hit lethal → HURT

JETPACK
  ├─ release jetpack / no fuel → JUMP (rising=false)
  ├─ left/right → horizontal accel
  ├─ up/down → vertical thrust
  └─ fuel=0 → JUMP

CLIMB
  ├─ up/down → move on climbable tiles only
  ├─ left/right off climbable → JUMP
  ├─ release up → IDLE or JUMP
  └─ fire + gun → SHOOT

SHOOT (12-frame cooldown) → returns to previous state
HURT (60 invincible frames) → lose life, respawn → GAME_OVER if lives=0
DEAD (60-frame animation) → GAME_OVER or respawn
```

### Collision Resolution Order

1. **Horizontal** — `pos.x += vel.x`; test tile collision; if solid → `pos.x = tileEdge`, `vel.x = 0`
2. **Vertical** — `pos.y += vel.y`; test tile collision; if solid → `pos.y = tileEdge`, `vel.y = 0`
3. **Lethal tiles** — overlap → `HURT` event
4. **Climbable** — tested during `CLIMB` state; allows vertical movement inside tile
5. **Entity vs Entity** — Dave vs enemies/projectiles/items (AABB)
6. **Warps** — screen edge + warp flag → `level:warp` event

### Enemy AI Patterns

| Enemy | Pattern | Notes |
|-------|---------|-------|
| Spider | Patrol horizontal; shoots web projectile | Slow arc down |
| Purple Blade | Patrol; shoots straight horizontal | Fast projectile |
| Red Sun | Spin around center; shoots radial | Predictable orbit |
| Green Baton | Patrol vertical; shoots horizontal | |
| Cloud | Float horizontal; drops lightning vertically | Warning flash |
| Brown UFO | Figure-8 path; shoots aimed at Dave | Leads target slightly |
| Green Blobby | Hop patrol; contact damage | No projectile |
| Grey Disc | Spin + patrol; contact damage | |

---

## 6. Rendering & Visuals

### Canvas Setup

```ts
const LOGICAL_W = 320;
const LOGICAL_H = 200;
const SCALE = 3;  // 960×600; user-configurable 2–5×

const canvas = document.createElement("canvas");
canvas.width = LOGICAL_W * SCALE;
canvas.height = LOGICAL_H * SCALE;
canvas.style.imageRendering = "pixelated";
```

### Sprite Sheet Pipeline

```
assets/
├── sprites.png           # single atlas: Dave, enemies, items, tiles, UI
├── sprites.json          # frame definitions
└── tiles.json            # tile ID → {srcRect, flags}
```

### CGA Palette

```ts
const CGA_PALETTE_0 = [0x000000, 0x00AA00, 0xAA00AA, 0xAAAAAA] as const;  // green/magenta/cyan/white
const CGA_PALETTE_1 = [0x000000, 0xAA0000, 0x00AAAA, 0xFFFFFF] as const;  // red/cyan/white
```

### CRT Shader (Optional WebGL Fragment Shader)

Quantizes to 4-color CGA palette, adds scanlines, vignette. Toggle: `C` key cycles **Off → Palette 0 + Scanlines → Palette 1 + Scanlines → Palette 0 Only → Palette 1 Only**

### Render Pass Order

1. Clear
2. Background tiles
3. Entities (interpolated positions)
4. Foreground tiles (illusory platforms)
5. HUD (lives, score, fuel bar, gun icon)
6. Debug overlay (if enabled)
7. CRT shader pass (if enabled)

### Visual Polish

| Feature | Implementation |
|---------|----------------|
| Screen shake | On hurt/death: `cameraOffset += randVec2() * intensity` for 8 frames |
| Collectible sparkle | 4-frame animation at pickup pos |
| Bullet muzzle flash | 1-frame white square at gun tip |
| Jetpack flame | 3-frame loop at Dave's feet while thrusting |
| Death animation | Dave spins + falls off screen (60 frames) |
| Level transition | Fade to black (16 frames) → load next → fade in |

---

## 7. Audio

### Web Audio Engine

```ts
class AudioEngine {
  private ctx: AudioContext;
  private buffers: Map<string, AudioBuffer> = new Map();
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode;
  private sfxGain: GainNode;
  private muted = false;

  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.ctx.destination);
  }

  async load(manifest: { [key: string]: string }) { /* fetch + decodeAudioData */ }

  playSfx(id: string, opts?: { volume?: number; rate?: number; loop?: boolean }) {
    if (this.muted) return;
    const buf = this.buffers.get(id); if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts?.rate ?? 1;
    src.loop = opts?.loop ?? false;
    const gain = this.ctx.createGain();
    gain.gain.value = opts?.volume ?? 1;
    src.connect(gain).connect(this.sfxGain);
    src.start(0);
    return src;
  }

  playMusic(id: string, opts?: { volume?: number; loop?: boolean }) {
    if (this.musicSource) this.musicSource.stop();
    const buf = this.buffers.get(id); if (!buf) return;
    this.musicSource = this.ctx.createBufferSource();
    this.musicSource.buffer = buf;
    this.musicSource.loop = opts?.loop ?? true;
    this.musicSource.connect(this.musicGain);
    this.musicGain.gain.value = opts?.volume ?? 0.5;
    this.musicSource.start(0);
  }

  toggleMute() { this.muted = !this.muted; this.sfxGain.gain.value = this.muted ? 0 : 1; }
}
```

### SFX Design (PC Speaker Style — Synthesized, No Samples)

| SFX | Synthesis | Params |
|-----|-----------|--------|
| Jump | Square wave, pitch sweep down | 440→220 Hz, 80ms, 0.15 gain |
| Land | Noise burst + low square | 150 Hz square + white noise, 40ms |
| Shoot | Square, quick decay | 880 Hz, 30ms, exponential decay |
| Collect (orb/diamond) | Triangle, ascending arpeggio | 523→659→784 Hz, 120ms |
| Collect (trophy) | Major chord arpeggio | 523→659→784→1047 Hz, 300ms |
| Hurt | Dissonant cluster + noise | 200+300+400 Hz + noise, 200ms |
| Death | Descending glissando | 880→110 Hz, 800ms, square |
| Jetpack | Low square + noise (loop) | 110 Hz square + filtered noise, 0.08 gain |
| Door open | Rising fifth | 220→330 Hz, 200ms |
| Warp | Quick pitch oscillation | 440↔880 Hz ×4, 150ms |
| 1-up | Happy fanfare | C-E-G-C5, 400ms |

**Why synthesized?** Zero asset size, perfectly frame-synced, authentic DOS PC speaker feel, easy to tweak.

### Music

Original Dangerous Dave has **no background music**. Decision: no music by default. Optional "remastered" toggle adds a chiptune loop for modern players. Controlled via `M` key.

---

## 8. Testing & Dev Tools

### In-Game Debug Overlay (Toggle: backtick `)

```
┌─────────────────────────────────────────────────────────┐
│ FPS: 60.0  Frame: 12,347  DT: 16.67ms  Accum: 0.00ms   │
│ Dave: pos(156.3, 89.0) vel(0.0, 0.45) state: WALK      │
│       grounded: true  fuel: 60/60  gun: yes  lives: 3  │
│ Screen: 0/3  Entities: 12  Collisions: 3/frame         │
│ Input: ← → ↑ (jump held: 4 frames)                      │
│ RNG seed: 0x7F3A2B1C  Next: 0x8E4D3C2F                  │
│ [H] Hitboxes  [G] Tile Grid  [P] Pause  [R] Restart    │
└─────────────────────────────────────────────────────────┘
```

### Automated Tests (Vitest + Bun)

```ts
test("jump arc matches original height", () => {
  const frames = simulateDave({ input: { jump: true }, frames: 30 });
  const maxHeight = Math.min(...frames.map(f => f.pos.y));
  expect(maxHeight).toBeCloseTo(-48, 1);
});

test("variable jump cutoff reduces height", () => {
  const full = simulateDave({ input: { jump: true }, frames: 30 });
  const cut = simulateDave({ input: { jump: true, jumpRelease: 8 }, frames: 30 });
  expect(cut.maxHeight).toBeGreaterThan(full.maxHeight);
});

test("jetpack fuel drains at correct rate", () => {
  const frames = simulateDave({ input: { jetpack: true }, frames: 900 });
  expect(frames[899].fuel).toBeCloseTo(0, 0);
});

test("Same seed + same input = identical state", () => {
  const seed = 0xDEADBEEF;
  const input = generateInputSequence(1000);
  const run1 = runLevel(1, seed, input);
  const run2 = runLevel(1, seed, input);
  expect(run1.finalState).toEqual(run2.finalState);
  expect(run1.rngState).toEqual(run2.rngState);
});
```

### Dev Workflow

| Command | Purpose |
|---------|---------|
| `bun run dev` | Vite dev server + HMR, `localhost:5173` |
| `bun run test` | Vitest watch mode |
| `bun run test:ci` | Vitest single run (CI) |
| `bun run build` | `bun build` → `dist/` (single HTML + JS + assets) |
| `bun run preview` | Serve `dist/` for final verification |

### Level Authoring

```json
{
  "id": 1,
  "name": "Level 1",
  "startScreen": 0,
  "screens": [
    {
      "width": 20,
      "height": 13,
      "tiles": [0,0,1,1,0,...],
      "entities": [
        {"type":"dave","x":2,"y":11},
        {"type":"spider","x":15,"y":10,"props":{"patrol":[12,18]}},
        {"type":"orb","x":5,"y":9},
        {"type":"trophy","x":18,"y":2},
        {"type":"exitDoor","x":19,"y":2}
      ],
      "warps": []
    }
  ]
}
```

### CI/CD (GitHub Actions)

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run test:ci
      - run: bun run build
```

---

## Spec Self-Review

| Check | Status |
|-------|--------|
| Placeholder scan | No TBD/TODO/incomplete sections |
| Internal consistency | Architecture matches feature descriptions; all components referenced in data flow |
| Scope check | Focused on first milestone (1-3 levels); expansion path documented |
| Ambiguity check | All requirements explicit: exact controls, physics constants, state transitions |

---

## Next Steps

Per the brainstorming skill: this spec is now ready for user review. After approval, invoke the `writing-plans` skill to create a detailed implementation plan.
