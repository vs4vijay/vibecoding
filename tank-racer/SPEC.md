# TANK RACER — Phased Spec (v1)

> 3D tank racing web game. Homage to *Tank Racer* (1997). Closed-circuit lap
> racing against AI tanks: shoot rivals, dodge shells, grab power-ups, finish 3 laps.
> Retro low-poly PS1-era look, desert theme, keyboard controls, browser-only.

## Stack & Conventions

- **Runtime:** Vite + TypeScript + Three.js. Package manager: `bun` (never npm).
- **Location:** `/Volumes/Main/GitHub/vibecoding/tank-racer/`
- **No backend, no persistence.** Everything client-side.
- Project setup (Phase 1 only): `bun create vite . --template vanilla-ts`, then `bun add three && bun add -d @types/three`.
- Keep modules small and focused; pure logic (spline math, lap detection, targeting)
  in framework-free functions so they stay testable.
- Code style: plain TS modules under `src/`, no classes where functions suffice,
  no external physics/AI libraries — custom arcade logic.

## Game Design Summary

- **Core loop:** Title → countdown → 3 laps vs 3 AI tanks → shells + power-ups → results → instant restart (R).
- **Track:** One closed circuit from a Catmull-Rom spline loop extruded into a chunky low-poly road with raised edge walls. Desert theme: sand plane, scattered rocks/cacti, bright blue sky.
- **Player tank:** Low-poly hull + turret. Arcade physics on a flat plane: acceleration, friction, drift-y turning, wall bounce. Turret fires with cooldown. Getting hit = spin-out + speed loss ~1s. Health to 0 = wrecked 3s, respawn on track at last checkpoint.
- **Controls:** W/↑ accelerate, S/↓ brake/reverse, A/D or ←/→ steer, Space fire, Shift boost (when holding boost power-up... no — boost is auto-consumed pickup; Shift reserved).
- **AI racers:** Follow spline with lateral offsets + rubber-banding (faster when behind player, ease off when ahead); fire at tank directly ahead occasionally. Same wreck/respawn rules.
- **Power-ups:** Floating crates on track; random pickup of Speed Boost (5s) / Shield (absorbs one hit) / Triple-Shot (3 quick shells).
- **HUD:** Lap x/3, position 1st–4th, speed, health bar, power-up slot, minimap (top-down dots), current/best lap time.
- **Screens:** Title (Enter to start) → Countdown 3-2-1-GO → Race → Results (finishing order, best lap, R restart).

## Architecture

```
tank-racer/
├── index.html              # canvas + HUD DOM overlay + screens
├── src/
│   ├── main.ts             # bootstrap, resize, RAF loop
│   ├── game.ts             # state machine (title/countdown/race/results), orchestration
│   ├── track.ts            # spline definition, road mesh, walls, checkpoints, boost pads, minimap data
│   ├── spline.ts           # Catmull-Rom closed-loop math: point/tangent/closest-point (pure)
│   ├── tank.ts             # tank mesh factory + arcade physics (shared by player & AI)
│   ├── player.ts           # input mapping onto tank
│   ├── ai.ts               # spline-following driver brain, rubber-band, targeting
│   ├── weapons.ts          # shells, collisions, spin-out/wreck handling
│   ├── powerups.ts         # crates, pickups, effects
│   ├── hud.ts              # DOM HUD updates, minimap canvas
│   └── screens.ts          # title/countdown/results overlay logic
└── SPEC.md
```

Data flow: `main.ts` owns the render loop and calls `game.update(dt)`; systems read
a shared `World` state object (tanks array, shells array, track reference, race state).

---

# PHASES (vertical slices — each is playable/verifiable on its own)

## Phase 1 — Scaffold + Drivable Tank
Build the Vite+TS+Three.js project. Flat desert ground plane, sky color, fog,
low-poly tank (box hull + turret + cylinder barrel + simple tracks) built from
primitives. WASD/arrows driving with arcade physics (accel ~28 u/s², max speed
~40 u/s, reverse half, turn rate scaled by speed, friction/drift feel, wall-less).
Chase camera with smooth follow behind hull. Minimal HUD skeleton (speed readout).
**Done when:** `bun run dev` shows the tank driving smoothly on desert ground;
`bun run build` passes with zero TS errors.

## Phase 2 — Track, Walls, Laps, Boost Pads
Implement closed-loop Catmull-Rom spline (~10 control points forming an interesting
circuit with straights and hairpins), extruded road mesh (~14 u wide, dark asphalt
with center dashes via simple texture or geometry strips), raised side walls.
Collision: if tank's distance to spline centerline > half-width, push back + kill
lateral velocity (soft bounce). Progress metric = parameter t along spline →
checkpoint gates (4 per lap) + lap detection + position-on-track respawn helper.
Boost pads on 2–3 straights: drive over → 1.5× speed for 2s + visual flash.
HUD gains lap counter + lap timer. Minimap canvas drawn from spline points +
tank dots. **Done when:** player can complete laps, can't leave track, boost
pads work, minimap renders.

## Phase 3 — Weapons, Health, Power-ups
Space fires shell from turret (cooldown 0.8s, speed ~80 u/s, lifetime 2s, small
glowing sphere + trail). Shell hit = target loses 25 HP (100 max), spin-out 1s.
Health 0 → wrecked (smoke puff / flipped barrel, immobile 3s) → respawn at last
checkpoint with full HP. Player also takes hits from own ricochets? No — shells
ignore shooter for 0.5s then can hit anyone including self? Keep simple: never
hit shooter. Power-up crates: 4 fixed spots, respawn 8s after taken, random
pickup: Boost (auto 5s ×1.4 speed) / Shield (absorb one hit, visual bubble) /
Triple-Shot (next 3 shots fire spread). HUD: health bar + power-up slot indicator.
**Done when:** player can shoot static target tanks (spawn 3 dumb stationary AI
hulls as targets for testing), take damage, wreck, respawn, and use all 3 pickups.

## Phase 4 — AI Opponents
Replace test dummies with 3 driving AI tanks using the shared Tank physics:
target point = spline point ahead (lookahead grows with speed) + lateral offset
(per-AI personality, wanders slowly); steer toward it with same turn limits;
throttle modulated by upcoming curvature (slow into corners). Rubber-band:
±15% max speed based on race position vs player. Fire at nearest tank ahead
within 60u and roughly in front, with aim error and 2–4s cadence. AI uses same
wreck/respawn, picks up crates by chance when driving over them. Race positions
computed from laps + progress-along-lap. **Done when:** a full race vs 3 AI is
competitive — AI completes the circuit cleanly, fights back, rubber-bands.

## Phase 5 — Game Flow, Screens, Polish
State machine: Title screen (game name, controls listing, Enter) → Countdown
(3-2-1-GO with tanks locked) → Race → Results (finishing order with times,
best lap, "R to restart"). Position indicator (1st/2nd…), final-lap banner,
simple engine hum + shot/hit/explosion blips via WebAudio oscillators (no assets).
Tune difficulty so an average player finishes mid-pack on first tries. Performance
pass: keep draw calls low, merged geometries where easy, target 60fps.
README.md with run instructions + screenshot placeholder section.
**Done when:** complete game loop title→race→results→restart works end-to-end;
`bun run build` clean.

---

---

# v1.1 PHASES

## Phase 6 — Second Track + Track Selection
Refactor track definition so a circuit is data (control points + dressing config + pad/gate/crate t-values) and `track.ts` builds a `Track` from it. Add a second circuit ("CANYON RUN") with a different character from track 1 ("DUST BOWL"): e.g. figure-eight-adjacent layout or long sweepers + chicane, distinct dressing (mesa rock slabs, more cacti, warmer sky tint). Both tracks get boost pads, 4 crates, 4 gates, tuned AI (existing curvature logic should just work — verify via scripts/sim-ai.ts on both). Title screen gains track selection: LEFT/RIGHT arrows to cycle tracks (name shown), persists choice in localStorage. Results screen shows which track was raced.
**Done when:** both tracks playable end-to-end vs AI, sim script shows clean laps on each; build clean.

## Phase 7 — Tank Selection + Best Times
Three selectable tanks with real stat differences (same physics code, different params): **BALANCED** (default stats), **SPRINTER** (+20% max speed, slower accel, -25 HP), **BRUISER** (-15% max speed, faster accel, +50 HP, faster fire cooldown 0.6s). Distinct hull colors/shapes (small proportion tweaks). Title screen: UP/DOWN cycles tank (stats card shown), ENTER confirms after track pick. Best-times: store per-track best lap + best total time in localStorage; show on title screen per track and highlight "NEW BEST!" on results. HUD tank name shown at countdown.
**Done when:** all 3 tanks selectable and meaningfully different to play, best times persist across reloads, full loop title→race→results→restart works for every track/tank combo; `bun run build` clean.

---

## Out of scope (v1)
Multiplayer, mobile/touch controls, multiple tracks, tank selection, persistence,
championship mode, real 3D assets/audio files.
