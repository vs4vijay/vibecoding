// Task 3.2 verification: dual-mount side selection geometry (D9).
// With heading north fwd=(0,-1): car's left is west (-1,0), right is east (1,0).

import assert from 'node:assert/strict';
import { aimSide, leftVector } from '../../src/game/weapons/mounts.js';

// heading -PI/2 → fwd = (cos, sin) = (0, -1) = "north" (screen up when camera
// looks down -y with the car pointing up)
const north = -Math.PI / 2;
const car = { x: 0, z: 0, heading: north };

const lv = leftVector(north);
assert.ok(Math.abs(lv.x - -1) < 1e-9 && Math.abs(lv.z) < 1e-9, 'left of north is west (-1, ~0)');
assert.equal(aimSide(car, -30, 0), 'left', 'aim west of north-facing car → LEFT mount');
assert.equal(aimSide(car, 30, 0), 'right', 'aim east of north-facing car → RIGHT mount');
assert.ok(['left', 'right'].includes(aimSide(car, 0, -30)), 'dead-ahead aim resolves to a side without crashing');

// heading east fwd=(1,0): left is north (0,-1)
const east = 0;
const car2 = { x: 0, z: 0, heading: east };
assert.equal(aimSide(car2, 0, -30), 'left', 'aim north of east-facing car → LEFT mount');
assert.equal(aimSide(car2, 0, 30), 'right', 'aim south of east-facing car → RIGHT mount');

// behind the car both sides are "behind": west aim for east-facing car is rear;
// cross picks a side deterministically — must be one of the two, never crash
assert.ok(['left', 'right'].includes(aimSide(car2, -30, 0)));

console.log('mounts.test: OK — aim side matches car-relative left/right');
