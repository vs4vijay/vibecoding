// Town scene (6.1): a small building cluster on a main street with glowing
// hotspots (TRADE / JOBS / GUN / GARAGE) you drive into, and exit gates back
// to the overworld. Same driving model as combat; no weapons fire in town.

import * as THREE from 'three';
import { palette } from '../data/palette.js';
import { cars } from '../data/content.js';
import { driving as drt } from '../data/tuning.js';
import { createRng, hashSeed } from '../rng.js';
import { nextId } from '../state.js';
import { makeDrivingState, stepDriving, pushOutOfAABB, dampAlongNormal } from '../combat/driving.js';
import { buildCarMesh, buildScrubMesh } from '../combat/meshes.js';

const TOWN_HALF = 60;
const ROAD_HALF = 8;

const HOTSPOT_DEFS = [
  { kind: 'trade', label: 'TRADE', color: palette.hotspotTrade, offset: -16 },
  { kind: 'jobs', label: 'JOBS', color: palette.hotspotJobs, offset: -6 },
  { kind: 'gun', label: 'GUN SHOP', color: palette.hotspotGun, offset: 6 },
  { kind: 'garage', label: 'GARAGE', color: palette.hotspotGarage, offset: 16 },
];

export function createTownScene({ state, townId, audio, onOpenShop, onExit, onPrompt }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.horizon, 90, 220);

  scene.add(new THREE.HemisphereLight(0xfff3d6, 0x6e5537, 1.05));
  const sun = new THREE.DirectionalLight(0xffe9c4, 1.5);
  sun.position.set(35, 60, 20);
  scene.add(sun);

  const rng = createRng(hashSeed('town', townId, state.seed));
  const obstacles = [];
  const hotspots = [];

  // ground + main street
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: palette.sand })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(TOWN_HALF * 2 + 40, ROAD_HALF * 2),
    new THREE.MeshLambertMaterial({ color: palette.road })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  scene.add(road);
  const lineMat = new THREE.MeshBasicMaterial({ color: palette.roadLine });
  for (let x = -TOWN_HALF; x < TOWN_HALF; x += 10) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.4), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.04, 0);
    scene.add(l);
  }

  function isOnRoad(x, z) {
    return Math.abs(z) <= ROAD_HALF;
  }

  // buildings: two rows off the street, skip hotspot plots
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let x = -TOWN_HALF + 8; x <= TOWN_HALF - 8; x += 13) {
    for (const sideZ of [-1, 1]) {
      // hotspots sit on the north (−z) side: keep that row clear at their plots
      const nearHotspot = HOTSPOT_DEFS.some((h) => Math.abs(h.offset - x) < 8);
      if (nearHotspot && sideZ === -1) continue;
      const w = rng.range(7, 11);
      const d = rng.range(7, 10);
      const h = rng.range(4, 7);
      const z = sideZ * (ROAD_HALF + 4 + d / 2 + rng.range(0, 3));
      const mat = new THREE.MeshLambertMaterial({ color: rng.chance(0.5) ? palette.adobe : palette.adobeDark });
      const b = new THREE.Mesh(boxGeo, mat);
      b.scale.set(w, h, d);
      b.position.set(x + rng.range(-2, 2), h / 2, z);
      scene.add(b);
      // flat roof lip + awning accent
      const roofMat = new THREE.MeshLambertMaterial({ color: rng.chance(0.5) ? palette.roofRust : palette.roofTar });
      const roof = new THREE.Mesh(boxGeo, roofMat);
      roof.scale.set(w + 0.6, 0.5, d + 0.6);
      roof.position.set(b.position.x, h + 0.2, b.position.z);
      scene.add(roof);
      obstacles.push({
        minX: b.position.x - w / 2 - 0.3,
        maxX: b.position.x + w / 2 + 0.3,
        minZ: b.position.z - d / 2 - 0.3,
        maxZ: b.position.z + d / 2 + 0.3,
      });
    }
  }

  // hotspot pads on the street (north side)
  for (const def of HOTSPOT_DEFS) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.2, 0.12, 26),
      new THREE.MeshLambertMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.35, transparent: true, opacity: 0.75 })
    );
    pad.position.set(def.offset, 0.07, -ROAD_HALF - 5.5);
    scene.add(pad);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4.2, 0.18, 8, 30),
      new THREE.MeshBasicMaterial({ color: def.color })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(def.offset, 0.16, -ROAD_HALF - 5.5);
    scene.add(ring);
    // vertical light beam so the pad reads from anywhere in town
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.6, 14, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.set(def.offset, 7, -ROAD_HALF - 5.5);
    scene.add(beam);
    hotspots.push({ ...def, x: def.offset, z: -ROAD_HALF - 5.5, r: 4.6, ring, beam });
  }

  // exit gates at both street ends
  const exitGates = [];
  for (const ex of [-TOWN_HALF - 6, TOWN_HALF + 6]) {
    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(5.5, 0.3, 8, 30),
      new THREE.MeshBasicMaterial({ color: palette.accentBright })
    );
    gate.rotation.x = Math.PI / 2;
    gate.position.set(ex, 0.2, 0);
    scene.add(gate);
    exitGates.push({ x: ex, z: 0, r: 7 });
  }

  // sparse scrub for flavor (off-street only)
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-TOWN_HALF, TOWN_HALF);
    const z = rng.range(-TOWN_HALF, TOWN_HALF);
    if (isOnRoad(x, z)) continue;
    const s = buildScrubMesh();
    s.position.set(x, 0, z);
    scene.add(s);
  }

  // player
  const def = cars[state.carId];
  const mesh = buildCarMesh({ body: palette.playerBody, stripe: palette.playerStripe });
  mesh.group.position.set(0, 0, 10);
  scene.add(mesh.group);
  const player = {
    id: nextId(),
    kind: 'player',
    x: 0,
    z: 10,
    prevX: 0,
    prevZ: 10,
    heading: Math.PI,
    prevHeading: Math.PI,
    vx: 0,
    vz: 0,
    health: state.carHealth,
    maxHealth: def.maxHealth,
    radius: Math.max(def.width * 0.62, 1.6),
    drive: makeDrivingState(def),
    mounts: null,
    mesh,
    dead: false,
  };

  let nearHotspot = null;
  let nearExit = false;
  let shopOpen = false;
  let exited = false;
  let promptShownFor = null;

  function update(step, controls) {
    if (exited) return;
    if (shopOpen) {
      player.drive.throttle = 0;
      player.drive.steer = 0;
    } else {
      player.drive.throttle = controls.throttle;
      player.drive.steer = controls.steer;
    }

    player.prevX = player.x;
    player.prevZ = player.z;
    player.prevHeading = player.heading;
    stepDriving(player, player.drive, step, isOnRoad(player.x, player.z));

    for (const o of obstacles) {
      const n = pushOutOfAABB(player, o);
      if (n) dampAlongNormal(player, n);
    }
    // town bounds
    player.x = Math.max(-TOWN_HALF - 12, Math.min(TOWN_HALF + 12, player.x));
    player.z = Math.max(-TOWN_HALF, Math.min(TOWN_HALF, player.z));

    // hotspot proximity
    nearHotspot = null;
    for (const h of hotspots) {
      if (Math.hypot(player.x - h.x, player.z - h.z) < h.r) {
        nearHotspot = h;
        break;
      }
    }
    nearExit = exitGates.some((g) => Math.hypot(player.x - g.x, player.z - g.z) < g.r);

    const prompt = shopOpen
      ? null
      : nearHotspot
        ? { type: 'shop', kind: nearHotspot.kind, label: nearHotspot.label }
        : nearExit
          ? { type: 'exit' }
          : null;
    if (onPrompt && (prompt?.type !== promptShownFor || (prompt && prompt.kind !== promptShownKind))) {
      promptShownFor = prompt?.type ?? null;
      promptShownKind = prompt?.kind ?? null;
      onPrompt(prompt);
    }

    if (!shopOpen && controls.interact && nearHotspot) {
      shopOpen = true;
      onOpenShop(nearHotspot.kind);
    }
    if (!shopOpen && controls.interact && nearExit) {
      exitToMap();
    }

    player.health = state.carHealth; // mirror canonical state
    audio.setEngine(true, Math.min(1, Math.abs(player.drive.speedFwd) / def.topSpeed));
  }

  let promptShownKind = null;

  function closeShop() {
    shopOpen = false;
  }

  function render(dt, alpha, camera) {
    const ix = player.prevX + (player.x - player.prevX) * alpha;
    const iz = player.prevZ + (player.z - player.prevZ) * alpha;
    player.mesh.group.position.x = ix;
    player.mesh.group.position.z = iz;
    let h = player.prevHeading + shortAngle(player.prevHeading, player.heading) * alpha;
    player.mesh.group.rotation.y = -h;
    for (const w of player.mesh.wheels) {
      w.tire.rotation.x = player.drive.wheelSpin;
      w.group.rotation.y = (w.front ? -player.drive.steer * 0.42 : 0) * -1;
    }
    // pulse active hotspot rings + beams
    const t = performance.now() / 1000;
    for (const hs of hotspots) {
      hs.ring.scale.setScalar(1 + Math.sin(t * 2.4 + hs.offset) * 0.06);
      hs.beam.material.opacity = 0.12 + Math.sin(t * 2.4 + hs.offset) * 0.05;
    }
    if (camera) {
      camera.follow(
        { x: ix, y: 0, z: iz },
        { x: Math.cos(player.heading), z: Math.sin(player.heading) },
        { x: player.vx, z: player.vz },
        dt
      );
    }
  }

  function exitToMap() {
    if (exited) return;
    exited = true;
    audio.setEngine(false);
    onExit();
  }

  return {
    scene,
    player,
    update,
    render,
    closeShop,
    exitToMap,
    dispose() {
      audio.setEngine(false);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    },
    get nearHotspot() {
      return nearHotspot;
    },
    get nearExit() {
      return nearExit;
    },
    hotspots,
    isOnRoad,
  };
}

function shortAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
