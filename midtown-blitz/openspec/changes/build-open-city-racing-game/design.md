# Design

## Context

The repo is a bare Vite scaffold: `index.html` with a loading shell, `three` ~0.171 and `vite` ~6 in `package.json`, and empty `src/engine/`, `src/game/`, `src/ui/` directories. There is no backend and no existing code to preserve. Motivation and scope are in [proposal.md](proposal.md); behavior contracts are in the five delta specs under `specs/`.

## Goals / Non-Goals

**Goals:**
- A layering that lets one capability be implemented and verified at a time (engine → world → car → traffic → races), matching the task breakdown.
- 60 fps on a mid-range laptop at default quality, with quality tiers for weaker machines.
- Deterministic, code-generated content: same city every run, no asset downloads.
- Frame-rate-independent simulation (spec: `game-shell`).

**Non-Goals:**
- TypeScript, a build framework beyond Vite, or any runtime dependency beyond `three`.
- Third-party physics engine integration (see Decision 4).
- Touch/gamepad support, pedestrians, police, damage modeling, multiplayer, Circuit mode (recorded as out of scope in the proposal; revisit in a later change).

## Decisions

1. **Plain JavaScript ES modules, DOM-overlay UI.** The scaffold has no TS; keep plain ESM with JSDoc headers on exported functions. HUD and menus are DOM/CSS overlays on top of the canvas rather than in-canvas UI — text layout, buttons, and menus are far cheaper in DOM, and the loading screen already establishes the DOM pattern. Alternative (canvas-rendered UI) rejected: more code for worse text quality.

2. **Layering: `engine` is game-agnostic, `game` owns simulation, `ui` owns screens.**
   - `src/engine/`: loop (fixed-timestep accumulator, clamped catch-up), input (keyboard map abstraction), audio manager (WebAudio graph, master gain), math/PRNG helpers, seedable RNG, simple AABB collision queries.
   - `src/game/`: city generation, collision-world build from city data, car physics, traffic AI, race definitions and race state machine, game-mode controller, save/load.
   - `src/ui/`: menu screens, HUD (speedometer, timer, checkpoint arrow, prompts), results screens, settings bindings.
   - `src/main.js`: composes engine + game + ui, owns the top-level mode state machine (`menu / racing / paused / results`).
   Interfaces between layers are plain objects and callback registries; no event-bus framework.

3. **Fixed-timestep simulation, interpolated rendering.** Simulation ticks at a fixed 60 Hz using an accumulator; the renderer interpolates visual transforms between the last two sim states. Catch-up is clamped (max ~5 ticks/frame; beyond that, time is dropped) so a stalled tab does not cause a teleport-sim. This directly satisfies the frame-rate-independence requirement. Alternative (variable dt physics) rejected: physics feel and race fairness drift with frame rate.

4. **Custom arcade car model — no physics engine.** Kinematic bicycle-style model in the horizontal plane: velocity vector in world space, heading from steering with speed-sensitive steering limits, lateral grip pulls velocity toward heading, handbrake cuts rear grip for slides, curb/sidewalk handled as a small allowed elevation step. Car-vs-static uses the circle (or two-circle capsule) body against the city's AABB collision world with impulse-style response; car-vs-car uses circle-circle separation with momentum exchange. Alternatives: `cannon-es`/Rapier rejected — heavier bundle, harder to tune to arcade feel, and the required behaviors (slides, glancing deflections) are simpler with a purpose-built model. Tunneling at ~60 m/s is handled by substepping collision resolution within a tick.

5. **Grid-aligned city with AABB collision world.** City = N×N blocks (10×10; block ≈ 64 m + 14 m road → ~780 m across, ~1 min to cross at top speed). All buildings are axis-aligned boxes registered in a uniform spatial hash of AABBs; props that block (lamp posts as thin cylinders/AABBs) registered likewise. An axis-aligned world makes collision queries cheap and generation simple. Alternative (arbitrary-orientation buildings with OBBs) rejected: cost/complexity without a payoff for arcade driving. Landmarks (park block, tower) may use composed non-AABB visuals but keep coarse AABB colliders.

6. **Rendering performance via instancing and quality tiers.** Buildings, lamps, trees, and parked cars render as `InstancedMesh` with per-instance color; one material per archetype. Shadow casting only at high quality; fog distance and `renderer.setPixelRatio` scale with quality tier (low/medium/high). Traffic cars share the player-car body archetype instanced per color.

7. **Traffic as a lane graph with pooled cars.** The road grid produces a lane graph (two lanes per road, right-hand traffic) at generation time. ~24 active AI cars follow lane waypoints; at intersections they pick straight/left/right from a seeded stream, slow for the turn, and probe ahead (~8 m) to brake for cars or the player. Cars beyond a radius from the player are teleported to unused lane slots near the player (pop-in hidden behind buildings/fog). Parked cars are static positions in the collision world plus instanced meshes.

8. **Audio fully synthesized via WebAudio.** Engine = sawtooth/triangle oscillators with pitch mapped to speed/throttle through a lowpass; skid = filtered noise gain tied to lateral slip; impacts = noise burst with lowpass sweep; checkpoint/UI = short envelopes; music = a lightweight scheduled chord/arp loop. Master gain is the settings volume; the `AudioContext` resumes on first user gesture. No audio files.

9. **Races as data + one race state machine.** Each Blitz route is a definition object: start position/heading, ordered checkpoint points (intersection coordinates from the city grid), time limit, medal thresholds. One state machine drives `countdown → running → finished/failed`; Cruise reuses the same controller with no route and no timer. Records are written through the save module.

10. **Persistence: one namespaced localStorage key.** `midtown-blitz.save.v1` holds `{ settings, records }` as JSON; all reads wrapped in try/catch with defaults fallback, writes are whole-object replaces. Alternative (per-key storage) rejected: more keys to migrate later; single blob is trivially versioned.

11. **Execution model for apply (per user direction):** implementation runs one subagent at a time; the main chat only orchestrates (dispatches a task, reviews the diff/acceptance checks, moves on). tasks.md is written as sequential, self-contained handoffs — each task states its goal, files to touch, and acceptance checks a subagent can complete and verify independently. No parallel subagents.

## Risks / Trade-offs

- [Arcade physics feel takes tuning time] → Car model keeps tunable constants in one file (`game/config` style); tasks include a dedicated tuning/verification pass with concrete test maneuvers.
- [Instanced city can still exceed budget on weak GPUs] → Quality tiers lower pixel ratio and disable shadows first; building/prop counts are constants that can drop without touching code paths.
- [Collision edge cases (corner clipping, car-car spin instability)] → Substepped resolution, capped response impulses, and a verification task that drives scripted maneuvers (wall slam, T-bone, curb hop) via a debug harness.
- [Traffic teleporting visibly] → Recycle only cars beyond fog/draw distance; verify during the traffic task by crossing the city.
- [WebAudio blocked until user gesture] → All sound is lazy; menus click first, and the loading screen is silent by design.
- [DOM HUD layout across aspect ratios] → HUD styled with viewport units and tested at 1280×720, 1920×1080, and ultrawide in the UI task's acceptance checks.

## Migration Plan

Greenfield: the only deployed artifact is the static Vite build. Rollback is `git revert`. No data migration; the save key is versioned (`v1`) so future formats can bump the suffix.

## Open Questions

None material. Exact Blitz route definitions and medal thresholds are tuned during implementation (task-level detail); their shape is fixed by the `race-events` spec.
