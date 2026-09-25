import * as THREE from "three";
import { createDustTexture } from "./textures.js";

// Player character rig (visual-overhaul D6, task 5.1) — torso/head/pack plus
// pivot-group limbs (shoulders, hips, knees) driven by a small pose mixer.
// States: run (distance-phased limb swing + torso bob), jump tuck, roll
// tumble, and lane-change banking. Channels lerp with a ~100ms time constant
// so transitions never pop; fast swing terms stay unfiltered (added on top).
//
// Landing dust (task 5.2): a fixed pool of camera-facing sprites in scene
// space — emitted at the feet on the airborne→grounded transition, drifting
// free so the player runs past them. Oldest slot is reused when a landing
// fires while puffs are alive; nothing is created or destroyed at runtime.
//
// Standing top = 2.45 (old box top), so the shrunken collision top stays
// ~2.25 and overhead beams keep their semantics. The roll tuck folds every
// mesh within r≈0.55 of the spin pivot at y 0.6, so a full 2π X-rotation
// sweeps the AABB between ~0.05 and ~1.15 (roll-under stays valid).
const SPIN_Y = 0.57;
const POSE_TAU = 0.05; // pose lerp time constant (≈100ms to settle)
const RUN_PHASE_RATE = 2.6; // stride phase per meter of travel
const LEAN_MAX = 0.32; // rad at a full 3m lane change
const DUST_POOL = 8; // fixed sprite pool — reused, never grown
const DUST_TTL = 0.5; // seconds per puff (±15% jitter per sprite)

export function createPlayerRig(materials, scene) {
  const packMat = new THREE.MeshStandardMaterial({ color: 0x1e40af, roughness: 0.6, metalness: 0.0 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.6, metalness: 0.0 });

  const group = new THREE.Group();
  const rig = new THREE.Group(); // lean (rotation.z)
  const spin = new THREE.Group(); // tumble (rotation.x), pivot at SPIN_Y
  spin.position.y = SPIN_Y;
  group.add(rig);
  rig.add(spin);

  const box = (w, h, d, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // Chest assembly: torso + head + pack + shoulder pivots move as one
  const chest = new THREE.Group();
  chest.position.y = 0.8; // torso center, world y 1.4
  spin.add(chest);
  box(0.8, 1.0, 0.5, materials.player, chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), materials.playerHead);
  head.position.set(0, 0.7, 0); // world y 2.1, top 2.45
  head.castShadow = true;
  chest.add(head);
  const pack = box(0.5, 0.7, 0.3, packMat, chest, 0, 0.05, -0.4);

  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.34 * side, 0.42, 0.05); // world y 1.82
    chest.add(shoulder);
    box(0.18, 0.6, 0.18, materials.player, shoulder, 0, -0.3, 0);
    return shoulder;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Legs: hip pivot -> thigh -> knee pivot -> shin + shoe
  const hips = new THREE.Group();
  hips.position.y = 0.35; // world y 0.95
  spin.add(hips);
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.18 * side, 0, 0);
    hips.add(hip);
    box(0.24, 0.42, 0.24, materials.player, hip, 0, -0.21, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    box(0.2, 0.35, 0.2, materials.player, knee, 0, -0.175, 0);
    box(0.28, 0.15, 0.45, shoeMat, knee, 0, -0.325, 0.075);
    return { hip, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // Dust pool (task 5.2): 8 sprites, one material each (per-sprite opacity),
  // sharing the cached dust texture. Group sits at the scene origin so sprite
  // positions are world positions — puffs stay put as the player runs past.
  const puffGroup = new THREE.Group();
  const dustMap = createDustTexture();
  const puffs = [];
  for (let i = 0; i < DUST_POOL; i++) {
    const mat = new THREE.SpriteMaterial({
      map: dustMap,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    puffGroup.add(sprite);
    puffs.push({ sprite, life: 0, ttl: DUST_TTL, vx: 0, vy: 0, vz: 0, size: 1 });
  }
  if (scene) scene.add(puffGroup);
  let puffCursor = 0; // ring index — full pool overwrites the oldest puff
  let wasAirborne = false;

  function emitDust() {
    const at = group.position;
    const count = 3 + Math.floor(Math.random() * 3); // 3–5 sprites
    for (let i = 0; i < count; i++) {
      const puff = puffs[puffCursor];
      puffCursor = (puffCursor + 1) % DUST_POOL;
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 0.9;
      puff.vx = Math.cos(ang) * speed;
      puff.vz = Math.sin(ang) * speed * 0.6; // less throw along travel
      puff.vy = 0.5 + Math.random() * 0.7; // slight rise
      puff.ttl = DUST_TTL * (0.85 + Math.random() * 0.3);
      puff.life = puff.ttl;
      puff.size = 0.5 + Math.random() * 0.35;
      puff.sprite.position.set(
        at.x + (Math.random() - 0.5) * 0.5,
        0.15 + Math.random() * 0.15,
        at.z + (Math.random() - 0.5) * 0.3,
      );
      puff.sprite.visible = true;
    }
  }

  function updateDust(dt) {
    for (const puff of puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      if (puff.life <= 0) {
        puff.sprite.visible = false;
        puff.sprite.material.opacity = 0;
        continue;
      }
      const t = 1 - puff.life / puff.ttl; // 0 fresh → 1 spent
      puff.sprite.position.x += puff.vx * dt;
      puff.sprite.position.y += puff.vy * dt;
      puff.sprite.position.z += puff.vz * dt;
      puff.vy -= 1.2 * dt; // buoyant rise decays
      const damp = Math.exp(-dt * 3.5); // outward burst settles
      puff.vx *= damp;
      puff.vz *= damp;
      puff.sprite.material.opacity = 0.85 * (1 - t);
      const s = puff.size * (1 + t * 1.6); // expand as it fades
      puff.sprite.scale.set(s, s, 1);
    }
  }

  // Pose channels: smoothed static targets; swing (run-cycle amplitude) and
  // the phase terms ride on top unfiltered.
  const NEUTRAL = { chestY: 0.8, chestRX: 0.07, headY: 0.7, headZ: 0, packY: 0.05, packZ: -0.4, shY: 0.42, splay: 0.08, hip: 0, knee: 0.2, arm: 0, swing: 0 };
  const JUMP = { chestY: 0.8, chestRX: 0.12, headY: 0.7, headZ: 0, packY: 0.05, packZ: -0.4, shY: 0.42, splay: 0.12, hip: -1.0, knee: 1.5, arm: 0.9, swing: 0 };
  const ROLL = { chestY: -0.05, chestRX: 0.3, headY: 0.05, headZ: 0.15, packY: 0.0, packZ: -0.3, shY: -0.2, splay: 0.05, hip: -1.5, knee: 2.7, arm: -2.4, swing: 0 };
  const channels = { ...NEUTRAL };
  const target = { ...NEUTRAL };
  let wasRolling = false;

  const wrapPi = (a) => (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

  function applyPose(phase) {
    const s = Math.sin(phase);
    const bob = Math.sin(phase * 2);
    const swing = channels.swing;

    chest.position.y = channels.chestY + swing * 0.055 * bob;
    chest.rotation.x = channels.chestRX;
    head.position.y = channels.headY - swing * 0.04 * bob; // counter-bob
    head.position.z = channels.headZ;
    pack.position.y = channels.packY;
    pack.position.z = channels.packZ;

    armL.position.y = channels.shY;
    armR.position.y = channels.shY;
    armL.rotation.x = channels.arm + swing * s * 0.85; // contralateral pump
    armR.rotation.x = channels.arm - swing * s * 0.85;
    armL.rotation.z = -channels.splay;
    armR.rotation.z = channels.splay;

    legL.hip.rotation.x = channels.hip - swing * s * 0.75;
    legR.hip.rotation.x = channels.hip + swing * s * 0.75;
    legL.knee.rotation.x = channels.knee + swing * Math.max(0, -s) * 1.0; // fold on recovery
    legR.knee.rotation.x = channels.knee + swing * Math.max(0, s) * 1.0;
  }

  function update(dt, input) {
    const k = 1 - Math.exp(-dt / POSE_TAU);

    // Touchdown (airborne → grounded, covers jump and jetpack landings)
    if (wasAirborne && !input.isJumping) emitDust();
    wasAirborne = input.isJumping;

    if (input.isRolling) {
      Object.assign(target, ROLL);
      // Tumble: delay the spin until the tuck has mostly landed, then one
      // full forward rotation across the roll. Driven directly off progress
      // (no lag) so it completes 2pi exactly; at progress 1 it reads as 0.
      const p = Math.min(Math.max((input.rollProgress - 0.08) / 0.92, 0), 1);
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      spin.rotation.x = Math.PI * 2 * eased;
    } else {
      if (wasRolling) spin.rotation.x = wrapPi(spin.rotation.x); // shed the 2pi
      Object.assign(target, input.isJumping ? JUMP : NEUTRAL);
      if (!input.isJumping) target.swing = 1; // run cycle, grounded only
      spin.rotation.x += (0 - spin.rotation.x) * k;
    }
    wasRolling = input.isRolling;

    for (const key in channels) {
      channels[key] += (target[key] - channels[key]) * k;
    }

    applyPose(input.distance * RUN_PHASE_RATE);

    // Bank toward the lane change; eases upright as the lerp converges.
    const lean = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, -input.lean * 0.11));
    rig.rotation.z += (lean - rig.rotation.z) * k;

    updateDust(dt);
  }

  function reset() {
    Object.assign(channels, NEUTRAL, { swing: 0 });
    Object.assign(target, NEUTRAL);
    rig.rotation.z = 0;
    spin.rotation.x = 0;
    wasRolling = false;
    for (const puff of puffs) {
      puff.life = 0;
      puff.sprite.visible = false;
      puff.sprite.material.opacity = 0;
    }
    wasAirborne = false;
    applyPose(0);
  }

  return { group, update, reset };
}
