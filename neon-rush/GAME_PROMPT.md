# GAME DESIGN PROMPT — "NEON RUSH: Hyperdrome"

> Copy-paste this entire document into your AI coding tool (or hand it to a developer).
> It is written to be a complete, unambiguous build specification for a three.js endless game.

---

## 1. THE PITCH (one sentence)

Build **"NEON RUSH: Hyperdrome"** — a browser-based, endlessly-running 3D game built with **three.js**, in which the player sprints through a synthwave neon world that continuously *morphs between gameplay phases borrowed from the most addictive games ever made* (Subway Surfers, Temple Run, Jetpack Joyride, Flappy Bird, Crossy Road, Stack, Sling Drift, slither.io, Geometry Dash), wrapped in the psychological reward systems (variable rewards, near-miss tension, flow-state difficulty, instant restarts, meta-progression) that make those games impossible to put down.

## 2. DESIGN PILLARS (every decision must serve these)

1. **One-tap learnable, lifetime to master** — playable within 5 seconds of page load, zero tutorial text.
2. **Death is always your fault** — every obstacle is avoidable with perfect play; no unfair spawns, ever.
3. **"Just one more run"** — restart in under 1 second with a single input; death screen shows exactly how close you were to your record.
4. **Constant novelty** — the game changes its own rules every ~30–60 seconds via phase shifts, so no two runs feel the same.
5. **60 FPS or nothing** — arcade-grade performance budget on mid-range mobile.

## 3. CORE LOOP

**Run → dodge/collect → near-miss → phase shift → die (or milestone) → instant restart → spend coins on upgrades/characters → beat record by a hair → repeat.**

Session length target: 30 seconds (early runs) to 5+ minutes (skilled). The retry button is the biggest element on the death screen.

## 4. BORROWED MECHANICS — "Greatest Hits" Fusion Map

| Source game | Mechanic borrowed | How it appears in NEON RUSH |
|---|---|---|
| **Subway Surfers** | 3-lane switching, jump, slide, roll-under | Default running phase; swipe/arrow lane changes, jump over barriers, slide under beams |
| **Temple Run** | Escalating chase + turning pressure, "the monster is behind you" | A wall of glitches ("The Static") trails you; mistakes let it close in, perfect runs push it back |
| **Jetpack Joyride** | Hold-to-fly vehicle sections + gadget slots | Phase shift turns the run into a hold-to-rise flight corridor with fuel pickups |
| **Flappy Bird** | Tight one-tap gap threading | During flight phase, some gates are Flappy-style gaps: tap = flap, gap spacing is tight but always fair |
| **Crossy Road** | Rhythmic hop across hazards | Phase: grid-hop river/highway crossing with timed vehicles and logs; waiting too long = camera edge kills you |
| **Stack (Ketchapp)** | Perfect-timing stacking + visible accumulation | Bonus gates: land inside the shrinking "perfect zone" to grow a tower/combo; misses shrink it |
| **Sling Drift / Drift Boss** | Hold-to-drift around curves | Phase: the track curves; hold to drift through the bend, release to snap straight; drift = score multiplier |
| **slither.io / agar.io** | Absorb orbs, grow, risk/reward size | "Orb fields": collect plasma orbs to fatten your score multiplier, but bigger orb trails make hitboxes harder to read |
| **Geometry Dash** | Rhythm-synced obstacles + instant restart | Obstacle patterns sync to the music's BPM; music intensity rises with combo tiers |
| **Merge/2048** | Combining pickups | Collect 3 identical power-up chips → they merge into the next tier of that power-up |
| **Fruit Ninja** | Swipe-slash bonus objects | Swipe through floating "data fruit" during slow-mo bonus windows for coin bursts |
| **Subway Surfers / crossword-style daily** | Daily seeded challenge | One shared seed per day = everyone worldwide runs the same track (daily leaderboard) |

## 5. GAMEPLAY PHASES (the signature system)

The track is divided into **phases** of 30–60 seconds. At each phase boundary a 1.5-second cinematic transition (tunnel warp + title card, e.g., "→ FLIGHT ZONE") swaps the rules. Phase order is randomly shuffled from a weighted pool, seeded per run:

1. **RUN** (default, always first) — 3 lanes, jump/slide, coins, trains/barriers/beams.
2. **FLIGHT** — hold to rise (Jetpack), release to fall; Flappy-style gap gates; fuel drains, grab fuel cells.
3. **DRIFT** — track curves left/right; hold to drift, release to straighten; stay on the road, chain drift for ×2, ×3 multiplier.
4. **HOPPER** — top-down grid crossing (Crossy Road style); hop lane by lane through traffic and rivers.
5. **STACK GATES** — a series of timing gates with a moving "perfect zone"; perfect hits grow your combo tower, misses shrink it.
6. **ORB FIELD** — open arena stretch; magnet orb pickups, merge chips, Fruit-Ninja slow-mo slash window.

Phases slowly get faster and denser. Every 3rd phase is a "fever phase" with doubled coins.

## 6. CONTROLS

- **Keyboard**: ← → or A/D = lane switch / steer; ↑ / W / Space = jump or flap; ↓ / S = slide or dive; Shift = drift (hold). P = pause.
- **Touch**: swipe left/right/up/down; tap = flap; touch-and-hold = drift/fly.
- **Gamepad (optional)**: d-pad/stick + A/B.
- All inputs buffered ~120 ms so a jump pressed just before landing still fires — inputs must never feel eaten.

## 7. SCORING, ECONOMY & VARIABLE REWARDS

- **Score** = distance × speed tier + coins × combo multiplier + **style points** (near misses +25, perfect stack +50, drift chains +10/hit).
- **Combo system**: pickups and near-misses build a combo; taking damage or 5s of inactivity decays it. Combo tiers add music layers and color shifts.
- **Coins** persist between runs (localStorage). Spend on: characters, trails, upgradeable perks (magnet duration, shield count, head start).
- **Variable-ratio reward schedule** (the slot-machine engine):
  - **Mystery Boxes** every ~500 m: random reward — coins, power-up, rare skin shard, or "×2 next run" (weighted table, rare drops ~2%).
  - **Post-death roulette**: a 3-second spinning wheel offering a "revive" — sometimes free, sometimes for coins, sometimes just out of reach.
  - **Near-miss engineering**: when you die within 5% of your high score, the death screen shows "SO CLOSE — 98.4% of your record!" and a ghost line of where the record was. Coins are occasionally placed in risky spots next to hazards.
- **Revive system**: one revive per run (ad/coins in a real product; here, coins or free), resuming from the exact spot.

## 8. META-PROGRESSION & RETENTION (all local, no backend required)

- **Missions**: 3 active at all times ("Drift 500 m", "Collect 2 mystery boxes", "Reach FLIGHT phase twice"); completing one auto-fills the next. Mission complete = coin burst + banner.
- **Daily challenge**: seeded run (same layout for everyone each day), one attempt per calendar day to post a score; streak counter with escalating daily rewards.
- **Character collection**: 12+ unlockable low-poly characters/skins (some earned, some bought, 2 rare drops only).
- **Level/XP bar** on the menu: XP from every run; levels grant cosmetic unlocks.
- **Best-score ghost**: translucent ghost of your best run replays beside you on the menu and optionally in-game.

## 9. PSYCHOLOGY CHECKLIST (must all be implemented)

- [ ] Instant restart (tap anywhere on death screen → running again in <1 s)
- [ ] Near-miss detection with slow-mo micro-hitstop (80 ms) + "+25 CLOSE!" popup
- [ ] Variable reward tables (mystery boxes, roulette revive)
- [ ] Dynamic difficulty: speed/obstacle-density tuned to rolling player performance (flow channel), capped so it always trends up
- [ ] Death cam: brief replay of the fatal 2 seconds, zoomed on the hazard
- [ ] "One more run" copywriting on death screen with distance-to-record
- [ ] Screen shake, FOV kick on speed-up, haptics (mobile), satisfying coin "plink" pitch rising with combo
- [ ] Music BPM-synced to gameplay; combo tiers add instrument layers (Geometry Dash feel)
- [ ] FOMO-free but streaky retention: daily seed + streak rewards

## 10. VISUAL & AUDIO DIRECTION

- **Style**: low-poly / flat-shaded synthwave: neon grid floor, gradient sky (magenta→cyan), fog for depth and draw-distance culling, emissive outlines on hazards, bloom via post-processing (cheap UnrealBloomPass, toggleable for performance).
- **The Static** (chaser wall): animated shader glitch wall — pure menace, cheap to render.
- **Readability rule**: hazards are red/orange, collectibles cyan/gold, neutral geometry desaturated — a player must parse any frame in <200 ms.
- **Camera**: smooth-follow behind player, subtle lead-in the direction of movement, FOV 60→75 with speed, shake on impacts, 1.5 s cinematic dolly at phase transitions.
- **Audio**: WebAudio-generated or CC0 synthwave loop at 120–140 BPM; procedural SFX (coin, jump, whoosh, crash); mute toggle; all audio starts only after first user gesture.

## 11. TECHNICAL SPECIFICATION (three.js)

- **Stack**: three.js (latest stable, ES modules via import maps or Vite), no physics engine — custom lightweight kinematics. Single `index.html` + modules, runs from any static host.
- **World generation**: chunk-based. The track = a linked list of ~12 recycled chunks (each ~60 m). When a chunk exits behind the camera, reposition it to the front and repopulate it from **pre-allocated object pools** (obstacles, coins, props). Zero `new Mesh()`/geometry allocation inside the game loop; pooled objects persist, `dispose()` only on true discard.
- **Determinism**: seeded PRNG (e.g., mulberry32) drives all generation — enables the daily challenge seed and fair-testing.
- **Movement model**: the player stays near origin; the world moves toward the camera (classic runner pattern). Fixed-timestep update (60 Hz) with render interpolation; clamp delta-time to avoid tunneling after tab-switch.
- **Collision**: lane-slot + AABB/sphere checks with a swept test for fast obstacles; hitboxes slightly smaller than visuals (Flappy-Bird-style "fair-forgiving" hitboxes). Near-miss detection = expanded hitbox pass that logs "close but clear".
- **Performance budget**: ≤150 draw calls; `InstancedMesh` for coins/props; merged geometries per chunk; frustum culling + fog-limited draw distance; pixel-ratio clamp; quality auto-toggle (bloom/shadow off) if FPS < 50 for 3 s. Target: 60 FPS on a mid-range phone, zero GC pauses.
- **State machine**: `BOOT → MENU → RUN ⇄ PAUSE → DEAD → (revive? RUN : MENU)`. Death/restart must not rebuild the scene — reset pooled state only.
- **Persistence**: localStorage JSON — best score, coins, unlocks, missions, daily streak, settings. Version the save key.
- **Optional stretch**: leaderboard via a tiny free backend (or mock), Web Share API for score cards, PWA manifest for install.

## 12. DIFFICULTY & FAIRNESS RULES (non-negotiable)

1. Speed ramps 12 → 40 m/s over ~10 minutes; never drops mid-run (except scripted fever zones).
2. Pattern library with difficulty tags (easy/med/hard); the spawner only draws patterns rated for current speed, with a guaranteed clear path through every pattern.
3. No obstacle may spawn within 1.2 reaction-seconds of a phase transition.
4. Every coin trail must be completable; trails may tempt toward danger but never through it.
5. First 3 runs of a new player are ~20% slower and sparser (silent onboarding).

## 13. BUILD ORDER (MVP → polish)

**MVP (must ship)**: RUN phase with 3 lanes + jump/slide, chunk recycling + object pooling, coins + score + best score in localStorage, death/restart loop, speed ramp, near-miss popup, sound on/off.
**v1.1**: FLIGHT + DRIFT phases, mystery boxes, combo system, music layers.
**v1.2**: Missions, shop (skins/perks), daily seeded challenge, roulette revive, death cam.
**v1.3**: HOPPER + STACK + ORB phases, Fruit-Ninja slow-mo, ghost replay, gamepad, PWA.

## 14. ACCEPTANCE CRITERIA

- Playable with zero instructions; a new player reaches 500 m within their first 5 runs.
- Restart from death to gameplay ≤ 1 s; no page reload.
- 60 FPS sustained on mid-range mobile hardware; no memory growth over 20 minutes of continuous runs.
- Every death is provably avoidable (patterns guaranteed solvable).
- A run 30+ minutes in still introduces phase combinations the player hasn't seen that session.

---

### Sources used to build this spec
- [Sphere Studios — Top endless runners](https://playspherestudios.com/blog/top-13-endless-running-mobile-games-in-2026) · [Game Developer — Endless runner design guide](https://www.gamedeveloper.com/design/endless-runner-games-how-to-think-and-design-plus-some-history-)
- [Psychology of Games — Near-miss effect](https://www.psychologyofgames.com/2016/09/the-near-miss-effect-and-game-rewards/) · [Emotiv — Psychology of addicting games](https://www.emotiv.com/neuroscience/addicting-games) · [PMC — Flow and gaming](https://pmc.ncbi.nlm.nih.gov/articles/PMC4117294/)
- [Game Developer — Hyper-casual design (Stack, instant loops)](https://www.gamedeveloper.com/design/admiring-the-game-design-in-hyper-casual-games) · [mobilefreetoplay — Top hyper-casual mechanics](https://www.mobilefreetoplay.com/top-10-game-mechanics-for-hyper-casual-games/) · [Thumbsticks — Crossy Road F2P case study](https://www.thumbsticks.com/crossy-road-how-hipster-whale-reinvented-free-to-play/)
- [Envato Tuts+ — three.js endless runner](https://code.tutsplus.com/creating-a-simple-3d-endless-runner-game-using-three-js--cms-29157t) · [Three.js Discourse — object pooling](https://discourse.threejs.org/t/most-performant-approach-to-rapidly-adding-and-removing-objects-from-a-scene/10619) · [Arcade-grade three.js runner (engineering)](https://www.linkedin.com/pulse/how-we-built-arcade-grade-3d-endless-runner-pure-threejs-bo-xu-7mkcc)
