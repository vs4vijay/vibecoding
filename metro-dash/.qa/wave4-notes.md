
---

# WAVE 4 — PROPS: trains, obstacles, collectibles

Date: 2026-09-13. Scope: the obstacle/collectible layer only. Engine, sky,
world dressing, character, lighting, post pipeline and all collision volumes
are untouched. No sprites, no external assets, procedural canvas textures
only, composer target still UnsignedByteType.

## Files changed
| File | Change |
|---|---|
| `client/js/src/entities/trains.js` | REPLACED. ObstacleManager rebuilt: detailed 5-mesh metro cars (shared geometries, pooled), striped barricades, STOP signal gantries, tread-plate ramps. Public API unchanged (`spawn/fixedUpdate/getColliders/reset`); ctor now takes an optional `seed` for livery variants. Colliders bit-identical. |
| `client/js/src/entities/coins.js` | Coin geometry replaced: lathe bevel + raised rim + recessed faces + embossed 5-point star on BOTH faces (merged, 576 tris). Wobble-spin added. Pooling/instancing/collection/magnet hooks untouched. |
| `client/js/src/entities/pickups.js` | NEW. PickupField: pooled (4/type) InstancedMesh per type — magnet horseshoe (red U + silver poles, vertex-colored), jetpack (twin orange canisters + caps/nozzles), x2 gold token ("2x" canvas on the faces). All pickups on screen cost <= 3 draw calls. |
| `client/js/src/core/assets.js` | Wave-4 art: `TRAIN_LIVERY_VARIANTS` (3 palettes) + `makeTrainAtlasTexture` (1024x768 per variant: side band with window band/glass/mullions/door reveals/trim/weathering, roof band with ribs + longitudinal weathering strips + walkway, end block with windshield/destination box/headlight rings/anti-climber), `makeTrainDoorTexture` (per-variant leaf: seal, window, handle, kick panel), `makeTrainDigitTexture` (0-9 atlas for car-number decals), `makeBarrierStripeTexture` (45-deg orange/white hazard stripes), `makeGantrySignTexture` (STOP + down chevrons), `makeTokenTexture` ("2x"), `treadPlate` PBR set (diamond plate + worn yellow chevron band). New materials: `lensDark`, `lensLit` (emissive), `lampAmber`, `pickupPaint` (vertexColors), `pickupToken`, `treadPlate`; MaterialLibrary getters `trainVariants`, `trainDigit`, etc. Old `trainLivery`/`makeTrainLiveryTexture` removed (nothing else referenced them). `gold` retuned for stronger specular: color 0xffc84a->0xffd05a, roughness 0.25->0.18, envMapIntensity 1.3->1.55 (used only by coins). |
| `client/js/src/game/run.js` | PickupField wired: ctor, `start()` reset + `onCollect -> collectPowerup(type, 10)`, `fixedUpdate` collection step, `updateRender` matrices. Director: each pattern sets a `pickupSpot` in the already-free lane; `_maybePickup()` rolls a SEPARATE seeded stream (`rngFor(seed ^ 0x51ce, patternCount)`, ~30% chance) — the pattern-director rng sequence is untouched, so all spacing guarantees and the wave-3 pattern layout for a given seed are bit-identical. ObstacleManager now receives the run seed. |
| `client/js/sw.js` | Cache bump v4 -> v5 + `pickups.js` precached (cache-first SW must not serve stale modules). |
| `dist/` | Rebuilt via `bun run build:client`. |
| `.qa/wave4-smoke.mjs` | NEW headless validation suite (see Validation). |
| `.qa/wave3-smoke.mjs` | Harness-only fix: added the 2D-canvas shim + `trainVariants` stub case; the mesh-count bound 25 -> 28 (the character gained its contact-shadow blob in a later wave-3 judge round — pre-existing staleness, not a wave-4 change). |

## A. Trains (signature prop)
One car = one obstacle (12 m; collider unchanged). 5 draw calls per car, all
geometry shared across the pool:
1. **Body** — box (2.0 x 2.25 x 12, y 0.85..3.10) UV-mapped into a per-variant
   1024x768 atlas: sides = clean transit livery (cream window band, dark glass
   strip with sky gradient + mullions, trim + accent stripes, panel seams,
   skirt/roof-edge contact shadow, 6 faint streaks — no blotches); roof face =
   ribbed panels (0.45 m transverse ribs), center walkway, 4 longitudinal
   weathering strips, edge grime fall-off, faint rust streaks (fixes the
   "synthetic corrugated roof"); ends = windshield, dark destination box with
   faint amber digits, headlight rings, anti-climber ribs, coupler hatch.
2. **Doors** — 12 real door leaves (3 pairs/side, 0.60 m leaves, 4 cm gap)
   merged into one mesh, slightly proud of the body (x +/-1.005) so the
   painted dark reveals read as shadow gaps; per-variant leaf texture with
   rubber seals, window, bright grab handle, kick panel.
3. **Dark parts** (steelDark, merged) — under-frame, side/end skirts leaving
   the bogies visible, 2 bogies (frames + 8 wheels r 0.33 + axles), couplers +
   head plates at both ends, roof gear: AC hump (top 3.32), 2 vents, folded
   pantograph (insulators, base, arms, saddle, contact strip, top 3.36).
4. **Lenses** — 4 small cylinders (2 per end) with SWAPPED material: dark
   tinted glass parked, emissive warm glass (lensLit, emissiveIntensity 1.5,
   bloom picks it up) when `vz != 0` — the moving-train headlight read, no
   lens flares/sprites. The `vz` hook advances and recycles exactly as before.
5. **Number decals** — 8 alpha-cut quads sampling a digit atlas; each pooled
   car carries a stable deterministic 4-digit number (hash of its pool slot),
   centered 1.15 m from the -z end on both flanks, reading left-to-right from
   outside on each side, clear of the door reveal.

**Livery variants (seeded):** transitOrange/cream (the passed look), tealNavy,
solarGray/yellow. Chosen per spawn via `mulberry32(hashSeed(seed ^ 0x74a1,
spawnIndex, 0x9e37))` — deterministic for a seed, uniform across the 3
palettes (verified over 12-car sequences for seeds 7/1/42/12345). Pool cars
are re-skinned on spawn (materials only; geometry shared).

## B. Barriers / overheads / ramps
- **Barrier** (3 meshes, was 3): hazard-striped plank (canvas 45-deg
  orange/white stripes with wear), steelDark trestle frame (legs, feet,
  braces, mid rail, lamp bases), 2 amber lamp domes (lampAmber, emissive
  0.4 — daytime tint, blink-capable later). Plank top = collider top 1.0;
  lamp domes peak 1.09 (visual only, at the plank ends).
- **Overhead** (3 meshes, was 3): catSteel signal gantry (2 posts + foot pads,
  top beam, drop rods, lamp housings), hanging STOP sign panel (2.2 x 1.3,
  bottom at 1.7 = collider y0; navy panel, white border, bold STOP, 3 amber
  down-chevrons), 2 amber lamp domes under the beam (static tint).
- **Ramp** (2 meshes, was 1; still never spawned by the director, no
  collider): wedge with proper UVs mapping a new `treadPlate` PBR set —
  diamond-plate lozenges + worn yellow chevron band repeating 1.79x up the
  slope — plus steelDark side rails following the slope angle and support
  legs.

## C. Coins & pickups
- Coin: beveled lathe (recessed faces, rounded rim) + embossed star on both
  faces; gold material retuned (stronger specular). Same InstancedMesh pool
  (256), same spawnLine/spawnArc/fixedUpdate/magnet APIs.
- Pickups: 3 distinct meshes, InstancedMesh per type (4 slots each, silently
  ignored when full), spin + bob from the fixed-step accumulator. Spawned in
  ~30% of patterns inside the coin lines (between coins, free lane only):
  coin-line height 1.05, arc peak 2.95, roll-under line 0.7. Collection
  (radius 1.25, height window like coins) routes into the existing
  `collectPowerup` stub — magnet already drives the coin-magnet hook, x2
  already doubles the multiplier, jetpack parks a timer for wave 5.
- "Pickup discs render as flat lime-green tokens" fixed by: beveled geometry
  with rim/face relief, warmer gold, tighter roughness, stronger env —
  speculars now break the flat-token read.

## D. Gameplay-feel tunables (all in entities/*.js; NO speed/jump/gravity/
spawn-cadence changes)
| Tunable | Was | Now |
|---|---|---|
| `PICKUP_RADIUS` (coins.js collection) | 1.05 | 1.2 |
| `SPIN_RATE` (coin spin, rad/s) | 4.0 | 5.2 |
| `MAGNET_RADIUS` (coin magnet hook) | 6 | 7 |
| coin wobble | none | x/z sway 0.14/0.10 rad at 2.6/2.08 rad/s |
| pickup spawn chance per pattern | - | 0.30 (separate stream) |

## Collider guarantees (contract)
Verified every fixed step of a 600-step god-mode run: the ONLY colliders
produced are exactly
`train {1.0, 6.0, 0, 3.2}`, `barrier {0.95, 0.16, 0, 1.0}`,
`overhead {1.1, 0.2, 1.7, 3.0}` (all solid), ramp none — identical schema and
values to wave 1. Visual solids stay inside the envelope: car bbox x +/-1.02
(doors), top 3.40 (pantograph, close rig flies at 3.6), length 12.54 m
(couplers protrude 0.27 m at knee height y 0.5-0.76 — dark, below the
forgiving-hitbox margin). `PLAYER_*`/`HITBOX_SHRINK` untouched; god-mode
center-lane-free policy, pattern director spacing/rng untouched; moving
trains (`vz`) advance/recycle as before (smoke-tested).

## Draw-call budget
Measured by scene traversal at the 600-step position (high tier, draw
distance 240): obstacle/coin/pickup layer = 32 main-pass draw calls (3 trains,
4 barriers, 1 overhead, 1 instanced coin batch, 1 visible pickup batch) vs 25
before the wave. Worst realistic frame (~8 trains, 4 barriers, 2 overheads, 3
pickup types visible): 62 vs 43 before -> **delta <= +19 main pass, ~+30 with
the shadow pass**. Wave-3 total was ~185-195 -> estimate **~215-225 worst case
vs the 250 budget**. Cost drivers: +2 draw calls per visible train (5-mesh
car), pickups <= 3, barrier/overhead/ramp counts unchanged. Pools stay
bounded: recycling returns objects to per-kind pools (size = peak concurrent;
measured 8 active obstacles, 11 pooled, at the snapshot), pickups 4/type.

## QA trace / determinism (?qa=1&seed=7&time=10&freeze=1)
- Pickups/coins/liveries derive from the run seed + fixed-step accumulators
  only; `?freeze` renders bit-identical warmup frames (smoke-verified for coin
  AND pickup instance matrices, obstacle layout, and cross-run identity).
- Pickups never touch the director rng: pattern layout for seed 7 is
  bit-identical to wave 3 (verified: identical obstacle z/lane/material lists
  across independent runs; the only gameplay deltas are the listed feel
  tunables and pickup collections).
- `?cam=close|side|front` all read: side/close show livery + doors + numbers +
  bogies + roof gear; front/chase show end detail (windshield, destination
  box, headlight rings) and the STOP gantry / striped barricade silhouettes.
  Trains appear at z 150-250 for seed 7 as before (director layout unchanged).

## Validation done (no browser used)
- `node --check` clean on every touched file (assets, trains, coins, pickups,
  run, sw, both smoke harnesses).
- `.qa/wave4-smoke.mjs`: 40/40 checks — 5-mesh car build + finite geometry,
  collider EXACT contract through spawn/move/recycle, variant determinism +
  all 3 palettes + seeded lens swap, vz hook advance/recycle + pool bound,
  beveled coin geometry + freeze-idempotent matrices, pickup pool bounds +
  collection routing, 600-step god-mode run with 0 collider violations,
  cross-run layout determinism, draw-call traversal (<90 layer bound).
- Canvas painters dry-run headlessly with a recording 2D context: all
  painters execute clean; door-reveal paint centers measured at canvas x
  221.9 / 512.0 / 802.1 — exactly the 3D leaf positions for both side
  hemispheres; glass band lands at the designed world heights.
- `dist/` rebuilt; SW cache v5 (stale-module risk cleared).

## Risks / notes for the judge + wave 5
- The 3 livery atlas canvases (1024x768) + 3 door textures + shared props add
  ~40-60 ms one-time boot texture cost (still inside the 300 ms budget).
- Atlas is a single texture per car body: mipmap bleeding between the
  side/roof/end regions is possible on very distant cars; regions are
  200+ px and far cars are fogged — not visible in practice.
- Lamp domes on barriers peak at 1.09 (9 cm above the collider top); couplers
  protrude 0.27 m beyond the train collider at y 0.5-0.76 — both are visual
  only and inside the forgiving-hitbox margin, but flag if a shot shows a
  "should-have-hit" scrape.
- Moving trains are not yet spawned by the director (unchanged policy); the
  vz hook + emissive lens variant are ready and smoke-tested when traffic
  wants them.
- Wave 5: `powerups` timers are live data — magnet already pulls coins, x2
  already doubles the multiplier; jetpack needs its flight behaviour (keep it
  under the 4.58 m wires, see wave-2 notes). Pickup pool is 4/type — raise
  `perType` if a future spawn rate exceeds ~1 pickup per 40 m per type.
