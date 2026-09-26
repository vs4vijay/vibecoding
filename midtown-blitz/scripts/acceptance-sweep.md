# Acceptance Sweep — task 6.3 (Full acceptance sweep and build)

Date: 2026-09-19. Scope: `npm run build` + `npm run preview` smoke, a code+harness
verification of EVERY `#### Scenario:` block in the five delta specs
(`/Volumes/Main/GitHub/projects/openspec/changes/build-open-city-racing-game/specs/*/spec.md`),
and a console-clean audit. GUI verification is delegated to the orchestrator's
final visual pass (see the last section).

Verdicts: **PASS** = implementing code verified by reading it, with harness
backing; **PASS-BY-HARNESS** = acceptance is a scripted metric/dump asserted by
a harness (logic additionally code-read); **FIXED** = fallout found and fixed
during this sweep. Result: **46/46 scenarios resolved, 0 FAIL, 0 PARTIAL.**
Two supporting fixes were made (see "Fixes applied during the sweep").

## Build + preview smoke (part 1)

| Check | Result |
| --- | --- |
| `npm run build` | OK — 40 modules, `dist/index.html` + `dist/assets/index-*.js` (581 kB / 157 kB gzip). Vite prints a >500 kB chunk *advisory* (three.js single-bundle app), not an error; no action taken. |
| `vite preview --port 4173` | OK — index 200, JS asset 200 `text/javascript`, bundle syntax-parses (`new Function` check), favicon link present. |
| Dev server on 5173 (reused, untouched) | OK — index 200, `/src/main.js` transforms. |
| Re-run after fixes | Build OK, new asset `index-3EAJLZ8R.js` serves 200 and parses; guard verified present in the minified bundle. |

## game-shell/spec.md

| Scenario | Verdict | Evidence |
| --- | --- | --- |
| First load shows progress | PASS | `src/main.js:358-362` (`loadPhase` paint+linger), `:399-404` (`setProgress` on `#loadbar`), six cost-weighted phases; title/bar markup in `index.html`. Harness: `scripts/boot-integration-test.mjs` (204 checks) asserts the exact phase width sequence [15,35,60,75,92,100]% with a frame yield between consecutive writes. |
| Load completes into menu | PASS | `src/main.js:955` (`#loading` gets `done` → CSS fade), `:1813` boot ends `modes.enterMode('menu')`. Harness: boot-integration (boot lands in MENU, menu DOM attached, sim frozen). |
| Start a race from the menu | PASS | `src/ui/main-menu.js:222-224` card click → `onStartMode(id)`; `src/main.js:1454-1503` fresh racing entry: `teardownRaceSession()`, respawn at the route start (`races.js` data), `race.begin()` returns the first gate; menu hidden. Harness: boot-integration check 12 (Blitz card click → racing, controllable at the route start pose). |
| Pause and resume | PASS | Esc edge `src/main.js:1567-1574`; resume is a `{resume:true}` re-entry that touches nothing (`:1357`, `:1504-1508`); the sim update hook returns unless racing (`:1689-1691`), so car/traffic/timer freeze exactly. Race clock is pure sim time (`src/game/race-controller.js:31-36`). Harness: boot-integration (paused state preserved exactly, resume continues the timer — not a restart); `scripts/modes-test.mjs` (91 checks) for the transition guards. |
| Quit to menu cleans up | PASS | `src/game/modes.js:50-55` legal transitions, `:128-137` teardown registry flushed LIFO before the next enter, `:202-211`; racing-mode cleanup `src/main.js:1546-1551` (test route, reset prompt, HUD, shake); quit path `src/main.js:1367` → menu enter `:1449-1450` (`teardownRaceSession()` + respawn to idle). Harness: boot-integration (after quit: no leftover overlays, only the menu's own cleanup registered, car at the menu idle). |
| Volume change applies immediately | PASS | `src/ui/settings-screen.js:303-308` slider `input` → `onApplyVolume`; `src/engine/audio.js:244-249` `setVolume` clamps + ramps the master gain via `setTargetAtTime` immediately (live even while muted); wired `src/main.js:1096-1102`; persisted through the debounced writer and restored at boot `:1020-1021`. Harness: `scripts/audio-test.mjs` (63 asserts, live gain behavior), `scripts/save-test.mjs` §10 (settings screen drives apply + persist). |
| Quality change applies immediately | PASS | One quality path `src/main.js:1044-1047`; `src/engine/renderer.js:149-161` applies pixel ratio/shadowMap live and marks scene materials for recompile on a shadow flip; `src/game/city-view.js:536-547` adopts sun castShadow + shadow map size; fog/far via `renderer.js:173-185`. Harness: boot-integration checks 6-9 (live tier switches; the debug panel reflects the REAL fog/far state); `scripts/camera-test.mjs` drives the real renderer tier core headless. |
| Records survive reload | PASS | Finish → `applyFinish` (`src/game/records.js:87-137`) → whole-blob persist (`src/game/save.js:245-256`) through the debounced writer (`src/main.js:1269-1285`); the menu re-reads live records on every entry (`src/main.js:1437`, `src/ui/main-menu.js:292-304`). Harness: boot-integration check 13 (scripted win → blob persisted → menu shows best + medal after quitting), `scripts/records-test.mjs` (61 asserts). |
| Corrupted storage tolerated | PASS | `src/game/save.js:204-232` `loadSave` never throws: missing key / throwing getItem / unparsable JSON / non-object → per-field defaults; sanitizers drop unknown and hostile (`__proto__`) keys; `:245-256` the next `saveSave` writes exactly the v1 schema (bad data overwritten). Harness: `scripts/save-test.mjs` (90 asserts: corrupt JSON, junk types, hostile keys, clean re-save). |
| Same pace at different frame rates | PASS-BY-HARNESS | Fixed 60 Hz accumulator with clamped catch-up + render interpolation: `src/engine/loop.js:92-150`; race/traffic/car timers consume sim dt only. Harness: `scripts/loop-test.mjs` (41 asserts: sim clock tracks wall clock, visual time never leaves one tick, dropped-time clamp), plus boot-integration driving the real app from scripted rAF timestamps. |

## city-world/spec.md

| Scenario | Verdict | Evidence |
| --- | --- | --- |
| Same city every run | PASS-BY-HARNESS | `src/game/city-gen.js:356-367` fixed versioned seed `'midtown-blitz-v1'`, per-phase forked rng streams, no `Math.random`/`Date` anywhere in the pipeline (parked cars/traffic fork caller seeds in `main.js:885,921-927`). Harness: `scripts/city-gen-test.mjs` (57 asserts incl. byte-identical JSON dumps from fresh processes). |
| Generation finishes promptly | PASS-BY-HARNESS | Pure-data generation + indexed build; measured in-harness at ~0.9 ms for 100 blocks / 257 buildings / 1164 props (`city-gen-test` output); boot deliberately stretched to <2 s by the phase lingers (`src/main.js:346-347`) — well inside "a few seconds". Harness: boot-integration (phases advance, boot completes headless). |
| Any destination reachable on roads | PASS-BY-HARNESS | `src/game/lane-graph.js:291-544`: two directed lanes per segment on every grid line both axes, junction connectors (straight/left/right, U-turns excluded), corners offer exactly one continuation — the graph is fully connected by construction. Harness: `scripts/lane-graph-test.mjs` (49 checks: every lane segment connects, all sampled turns stay on roads, full grid coverage). |
| City is large enough to explore | PASS | 10×10 blocks (requirement: ≥ 8×8) at 78 m pitch → 780 m edge-to-edge (`src/game/city-gen.js:56-66`, `world.roadSpanM`), matching design Decision 5's "~1 min to cross" at typical city pace. Note for the record: a straight-line flat-out run at the 200 km/h governor covers it faster; the spec's measurable ("at least 8×8 blocks") passes with margin. Harness: lane-graph-test grid coverage + city-gen-test counts. |
| Buildings vary across blocks | PASS | `src/game/city-gen.js:99-108` 8-color facade palette, `:290-321` binary lot subdivision → varied footprints, `:404-427` heights from the downtown factor + rng (8-64 m); rendered with per-instance color (`src/game/city-view.js:403-419`). Harness: city-gen-test asserts footprint/height/color variation; `scripts/city-view-test.mjs` (56 asserts) verifies per-instance colors land on the meshes. |
| Curbs are bump-over | PASS | Elevation model `src/game/collision.js:498-511` (`surfaceHeightAt` = 0 road / 0.15 block, inclusive curb line); crossing never blocks — 6% speed scrub + visual bump only (`src/game/car-physics.js:441-455`, tunables `src/game/config.js:135-148`). Harness: car-physics-test (curb hop without sticking/destroying), collision-test (road centers clear, block surface 0.15). |
| Landmark is identifiable | PASS | `src/game/city-gen.js:429-437,557-571` 150 m tower shaft + spire + accent crown; `src/game/city-view.js:480-506` renders the dedicated spire + crown band so the silhouette reads over the roofs from anywhere. Harness: city-view-test (landmark meshes, silhouette geometry), boot-integration draw accounting. |
| Car cannot drive through buildings | PASS | Every building registered (`src/game/collision.js:229-234`); capsule-vs-AABB resolution substepped so a 55 m/s tick can never tunnel (`src/game/car-physics.js:260-343`, `maxMovePerSubstepM` 0.45 < radius 0.95), residual penetration asserted ~0. Harness: car-physics-test (head-on wall stop, no tunneling, penetration ≤ 0.01 m), collision-test (cross-validation vs brute force). |
| Props block the car | PASS | All lamps and trees (collisionRadius > 0) registered as thin AABBs (`src/game/collision.js:235-239`); the car resolves against them exactly like walls (`car-physics.js:260-343`); parked cars likewise (below). Harness: collision-test (lamp posts hit, 10k-query budget), car-collisions-test (parked solid). |
| Distant geometry fades | PASS | Scene background AND fog share `CITY_SKY_COLOR` (`src/game/city-view.js:57`, `src/main.js:857-859`) so geometry fades into exactly the sky; per-tier near/far/far-plane via `src/engine/renderer.js:173-185`, adopted at boot (`src/main.js:875-876`). Harness: boot-integration checks 5/9 (fog near<far, camera.far > fog.far, sane ordering for every tier). |

## vehicle-control/spec.md

| Scenario | Verdict | Evidence |
| --- | --- | --- |
| Full throttle reaches top speed | PASS-BY-HARNESS | Governor tuning `src/game/config.js:79-100` (200 km/h top, taper above), integration `src/game/car-physics.js:383-385,406`. Harness: `scripts/car-physics-test.mjs` (73 asserts: top speed reached within ~8 s and held). |
| Handbrake slides the car | PASS-BY-HARNESS | Handbrake cuts lateral grip 10 → 1.6 /s + longitudinal scrub (`src/game/car-physics.js:393-397,408-410`, `config.js:124-129`). Harness: car-physics-test (handbrake slide maneuvers under control). |
| Steering responds continuously | PASS | Held keys are polled per tick (`src/engine/input.js:210-217`; `src/main.js:1727-1729` maps left/right each tick), steering angle smoothed with a speed-sensitive cap (`src/game/car-physics.js:244-248,374-376`). Harness: input-test (49 asserts polled state + exactly-once edges), boot-integration (held input drives continuous response). |
| Reverse works | PASS | Brake acts as reverse throttle below 0.35 m/s with a −10 m/s (−36 km/h) governor (`src/game/car-physics.js:386-392`, `config.js:88-93`). Harness: car-physics-test (reverse from standstill to the limited speed). |
| Camera follows through a corner | PASS | Smoothed chase rig, exponential low-pass with look stiffness above position stiffness so the view direction settles before the framing (`src/engine/camera-rig.js:42-48,165-171,232-248`). Harness: `scripts/camera-test.mjs` (91 asserts: cornering follow, bounded trail, frame-rate-independent damping). |
| Camera view toggles | PASS | C mapped to `camera` (`input.js:62`), press edge cycles modes with a snap cut (`src/main.js:1004-1008`, `camera-rig.js:214-230`); chase/hood modes with the car-retuned hood def (`src/main.js:321-324,944-947`). Harness: camera-test (mode cycling + snap behavior). |
| Head-on impact stops the car | PASS | Positional pushout + inward-normal velocity kill with capped rebound (`src/game/car-physics.js:299-317`); impacts ≥ 5 m/s fire the rate-limited `onImpact` → camera shake + impact burst (`src/main.js:902-913`; `src/game/game-audio.js:421-461`). Harness: car-physics-test (head-on stop, no tunneling, onImpact rate limit), game-audio-test (81 asserts, impact envelope). |
| Glancing impact deflects | PASS | Only the normal component is reflected; the tangential component survives → deflection (`car-physics.js:284-311`); car-car side contacts resolve via the deeper of circle-pair/axis-segment tests with momentum exchange (`src/game/car-collisions.js:121-241,269-421`). Harness: car-physics-test (glancing-wall deflection), car-collisions-test (side-swipe deflects both, no interpenetration). |
| Manual reset recovers the car | PASS | R press edge (racing only) raises a flag consumed inside the next tick: `findNearestRoadPosition` maps any point to the nearest centerline, `car.reset` zeroes velocity, rig snaps — all in one 1/60 s tick (`src/main.js:1581-1585,1693-1701`; `src/game/recovery.js:52-79`). Harness: `scripts/recovery-test.mjs` (55 asserts: upright on road, zero speed, deterministic targeting). |
| Flipped car prompts recovery | PASS | Planar physics cannot roll over, so the spec's "flipped" is implemented as the documented stuck equivalent: throttle-held-no-motion ~2 s, sustained embed, or out-of-bounds (immediate) → the HUD prompt "STUCK — PRESS R TO RESET" (`src/game/recovery.js:146-205`; `src/main.js:1800-1801`; `src/ui/hud.js:249-268`). Harness: recovery-test (all three triggers, timing). |

## traffic/spec.md

| Scenario | Verdict | Evidence |
| --- | --- | --- |
| Traffic keeps to its lane | PASS-BY-HARNESS | Right-hand lanes at ±3.5 m off the centerlines (`src/game/lane-graph.js:11-27,375-396`); poses are exact points on the lane polyline — heading chase is cosmetic only (`src/game/traffic.js:359-380`). Harness: `scripts/traffic-test.mjs` (24 checks incl. the lane-keeping metric and determinism). |
| Traffic turns at intersections | PASS | Pre-drawn straight/left/right choices with tangent quarter-circle arcs that stay on the junction asphalt (`src/game/lane-graph.js:253-279,398-423`); traversal + turn-speed slowdown (`src/game/traffic.js:388-415,626-637`). Harness: lane-graph-test (turns stay on roads), traffic-test (turn events counter). |
| Traffic surrounds the player everywhere | PASS | Cars beyond 260 m (medium-tier fog far) recycle into a 100-180 m ring around the player, ≥ 40 m keep-out, clear of solids — outside the visible window, so no pop-in (`src/game/traffic.js:462-540,739-746`). Harness: traffic-test (cross-city player path keeps traffic present throughout). |
| Traffic brakes for a stopped player | PASS | Ahead-probe cone (18 m × ±2.1 m) includes the player always (`src/game/traffic.js:426-460`); obstruction holds at a kinematically safe speed with a 5 m bumper gap and a hard stop clamp (`:649-678`). Harness: traffic-test (stops a safe distance behind a stopped player and waits). |
| Traffic resumes after obstruction clears | PASS | Held cars draw a 0.3-0.6 s reaction delay when the gap reopens, then resume (`src/game/traffic.js:651-659`, `RESUME_DELAY_*` `:109-111`). Harness: traffic-test (resume timing asserted). |
| Parked car is a solid obstacle | PASS | 48 spots along the curbs, each capsule-validated then registered as a static `'parked-car'` AABB (`src/game/parked-cars.js:145-247`), wired before traffic spawns (`src/main.js:893-894`); the player physics treats them exactly like walls. Harness: car-collisions-test + collision-test (parked solid, spots never overlap buildings/cars). |
| Side collision deflects both cars | PASS | Player-authority separation + equal-mass momentum exchange + contact-point torque spin, run last in the tick (`src/game/car-collisions.js:121-241`); traffic integrates the decaying kick/spin/offset fields with a static-solids guard (`src/game/traffic.js:687-737`). Harness: `scripts/car-collisions-test.mjs` (53 checks: T-bone deflects/spins both, separates without interpenetration, queue pile-up without overlap, determinism). |

## race-events/spec.md

| Scenario | Verdict | Evidence |
| --- | --- | --- |
| Winning a blitz race | PASS | Final gate before zero → `phase='finished'`, `onFinish{eventId,timeMs,medal}` (`src/game/race-controller.js:287-301`); main shows results with time + medal (`src/main.js:1269-1285`); three routes with distinct length/difficulty and defined starts (`src/game/races.js:115-189`). Harness: `scripts/race-controller-test.mjs` (130 checks, win path), boot-integration check 12 (real win → results). |
| Time expires mid-route | PASS | Expiry fires on the FIRST tick whose accumulated time reaches the limit, payload clamped to exactly `timeLimitMs` (`race-controller.js:235-253`); main tears the session down and shows the TIME UP variant with RETRY/MENU (`src/main.js:1294-1304`; `src/ui/results-screen.js:215-235`). Harness: race-controller-test (fail path; same-tick tie goes to the driver), boot-integration (TIME UP variant renders). |
| Checkpoint advances in sequence | PASS | Only the CURRENT target is ever sampled, so out-of-order passes do nothing by construction (`src/game/test-route.js:96-118`); a pass chimes (real two-note chime via the `{blip}` shim), advances the HUD target, and moves the world marker (`race-controller.js:278-286`; `src/main.js:1498-1503`). Harness: hud-test §d (order enforcement), race-controller-test §E (out-of-order), boot-integration check 11 (chime + in-order advance). |
| Guidance points off-screen | PASS | Pure projection math: perspective-correct in front, unflipped turn direction behind, edge-rectangle arrow with CSS angle (`src/ui/checkpoint-arrow.js:96-161`); HUD switches diamond↔arrow per frame (`src/ui/hud.js:458-533`). Harness: hud-test (edge arrow tracks off-screen targets), boot-integration check 11. |
| Checkpoint visible in the world | PASS | Additive, `fog:false` beam + ring marker that fog cannot swallow, moved per target, near-camera fade so driving through never whites out (`src/game/checkpoint-marker.js:86-177`); set at `race.begin()` and every `onCheckpoint` (`src/main.js:1498-1503`). Harness: hud-test §f (marker state), boot-integration. |
| Medal from finish time | PASS | Inclusive thresholds gold ≤ silver ≤ bronze (`src/game/races.js:224-230`, per-route thresholds `:115-189`); results medal slot tinted with the shared palette (`results-screen.js:223-225`); menu cards show the saved medal chip (`src/ui/main-menu.js:292-304`). Harness: records-test (61 asserts: medal mapping + both displays). |
| Best time updates | PASS | Best kept only when STRICTLY faster; medal upgrades independently; `isNewBest` drives the NEW RECORD badge (`src/game/records.js:119-136`; `src/main.js:1269-1285` passes standing best + flag). Harness: records-test §i (badge on the record run, hidden on a slower follow-up, stored best intact), boot-integration check 13 (persist end-to-end). |
| Cruise has no fail state | PASS | Cruise = the same controller with no gates/no timer → `'cruising'` forever, update() a no-op (`src/game/races.js:103-107`; `race-controller.js:189-194,326`); ends only via pause-quit (mode machine). Harness: race-controller-test §F (10 min simulated cruise never ends), boot-integration (minute-plus cruise, dimmed timer, no results). |
| Countdown before control | PASS | 3·2·1·GO controller locks controls from `start()` until GO (`src/game/countdown.js:103-178`); main zeroes throttle/brake/steer while locked (`src/main.js:1734-1740`); the race clock starts exactly at the GO boundary — no race time in countdown (`race-controller.js:315-324`). Harness: hud-test (countdown display + lock), boot-integration check 11/12 (held W does not move the car until GO). |

## Console-clean audit (part 3)

- `grep -rn "console." src/ index.html` → **zero matches**: no app code path
  can log anything in a normal session; harnesses also run the real modules
  with no-throw assertions.
- three.js r171 internal warnings were reviewed against every API we call
  (`WebGLRenderer`, `InstancedMesh` + `instanceColor`, `MeshLambertMaterial`,
  `MeshBasicMaterial`, `Fog`, `DirectionalLight`/`HemisphereLight`,
  `CanvasTexture`-free pipeline): no deprecated `outputEncoding`/
  `physicallyCorrectLights`/legacy-geometry usage exists in `src/` (grep
  clean), no textures/XR/tone-mapping/custom shader chunks are used, and the
  shadow-map warn path cannot fire (only the DirectionalLight sun gets
  `castShadow`, and it always owns a shadow object). Program-info warnings
  fire only on failed links, which the standard material programs are not.
- WebAudio autoplay warnings are designed out: the context is created lazily
  inside the first pointer/key gesture (`src/engine/audio.js:178-210`), the
  game-audio graph builds on the first sound, and music DEFERS while the
  manager is still `'uninitialized'` (`src/game/game-audio.js:603-614`) — a
  silent boot constructs no context outside a gesture.
- Fixed during this sweep: (1) a missing favicon meant every session logged a
  404 resource error for `/favicon.ico` — an inline data-URI SVG icon was
  added to `index.html`; (2) the boot-time camera aspect could be NaN/Infinity
  from a collapsed embed pane (the resize path was already guarded; the
  constructor was not) — see below.
- Known remaining (accepted, reported): `index.html` loads Google Fonts
  (pre-existing scaffold design). Online sessions are silent; an OFFLINE
  session would log font fetch failures. Not removed because it is the
  scaffold's visual design decision, not game code.

## Fixes applied during the sweep

1. **Camera aspect guard at construction** — `src/main.js:860-873`. The
   constructor used bare `window.innerWidth / window.innerHeight`; a collapsed
   pane booting at 0/non-finite size produced a NaN/Infinity aspect and a
   degenerate projection for the first frames (the resize guard in
   `src/engine/renderer.js:205-233` only healed it on a later valid resize).
   Boot now falls back to 16/9 (matching the renderer's 1280×720 fallback)
   until a real resize arrives. Verified present in the rebuilt bundle.
2. **Inline SVG favicon** — `index.html:9-15`. Kills the guaranteed
   `/favicon.ico` 404 console error in every session without adding an asset
   or a network fetch.

After both fixes: `npm run build` OK and **all 21 harness suites green**
(boot-integration 204, hud 140, race-controller 130, save 90, modes 91,
game-audio 81, records 61, camera 91, car-physics 73, audio 63, city-view 56,
recovery 55, car-collisions 53, car-view 58, collision 50, input 49,
lane-graph 49, loop 41, perf-audit 41, city-gen 57, traffic 24 checks).

## For the orchestrator's final visual pass (highest-risk spots)

1. **Feel items only a human can judge**: handbrake slide control feel,
   chase-camera tightness through 90° corners, curb bump readability.
2. **Loading sequence**: the six-phase bar (15→35→60→75→92→100%) and the fade
   to a live menu — confirm the fade never reveals a blank canvas on real GPU.
3. **Audio unlock choreography**: first click on a menu card should start
   music + engine without any autoplay warning; volume slider audibility
   mid-race.
4. **Traffic pop-in**: watch for teleports at the fog edge during a fast
   cross-city drive (recycle ring is hidden behind fog by design).
5. **Results flow with sound**: win chime + NEW RECORD badge, TIME UP variant,
   retry path, and quit-to-menu leaving no HUD/timer/marker behind.
6. **Ultrawide/narrow windows**: HUD (viewport-unit layout) and the new
   boot-aspect guard — resize through degenerate sizes and back.
7. Google Fonts must load (online) for the intended title typography; offline
   it falls back to system fonts with console noise (documented above).
