# Lugaru Web Combat Prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser remake of Lugaru's core loop — 3D third-person arena combat where three context-sensitive buttons, timing-based reversals, simulated senses (scent/hearing), and ragdoll physics deliver the original's depth.

**Architecture:** Decoupled fixed-step simulation (60Hz, pure TypeScript, no three.js imports) observed by a three.js renderer with interpolation. Rapier WASM is used ONLY for cosmetic dynamics (ragdolls, thrown knives, corpses, dropped weapons); fighters are kinematic capsules with analytic terrain height and circle-vs-box wall pushout, keeping combat deterministic and headless-testable. Moves are a data table consumed by one state machine; AI is perception → FSM → utility picker.

**Tech Stack:** Bun, Vite 7, TypeScript 5 strict, three ^0.180, @dimforge/rapier3d-compat, vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-22-lugaru-combat-design.md` — implementers MUST read the spec; this plan argues from it. Section references below ([spec §N]) point there.

## Global Constraints

- Package manager: `bun` — never `npm`/`npx`; prefix shell commands with `rtk` per repo AGENTS.md.
- TypeScript `"strict": true`; no `any` except the two documented interop boundaries (`rapier3d-compat` raw handles, `three` Object3D maps).
- **Sim/renderer separation (hard rule):** nothing under `src/combat/`, `src/ai/`, `src/core/`, `src/data/` may import `three` or Rapier. The renderer reads sim state; sim never renders.
- Determinism: no `Date.now()` or bare `Math.random()` inside the sim — inject `clockMs` and a seeded `mulberry32` RNG (`src/core/rng.ts`).
- Fixed timestep 16.667ms; catch-up clamp 4 steps/frame [spec §9]; zero heap allocations inside per-step update paths (preallocated scratch vectors).
- Every gameplay timing/damage number lives in `src/data/moves.ts` or `src/data/tuning.ts` — magic numbers elsewhere are review rejections.
- No HUD over gameplay [spec §3.4]: health is diegetic only. Allowed UI: menu, tutorial prompts, wave banners, results, pause, error screen, optional F3 debug overlay (dev builds only).
- Desktop only; show a fullscreen notice if `matchMedia('(pointer: coarse)')` matches.
- Controls (locked): mouse-look via pointer lock; WASD move; **LMB = attack**, **Space = jump**, **Shift = crouch/reverse/context**. Nothing else.
- Every task ends with: `rtk vitest run` green (whole suite) + the task's listed verification, then one conventional-commit.
- Browser verifications use the `playwright-cli` skill against `bun run dev` (port 5173) unless stated otherwise.

## File Structure

```
lugaru-combat/
├── package.json  tsconfig.json  vite.config.ts  index.html  .gitignore  README.md
├── src/
│   ├── main.ts                  # boot, error overlay wiring, coarse-pointer guard
│   ├── game.ts                  # Game class: owns sim + renderer + ui, mode switching
│   ├── core/    loop.ts  timescale.ts  input.ts  rng.ts  clock.ts
│   ├── data/    moves.ts  weapons.ts  tuning.ts  species.ts
│   ├── combat/  types.ts  resolver.ts  stateMachine.ts  reversal.ts
│   │            antirepetition.ts  injury.ts  scoring.ts  hitdetect.ts
│   │            weaponsLogic.ts  stealth.ts
│   ├── ai/      perception.ts  scent.ts  brain.ts  engage.ts  difficulty.ts
│   ├── actors/  skeleton.ts  clips.ts  clipsData.ts  controller.ts  ragdoll.ts
│   ├── world/   terrain.ts  physics.ts  wind.ts  bushes.ts  pickups.ts  projectiles.ts
│   ├── render/  scene.ts  camera.ts  fx.ts  debugStats.ts
│   └── ui/      dom.ts  menu.ts  tutorial.ts  waves.ts  results.ts  pause.ts  errorScreen.ts
└── tests/                       # mirrors src/; plus tests/sim/harness.test.ts
```

---

### Task 1: Project scaffold with guarded boot

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/ui/errorScreen.ts`, `.gitignore`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `initErrorScreen(): {show(title:string, detail:string): void}` — every later task's async boot failure routes here. Dev scripts: `bun run dev|build|preview|test`.

- [ ] **Step 1: Write config + entry files**

`package.json`:
```json
{
  "name": "lugaru-combat",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "three": "^0.180.0",
    "@dimforge/rapier3d-compat": "^0.19.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0",
    "@types/three": "^0.180.0"
  }
}
```

`tsconfig.json`: standard Vite template values with `"strict": true`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"types": ["vite/client"]`, `"include": ["src", "tests"]`.

`index.html`: dark background, `<div id="app">`, `<canvas id="game">`, hidden `<div id="error-screen">` (title, `<pre id="error-detail">`, Retry button calling `location.reload()`), hidden `<div id="coarse-warning">` ("This game needs a keyboard and mouse."), and `<div id="ui-root">` for all menu/UI DOM. Load `/src/main.ts` as module.

`src/ui/errorScreen.ts`:
```ts
export function initErrorScreen(): { show(title: string, detail: string): void } {
  const el = document.getElementById('error-screen')!;
  el.querySelector('#error-title')!.textContent = '';
  return { show(title, detail) {
    el.querySelector('#error-title')!.textContent = title;
    (el.querySelector('#error-detail') as HTMLElement).textContent = detail;
    el.classList.remove('hidden');
  }};
}
```

`src/main.ts`: `async function boot()` — guards `matchMedia('(pointer: coarse)').matches` → unhide `#coarse-warning` and return; creates renderer + game (placeholder `console.log('boot ok')` for now); entire body wrapped in try/catch → `errors.show('Failed to start', String(err))`. Call `boot()`.

`.gitignore`: `node_modules/`, `dist/`, `.playwright-cli/`, `*.local`.

- [ ] **Step 2: Install and verify tooling**

Run: `bun install && rtk vitest run`
Expected: install ok; vitest reports "no test files found" is FAILURE here — so first write Step 3's test, then run.

- [ ] **Step 3: Write smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('scaffold', () => {
  it('declares required dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies.three).toBeDefined();
    expect(pkg.dependencies['@dimforge/rapier3d-compat']).toBeDefined();
  });
});
```

- [ ] **Step 4: Run suite** — `rtk vitest run` → PASS (1 test).

- [ ] **Step 5: Verify page boots** — `bun run dev`; playwright-cli: open `http://localhost:5173`, assert no `#error-screen` visible, canvas present. Kill server.

- [ ] **Step 6: Commit** — `rtk git add -A && rtk git commit -m "chore: scaffold lugaru-combat (vite+ts+three+rapier)"`

---

### Task 2: Fixed-step loop, timescale, seeded RNG

**Files:**
- Create: `src/core/loop.ts`, `src/core/timescale.ts`, `src/core/rng.ts`
- Test: `tests/core/loop.test.ts`, `tests/core/timescale.test.ts`

**Interfaces:**
- Produces:
  - `class FixedLoop { constructor(stepMs: number, update: (stepDtMs: number) => void); advance(realDtMs: number): number }` — returns steps executed; clamps catch-up to 4 steps.
  - `class Timescale { value: number; hitstop(durationMs: number): void; slowmo(scale: number, durationMs: number): void; update(realDtMs: number): number }` — returns effective dt multiplier this frame; hitstop yields 0; slowmo decays linearly back to 1.
  - `mulberry32(seed: number): () => number` — pure PRNG `[0,1)`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/core/loop.test.ts
import { describe, it, expect } from 'vitest';
import { FixedLoop } from '../../src/core/loop';

describe('FixedLoop', () => {
  it('executes one step per accumulated stepMs', () => {
    let steps = 0;
    const loop = new FixedLoop(16.667, () => { steps++; });
    loop.advance(16.667); loop.advance(16.667);
    expect(steps).toBe(2);
  });
  it('clamps catch-up to 4 steps after a long freeze', () => {
    let steps = 0;
    const loop = new FixedLoop(16.667, () => { steps++; });
    loop.advance(500); // 30 steps worth
    expect(steps).toBe(4);
  });
  it('carries remainder across frames', () => {
    let steps = 0;
    const loop = new FixedLoop(10, () => { steps++; });
    loop.advance(15); loop.advance(15); // 1 + 2 steps (5ms carried twice -> second frame 20ms)
    expect(steps).toBe(3);
  });
});
```

```ts
// tests/core/timescale.test.ts
import { describe, it, expect } from 'vitest';
import { Timescale } from '../../src/core/timescale';

describe('Timescale', () => {
  it('defaults to 1', () => expect(new Timescale().update(16)).toBeCloseTo(1));
  it('hitstop returns 0 then recovers', () => {
    const ts = new Timescale();
    ts.hitstop(50);
    expect(ts.update(16)).toBe(0);
    expect(ts.update(40)).toBeCloseTo(1); // hitstop expired
  });
  it('slowmo scales then decays back to 1', () => {
    const ts = new Timescale();
    ts.slowmo(0.25, 400);
    expect(ts.update(16)).toBeCloseTo(0.25);
    ts.update(380);
    expect(ts.update(16)).toBeCloseTo(1, 1);
  });
});
```

- [ ] **Step 2: Run** `rtk vitest run tests/core` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`FixedLoop.advance`: accumulate `realDtMs` into `acc`; `let n = Math.floor(acc / stepMs); n = Math.min(n, MAX_CATCH_UP=4); acc -= n * stepMs; if (acc > stepMs * 4) acc = 0;` call `update(stepMs)` n times; return n.
`Timescale`: fields `value=1`, timers; `hitstop` sets `hitstopMsLeft`; `slowmo(s,d)` sets `slowScale, slowMsLeft`; `update(realDt)`: if hitstop left → decrement, return 0; else if slow left → decrement by realDt, return `slowScale`, and when expired return 1.
`rng.ts`: standard mulberry32 implementation (uint32 LCG with `Math.imul`, return `x / 4294967296`).

- [ ] **Step 4: Run** `rtk vitest run tests/core` → PASS.

- [ ] **Step 5: Commit** — `feat: fixed-step loop, timescale, seeded rng`

---

### Task 3: Input manager

**Files:**
- Create: `src/core/input.ts`
- Test: `tests/core/input.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface InputFrame { moveX: number; moveZ: number; lookDX: number; lookDY: number; pressed: { attack: boolean; jump: boolean; crouch: boolean }; held: { attack: boolean; jump: boolean; crouch: boolean } }`
  - `class InputManager { attach(el: HTMLElement): void; detach(): void; requestPointerLock(): void; sample(): InputFrame }` — `sample()` returns and clears edge (`pressed`) state and look deltas. Buttons: LMB=`attack`, Space=`jump`, ShiftLeft=`crouch`. WASD/arrows → normalized `moveX/moveZ`. Pointer-lock loss does NOT throw; `isLocked` accessor exposed.

- [ ] **Step 1: Write failing tests** — use `jsdom`-free synthetic events: vitest environment 'jsdom' for this file (`// @vitest-environment jsdom` pragma; jsdom ships with vitest). Dispatch `KeyboardEvent('keydown', {code:'KeyW'})` on `document`, `MouseEvent('mousedown', {button:0})` on element; assert `sample()` shows `pressed.attack === true`, second `sample()` shows false while held stays via separate `mouseup`. Assert W+D normalizes to `(≈0.707, ≈-0.707)`. Assert mousemove accumulates `movementX/Y` into lookDX/DY and clears on sample. Assert Shift keyup clears `held.crouch`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `InputManager` (event-listener state object; edges stored in a Set cleared on sample; pointerlockchange updates `isLocked`; `requestPointerLock` wrapped in try/catch for jsdom). **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `feat: pointer-lock input manager with edge sampling`

---

### Task 4: Terrain, scene, chase camera

**Files:**
- Create: `src/world/terrain.ts`, `src/render/scene.ts`, `src/render/camera.ts`, `src/render/debugStats.ts`
- Modify: `src/main.ts` (real boot), `index.html` (F3 hint comment only)

**Interfaces:**
- Produces:
  - `heightAt(x: number, z: number): number` — THE single source of terrain truth; analytic, imported by sim AND mesh builder.
  - `buildTerrainMesh(): THREE.Mesh` — 120m plane, 128×128 segs, vertices displaced by `heightAt`, vertex colors grass/dirt/snow bands.
  - `class ChaseCamera { constructor(camera: THREE.PerspectiveCamera); update(dtSec: number, targetPos, targetHeading: number, lookDX, lookDY): void; distance: number }` — pointer-driven orbit, lerp follow, clamped pitch [-0.15π, 0.45π], never below `heightAt(cam.x,z)+0.4`.
  - `createScene(canvas): { renderer, scene, sunLight, hemiLight }`.
  - `DebugStats`: F3-toggled `<div>` updating fps twice/sec.

- [ ] **Step 1: Implement** (visual surface — no unit tests; verified in browser):

`terrain.ts`:
```ts
export function heightAt(x: number, z: number): number {
  return 1.2 * Math.sin(x * 0.08) * Math.cos(z * 0.06)
       + 0.6 * Math.sin((x + z) * 0.045)
       + 0.25 * Math.sin(x * 0.21 + z * 0.17);
}
```
Mesh: iterate `PlaneGeometry(120,120,128,128)` positions, set `pos.y = heightAt(x,z)` (rotate plane -π/2 X first so xz map directly), `computeVertexNormals()`; color per vertex by height + hash noise: h<0.4 grass `#5a7a3a`, mid dirt `#7a6a4a`, h>1.8 snow `#dfe6ea`, dithered ±8% lightness. Material `MeshStandardMaterial({ vertexColors: true, flatShading: true })`.

`camera.ts`: spherical offset (yaw,pitch) around target head point (`targetPos + [0, 1.4, 0]`), `distance=4.6`, smoothing `pos.lerp(desired, 1 - Math.exp(-12*dtSec))`, yaw -= lookDX*0.0022, pitch clamp, terrain clearance as specified.

`scene.ts`: fog `Fog(#bcd6e4, 40, 110)`, sky `scene.background = #bcd6e4`, directional sun (2048 shadowmap, camera bounds ±40) + hemisphere light; appends terrain mesh.

- [ ] **Step 2: Wire boot** — `main.ts` creates scene+camera+terrain+stats, RAF loop calling only camera.update with fake stationary target at origin, `renderer.render`.

- [ ] **Step 3: Browser verify** — dev server + playwright-cli: (a) screenshot shows shaded hill terrain with color bands; (b) after click (pointer lock), synthetic mouse-move orbits camera; (c) F3 toggles stats showing ~60fps; (d) console free of errors.

- [ ] **Step 4: Commit** — `feat: analytic terrain, lit scene, chase camera`

---

### Task 5: Procedural rabbit rig, pose clips, locomotion

**Files:**
- Create: `src/data/species.ts`, `src/actors/skeleton.ts`, `src/actors/clips.ts`, `src/actors/clipsData.ts`, `src/actors/controller.ts`
- Modify: `src/main.ts` (spawn player, feed input)

**Interfaces:**
- Consumes: `InputFrame`, `heightAt`, `ChaseCamera`.
- Produces:
  - `interface SpeciesDef { id: 'rabbit'|'wolf'; hipHeight: number; torsoLen: number; limbLens: {...}; massKg: number; maxHp: number; runSpeed: number; crouchSpeed: number; colors: { fur: number; belly: number }; punchDmgMult: number }` + `SPECIES: Record<'rabbit'|'wolf', SpeciesDef>`.
  - `buildRig(def): Rig` where `Rig = { root: THREE.Group; bones: Record<BoneName, THREE.Object3D>; boneLen: Record<BoneName, number> }`; `BoneName = 'pelvis'|'spine'|'head'|'armLU'|'armLL'|'armRU'|'armRL'|'legLU'|'legLL'|'legRU'|'legRL'`.
  - `type Pose = Record<BoneName, [number,number,number]>` (euler rad); `samplePose(clip: Clip, tMs: number): Pose` (ease-in-out between keys); `class ClipPlayer { play(name: string, fadeMs?: number): void; update(dtMs: number): void; applyTo(rig: Rig): void; current: string; finished: boolean }`.
  - `class CharacterController { constructor(rig, def); update(dtMs: number, input: InputFrame, locked: boolean): void; pos: THREE.Vector3; vel; heading; stance: Stance; crouchHeldMs: number }` — gravity −14, jump v 5.4, speeds from def, ground snap `max(y, heightAt+…)`, root slerp toward velocity heading, terrain-slope alignment, stance computed ('standing'|'running'|'crouched'|'airborne'). Exposes `consumeJumpRequest()` etc.? NO — controller is display+kinematics only; action decisions come later from resolver reading its public state fields.

- [ ] **Step 1: species.ts** — rabbit: hip 0.62, runSpeed 6.2, crouchSpeed 1.8, maxHp 100, mass 30; wolf: hip 0.85, runSpeed 6.6, maxHp 160, mass 70, punchDmgMult 1.6, darker fur.

- [ ] **Step 2: skeleton.ts** — hierarchy pelvis→spine→head; shoulders off spine top → upper/lower arms; hips off pelvis → upper/lower legs. Each bone: `THREE.Group` at joint origin + child `Mesh(BoxGeometry(len,len*0.45,len*0.45))` translated `-len/2` on local Y so rotation pivots at joint. Flat-shaded standard material, fur color, castShadow.

- [ ] **Step 3: clips.ts + clipsData.ts** — `Clip = { durMs: number; loop: boolean; keys: { t: number; pose: Partial<Pose> }[] }` (partial poses merged over base idle pose). Data: `idle` (breath bob, loop), `run` (4-key diagonal leg swing, loop), `crouchWalk` (low gait, loop), `jump` (tuck, once), `fall`, `roll` (ball tuck 420ms), `punchR`, `punchL` (for double-punch alternate), `kickFront`, `sweep` (deep crouch spin), `hurt`, `koFlail`. Poses authored as literal euler tables — keep each ≤6 keys.

- [ ] **Step 4: controller.ts** — integrates input: desired horizontal vel from move vector rotated by camera yaw; accel 40, friction 24; jump when `pressed.jump && grounded`; crouch toggles stance (hold), tracks `crouchHeldMs`; picks clip: airborne→jump/fall, speed>4→run, crouched+moving→crouchWalk, else idle; one-shot clips play to end unless interrupted by locomotion need.

- [ ] **Step 5: Wire + browser verify** — player rabbit at (0, h, 0), ChaseCamera targets it, InputManager feeds controller. playwright-cli: (a) run forward 2s → screenshot shows run pose mid-stride displaced ~10m; (b) jump → leaves ground; (c) hold Shift → low crouch pose; (d) walk uphill → body tilts with slope; (e) fps still ≥58.

- [ ] **Step 6: Commit** — `feat: procedural rabbit rig with pose clips and locomotion`

### Task 6: Combat types, move table, context resolver

**Files:**
- Create: `src/combat/types.ts`, `src/data/moves.ts`, `src/combat/resolver.ts`
- Test: `tests/combat/resolver.test.ts`

**Interfaces:**
- Consumes: `Stance` from controller (re-declared sim-side as `'standing'|'running'|'crouched'|'airborne'`), move ids.
- Produces:
  - `type ActionButton = 'attack'|'jump'|'crouch'`; `type MoveId = 'punch'|'doublePunch'|'runningKick'|'legSweep'|'wallKick'|'soccerKick'|'airGrab'|'legCannon'|'jump'|'hop'|'flip'|'tackle'|'pickupOrContext'|'slideStop'|'stealthKill'|'reverseAttempt'|'bodyThrow'|'cleanBlade'` (string union).
  - `interface MoveDef { id: MoveId; clip: string; startupMs: number; activeMs: number; recoveryMs: number; rangeM: number; arcRad: number; damage: number; knockdown: boolean; reversalWindow?: { from: number; to: number }; counterWindow?: { from: number; to: number }; requiresCrouchedTarget?: boolean; requiresDownedTarget?: boolean; requiresAirborneTarget?: boolean; requiresWallWithinM?: number; requiresBehindUnaware?: boolean; weaponClass?: 'none'|'knife'|'sword'|'staff' }`.
  - `MOVES: Record<string, MoveDef>` — every value in §3 tables [spec].
  - `resolveAction(button, actor: CombatantSnapshot, worldCtx: WorldContext): { kind: 'move'; id: MoveId } | { kind: 'reverse'; targetId: string } | null` where `CombatantSnapshot = { id; stance; isRunning; crouchHeldMs; pos; heading; hasWeapon: WeaponClass|null; wallProximityM; nearestTarget: { id; dist; relAngle; stance; isDowned; airborne; facingMe; unaware } | null }`, `WorldContext = { downedBodyNearby: boolean; weaponOnGroundNearby: boolean; airborneSelf: boolean }`. Pure — no I/O.

- [ ] **Step 1: Write failing truth-table tests** — one `it` per row:
  - attack×standing→`punch`; standing with `held.attack` during recovery of first punch → `doublePunch`; running→`runningKick`; crouched→`legSweep`; enemy downed in front→`soccerKick`; enemy airborne overhead→`airGrab`; `wallProximityM<0.9`→`wallKick`; behind-unaware target→`stealthKill` beats all other attack resolutions.
  - jump×running near target→`legCannon`; jump×crouched→`hop`; airborne+crouch pressed→`flip`.
  - crouch×standing while incoming attack within window+facing→`{kind:'reverse', targetId}`; crouch×crouched over ground weapon→`pickupOrContext`; over downed body→`bodyThrow`; holding bloody blade→`cleanBlade` (priority: reverse > pickup > body > clean); crouch×running→`slideStop`.
  - No target/no context + attack → `null`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** resolver as pure if-chain ordered: stealthKill → reverse → context (pickup/body/clean) → stance-based table. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat: combat types, move table, context resolver`

### Task 7: Fighter state machine + hit detection

**Files:**
- Create: `src/combat/stateMachine.ts`, `src/combat/hitdetect.ts`
- Test: `tests/combat/stateMachine.test.ts`, `tests/combat/hitdetect.test.ts`

**Interfaces:**
- Consumes: `MoveDef/MOVES`, `resolveAction`, controller kinematics fields.
- Produces:
  - `type FighterPhase = { t: 'idle'|'move'|'startup'|'active'|'recovery'|'hitstun'|'downed'|'ko'; moveId?: MoveId; phaseMsLeft: number }`.
  - `class FighterSim { constructor(species, id, isPlayer); update(dtMs, input: InputFrame|null, world): void; state: FighterState }` where `FighterState = { id; species; team: 0|1; hp; maxHp; pos; velY; heading; stance; phase: FighterPhase; currentMove?: MoveDef; moveElapsedMs; flags: { bleeding; limping; unconscious; invulnerableAirFlipMs } ; antiRep: AntiRepState; pendingReverseOf?: string }`. Internally: on `pressed` edge calls `resolveAction`; transitions idle/move→startup→active→recovery; applies forward lunge during active for lunging moves (data flag `lungeSpeed`).
  - `findHit(attacker: FighterState, victims: FighterState[]): HitEvent[]` — pure; active phase only; `dist ≤ range && |angleDiff(heading→victim)| ≤ arc/2`; returns `{ attackerId, victimId, moveId, dirVector }`; never double-hits same victim per swing (track `swingHitSet`).
  - `applyHit(hit, fighters): FighterDelta[]` — damage×species mult, knockdown→phase 'downed'+velY impulse, hitstun 350ms, bleed flag for blades.

- [ ] **Step 1: Failing tests (stateMachine)** — press attack standing → after 120ms sim time phase='startup' (punch data); at startup+active window a stationary dummy fighter in range receives exactly one `HitEvent`; third consecutive punch sets `antiRep.streak=3`; requesting same move while in recovery is ignored; legSweep vs crouched dummy staggers but doesn't down (knockdown=false for sweep vs crouch? NO — sweep downs standing, staggers crouched: encode via `applyHit` check `victim.stance==='crouched' ? stagger : down`).
- [ ] **Step 2: Failing tests (hitdetect)** — out-of-range no event; behind-attacker (angle>arc/2) no event; two victims in arc both hit once; second call same swing empty.
- [ ] **Step 3: Run FAIL. Step 4: Implement both. Step 5: Run PASS.**
- [ ] **Step 6: Commit** — `feat: fighter state machine with phased moves and analytic hits`

### Task 8: Reversals, counter-reversals, anti-repetition

**Files:**
- Create: `src/combat/reversal.ts`, `src/combat/antirepetition.ts`
- Test: `tests/combat/reversal.test.ts`, `tests/combat/antirepetition.test.ts`

**Interfaces:**
- Consumes: `MoveDef.reversalWindow/counterWindow`, fighter phases.
- Produces:
  - `tryReversal(defender: FighterState, incoming: { attacker: FighterState; def: MoveDef; elapsedMs: number }): 'success'|'early'|'late'|'notFacing'` — success iff elapsed ∈ window AND angleDiff(defender.heading→attacker) < 100°; early iff elapsed < window.from; late otherwise.
  - `startCounter(originalAttacker: FighterState, reverserId: string): boolean` — true iff called within `counterWindow` of the reversal's own animation; grants original attacker the counter-reversal throw (downs reverser, 15 dmg).
  - `recordAttack(s: AntiRepState, moveId): void` / `penaltyFor(s, moveId): number` — streak≥3 grows penalty 1.0→1.6 linearly to 6; different move resets streak.

- [ ] **Step 1: Failing tests** — craft states by hand: defender facing attacker, punch elapsed 60ms inside window {40..140} → success; elapsed 20 → early; elapsed 200 → late; defender heading away → notFacing. Counter: call within window → true, outside → false; successful counter downs reverser (assert via returned effect object). Anti-rep: three punches then penaltyFor('punch')≈1.4±0.2, penaltyFor('legSweep')===1.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat: timed reversal windows and anti-repetition pressure`

### Task 9: Injury model + scoring

**Files:**
- Create: `src/combat/injury.ts`, `src/combat/scoring.ts`
- Modify: `src/combat/stateMachine.ts` (wire flags)
- Test: `tests/combat/injury.test.ts`, `tests/combat/scoring.test.ts`

**Interfaces:**
- Consumes: `FighterState.flags/hp`.
- Produces:
  - `updateInjuries(f: FighterState, dtMs: number): InjuryEvent[]` — bleeding drains 2hp/s until clamped (never kills below 1 via bleed alone); hp<40% → `limping=true`; hp≤0 or knockout conditions → `unconscious` (+`ko` phase). Returns events (`{type:'limped'|'bled'|'knockedOut'}`) for FX/score hooks.
  - `class ScoreLedger { award(event: ScoreEvent): number; total(): number; breakdown(): Array<{ label: string; points: number; count: number }> }`; `registerComboHit(ledger, nowMs)` implements chain ×2 ×4 ×8 ×16 (66→1066) with 2.5s combo timeout, decay past 5th hit (533,355,…). Constants: REVERSAL 30, REVERSAL_KO 100, STEALTH_KILL 100, LEG_CANNON 100, NICE_AIM 150, STYLE_WALLKICK 150, NINJA_THROW 60.

- [ ] **Step 1: Failing tests** — bleed: 5000ms sim → hp reduced ≈10; limp flips at 39hp; KO at 0. Scoring: 4 fast punches → 66+133+266+533; 3s gap resets chain; stealth kill awards 100 once.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS.** Wire into FighterSim.update (injury tick each step; ledger injected).
- [ ] **Step 5: Commit** — `feat: diegetic injury model and combo scoring ledger`

### Task 10: Headless fight harness (sim integration proof)

**Files:**
- Create: `tests/sim/harness.test.ts` (+ `tests/sim/scriptedInputs.ts` helper)

**Interfaces:**
- Consumes: FighterSim, terrain heightAt, reversal/scoring modules.
- Produces: pattern used by later tasks — `runScriptedFight(stepsMs: number[], playerInputAt: (i: number) => InputFrame|null, aiInputs?): Summary`.

- [ ] **Step 1: Write harness test**: spawn player rabbit + dummy wolf 3m apart; script: approach 800ms, punch when in range ×3, assert ≥1 HitEvent fired, dummy hp < max, no NaN in any position after 20k steps, both fighters y-coordinates always ≥ heightAt(x,z)−ε, fight reaches KO or times out cleanly.
- [ ] **Step 2: Run suite** — whole `rtk vitest run` green including new harness.
- [ ] **Step 3: Commit** — `test: headless scripted-fight harness`

### Task 11: Renderer reads sim — player fights a training dummy

**Files:**
- Create: `src/game.ts`
- Modify: `src/main.ts` (boot Game), `src/actors/controller.ts` (accept external velocity/stance overrides from sim phases)
- Test: none new (browser verification; sim already covered)

**Interfaces:**
- Consumes: everything so far.
- Produces: `class Game { constructor(canvas); start(mode: 'sandbox'); dispose(); }` — owns FixedLoop driving FighterSims, maps sim states → rigs via ClipPlayer (startup→windup pose hold, active→strike frame snap, recovery→follow-through, hitstun→hurt clip, downed→lying rotation, ko→ragdoll handoff placeholder Task 14), ChaseCamera targets player, Timescale hooked: on player-hit-landed `hitstop(90ms)`; on KO `slowmo(0.25, 900ms)`. Training dummy: static wolf FighterSim with null input.

- [ ] **Step 1: Implement Game wiring.** Keep renderer read-only over sim state (copy positions into rig roots; no backflow).
- [ ] **Step 2: Browser verify** — playwright-cli: click to lock pointer, dispatch LMB presses; screenshots show punch windup/strike poses hitting dummy; dummy staggers then falls (downed pose) after ~8 hits; visible hitstop freeze frames; slow-mo on dummy KO; fps ≥55 during combat.
- [ ] **Step 3: Commit** — `feat: game shell rendering live combat against dummy`

### Task 12: Rapier world, ragdolls, thrown knives, dropped weapons

**Files:**
- Create: `src/world/physics.ts`, `src/actors/ragdoll.ts`, `src/world/projectiles.ts`
- Modify: `src/game.ts` (init Rapier async, register KO handoff), `package.json` if polyfill needed
- Test: `tests/world/ragdoll.test.ts` (headless Rapier — rapier3d-compat runs in Node via WASM)

**Interfaces:**
- Consumes: `FighterState` (KO event, bone transforms from rig at death moment).
- Produces:
  - `class PhysicsWorld { static async create(heightAt): Promise<PhysicsWorld>; step(dtSec: number): void; castGround(x,z): number; addBox(center, halfExtents): void }` — heightfield collider from analytic function sampled 64×64 + matching visual mesh assumption documented.
  - `spawnRagdoll(world: PhysicsWorld, rig: Rig, impulse: { dir; force }): RagdollHandle` — for each bone: dynamic body + capsule (density from species mass distribution); ball joint spine↔pelvis, pelvis↔legs, shoulders; apply impulse at chest. `RagdollHandle = { bones: Record<BoneName, { pos, quat }>; settled: boolean; update(): void }`.
  - `class Projectiles { throwKnife(from, dir, speed); step(dtMs): KnifeEvent[] }` — dynamic rigid body with gravity; on body/fighter intersect → `{ type:'hit', targetId?, stuckAt }`; knife becomes ground pickup at rest. Dropped weapons use same body pool with `WeaponBodyHandle`.
  - `class WeaponDrops { spawnDrop(weaponClass, pos, vel?); nearest(pos, maxM): DropHandle|null; remove(h) }`.

- [ ] **Step 1: Failing headless test** — init Rapier (`await RAPIER.init()`); spawn ragdoll with upward impulse → after 60 steps all bone y < initial chest y (fell) and positions finite; settle flag true within 600 steps; knife thrown at flat ground lands and reports rest position within bounds.
- [ ] **Step 2: FAIL. Step 3: Implement (async create pattern; game.ts awaits before first frame). Step 4: PASS.**
- [ ] **Step 5: Browser verify** — kill dummy in sandbox → ragdoll flops with killing-blow direction, comes to rest on slope without falling through terrain; screenshot.
- [ ] **Step 6: Commit** — `feat: rapier cosmetic dynamics - ragdolls, knives, drops`

### Task 13: Weapons logic — clash, disarm, throwing, cleaning

**Files:**
- Create: `src/combat/weaponsLogic.ts`, `src/data/weapons.ts`
- Modify: `src/combat/resolver.ts` (+armed moves), `src/combat/hitdetect.ts` (clash check first)
- Test: `tests/combat/weaponsLogic.test.ts`

**Interfaces:**
- Consumes: FighterSim, PhysicsWorld drops.
- Produces:
  - `WEAPONS: Record<WeaponClass, WeaponDef>` where `WeaponDef = { id: 'knife'|'sword'|'staff'; reachM; damage; bleedOnHit: boolean; throwable: boolean; throwDamage: number; durability?: number }` — knife reach 0.8 dmg 10 (2 slices → stab finisher ×4), sword reach 1.5 dmg 22 bleeding, staff reach 1.3 dmg 14 durability 6.
  - `tryClash(a: ArmedSwing, b: ArmedSwing): ClashResult | null` — both active phases overlap + facing → clash: both pushed to recovery; staff loses 1 durability each clash; durability 0 or random(<0.15 per clash, seeded rng) → weapon flies off (drop event).
  - `onReversalVsArmed(reverser, armedVictim): DisarmEvent` — reversal vs armed enemy always disarms: victim's weapon spawns as drop near them.
  - `throwKnife(state, dir): void`; knife hit: unarmored OHK else 60 dmg; sticks in victim (`stuckIn: fighterId`) retrievable by rolling over body.
  - `cleanBlade(f: FighterState): boolean` — clears `bloodiedWeapon` flag (set on any blade hit).

- [ ] **Step 1: Failing tests**: simultaneous active swings of two sword fighters → clash result, no damage applied; staff breaks after 6 clashes (drop event); reversal vs armed → disarm event with drop position ≈ victim pos; thrown knife unarmored dummy → hp 0; bloodied flag set on slash, cleared by cleanBlade.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS.**
- [ ] **Step 5: Browser verify**: sandbox spawns sword pickup; pick up (crouch near it), attack dummy — visible blade box in hand during swings, bleeding decal tint on dummy, KO drops sword onto terrain as physical box; pick it up again.
- [ ] **Step 6: Commit** — `feat: weapon combat - clash, disarm, throws, cleaning`

### Task 14: Body mechanics — tackles, soccer kick, air-grab, wall-kick, body-throw

**Files:**
- Create: `src/combat/bodymoves.ts`
- Modify: `src/combat/stateMachine.ts` (special-move effects), `src/render/fx.ts` (new file: blood puff particles, dust rings)
- Test: `tests/combat/bodymoves.test.ts`

**Interfaces:**
- Consumes: resolver outputs, FighterSim.
- Produces:
  - `applySpecial(move: MoveId, attacker: FighterState, target: TargetRef | null, ctx: SpecialCtx): SpecialEffect | null` handling: `tackle` (run+crouch-release+jump near enemy: knocks prone, 5 dmg, can disarm if crouch pressed on top), `soccerKick` (downed target only, unblockable 12 dmg), `airGrab` (target airborne overhead: pull to ground, both downed, 20 dmg), `wallKick` (wall within 0.9m: launch away from wall, arc hit 25 dmg, STYLE bonus if kills), `legCannon` (running jump-attack near target: massive knockback 30 dmg, self falls on miss), `bodyThrow` (crouch-attack corpse: corpse becomes projectile 40 dmg on enemy hit = NICE_AIM), `flip` (airborne crouch: stuns enemies within 3m for 1500ms).
  - All effects are plain data (`{ knockdown?: boolean; stunMs?: number; damage?: number; scoreEvent?: ScoreEvent; impulse?: vec }`) — state machine applies them uniformly.

- [ ] **Step 1: Failing tests per move** (table-driven: craft attacker/target states, call applySpecial, assert effect fields): tackle downs + low dmg; soccerKick rejected vs standing target (null); airGrab downs both; wallKick requires wallProximity<0.9; legCannon applies big impulse; bodyThrow emits NICE_AIM score event when corpse hits enemy (simulate via direct second call); flip sets stunMs on nearby.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS.**
- [ ] **Step 5: Browser verify** — sandbox: leg-cannon a dummy across the arena (slow-mo + flying ragdoll); wall-kick off boulder cluster kills with style banner-less score bump visible on F3 debug overlay.
- [ ] **Step 6: Commit** — `feat: signature moves - cannon, wall-kick, air-grab, body-throw`

### Task 15: Perception — sight, hearing, wind, scent field

**Files:**
- Create: `src/ai/perception.ts`, `src/ai/scent.ts`, `src/world/wind.ts`
- Test: `tests/ai/perception.test.ts`, `tests/ai/scent.test.ts`

**Interfaces:**
- Consumes: fighter states, bush positions (Task 17), tuning constants.
- Produces:
  - `class WindSystem { constructor(rng); update(dtMs): void; vector: { x: number; z: number }; strength: number }` — slow random walk of direction ±30° over ~20s, strength 0..1.
  - `canSee(observer, target, world): boolean` — dist < sightRange (18m wolf / 14m rabbit), FOV 120°, target crouched halves range; bushes between → blocked if ≥2 bushes within ray path (segment-circle test).
  - `emitHearing(events: HearingEvent[], e: { kind: 'bushRustle'|'landThud'|'scream'|'roll'; pos; loudness }): void`; `hear(listener, e): boolean` — radius = loudness × base (wolf 14m, rabbit 18m hearing); returns true + records lastHeardPos.
  - `class ScentField { update(dtMs, emitters: ScentEmitter[], wind): void; intensityAt(pos): number }` — grid 48×48 over arena, scalar diffusion + advection `cell += wind·∇t`; emitters: player base 0.3/s, bloodied player or held bloody weapon 1.0/s; wolves query intensityAt(player.pos relative) > threshold → investigate toward upwind-shifted pos.

- [ ] **Step 1: Failing tests**: canSee fails beyond range, outside FOV, when crouched target beyond halved range; blocked by 2 bushes. hear: rustle at 10m heard by rabbit not wolf-at-8m-if... (use table). Scent: uniform wind east → after N updates peak intensity offset downwind of emitter; bloody emitter saturates radius faster than clean.
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Commit** — `feat: senses - sight cones, hearing events, advected scent field`

### Task 16: Enemy brain — FSM + utility engagement + difficulty

**Files:**
- Create: `src/ai/brain.ts`, `src/ai/engage.ts`, `src/ai/difficulty.ts`
- Modify: `tests/sim/harness.test.ts` (add AI-vs-player scenario)
- Test: `tests/ai/brain.test.ts`, `tests/ai/engage.test.ts`

**Interfaces:**
- Consumes: perception outputs, FighterSim, MOVES, anti-repetition.
- Produces:
  - `type AiState = 'patrol'|'investigate'|'circle'|'engage'|'flee'|'downed'`; `class Brain { constructor(fighter, difficulty: DifficultyDef); update(dtMs, senses, world): InputFrame }` — **Brain outputs the same InputFrame shape as the player**; the sim cannot tell them apart (core design invariant).
  - FSM transitions: patrol (waypoint wander) → investigate(lastHeard/scent point) → circle (orbit target 4–6m, strafe random flips every 1–3s) → engage (in range 2.2m) → flee (hp<25%: run to nearest ally, emit scream event once) ; downed overrides until recovered.
  - `pickAttack(self, target, rng, antiRep): MoveId | 'reverseAttempt' | null` — utility = `moveDef.damage × hitProbability(range, targetStance, phase) × penaltyFor(antiRep, move)`; reverseAttempt chosen with prob `reversalChance` when target enters startup (reaction delay ms from difficulty); never same move >3× (hard cap via penalty ∞).
  - `DIFFICULTY: Record<'easy'|'normal'|'hard', DifficultyDef>` — reactionMs 550/320/170, reversalChance 0.15/0.35/0.6, aggression 0.5/0.75/1.0, memoryLen 2/4/6, engageLimit 1/2/3.

- [ ] **Step 1: Failing tests (brain)**: idle brain far from silent player stays patrol; loud landThud within radius → investigate toward pos; seeing player → engage; hp set 20% → flee + exactly one scream event; downed → outputs no inputs.
- [ ] **Step 2: Failing tests (engage)**: seeded rng — with antiRep streak 3 on punch, pickAttack never returns punch; hard difficulty reacts to startup within 200ms (feed synthetic target phase changes, advance clock); easy misses window (no reverse attempt).
- [ ] **Step 3: FAIL → implement → PASS. Harness addition:** scripted player vs one Brain-driven wolf: fight terminates (someone KOs) within 90s sim time across 5 seeds; assert no NaN.
- [ ] **Step 4: Full suite green. Step 5: Commit** — `feat: ai brains - fsm states, utility attacks, difficulty presets`


### Task 17: Arena dressing — walls, bushes, pickups, wind tells

**Files:**
- Create: `src/world/bushes.ts`, `src/world/pickups.ts` (spawn logic; visuals inline)
- Modify: `src/game.ts` (populate arena), `src/render/scene.ts` (instanced grass tufts, 3 boulder wall clusters)

**Interfaces:**
- Consumes: PhysicsWorld (static colliders), WindSystem, hearing events.
- Produces:
  - `class BushField { bushes: Bush[]; rustleCheck(pos, prevPos, isRunning): HearingEvent|null }` — ~40 bushes (seeded scatter, min 3m from spawn), each radius 0.8m; crossing while moving fast → rustle event (loudness 0.6); crouch-walk through → 0.15. Visual: instanced cone/icosphere clusters that sway with wind (`wind.strength × sin(t)` vertex nudge in onBeforeRender).
  - `spawnPickups(game): void` — knife ×2, staff ×2, sword ×1 at fixed points; floating slight bob + ground ring decal so they're findable [spec §6].
  - Boulder clusters: 3 groups of 2–4 boxes (PhysicsWorld static + mesh), tall enough for wall-kick (≥1.6m).
  - Wind tells: drifting snow/dust particle system (Points, pooled 400) velocity = wind vector; grass tufts lean.

- [ ] **Step 1: Implement** (visual/spatial, logic covered by perception tests). **Step 2: Browser verify**: screenshot shows bushes, boulders, pickups with rings, visible particle drift direction matching F3 wind debug arrow; running through bush triggers audible-less rustle → nearby AI investigates (manual check with debug overlay showing lastHeard marker).
- [ ] **Step 3: Commit** — `feat: arena dressing - bushes, boulders, pickups, wind particles`

### Task 18: Stealth kills + group engagement polish

**Files:**
- Create: `src/combat/stealth.ts`
- Modify: `src/ai/brain.ts` (engageLimit from difficulty; unaware flag), `src/combat/stateMachine.ts`
- Test: `tests/combat/stealth.test.ts`, `tests/ai/group.test.ts`

**Interfaces:**
- Consumes: resolver's stealthKill resolution, Brain FSM state.
- Produces:
  - `tryStealthKill(attacker, victim): StealthResult | null` — requires: victim FSM not engage/alerted, attacker within 1.1m, |angle(attacker.heading→victim.heading)| < 60° (behind), attack pressed standing. Result by weapon: unarmed `spineCrusher` (down+KO if hp<30 else 35 dmg), knife `tracheotomy` (instant kill), sword `backstabber` (instant kill). Awards STEALTH_KILL 100. Victim never screams (silent).
  - Group gate in Brain: count allies with state 'engage'; if ≥ engageLimit → stay 'circle'. Circle members occasionally body-throw stones? NO [spec §7: v1 circle only].

- [ ] **Step 1: Failing tests**: stealth conditions table (alerted victim → null; facing their back ±40° ok, front → null; knife vs full-hp rabbit → dead instantly, no scream event dispatched). Group: 3 wolves easy difficulty → exactly 1 engages, 2 circle; hard → all 3 engage.
- [ ] **Step 2: FAIL → implement → PASS. Full suite green.**
- [ ] **Step 3: Browser verify**: sneak behind patrolling wolf (crouch approach downwind) → spine crusher animation, wolf drops silently, second patrol wolf unaffected.
- [ ] **Step 4: Commit** — `feat: stealth kills and group engagement limits`

### Task 19: Game shell — menu, tutorial, waves, results

**Files:**
- Create: `src/ui/menu.ts`, `src/ui/tutorial.ts`, `src/ui/waves.ts`, `src/ui/results.ts`, `src/ui/pause.ts`
- Modify: `src/game.ts` (mode state machine: menu→tutorial→wave1→wave2→wave3→results), `src/main.ts`
- Test: `tests/ui/persistence.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces:
  - Menu: title "LUGARU", buttons Tutorial / Arena / difficulty select (Easy/Normal/Hard radio, default Normal). Keyboard navigable.
  - `class Tutorial { steps: TutorialStep[]; update(input, sim): { done: boolean; hint: string } }` — 6 gated steps [spec §8]: move to marked point → land 3 punches → reverse 1 attack (spawns scripted attacker telegraphing punches slowly) → leg-cannon a dummy → pick up knife + throw it → stealth-kill a sleeper. Each shows hint text bottom-center; ESC skips all.
  - Waves [spec §8]: wave1 = 1 wolf Normal brain; wave2 = 1 wolf + 1 rabbit; wave3 = 2 wolves + 1 rabbit. Spawn at arena edge with 1s dust puff. Clear → 3s banner "Wave cleared" → next. Player death: slow-mo ragdoll 2s → "You died" → R restarts wave / Esc menu.
  - Results: score total, breakdown lines (label ×count), time, best-per-difficulty from localStorage guarded try/catch [spec §9]; buttons Retry / Menu.
  - Pause: pointer-lock loss / Esc → overlay Resume|Restart|Menu; auto-pause on blur.

- [ ] **Step 1: Failing test (persistence only)** — mock localStorage absent → ScoreLedger save/load no-throw returns null bests; present → roundtrips JSON.
- [ ] **Step 2: Implement UI modules (plain DOM, no framework).**
- [ ] **Step 3: Browser verify full loop** — playwright-cli end-to-end: load → menu screenshot → click Arena → fight wave 1 (dispatch inputs; may use F3 god-flag dev cheat `?debug=god` to survive) → clear → results reachable → retry works; Esc during fight pauses; tab-blur auto-pauses; coarse-pointer emulation shows warning instead of canvas.
- [ ] **Step 4: Full suite + build green** — `rtk vitest run && bun run build` (tsc --noEmit passes).
- [ ] **Step 5: Commit** — `feat: game shell - menu, tutorial, waves, results, pause`

### Task 20: Polish pass — FX, audio-free feel, perf, README

**Files:**
- Modify: `src/render/fx.ts` (blood decals pool, kill slow-mo tuning), `src/data/tuning.ts` (final numbers), `README.md`

**Interfaces:**
- Produces: README (run/test/build instructions, controls table, architecture summary linking spec+plan); tuning pass notes.

- [ ] **Step 1: Perf audit** — F3 overlay: frame time p95 <16ms in 3-enemy wave; zero allocations per step verified via Chrome DevTools allocation sampling on 60s capture; ragdolls >6 oldest culled after settled.
- [ ] **Step 2: Feel pass** — hitstop 90ms standard hits / 140ms KO; camera FOV kick on leg-cannon landing; blood decal pool (32 planes) fades over 20s; damage vignette + desaturation below 40% hp via fullscreen CSS filter on canvas [spec §3.4 diegetic health].
- [ ] **Step 3: Tuning session** — play each wave; adjust moves.ts windows until: reversal success rate feels ~50% for practiced human on Normal (record via debug counters); document final constants in tuning.ts comments.
- [ ] **Step 4: Browser verify** — full 3-wave run start to results without console errors, fps stable.
- [ ] **Step 5: Final commit** — `polish: fx pass, tuning, readme`

---

## Self-Review Notes (completed at plan time)

- Spec coverage: §3.1→T6, §3.2→T6/T8, §3.3→T8, §3.4→T9/T20, §3.5→T13, §3.6→T9, §3.7→T18, §4→T5/T12, §5→T12, §6→T4/T17, §7→T15/T16/T18, §8→T19, §9→T1/T19, §10→throughout, §11 M1→T1–T5, M2→T6–T11, M3→T12–T14, M4→T15–T16, M5→T17–T18, M6→T19–T20.
- Type consistency: `InputFrame` produced T3, consumed T5/T7/T16 (Brain outputs it — invariant stated). `FighterState` produced T7, consumed everywhere after. `MoveDef/MOVES` produced T6. No renames across tasks.

