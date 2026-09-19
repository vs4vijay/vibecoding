// Task 3.1 verification: arcade driving model behavior — off-road slowdown,
// no damage signature in the model, collisions push out only.

import assert from 'node:assert/strict';
import { makeDrivingState, stepDriving, pushOutOfAABB, dampAlongNormal, resolveCarPair } from '../../src/game/combat/driving.js';

const def = { topSpeed: 26, accel: 19, turnRate: 2.15, grip: 7.5, offroad: 0.55 };
const dt = 1 / 60;

function run(topSpeedSurface, seconds = 6) {
  const car = { x: 0, z: 0, heading: 0, vx: 0, vz: 0, radius: 1.6 };
  const drive = makeDrivingState(def);
  for (let i = 0; i < seconds / dt; i++) {
    drive.throttle = 1;
    stepDriving(car, drive, dt, topSpeedSurface);
  }
  return { car, drive };
}

const onRoad = run(true);
const offRoad = run(false);
const roadTop = onRoad.drive.speedFwd;
const offTop = offRoad.drive.speedFwd;

console.log(`top speed on road: ${roadTop.toFixed(1)} | off road: ${offTop.toFixed(1)}`);
assert.ok(roadTop > 20, 'reaches near top speed on road');
assert.ok(offTop < roadTop * 0.62, `off-road visibly slower (${(offTop / roadTop * 100).toFixed(0)}% of road speed)`);
assert.ok(offTop > 5, 'off-road still drivable');

// braking / reverse
{
  const car = { x: 0, z: 0, heading: 0, vx: 20, vz: 0, radius: 1.6 };
  const drive = makeDrivingState(def);
  for (let i = 0; i < 2 / dt; i++) {
    drive.throttle = -1;
    stepDriving(car, drive, dt, true);
  }
  assert.ok(car.vx < 0 || drive.speedFwd <= 0.5, 'braking then reversing works');
}

// drift: lateral velocity bleeds over time
{
  const car = { x: 0, z: 0, heading: 0, vx: 0, vz: 12, radius: 1.6 };
  const drive = makeDrivingState(def);
  drive.throttle = 1;
  const lat0 = Math.abs(drive.speedLat + 12); // before step, speedLat recomputed each step
  stepDriving(car, drive, dt, true);
  const lat1 = Math.abs(drive.speedLat);
  for (let i = 0; i < 1.0 / dt; i++) stepDriving(car, drive, dt, true);
  const lat2 = Math.abs(drive.speedLat);
  assert.ok(lat2 < lat1, `lateral speed decays (grip): ${lat1.toFixed(2)} -> ${lat2.toFixed(2)}`);
  void lat0;
}

// collision push-out never touches health (no damage field even exists)
{
  const car = { x: 2, z: 0, vx: 10, vz: 0, radius: 1.5 };
  const rect = { minX: 3, maxX: 9, minZ: -3, maxZ: 3 };
  const n = pushOutOfAABB(car, rect);
  assert.ok(n, 'collision detected');
  assert.ok(Math.abs(car.x - (rect.minX - 1.5)) < 0.05, `pushed out of AABB to x=${car.x.toFixed(2)}`);
  dampAlongNormal(car, n);
  assert.ok(car.vx < 10, 'velocity into wall damped');
  assert.ok(!('health' in car) && !('damage' in car), 'driving layer carries no damage concept');
}

// car-vs-car: both pushed, no damage
{
  const a = { x: 0, z: 0, vx: 5, vz: 0, radius: 1.6 };
  const b = { x: 2.5, z: 0.2, vx: -3, vz: 0, radius: 1.6 };
  assert.ok(resolveCarPair(a, b), 'cars collide');
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(d >= 3.15, `separated to ${d.toFixed(2)} ≥ sum of radii`);
}

console.log('driving.test: OK — off-road slowdown, drift bleed, damage-free collisions');
