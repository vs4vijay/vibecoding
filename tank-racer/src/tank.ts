import * as THREE from "three";

// ---------------------------------------------------------------------------
// Tank mesh (low-poly primitives, shared by player & AI)
// ---------------------------------------------------------------------------

export interface TankMesh {
  /** Whole-tank group: position on plane, yaw = hull heading. */
  root: THREE.Group;
  /** Rotates independently of the hull. */
  turret: THREE.Group;
  /** Per-instance clones so combat visuals (wreck darkening) don't leak between tanks. */
  bodyMaterials: THREE.MeshLambertMaterial[];
  /** Original colors of bodyMaterials, for restoring after a wreck. */
  bodyColors: number[];
}

export const HULL_COLOR = 0x4a7c3f;
const TRACK_COLOR = 0x2b2b2b;
const TURRET_COLOR = 0x5c9450;
const BARREL_COLOR = 0x3a3a3a;

// --- Tuning constants (spec Phase 1; per-tank overrides live in TankDef) ---
export const ACCEL = 28; // u/s^2 engine acceleration
export const MAX_SPEED = 40; // u/s forward
const MAX_REVERSE = 20; // u/s reverse
const BRAKE_DECEL = 48; // u/s^2 when throttling against motion
const ROLLING_FRICTION = 10; // u/s^2 passive slowdown when no throttle
const LATERAL_GRIP = 5.5; // 1/s — how fast sideways slip is killed (lower = drifty)
const MAX_TURN_RATE = 1.8; // rad/s at full steering authority
const TURN_SPEED_FALLOFF = 14; // u/s to reach full turn authority
export const FIRE_COOLDOWN = 0.8; // s between shots (default tank)
export const MAX_HP = 100; // default tank max HP

// ---------------------------------------------------------------------------
// Selectable tank definitions (Phase 7) — same physics code, different params
// ---------------------------------------------------------------------------

export interface TankDef {
  id: string;
  name: string;
  hullColor: number;
  turretColor: number;
  /** u/s forward top speed (before boosts). */
  maxSpeed: number;
  /** u/s² engine acceleration. */
  accel: number;
  maxHp: number;
  /** Seconds between shots. */
  fireCooldown: number;
  /** Mesh silhouette multipliers (x = width, y = height, z = length). */
  proportions: { w: number; h: number; l: number };
  blurb: string;
}

/** Baseline stats — spec Phase 1 defaults. */
export const BALANCED: TankDef = {
  id: "balanced",
  name: "BALANCED",
  hullColor: HULL_COLOR,
  turretColor: TURRET_COLOR,
  maxSpeed: MAX_SPEED,
  accel: ACCEL,
  maxHp: MAX_HP,
  fireCooldown: FIRE_COOLDOWN,
  proportions: { w: 1, h: 1, l: 1 },
  blurb: "ALL-ROUNDER",
};

/** +20% top speed, ~-20% acceleration, -25 HP. Sleeker / lower hull. */
export const SPRINTER: TankDef = {
  id: "sprinter",
  name: "SPRINTER",
  hullColor: 0x2f8fb0,
  turretColor: 0x45aecf,
  maxSpeed: Math.round(MAX_SPEED * 1.2),
  accel: Math.round(ACCEL * 0.8 * 10) / 10,
  maxHp: MAX_HP - 25,
  fireCooldown: FIRE_COOLDOWN,
  proportions: { w: 0.9, h: 0.85, l: 1.08 },
  blurb: "FAST · FRAGILE",
};

/** -15% top speed, ~+25% acceleration, +50 HP, 0.6s fire cooldown. Bulkier hull. */
export const BRUISER: TankDef = {
  id: "bruiser",
  name: "BRUISER",
  hullColor: 0x6b4fa0,
  turretColor: 0x8465bd,
  maxSpeed: Math.round(MAX_SPEED * 0.85),
  accel: Math.round(ACCEL * 1.25 * 10) / 10,
  maxHp: MAX_HP + 50,
  fireCooldown: 0.6,
  proportions: { w: 1.18, h: 1.15, l: 1.05 },
  blurb: "ARMORED · RAPID FIRE",
};

/** All selectable tanks (Phase 7) — order = title-screen UP/DOWN cycle order. */
export const TANK_DEFS: TankDef[] = [BALANCED, SPRINTER, BRUISER];

/**
 * Recolor + rescale an existing tank mesh to match a tank definition.
 * Used on the title screen so UP/DOWN cycling restyles the player's tank
 * without rebuilding GPU resources.
 */
export function applyTankLivery(mesh: TankMesh, def: TankDef): void {
  // bodyMaterials order: [track, hull, turret, barrel]
  mesh.bodyMaterials[1].color.setHex(def.hullColor);
  mesh.bodyMaterials[2].color.setHex(def.turretColor);
  mesh.bodyColors[1] = def.hullColor; // wreck-restore must bring these back
  mesh.bodyColors[2] = def.turretColor;
  mesh.root.scale.set(def.proportions.w, def.proportions.h, def.proportions.l);
}

/** Hull/turret colors are parameterizable so AI racers get distinct liveries. */
export function createTankMesh(
  hullColor: number = HULL_COLOR,
  turretColor: number = TURRET_COLOR,
  proportions?: { w: number; h: number; l: number },
): TankMesh {
  const root = new THREE.Group();

  // Per-instance material clones: wreck visuals recolor one tank only
  const trackMat = new THREE.MeshLambertMaterial({ color: TRACK_COLOR });
  const hullMat = new THREE.MeshLambertMaterial({ color: hullColor });
  const turretMat = new THREE.MeshLambertMaterial({ color: turretColor });
  const barrelMat = new THREE.MeshLambertMaterial({ color: BARREL_COLOR });

  // Tracks: two long boxes either side
  const trackGeo = new THREE.BoxGeometry(1.1, 0.9, 4.6);
  for (const x of [-1.35, 1.35]) {
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.position.set(x, 0.55, 0);
    track.castShadow = true;
    root.add(track);
  }

  // Hull box sits on tracks
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.0, 4.2),
    hullMat,
  );
  hull.position.y = 1.5;
  hull.castShadow = true;
  root.add(hull);

  // Turret group pivots at hull center; barrel points +Z (forward)
  const turret = new THREE.Group();
  turret.position.y = 2.15;

  const turretBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.8, 1.8),
    turretMat,
  );
  turretBox.castShadow = true;
  turret.add(turretBox);

  const barrelGeo = new THREE.CylinderGeometry(0.16, 0.16, 2.8, 8);
  barrelGeo.rotateX(Math.PI / 2); // align along Z
  const barrel = new THREE.Mesh(barrelGeo, barrelMat);
  barrel.position.set(0, 0.1, 2.0);
  barrel.castShadow = true;
  turret.add(barrel);

  root.add(turret);

  if (proportions) {
    root.scale.set(proportions.w, proportions.h, proportions.l);
  }

  return {
    root,
    turret,
    bodyMaterials: [trackMat, hullMat, turretMat, barrelMat],
    // Actual colors (not constants) so wreck-restore keeps custom liveries
    bodyColors: [TRACK_COLOR, hullColor, turretColor, BARREL_COLOR],
  };
}

// ---------------------------------------------------------------------------
// Arcade driving physics (flat plane)
// ---------------------------------------------------------------------------

export interface TankInput {
  throttle: number; // -1..1 (+ = forward)
  steer: number; // -1..1 (+ = right)
}

export interface TankState {
  mesh: TankMesh;
  position: THREE.Vector3;
  heading: number; // yaw in radians, 0 = +Z forward
  velocity: THREE.Vector3; // XZ-plane velocity (drift comes from lateral slip)
  input: TankInput;
  // --- Speed-boost effect hook (boost pads now, power-ups in later phases) ---
  boostTimer: number; // seconds remaining
  boostMultiplier: number; // applied to max speed while boostTimer > 0
  // --- Combat / survival (Phase 3 — weapons.ts owns the rules) -------------
  hp: number; // 0..MAX_HP
  fireCooldown: number; // seconds until next shot allowed
  spinTimer: number; // >0 = spinning out (fast yaw + heavy speed loss)
  spinDir: number; // -1 | +1 yaw direction while spinning
  wreckTimer: number; // >0 = wrecked & immobile; hits 0 → respawn
  invulnTimer: number; // >0 = can't take damage (post-respawn grace)
  shield: boolean; // absorbs the next shell hit
  tripleShots: number; // remaining trigger pulls that fire a 3-shell spread
  // --- Per-tank tuning (Phase 7 selectable tanks; AI uses defaults) ---------
  maxSpeed: number; // u/s forward top speed (before boosts)
  accel: number; // u/s² engine acceleration
  maxHp: number;
  fireCooldownMax: number; // seconds between shots
}

export const SHELL_DAMAGE = 25;
const SPIN_RATE = 9; // rad/s while spun out
const SPIN_DRAG = 3.2; // 1/s extra velocity decay during a spin-out

export function createTankState(
  mesh?: TankMesh,
  def: TankDef = TANK_DEFS[0],
): TankState {
  return {
    mesh: mesh ?? createTankMesh(),
    position: new THREE.Vector3(),
    heading: 0,
    velocity: new THREE.Vector3(),
    input: { throttle: 0, steer: 0 },
    boostTimer: 0,
    boostMultiplier: 1,
    hp: def.maxHp,
    fireCooldown: 0,
    spinTimer: 0,
    spinDir: 1,
    wreckTimer: 0,
    invulnTimer: 0,
    shield: false,
    tripleShots: 0,
    maxSpeed: def.maxSpeed,
    accel: def.accel,
    maxHp: def.maxHp,
    fireCooldownMax: def.fireCooldown,
  };
}

// Tuning constants moved above TANK_DEFS (Phase 7): per-tank stats derive
// from the same baseline numbers via TankDef.

export function applySpeedBoost(tank: TankState, multiplier: number, duration: number): void {
  tank.boostTimer = Math.max(tank.boostTimer, duration);
  tank.boostMultiplier = multiplier;
}

/** Advance tank physics one fixed/variable timestep. */
export function updateTankPhysics(tank: TankState, dt: number): void {
  // --- Combat timers count down regardless of throttle ----------------------
  if (tank.fireCooldown > 0) tank.fireCooldown -= dt;
  if (tank.spinTimer > 0) tank.spinTimer = Math.max(0, tank.spinTimer - dt);
  if (tank.wreckTimer > 0) tank.wreckTimer = Math.max(0, tank.wreckTimer - dt);
  if (tank.invulnTimer > 0) tank.invulnTimer = Math.max(0, tank.invulnTimer - dt);

  const wrecked = tank.wreckTimer > 0;
  const spinning = tank.spinTimer > 0;

  // Wrecked tanks are immobile: no throttle, no steering
  const input = wrecked ? ZERO_INPUT : tank.input;

  // Boost timer counts down regardless of throttle
  if (tank.boostTimer > 0) tank.boostTimer = Math.max(0, tank.boostTimer - dt);
  const boost = tank.boostTimer > 0 && !wrecked ? tank.boostMultiplier : 1;
  const maxSpeed = tank.maxSpeed * boost;

  // Forward direction on the XZ plane from heading (0 = +Z).
  const forward = new THREE.Vector3(Math.sin(tank.heading), 0, Math.cos(tank.heading));
  const speedForward = tank.velocity.dot(forward);

  // --- Longitudinal forces -------------------------------------------------
  let accelAlong = 0;
  if (spinning || wrecked) {
    // Heavy speed loss during a spin-out; engine cut while wrecked.
    // Recovers naturally once the spin ends / respawn happens.
    const drop = Math.min((spinning ? SPIN_DRAG : ROLLING_FRICTION * 2) * Math.abs(speedForward), Math.abs(speedForward) / dt);
    accelAlong = -Math.sign(speedForward) * drop;
  } else if (input.throttle > 0) {
    // Accelerating forward (or braking out of reverse)
    accelAlong =
      speedForward < -0.5 ? BRAKE_DECEL : tank.accel * (1 - clamp(speedForward / maxSpeed, 0, 1));
  } else if (input.throttle < 0) {
    accelAlong =
      speedForward > 0.5 ? -BRAKE_DECEL : -tank.accel * (1 - clamp(-speedForward / MAX_REVERSE, 0, 1));
  } else {
    // Rolling friction toward a stop
    accelAlong = -Math.sign(speedForward) * Math.min(ROLLING_FRICTION, Math.abs(speedForward) / dt);
  }
  tank.velocity.addScaledVector(forward, accelAlong * dt);

  // --- Steering: turn rate scales with speed (none at standstill) ----------
  const speed = tank.velocity.length();
  const dirSign = speedForward >= 0 ? 1 : -1; // steering flips in reverse
  const authority = Math.min(speed / TURN_SPEED_FALLOFF, 1);
  tank.heading -= input.steer * MAX_TURN_RATE * authority * dirSign * dt;

  // --- Spin-out: fast uncontrolled yaw -------------------------------------
  if (spinning) tank.heading += tank.spinDir * SPIN_RATE * dt;

  // --- Grip: bleed off lateral (sideways) velocity for drift feel ----------
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const lateralSpeed = tank.velocity.dot(right);
  const gripFactor = Math.exp(-(wrecked ? LATERAL_GRIP * 2 : LATERAL_GRIP) * dt);
  tank.velocity.addScaledVector(right, lateralSpeed * (gripFactor - 1));

  // --- Integrate -----------------------------------------------------------
  tank.position.addScaledVector(tank.velocity, dt);
  tank.position.y = 0;

  // --- Sync mesh -----------------------------------------------------------
  tank.mesh.root.position.copy(tank.position);
  tank.mesh.root.rotation.y = tank.heading;
}

const ZERO_INPUT: TankInput = { throttle: 0, steer: 0 };

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
