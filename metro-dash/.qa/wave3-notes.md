
---

# WAVE 3 — CHARACTER (procedural stylized runner replaces the placeholder capsule)

Date: 2026-09-13. Scope: the player character only. Engine/world/palette/qa-hooks
untouched; composer target stays UnsignedByteType; no sprites; no textures for the
character (flat stylized PBR); no external assets.

## Files changed
| File | Change |
|---|---|
| `client/js/src/entities/player.js` | REPLACED. Full procedural character ("Jax") + channel-based animation state machine. Interface preserved: `createPlayer(lib) -> { group, updateRender(pose, dt), meshes, update(dt, pose) }`. `meshes` list exposed (24 entries). |
| `client/js/src/core/assets.js` | ADDED 11 flat MaterialLibrary entries (no texture sets): `hoodie 0x1db3a3 r0.88`, `denim 0x2c3a5e r0.92`, `denimCuff 0x3d4e7c`, `skin 0xdfa277 r0.52`, `sneaker 0xefece3 r0.55`, `capPlastic 0xffc23d r0.42`, `accentOrange 0xe8742c r0.38`, `packFabric 0xc7532f r0.9`, `creamFabric 0xf0e7d4`, `ink 0x22201d r0.5`, `hair 0x45301f r0.82` (+ ergonomic getters). Existing passed materials untouched. Headphone band reuses `plasticDark`. |
| `client/js/src/game/run.js` | ADDITIVE pose plumbing: `_runPhase` accumulator (speed-scaled cadence, advanced in fixedUpdate -> deterministic, rewind-safe); `_snapshot()`/`renderPose()` now carry `vy`, `runPhase` (interpolated), `deathT`, `phase`; `updateRender()` roll/air blends now snap when `dt===0` (freeze correctness) and no longer force the roll pose during "dying" (death has its own flop pose). Hitboxes/collisions/spawn director untouched. |
| `client/js/src/main.js` | `fastForward()` now calls `run.updateRender(1, FIXED)` per fixed step, so blend states (lean/roll/air/spin) advance during ?time fast-forward with FIXED dt — the frozen frame shows the true animation state, fully deterministic. |
| `client/js/sw.js` | Cache bump v3 -> v4 (cache-first SW must not serve stale src modules to the QA browser). |
| `dist/` | Rebuilt via `bun run build:client`. |

## Character model (24 meshes, one group; all castShadow, receiveShadow false)
Proportions: ~1.81 m total, head (incl cap) ~0.44 (~1/4.1 body — stylized big),
hip line 0.82, oversized 0.34 m sneakers, stocky lathe torso (hem 0.235 r, flared).
Rig: `group(feet) -> acro(pivot y 0.55 for flips/tumbles) -> body -> hips -> {legL/R
(hip->knee->ankle joints)}, spine -> {torso, pack, straps, strings, neckband, cups,
armL/R (shoulder->elbow), headJ}`.

Merged parts (same-material merges keep draw calls down):
- Head: skull+ears (skin) / cap dome+curved brim+button (capPlastic, one lag-wobble
  pivot) / eyes+brows+smile (ink, one decal cluster embedded in the skull surface) /
  hair tufts under the cap back (hair).
- Torso: lathe hoodie + hood roll (hoodie) / backpack body+pocket+zip bar (pack) /
  2 chest straps (ink webbing) / 2 drawstrings on one pendulum pivot (cream).
- Neck headphones: C-band wrapping the back of the neck (plasticDark) + 2 cups
  (capPlastic) — reads in close/side shots.
- Arms: sleeve capsule + shoulder ball (hoodie) / forearm + mitten hand (skin;
  sleeves end just past the elbow).
- Legs: thigh (denim) / shin (denim) + rolled cuff band (denimCuff) / sneaker
  upper+sole+padded collar (sneaker) / heel patch + lace bar (accentOrange).

No Sprites, no canvas textures, all geometry from primitives (Lathe/Capsule/Sphere/
Cylinder/Torus/Box/RoundedBox) merged via BufferGeometryUtils.mergeGeometries.
NOTE: all parts are normalized to NON-indexed before merging (RoundedBoxGeometry
ships non-indexed while primitives are indexed — mixed merges throw).

## Animation state machine (channels -> joints, all targets absolute)
Channels: 6 leg joints (hip/knee/ankle x), 6 arm channels, spine x/y, head x/y/z,
hips height/roll, acro pitch, group bank/yaw. Blend order per frame:
`idle --modeBlend-> locomotion --airBlend-> air --rollBlend-> roll` (death flop
replaces the locomotion branch, driven by `pose.deathT`), then lane-lean layer.
- RUN: opposing arm/leg swing from sim-accumulated `runPhase`; per-leg: hip swing
  0.75 rad + forward bias, stance load bend, 1.05 rad recovery tuck (knee peaks
  mid-swing-through), ankle heel-strike/toe-off roll; elbows pump 93-125 deg,
  arms oppose legs; 2-per-cycle vertical bob; spine lean 0.14+0.07*speedFactor with
  shoulder counter-twist; head stabilizes (-0.7x spine lean) + subtle nod.
  CADENCE: cycle = clamp(8.8/speed, 0.34, 0.62) s -> 0.55 s at 16 m/s, 0.34 s at
  42 m/s (stride grows with speed). Secondary: cap lag (0.9 rad phase delay), pack
  wobble, drawstring pendulum, all damped by air/roll.
- LANE SWITCH: bank into the move (lean = clamp(-lateralVel*0.028, 0.38), eased
  11/s with exp ease-out on exit), group yaw 0.55x, head leads +0.45x.
- JUMP: rise tuck (knees up 1.3/1.05 rad, knees fold 1.6, arms sweep back, spine
  forward) vs fall extend (legs reach down, arms spread/up) blended by sign of
  interpolated `vy`; land recovers via airBlend ease (10/s).
- ROLL: tuck ball (hips drop 0.45, thighs fold -2.05/-1.95, knees 2.0, arms wrap,
  spine curl 1.0) blended by rollAmount; forward SOMERSAULT via the acro pivot:
  spin accumulates 1 full turn per ROLL_DURATION while rollBlend > 0.55, then
  unwinds to the nearest 2Pi multiple (visually upright) with exp ease — no snap.
  Measured ball: 0.97 m tall vs 0.95 m hitbox, sits on the floor.
- DEATH ("dying"/"dead"): flop driven by pose.deathT — tumbles backward around the
  acro pivot (-1.12 rad), arms flung up/out, legs kick, head rolls back; clamps at
  the end pose and freezes there for "dead". Never a T-pose.
- IDLE (menu): breathing, weight shift, look-around (wall-clock dt; never frozen
  in QA because autostart skips the menu).

## Determinism / QA trace (?qa=1&seed=7&time=10&freeze=1)
- All animation targets derive from the interpolated sim pose; every accumulator
  advances only through the dt passed to updateRender. easeK(dt=0) = 1 -> targets
  applied directly, so warmup frames are identical (verified: 5 renders
  bit-identical; also bit-identical across two independent 600-step runs).
- Trace: startRun (dt=0 snap to running pose) -> 600x [fixedUpdate + updateRender
  (FIXED)] -> runPhase ~127.8 rad at the freeze frame -> frozen mid-cycle (2.14 rad
  into the cycle: limbs mid-swing, NOT frame 0, NOT T-pose) -> 5 identical warmup
  frames. God-mode keeps phase "running"; death/roll paths verified by scripted
  smoke test instead.
- `?cam=close|side|front` see: backpack/hood/headphones (back), full silhouette
  profile (side), face + cap + drawstrings (front).

## Validation done (no browser used)
- `node --check` clean on all touched files.
- `.qa/wave3-smoke.mjs` (bun, headless, real geometry + full RunController): 25/25
  checks — mesh count 24 <= 25, no sprites, origin at feet (min.y 0.006), height
  1.815 m, geometry finite, 600-step god-mode run stable, runPhase monotonic
  (127.8 rad @10 s), jump/roll/death state transitions, somersault unwinds to an
  exact 2Pi multiple, frozen-frame + cross-run determinism.
- `.qa/wave3-probe.mjs`: run-cycle envelope over 128 phases — no foot penetration
  (worst -0.007 m), height 1.88 max, rise-tuck lifts feet to 0.14, fall extends
  to 0.05, roll ball 0.97/-0.003, flop lies back (z -1.19..0.68).
- dist rebuilt and synced; zero console-error sources (no new network, no sprites).

## Draw-call budget
Character: 24 meshes -> 24 main-pass + 24 shadow-pass draw calls (flat vs distance;
character is always in frustum). Wave-2 estimate was ~170 total high tier with the
12-mesh placeholder -> now ~185-195. Budget 250: ~55-65 headroom.

## Risks / notes for later waves
- Death flop can intersect the ground by up to ~0.07 m at the tumble apex for
  <0.8 s (reads as impact); the frozen QA frames never show it (god-mode).
- `wave3-probe.mjs` reported values are per-call snapshots (Box3 aliasing fixed);
  if re-extending, keep returning fresh objects.
- The character materials are flat by design; if the judge wants more material
  read, the cheapest upgrade is a subtle fabric-weave canvas set on hoodie/denim
  via TextureFactory (keys already isolated in MATERIAL_DEFS).
- Wave 5 jetpack: flight pose should reuse the air channels (tuck/fall blend);
  acro pivot (y 0.55) is the right place for any new full-body pitch.
- Tunables live in `TUNE` (player.js): cadence const 8.8 in run.js `fixedUpdate`;
  lean gain `leanFromVel`/`leanMax`; swing amplitudes hipSwing/armSwing/kneeRecover.
