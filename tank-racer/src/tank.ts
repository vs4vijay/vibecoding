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

/** Hull/turret colors are parameterizable so AI racers get distinct liveries. */
export function createTankMesh(
  hullColor: number = HULL_COLOR,
  turretColor: number = TURRET_COLOR,
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

  return {
    root,
    turret,
    bodyMaterials: [trackMat, hullMat, turretMat, barrelMat],
    bodyColors: [TRACK_COLOR, HULL_COLOR, TURRET_COLOR, BARREL_COLOR],
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
}

export const MAX_HP = 100;
export const SHELL_DAMAGE = 25;
const SPIN_RATE = 9; // rad/s while spun out
const SPIN_DRAG = 3.2; // 1/s extra velocity decay during a spin-out

export function createTankState(mesh?: TankMesh): TankState {
  return {
    mesh: mesh ?? createTankMesh(),
    position: new THREE.Vector3(),
    heading: 0,
    velocity: new THREE.Vector3(),
    input: { throttle: 0, steer: 0 },
    boostTimer: 0,
    boostMultiplier: 1,
    hp: MAX_HP,
    fireCooldown: 0,
    spinTimer: 0,
    spinDir: 1,
    wreckTimer: 0,
    invulnTimer: 0,
    shield: false,
    tripleShots: 0,
  };
}

// Tuning constants (spec Phase 1)
const ACCEL = 28; // u/s^2 engine acceleration
export const MAX_SPEED = 40; // u/s forward
const MAX_REVERSE = 20; // u/s reverse
const BRAKE_DECEL = 48; // u/s^2 when throttling against motion
const ROLLING_FRICTION = 10; // u/s^2 passive slowdown when no throttle
const LATERAL_GRIP = 5.5; // 1/s — how fast sideways slip is killed (lower = drifty)
const MAX_TURN_RATE = 1.8; // rad/s at full steering authority
const TURN_SPEED_FALLOFF = 14; // u/s to reach full turn authority

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
  const maxSpeed = MAX_SPEED * boost;

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
      speedForward < -0.5 ? BRAKE_DECEL : ACCEL * (1 - clamp(speedForward / maxSpeed, 0, 1));
  } else if (input.throttle < 0) {
    accelAlong =
      speedForward > 0.5 ? -BRAKE_DECEL : -ACCEL * (1 - clamp(-speedForward / MAX_REVERSE, 0, 1));
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
