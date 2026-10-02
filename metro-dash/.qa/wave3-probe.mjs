/**
 * WAVE 3 pose-quality probe (headless).
 * Run: bun .qa/wave3-probe.mjs
 * Checks the run cycle keeps feet at/above the floor, measures the body
 * envelope across a full cycle, and the tucked-roll compactness.
 */
import * as THREE from "three";
import { createPlayer } from "../client/js/src/entities/player.js";

const lib = new Proxy(
  {},
  { get: (_t, k) => (k === "get" ? (k2) => new THREE.MeshStandardMaterial({ name: k2 }) : k === "then" ? undefined : new THREE.MeshStandardMaterial({ name: String(k) })) },
);

const p = createPlayer(lib);
const group = p.group;
const box = new THREE.Box3();
const tmp = new THREE.Box3();

function poseBounds(runPhase, extra = {}) {
  p.updateRender(
    {
      x: 0, y: 0, z: 0, vy: extra.vy || 0, lateralVel: 0, speed: 19.5,
      rollAmount: extra.roll || 0, airAmount: extra.air || 0,
      runPhase, phase: extra.phase || "running", deathT: extra.deathT || 0,
    },
    0, // dt=0: easers snap, spin does not accumulate (measures the pose itself)
  );
  group.updateMatrixWorld(true);
  box.makeEmpty();
  group.traverse((o) => {
    if (o.isMesh) {
      tmp.setFromObject(o);
      box.union(tmp);
    }
  });
  // Return a snapshot: box is reused across calls (aliasing otherwise).
  return { min: { y: box.min.y }, max: { y: box.max.y }, maxZ: box.max.z, minZ: box.min.z, maxX: box.max.x };
}

// 1) Run cycle: foot height / body envelope over one full cycle.
let minY = Infinity, maxY = -Infinity, maxZ = -Infinity, minZ = Infinity, maxX = -Infinity;
for (let i = 0; i < 64; i++) {
  const b = poseBounds((i / 64) * Math.PI * 2);
  minY = Math.min(minY, b.min.y);
  maxY = Math.max(maxY, b.max.y);
  maxZ = Math.max(maxZ, b.maxZ);
  minZ = Math.min(minZ, b.minZ);
  maxX = Math.max(maxX, b.maxX);
}
console.log(`run cycle envelope: y [${minY.toFixed(3)}, ${maxY.toFixed(3)}]  z [${minZ.toFixed(3)}, ${maxZ.toFixed(3)}]  maxX ${maxX.toFixed(3)}`);
console.log(`  feet below floor: ${minY < -0.03 ? "YES (BAD)" : "no"}   body below 0.1m of ground always? ${minY < 0.1 ? "grounded-ish" : "airtime"}`);

// 2) Jump tuck (rising) and fall extend: feet should lift well off the floor.
const rise = poseBounds(0.7, { air: 1, vy: 8 });
const fall = poseBounds(0.7, { air: 1, vy: -8 });
console.log(`rise tuck: feet lift to ${rise.min.y.toFixed(2)} (tucked) .. cap ${rise.max.y.toFixed(2)}`);
console.log(`fall extend: feet lift to ${fall.min.y.toFixed(2)} .. cap ${fall.max.y.toFixed(2)}`);

// 3) Roll ball compactness vs hitbox 0.95.
const roll = poseBounds(0.3, { roll: 1 });
console.log(`roll ball height ${(roll.max.y - roll.min.y).toFixed(2)} (hitbox 0.95)  min.y ${roll.min.y.toFixed(3)}`);

// 4) Death flop envelope.
const flop = poseBounds(0.3, { phase: "dying", deathT: 0.3 });
console.log(`flop envelope y [${flop.min.y.toFixed(2)}, ${flop.max.y.toFixed(2)}] z [${flop.minZ.toFixed(2)}, ${flop.maxZ.toFixed(2)}]`);
