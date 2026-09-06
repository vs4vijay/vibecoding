# Game Catalog — Vibecoding Arcade

A curated list of classic 90s-inspired games worth building as pure-client,
zero-asset, keyboard-first browser games. Every entry must be feasible under
the Vibecoding Arcade brand: procedural visuals, no binary assets, deterministic
sim, testable pure logic, one self-contained Vite project, deployable to the
shared GitHub Pages workflow.

Status: 🟢 ready to build · 🟡 scoped but needs design · 🔴 good idea, heavy scope

---

## Existing (deployed)

| Game | Genre | URL |
|---|---|---|
| Undead Driver | Endless driving-shooter | `/undead-driver/` |
| Tank Racer | 3D tank race + combat | `/tank-racer/` |
| Lugaru Combat | 3D arena brawler | `/lugaru-combat/` |
| Dave Dangerous | 2D platformer | `/dave-dangerous/` |

**In development:** Dustline (server-backed FPS, needs WebSocket — run locally).

**Genre gaps to fill:** puzzle, maze-chase, breakout/arcade, artillery, dig/miner,
tube/radial shooter, rogue-like, stealth, roguelite descent.

---

## 🟢 Strong candidates — buildable now

### 1. Thermal Dive (Steamworld Dig / Motherload homage)

**What:** Dig straight down through procedural crust. WASD steers the drill;
heat builds with depth and friction-duration; oxygen is a soft clock; fuel a
hard economy. Seeded crust per run → daily-seed leaderboard. Juicy: screen
shake, crust crack propagation, near-melt "heat-bounce" risk-play.

**Why it fits:** Procedural strata are trivially seeded. Heat/O2/fuel are pure
functions → fully unit-testable. Zero assets: canvas draw rectangles + particles.
Genre absent from the hub (digging/descent).

**Controls:** WASD steer, space to vent heat, shift to boost. Touch: virtual stick + 2 buttons.

**Original reference:** Steamworld Dig (2013), Motherload (2004), Burrito Bison.

**Key risk:** Too many meters (heat + O2 + fuel) can stall a run into hesitation; cap
at two simultaneous pressures (O2 regenerates, heat is the real threat).

**Complexity:** 🟢 low — tile grid, pure-function sim, no physics engine needed.

---

### 2. Race Your Own Ghost (inspired by Time Trials)

**What:** Lap racer where lap N's ghost becomes solid collision on lap N+1.
First lap defines your track; perfect lap = clean racing line; messy lap = you
must thread your own mistakes live. Content is 100% player-generated — trivially
zero-asset, no seed infrastructure, no AI needed. Small enough to be one
weekend file; big enough to be conversation-bait.

**Why it fits:** Most novel idea in the catalog. Your past self IS the level.
Fully deterministic (replay = ghost data). Unit test: replay + collision overlay.

**Controls:** WASD/arrows drive, space drift.

**Original reference:** Time Trials (various racing games), Trackmania ghost system,
Snake's own-tail mechanic.

**Key risk:** Self-trap frustration; mitigation: ghost collision is silhouette-only,
1s rewind refund if you die to your own ghost.

**Complexity:** 🟢 low — store per-frame (t, x, y, θ) strips; collision is
point-in-recorded-polyline within margin. That's the whole game.

---

### 3. Boulder Dash (1984 classic — dig, collect, avoid)

**What:** Dig through dirt, collect all gems, avoid falling boulders. Dig a
column of dirt and a boulder above it falls on your head. Enemies patrol
procedural cave layouts. Levels are tile grids; every action has visible
cause-and-effect.

**Why it fits:** The original 90s kid game. Pure tile logic → trivially
deterministic and unit-testable. Procedural levels from seeded cave generators.
Zero assets: tile-based canvas drawing (dirt, rock, gem, enemy, player — all
colored rectangles or simple shapes).

**Controls:** Arrow keys move, one key dig. Touch: swipe to move.

**Original reference:** Boulder Dash (1984, First Star Software), Repton (1985).

**Key risk:** Boulder-falling logic edge cases (chain falls, edge-of-grid); standard
tile-physics implementation, no real gotchas.

**Complexity:** 🟢 low — pure tile grid, no physics, no animation beyond movement.

---

### 4. Lode Runner (1983 classic — dig, trap, climb)

**What:** Side-view tile platformer where you dig holes to trap patrolling
enemies, then climb ladders and ropes to collect all gold. Enemies re-emerge
after a few turns and walk through dirt. Every level is a puzzle: timing +
positioning.

**Why it fits:** Procedural levels from tile generators. Digging/trapping is
pure tile logic. AI enemies are simple patrol + pathfind on tile graph.
Zero assets: colored rectangles for tiles, characters.

**Controls:** Arrow keys move, one key dig. Touch: swipe to move.

**Original reference:** Lode Runner (1983, Broderbund), Lode Runner: The Legend
Returns (1994).

**Key risk:** Enemy AI pathfinding needs to be simple but not dumb — use tile-graph
BFS (not A*); keep levels small enough that BFS is instant.

**Complexity:** 🟡 medium — needs tile-graph pathfinding for enemies; still no physics.

---

### 5. Scorched Earth (1991 — turn-based artillery)

**What:** 2-4 players (or vs AI) take turns firing artillery over procedural
terrain. Wind, gravity, and angle matter. Blast radius destroys terrain.
Last tank standing wins. Pure turn-based — no reflexes, all math.

**Why it fits:** Turn-based = zero frame-rate concerns. Procedural terrain from
seeded heightmaps. Physics is projectile math (closed-form). Fully
deterministic → every shot is a unit test. Zero assets: colored terrain
triangles, tank sprites, explosion circles.

**Controls:** Arrow keys aim + set power, space fires. Touch: slider for angle/power.

**Original reference:** Scorched Earth (1991, Wendell Hicken), Pocket Tanks,
Tank Battle (various).

**Key risk:** Terrain destruction can get weird at grid edges; use marching-squares
for terrain mesh and simple radius-clip for explosions.

**Complexity:** 🟢 low — projectile sim, terrain grid, turn manager. No animation
beyond explosion + terrain redraw.

---

### 6. Breakout / Arkanoid (paddle-ball brick breaker)

**What:** Classic paddle and ball, procedurally generated brick layouts.
Power-ups drop from bricks (multi-ball, wide paddle, laser). Seeded brick
patterns for daily challenges. Simple but addictive — "one more level" hook.

**Why it fits:** Trivially zero-asset (colored rectangles). Fully deterministic
(ball trajectory is closed-form between bounces). Zero assets: rectangles +
circles. Controls are one axis (left/right paddle).

**Controls:** Left/right arrows or mouse. Touch: drag paddle.

**Original reference:** Breakout (1976), Arkanoid (1986, Taito), DX Ball (1996).

**Key risk:** Ball-stuck edge case (ball in horizontal-only bounce); standard fix:
nudge angle on every paddle hit.

**Complexity:** 🟢 low — ball physics, paddle, brick grid. No AI, no pathfinding.

---

### 7. Tempest (1981 — radial tube shooter)

**What:** Shoot down enemies crawling up the inside of a 3D tube (rendered as
2D radial polygon). You rotate around the rim and fire inward. Enemies crawl
toward you; some jump over the rim. Clean, hypnotic visual language — all
procedural polygons.

**Why it fits:** Radial geometry is procedural by definition (generate any tube
shape). Zero assets: colored polygon lines + filled enemy shapes. Fully
deterministic. Adds a genre completely absent from the hub (radial/tube
shooter).

**Controls:** Left/right rotate, space/up to fire, down to super-zap. Touch: left/right
buttons + fire.

**Original reference:** Tempest (1981, Atari), Tempest 2000 (1994, Jeff Minter).

**Key risk:** The 3D→2D projection math needs to be crisp; use polar coords +
depth scaling, no WebGL needed.

**Complexity:** 🟡 medium — radial projection math is the only non-trivial piece;
rest is pure collision on polar grid.

---

### 8. Chip's Challenge (1989 — tile puzzle adventure)

**What:** Navigate a tile-based maze collecting all chips to unlock the exit.
Ice, water, fire, switches, teleporters, enemies — each tile type has a
clear, auditable rule. Every level is a logic puzzle dressed as an adventure.

**Why it fits:** Pure tile logic, no physics, no animation beyond movement.
Procedural level generation from tile-templates. Deterministic → every move
is testable. Zero assets: colored tiles. Genre gap: logic/puzzle in the hub.

**Controls:** Arrow keys only. Touch: swipe.

**Original reference:** Chip's Challenge (1989, Epyx / Microsoft).

**Key risk:** Tile interaction rules are many (ice = slide, water = drown, fire = death,
switch = toggle) — keep tile types to 8-10 max for a first version.

**Complexity:** 🟡 medium — many tile types, but each is a pure if/else on the tile grid.

---

### 9. Bomberman (1983 — maze bomb strategy)

**What:** Place bombs in a grid maze, destroy walls, collect power-ups, last
one standing wins (or vs AI enemies). Bombs detonate in a cross pattern;
fire spreads through destructible walls. Procedural maze generation.

**Why it fits:** Pure tile logic. Procedural mazes from seeded generators.
Deterministic bomb physics (fuse timer + blast radius). AI enemies: simple
random-walk + avoidance. Zero assets: colored tiles, explosion cross.

**Controls:** Arrow keys move, space place bomb. Touch: virtual d-pad + bomb button.

**Original reference:** Bomberman (1983, Hudson Soft), Dyna Blaster (1991).

**Key risk:** Multiplayer (vs human) needs Dustline's server; keep AI-only for
Pages version, note multiplayer as optional server extension.

**Complexity:** 🟡 medium — tile grid, bomb timer, blast propagation, simple AI.

---

### 10. Centipede (1980 — shooter with segmented enemies)

**What:** Top-down shooter where a segmented centipede winds down the screen.
Shoot a segment → it becomes a mushroom. Centipede navigates around mushrooms.
Fleas drop down spawning mushrooms. Spider jumps erratically. Clean, classic,
pure reflexes.

**Why it fits:** Procedural from seeded wave patterns. Fully deterministic.
Zero assets: colored circles (centipede segments), rectangles (mushrooms),
simple shapes for spider/flea. Genre absent from hub (fixed-position shooter).

**Controls:** WASD aim, space/j to fire, mouse optional. Touch: drag to aim, tap to fire.

**Original reference:** Centipede (1980, Atari), Millipede (1982).

**Key risk:** Centipede pathfinding around mushrooms must be smooth; use
segment-follow (each segment follows predecessor's path with 1-frame delay).

**Complexity:** 🟢 low — segment-follow AI, simple collision, seeded waves.

---

## 🟡 Strong ideas — needs design first

### 11. Swing Courier (Windlands / Dying Light grapple homage)

**What:** Seeded vertical city; swing anchor-to-anchor delivering parcels.
Right-mouse/drag to throw grapple, release to fly. No floor — every drop is
momentum math. Ghost + daily seed → per-seed world records. Touch-friendly.

**Why it fits:** Most "speedrunner-friendly" idea. Pure momentum physics is
testable. Genre: vertical-flow parkour — totally absent from hub.

**Controls:** WASD aim, mouse/grapple throw, release timing. Touch: tap begin/end.

**Original reference:** Windlands (2016), Dying Light grapple, Titanfall 2.

**Key risk:** Camera feel in 2D — keep it side-view 2D, not 3D; camera is
fixed, player swings within frame. 3D first-person swing in canvas is too heavy.

**Complexity:** 🟡 medium — pendulum constraint solver + release-velocity math.

---

### 12. Swarm Shepherd (Lemmings / Sheep in Space homage)

**What:** Herd panicking procedural creatures with light, sound, and body-blocking
into pens. Creatures are boid-simulated (cohesion + separation + alignment)
and respond to player proximity. Seeded creature behaviors per run.

**Why it fits:** Emergent visual delight from boid rules — zero assets shine
(flocking dots = beautiful). Rules are pure math → testable. Lemmings was a
90s icon.

**Controls:** WASD move, space shout/wave to direct, shift to sprint. Touch: drag.

**Original reference:** Lemmings (1991, DMA Design), Sheep in Space (1983),
Insaniquarium (2001).

**Key risk:** Boid tuning is the whole game — wrong numbers = creatures feel dumb
or chaotic. Need a tuning config file from day one.

**Complexity:** 🟡 medium — boid sim is pure math but needs careful parameter tuning.

---

### 13. Pheromone Highways (ant colony stigmergy)

**What:** You are the queen. Draw evaporating pheromone trails to route a blind
ant colony to food sources before trails fade. Ants follow strongest local
gradient. Multiple food types need different trail "colors." Seeded food
layouts.

**Why it fits:** Visually hypnotic — trail evaporation is beautiful procedurally.
Rules are pure: ants = gradient followers. Fully deterministic. Zero assets:
colored trail particles + ant dots.

**Controls:** WASD move queen, space mark trail, shift sprint. Touch: drag trail.

**Original reference:** SimAnt (1991, Maxis), actual ant colony optimization.

**Key risk:** Trail evaporation rate is the tuning knob — too fast = frustrating,
too slow = trivial. Needs a config with sensible defaults.

**Complexity:** 🟢 low — ant agents follow local gradient on a trail grid.

---

### 14. Jelly Balance (physics oddity)

**What:** Carry a giant jiggly jelly across a shaky kitchen table. The jelly
wobbles with spring physics; tilt the table with arrow keys. Physics is the
game — every step is balance, every bump sends the jelly flying.

**Why it fits:** Procedural visual delight (jelly deformation is code-only).
Physics is a spring sim — fully deterministic and testable. Touch-friendly.
Genre: physics-balance — absent from hub.

**Controls:** Left/right tilt, space steady. Touch: tilt device or buttons.

**Original reference:** QWOP (2008), Getting Over It (2017), Katamari Damacy
(2004) — all physics-balance.

**Key risk:** Spring physics tuning — needs to feel "jiggly" not "annoying."
Config-driven spring constant + damping.

**Complexity:** 🟡 medium — spring-mass simulation for jelly, simple tilt input.

---

### 15. Gravity Flip (VVVVVV homage)

**What:** Platformer where you flip gravity with one key. Walk along the
ceiling, dodge spikes, collect shiny things. Levels are tile-based with
predetermined spike placements; gravity flip is instantaneous. Daily seeded
level variant.

**Why it fits:** One-key mechanic = pure simplicity. Procedural levels from
spike-pattern generators. Deterministic movement. Zero assets: colored tiles.
Genre: precision platformer — different from Dave Dangerous (traditional jumps).

**Controls:** Left/right move, space flip gravity. Touch: left/right buttons + flip.

**Original reference:** VVVVVV (2010, Terry Cavanagh), Spelunky flip mechanic,
VVVVVV spirit.

**Key risk:** Precision platforming demands tight hitboxes — test with frame-by-frame
replay assertions.

**Complexity:** 🟢 low — tile grid, gravity state toggle, spike collision.

---

### 16. Matrix Rain Typing (90s hacker vibe)

**What:** Green-on-black matrix rain falling; each column has a word chain.
Type the word before it reaches the bottom. Speed increases. Combo for
consecutive accurate words. Boss levels: long phrases.

**Why it fits:** Zero assets (just text + color). Fully deterministic
(word list + speed curve). Genre: typing game — completely absent from hub.
Perfect 90s nostalgia (Matrix, 1999). One-file-buildable.

**Controls:** Keyboard typing only. Touch: on-screen keyboard (not ideal but works).

**Original reference:** The Matrix (1999), Typing of the Dead (1999),
ZType (2012).

**Key risk:** Word list must be seeded for deterministic runs; use a curated
200-word list bundled in code.

**Complexity:** 🟢 low — word array, falling columns, timer. Trivially testable.

---

### 17. Missile Command (1980 — defend your cities)

**What:** Missiles rain down on your 6 cities. Click to launch interceptors;
blast radius destroys incoming missiles. Finite ammo. Strategic: which
missiles to intercept and which to let through. Escalating difficulty.

**Why it fits:** Procedural missile patterns from seed. Pure projectile math.
Zero assets: cities = colored rectangles, missiles = lines, explosions = circles.
Genre: defense/strategy — absent from hub. Pure mouse/click, breaks the
keyboard-only mold slightly but complements the hub.

**Controls:** Mouse aim + click (or arrow keys + space). Touch: tap.

**Original reference:** Missile Command (1980, Atari).

**Key risk:** Difficulty curve — starts too easy or too hard. Use time-scaled
enemy count + speed.

**Complexity:** 🟢 low — projectile sim, explosion radius, city HP.

---

### 18. Pipemania (1989 — pipe puzzle)

**What:** Rotate pipe segments to connect source to drain before fluid flows
through. Procedural layouts. Pipe types: straight, corner, T, cross, end.
Fluid flows when path is complete; timed mode adds pressure.

**Why it fits:** Pure tile rotation logic. Procedural from seeded pipe-graphs.
Deterministic: every pipe connects or doesn't → unit test. Zero assets:
colored pipe segments on a grid. Genre: puzzle — fills the gap.

**Controls:** Arrow keys select + rotate pipe. Touch: tap to rotate.

**Original reference:** Pipe Mania / Pipemania (1989, LucasArts), Tetris Attack.

**Key risk:** Pipe-graph generation must always be solvable → use spanning-tree
algorithm on grid.

**Complexity:** 🟡 medium — pipe-graph generation + fluid flow animation.

---

## 🔴 Heavy scope — good ideas but harder

### 19. Wolfenstein 3D tribute (raycaster)

**What:** First-person maze shooter using canvas raycasting. Rooms, doors,
enemies with simple AI. Procedural level layouts. The technical showcase of
the hub.

**Why it fits:** Raycasting in canvas is well-documented (no WebGL needed).
Procedural maze + room placement. Genre: FPS — homages the 90s king.

**Key risk:** Raycasting performance on mobile; scope creep (weapons, enemies,
doors). Needs a strict feature cap for v1.

**Complexity:** 🔴 high — raycaster renderer + enemy AI + weapon system.

---

### 20. Prince of Persia tribute (tile-platformer)

**What:** Side-view tile platformer with traps, timed gates, swords. Physics:
momentum, falling damage, ledge-grab. Procedural level from tile templates.
Requires animation frames for running/jumping/fighting.

**Why it fits:** Iconic 90s game. Pure tile logic + animation. Procedural
from tile templates.

**Key risk:** Animation frames need to be code-drawn (SVG or canvas) — not
binary assets, but significant drawing work. Combat timing is fiddly.

**Complexity:** 🔴 high — animation system + combat + trap logic.

---

### 21. Doom tribute (raycaster + lighting)

**What:** Like Wolfenstein but with textured floors, lighting falloff, and
more complex rooms. The ultimate 90s nostalgia piece.

**Why it fits:** Iconic 90s game. Procedural levels. Technical showcase.

**Key risk:** Significantly harder than Wolfenstein — texture mapping, lighting,
multi-floor. Too heavy for a first project.

**Complexity:** 🔴 high — advanced raycasting, lighting, texture system.

---

## Selection criteria

When picking from this catalog, prioritize:

1. **Genre gap** — does it fill a slot the hub doesn't have?
2. **Feasibility** — can it ship in one Vite project with one dev?
3. **Testability** — is the core sim pure-logic and unit-testable?
4. **Nostalgia** — does a 90s kid smile when they see it?
5. **"One more run"** — is there a seeded, timed, or scored loop?

## How to build (follow docs/GAMES.md)

1. Pick an entry from this catalog
2. Write a `.plan.md` design spec in the game folder
3. Scaffold: `bun create vite <slug> --template vanilla-ts`
4. All tunables in `src/config.ts`
5. Tests: pure logic vitest node env
6. Deploy: add to `.github/workflows/games-pages-deploy.yml` + hub card
7. Verify live + commit
