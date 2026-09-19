// Arcade driving model (D5): heading + decomposed velocity, grip bleeds
// lateral speed into drift, off-road multiplies drag and caps top speed.
// Collisions push out positionally only — never damage (spec).

import { driving as dr } from '../data/tuning.js';

export function makeDrivingState(def) {
  return {
    throttle: 0,
    steer: 0,
    onRoad: true,
    speedFwd: 0,
    speedLat: 0,
    drifting: false,
    wheelSpin: 0,
    def,
  };
}

// Integrate one sim step for a car entity that carries x, z, heading, vx, vz.
export function stepDriving(car, drive, dt, isOnRoad) {
  const def = drive.def;
  const fwdX = Math.cos(car.heading);
  const fwdZ = Math.sin(car.heading);
  const latX = -fwdZ;
  const latZ = fwdX;

  drive.speedFwd = car.vx * fwdX + car.vz * fwdZ;
  drive.speedLat = car.vx * latX + car.vz * latZ;
  drive.onRoad = isOnRoad;

  // --- throttle / brake / reverse
  if (drive.throttle > 0) {
    drive.speedFwd += def.accel * drive.throttle * dt;
  } else if (drive.throttle < 0) {
    if (drive.speedFwd > 0.5) {
      drive.speedFwd -= dr.brakeAccel * dt; // braking
    } else {
      drive.speedFwd += def.accel * dr.reverseFactor * drive.throttle * dt; // reverse
      drive.speedFwd = Math.max(drive.speedFwd, -def.topSpeed * 0.35);
    }
  }

  // --- surface limits
  const maxSpeed = def.topSpeed * (isOnRoad ? 1 : def.offroad);
  const surfaceDrag = isOnRoad ? dr.drag : dr.drag + 0.55;
  if (drive.speedFwd > maxSpeed) {
    drive.speedFwd = Math.max(maxSpeed, drive.speedFwd - (drive.speedFwd - maxSpeed) * 4 * dt - 6 * dt);
  }
  if (drive.speedFwd < -maxSpeed * 0.35) drive.speedFwd = -maxSpeed * 0.35;

  // --- drags
  drive.speedFwd -= drive.speedFwd * surfaceDrag * dt;
  const gripBleed = Math.min(1, def.grip * dt);
  drive.speedLat -= drive.speedLat * gripBleed;

  // --- steering authority grows with speed; sliding widens the arc
  const speedAbs = Math.abs(drive.speedFwd);
  const auth =
    dr.steerParkScale +
    (1 - dr.steerParkScale) * Math.min(1, speedAbs / dr.steerSpeedScale);
  drive.drifting = Math.abs(drive.speedLat) > 4;
  const boost = drive.drifting ? dr.driftSteerBoost : 1;
  const dir = drive.speedFwd >= 0 ? 1 : -1;
  car.heading += drive.steer * def.turnRate * auth * boost * dir * dt;

  // --- recompose world velocity (heading may have turned mid-step)
  const nfX = Math.cos(car.heading);
  const nfZ = Math.sin(car.heading);
  const nlX = -nfZ;
  const nlZ = nfX;
  car.vx = nfX * drive.speedFwd + nlX * drive.speedLat;
  car.vz = nfZ * drive.speedFwd + nlZ * drive.speedLat;

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  drive.wheelSpin += (drive.speedFwd / 0.55) * dt;
}

// Circle-vs-AABB push-out; returns collision normal or null.
export function pushOutOfAABB(car, rect) {
  const cx = Math.max(rect.minX, Math.min(car.x, rect.maxX));
  const cz = Math.max(rect.minZ, Math.min(car.z, rect.maxZ));
  const dx = car.x - cx;
  const dz = car.z - cz;
  const d2 = dx * dx + dz * dz;
  const r = car.radius;
  if (d2 >= r * r) return null;

  let nx;
  let nz;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    nx = dx / d;
    nz = dz / d;
    const push = r - d;
    car.x += nx * push;
    car.z += nz * push;
  } else {
    // center inside the rect: eject along the smallest penetration axis
    const toLeft = car.x - rect.minX;
    const toRight = rect.maxX - car.x;
    const toTop = car.z - rect.minZ;
    const toBottom = rect.maxZ - car.z;
    const m = Math.min(toLeft, toRight, toTop, toBottom);
    if (m === toLeft) {
      nx = -1;
      nz = 0;
      car.x = rect.minX - r;
    } else if (m === toRight) {
      nx = 1;
      nz = 0;
      car.x = rect.maxX + r;
    } else if (m === toTop) {
      nx = 0;
      nz = -1;
      car.z = rect.minZ - r;
    } else {
      nx = 0;
      nz = 1;
      car.z = rect.maxZ + r;
    }
  }
  return { nx, nz };
}

// Kill velocity into a collision normal (keep a bounce fraction).
export function dampAlongNormal(car, n, bounce = dr.wallBounce) {
  const into = car.vx * n.nx + car.vz * n.nz; // <0 when moving into the surface
  if (into < 0) {
    car.vx -= (1 - bounce) * into * n.nx;
    car.vz -= (1 - bounce) * into * n.nz;
  }
}

// Car-vs-car: positional push-out split between both circles, no damage.
export function resolveCarPair(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  const minD = a.radius + b.radius;
  if (d2 >= minD * minD) return false;
  const d = Math.max(Math.sqrt(d2), 1e-5);
  const nx = dx / d;
  const nz = dz / d;
  const push = (minD - d) * dr.carPush;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;
  // small momentum exchange along the normal
  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rel < 0) {
    const j = rel * 0.4;
    a.vx += nx * j;
    a.vz += nz * j;
    b.vx -= nx * j;
    b.vz -= nz * j;
  }
  return true;
}
