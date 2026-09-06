# Lugaru Web — Design Spec

Date: 2026-08-22
Status: Approved design (pending implementation plan)
Source research: Wikipedia (Lugaru), Wolfire Games wiki combat strategy docs, wolfire.com/lugaru feature list

## 1. Vision

A browser remake of the core of *Lugaru: The Rabbit's Foot* (Wolfire, 2005): a
3D third-person arena brawler whose entire depth comes from **timing and
positioning**, not button combos. Three context-sensitive buttons. Every attack
can be reversed; every reversal can be counter-reversed. Enemies simulate
senses — wolves smell blood and track wind, rabbits hear rustling bushes.

v1 is a **combat prototype**: one island arena, waves of AI opponents
(1v1 → 1v2 → 1v3), an interactive tutorial, score screen. Not in v1: story
campaign, challenge map progression, online multiplayer, mobile touch,
custom character models.

Decisions locked with user:
- Scope: combat prototype first (prove the reversal combat loop)
- Presentation: full 3D third-person, like the original
- Art: procedural low-poly characters + procedural animation, no external assets
- Players: single-player vs AI
- Platform: desktop browser only (keyboard + mouse)
- Stack: TypeScript + Vite (bun) + three.js rendering + Rapier WASM physics

## 2. Architecture

New project at `lugaru-combat/`. Vite + TypeScript strict mode, bun as package
manager. No server component; everything client-side. localStorage for scores.

```
src/
├── core/      game loop (fixed 60Hz sim, interpolated render),
│              input manager (pointer lock mouse + WASD + 3 action keys),
│              timescale (hitstop / slow-mo)
├── combat/    character state machine, move table (data),
│              context resolver (pure), reversal windows, injury model,
│              scoring/bonuses
├── ai/        perception (sight cones, hearing events, scent field),
│              brain FSM (patrol/investigate/circle/engage/flee/down),
│              utility attack picker + anti-repetition memory
├── actors/    procedural skeletons (rabbit/wolf), pose data structures,
│              clip player with crossfade blending, ragdoll bridge
├── world/     heightfield terrain, bushes (rustle events), walls,
│              weapon pickups, wind system
├── render/    three.js scene assembly, chase camera, FX (blood decals,
│              hitstop kick, low-HP desaturation+blur), foliage sway
├── ui/        main menu, tutorial prompts, wave/results screens, pause
└── data/      moves.ts, tuning.ts — all timing/tuning constants in one place
```

Principles:
- **Fixed-step simulation** (60Hz) with render interpolation. Combat logic is
  pure functions over `(actorState, worldState)` → unit-testable headless.
- **Data-driven moves**: state machine reads only the move table. Adding a move
  = new data entry + pose clip; no logic changes.
- **Zero per-frame allocations** in the sim loop (pre-allocated scratch vectors).

## 3. Combat System

### 3.1 Input & Context Resolution

One pure function decides what a button press means:

```
resolveAction(input, actor, world) → Action | null
```

| Button   | Standing        | Running            | Crouched                  | Near wall     | Enemy downed  | Enemy airborne |
|----------|-----------------|--------------------|----------------------------|---------------|---------------|----------------|
| Attack   | punch → double-punch (held) | running kick | leg sweep                 | wall-kick     | soccer kick   | air-grab throw |
| Jump     | jump            | leg cannon (near enemy) | hop                   | wall-jump     | —             | mid-air flip*  |
| Crouch   | crouch (**timed press = reverse**) | slide-stop | pickup weapon / throw body / clean blade | — | — | flip |

\* Mid-air flip stuns nearby attackers ~1.5s and cancels air-grabs.

### 3.2 Timing Model

Every attack has `startup → active → recovery` phases with ms durations from
the move table. Rules:

- A **reversal** succeeds iff crouch is pressed within the attack's
  `reversalWindow` (a sub-range of startup+active) while facing the attacker.
- Too early: whiffed duck — attacker may follow with a low kick (only usable
  vs crouched targets).
- Too late: hit lands.
- **Counter-reversal**: during the reversal animation's counter window, the
  original attacker gets a tighter window to reverse back.

### 3.3 Anti-Repetition

Track last N attacks per fighter. Same attack 3× consecutively → each further
repeat has sharply increasing probability of being reversed or blocked by AI.
This forces varied offense — it is the original's hidden depth and must be in
the resolver/AI contract from day one.

### 3.4 Injury Model (no HUD)

HP pool plus status flags: `bleeding` (blade hits; drains HP over time),
`limping` (<40% HP: slower movement, hunched posture), `unconscious`
(tackles/throws can KO without killing). Player reads health through:
posture changes, blood decals accumulating on body mesh, screen desaturation +
blur at low HP, ragdoll weight on death. Wolves take more damage before limping;
wolves cannot be reversed from behind (per original).

### 3.5 Weapons

| Weapon | Melee | Special | Durability |
|---|---|---|---|
| Knife | fast, low dmg slices; 2-in-a-row → throat stab finisher | throwable: OHK unarmored, sticks in target/body, retrievable | indestructible |
| Sword | long range, causes bleeding | best disarm reward via reversal | indestructible |
| Staff | vertical (standing) + horizontal (running) swings, knockback | breaks after N blocked/clashing hits | ~6 hits |

Weapon clash: two simultaneous weapon attacks → clang, repeat until one flies
off or breaks. Disarms happen via successful reversals against armed enemies
(weapon drops nearby, either fighter can pick up). Crouch+attack with blade
stabs ground → cleans blood (stealth mechanic). Body-throw: crouch+attack on a
downed/unconscious body launches it as a projectile ("Nice Aim" if it hits an enemy).

### 3.6 Scoring

Combo chain ×2 ×4 ×8 ×16 (66→133→266→533→1066 pts, decays past 5th hit);
Reversal 30; Reversal-KO 100; Stealth kill 100; Leg cannon 100;
Nice Aim 150; Style bonus (wall-kick kill) 150; Ninja bonus (mid-air knife
throw kill) 60. Score shown on results screen with bonus breakdown; persisted
best score/time per wave-set in localStorage.

### 3.7 Stealth Kills

Behind an unaware enemy (their FSM not in engage): standing attack = spine
crusher; knife = tracheotomy; sword = backstabber. All instant-KO/kill, silent,
100 pts. Unarmed stealth requires standing behind; rolling gets close enough
for rabbits but not wolves (roll noise); wolves need a long-jump approach.

## 4. Characters & Animation

Procedural skeletons built in code (~14 bones: pelvis, spine, neck/head,
2×(upper/lower arm), 2×(upper/lower leg)). Rabbit ~1.2m; wolf larger and
heavier with different move stats (harder punches, better scent, no behind-reversal).

Poses = joint rotation keyframes; clips = pose sequences with easing. The clip
player crossfades locomotion ↔ attack ↔ reaction clips. An orientation layer
keeps the body aligned to terrain slope and velocity lean.

Ragdoll bridge: on KO/death, kinematic capsule + skeleton hand off to dynamic
ragdoll bodies seeded from current bone transforms; killing blow applies its
impulse. Ragdoll bone transforms drive the rendered mesh afterward.

## 5. Physics Regimes (Rapier WASM)

1. Standing fighters: kinematic capsules — never dynamic; crisp combat.
2. Attacks: pure math arc/range checks — no physics queries on the hot path.
3. Ragdolls: dynamic bodies only after KO/death; capped count; culled after settling.
4. World: Rapier heightfield collider matching the terrain mesh; box colliders for walls; thrown knives/bodies as short-lived dynamic bodies.

## 6. World

Single island arena: rolling hill heightfield (vertex-colored grass/dirt/snow
patches), ~40 interactive bushes (rustle hearing events when brushed while
running/crouch-walking), 3–5 wall clusters (wall-kick/wall-jump surfaces),
weapon pickups placed around the arena (knife ×2, staff ×2, sword ×1).

Wind system: global direction + speed vector; drives foliage sway, snow/dust
particle drift (visible wind tells), and scent-field advection.

## 7. AI

Pipeline per enemy: perception → FSM → utility action picker.

- **Perception**: sight cone (range/FOV reduced when target crouched), hearing
  events (running near bushes, hard landings, screams), scent field (wolves:
  scalar strength advected by wind; bloodied player or bloody weapon raises
  emission radius).
- **FSM**: patrol → investigate(point of interest) → circle/approach → engage →
  flee-at-low-HP (runs toward allies, scream = alert event) → unconscious/dead.
- **Engagement**: utility scoring `damage × hitProbability(context) ×
  antiRepetitionPenalty(sameMoveStreak)` picks among available moves; reversal
  attempts sample the player's actual startup phase with difficulty-scaled
  reaction time; difficulty also scales reversal probability + memory length.
- **Groups**: max N attackers engage simultaneously; others circle at radius.
  v1: circle only, no coordinated flanking.

Difficulty presets (Easy/Normal/Hard) adjust: reaction ms, reversal chance,
anti-repetition memory, aggression, group engage limit.

## 8. Game Flow

Main menu → Tutorial (interactive, 6 steps: movement, attack, reversal,
leg-cannon, pickup/body-throw, stealth kill) → Arena waves (1v1 → 1v2 → 1v3,
next wave spawns on clear) → Results (score, bonuses, time, best records).
Death: slow-mo ragdoll moment → retry same wave. Pause menu (resume/restart/
menu). Pointer lock loss or tab blur auto-pauses.

## 9. Error Handling

- Rapier/WASM load failure or shader compile error → explicit error screen with
  retry; never a black canvas.
- Frame spikes: clamp catch-up to ≤4 sim steps/frame; slow-mo beyond that.
- localStorage unavailable → game runs, scores just don't persist (guard reads/writes).

## 10. Testing Strategy

Unit tests (vitest) over pure combat logic — no WebGL required:
- Context resolver truth table (button × stance × proximity/wall/downed → move)
- Reversal windows: early whiff / in-window+facing success / late hit;
  counter-reversal tighter-window rule
- Anti-repetition streak penalty growth
- Combo scoring chain and bonus awards (Nice Aim, Style, Ninja)
- Injury model: bleed ticks, limp threshold, unconscious transitions
- Scent advection by wind; hearing event falloff
- Ragdoll handoff seeds correct transforms/impulses (headless Rapier)

Headless sim harness: scripted fixed-step 1v1 fight, asserts termination,
grounded actors, no NaNs.

Visual verification: playwright-cli drives real page (menu, tutorial flow,
arena screenshots); dev stats overlay for fps/draw calls.

Performance budget: 60fps on integrated GPUs; instanced foliage; pooled FX;
zero sim-loop allocations.

## 11. Milestones (for planning)

M1 Playable fighter: terrain, camera, input, rabbit rig, locomotion + punch/sweep,
  dummy target, ragdoll on dummy KO (kinematic→dynamic handoff).
M2 Combat depth: full move table, reversals + counter-reversals, anti-repetition,
  injury model, hitstop/slow-mo FX, scoring.
M3 Weapons: three weapons, clash/disarm/throw/retrieval, cleaning, body-throw.
M4 AI opponent: perception incl. scent/hearing, FSM, utility engagement,
  flee/alert behavior; 1v1 fights.
M5 Stealth + senses layer: bushes rustle, wind tells, stealth kills, difficulty presets.
M6 Game shell: menu, tutorial steps, wave progression, results/persistence, polish pass.
