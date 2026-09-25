// Scenery prop factories (buildings, obstacles, decorations) (per visual-overhaul D1)
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createFacadeTextures, createHazardTexture, FACADE_TILE } from "./textures.js";

// ---------------------------------------------------------------------------
// Building families — muted urban palette; facade + lit-window emissive baked
// per variant (3 colorways x 2 lit patterns per family, generated once)
// ---------------------------------------------------------------------------
const FAMILIES = [
  {
    name: "brick",
    colors: [0x8a5140, 0x7a4839, 0x955f4b],
    weight: 0.3,
    roughness: 0.9,
    metalness: 0.0,
    facade: { kind: "brick", trim: 0xd8cfc4, glass: 0x232830, litChance: 0.3 },
  },
  {
    name: "concrete",
    colors: [0x98928a, 0x8a857d, 0xa49e94],
    weight: 0.3,
    roughness: 0.95,
    metalness: 0.0,
    facade: { kind: "ribbon", trim: 0xb9b3a9, glass: 0x20262e, litChance: 0.22 },
  },
  {
    name: "glass",
    colors: [0x5a6b78, 0x4c5c68, 0x66788a],
    weight: 0.2,
    roughness: 0.45,
    metalness: 0.15,
    facade: { kind: "curtain", trim: 0x9aa7b0, glass: 0x2c3944, litChance: 0.32 },
  },
  {
    name: "sandstone",
    colors: [0xbfa578, 0xad9569, 0xcbaf83],
    weight: 0.2,
    roughness: 0.9,
    metalness: 0.0,
    facade: {
      kind: "punchedStone",
      trim: 0xe2d7c3,
      glass: 0x2a2e33,
      litChance: 0.25,
    },
  },
];

const LIT_VARIANTS = 2;
const facadeCache = new Map();

function getFacade(family, colorIndex, litIndex) {
  const key = `${family.name}:${colorIndex}:${litIndex}`;
  let textures = facadeCache.get(key);
  if (!textures) {
    textures = createFacadeTextures({
      base: family.colors[colorIndex],
      ...family.facade,
    });
    facadeCache.set(key, textures);
  }
  return textures;
}

// One shared unit box for every building: cap faces (top/bottom) are UV-pinned
// to the facade's plain band crossings and vertex-tinted dark — flat roofs at
// zero extra draw calls.
const buildingGeometry = (() => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uv = geo.attributes.uv;
  const colors = new Float32Array(24 * 3);
  for (let i = 0; i < 24; i++) {
    const cap = i >= 8 && i < 16; // +y / -y faces
    if (cap) uv.setXY(i, 0.5, 0.5);
    const c = cap ? 0.38 : 1;
    colors[i * 3] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
})();

function pickFamily() {
  let r = Math.random() * FAMILIES.reduce((sum, f) => sum + f.weight, 0);
  for (const f of FAMILIES) {
    r -= f.weight;
    if (r <= 0) return f;
  }
  return FAMILIES[FAMILIES.length - 1];
}

// Factory: shared geometry + shared facade sources; per-instance material so
// each building can tile its facade by its own (integer) repeat.
export function createBuildingMesh(x, z) {
  const family = pickFamily();
  const colorIndex = Math.floor(Math.random() * family.colors.length);
  const litIndex = Math.floor(Math.random() * LIT_VARIANTS);

  const height = 4 + Math.random() * 12;
  const width = 2 + Math.random() * 2;
  const depth = 2 + Math.random() * 2;

  const facade = getFacade(family, colorIndex, litIndex);
  const map = facade.map.clone();
  map.repeat.set(
    Math.max(1, Math.round(width / FACADE_TILE.meters)),
    Math.max(1, Math.round(height / FACADE_TILE.meters)),
  );
  const emissiveMap = facade.emissiveMap.clone();
  emissiveMap.repeat.copy(map.repeat);

  const material = new THREE.MeshStandardMaterial({
    map,
    emissiveMap,
    emissive: 0xffd28a, // warm lit windows; intensity raised by the night pass
    emissiveIntensity: 0,
    roughness: family.roughness,
    metalness: family.metalness,
    vertexColors: true,
  });

  const mesh = new THREE.Mesh(buildingGeometry, material);
  mesh.position.set(x, height / 2, z);
  mesh.scale.set(width, height, depth);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Subway cars (per visual-overhaul D5) — 3 curated liveries assembled once as
// template groups, cloned per spawn (Group.clone shares geometries/materials,
// so a spawn allocates nothing but the group itself). Every part is sized to
// keep the group's world bounds within the old 2.2 x 3.5 train obstacle box in
// width and height; length is the sanctioned 6 -> 7 growth (dodge-only). The
// group is registered as the single obstacle — its bounds are the hitbox.
// ---------------------------------------------------------------------------

const TRAIN_LIVERIES = [
  { body: 0xc9ced4, accent: 0x2f5fa8 }, // silver / blue stripe
  { body: 0xa83228, accent: 0xf2e6c9 }, // red / cream band
  { body: 0x3f7d4e, accent: 0xf0ead6 }, // green / ivory band
];

const trainMaterials = {
  glass: new THREE.MeshStandardMaterial({ color: 0x10161e, roughness: 0.12, metalness: 0.7 }),
  door: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.4 }),
  bogie: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.85, metalness: 0.25 }),
  headlight: new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    emissive: 0xfff2cc,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.1,
  }),
  bodies: TRAIN_LIVERIES.map(
    (l) => new THREE.MeshStandardMaterial({ color: l.body, roughness: 0.35, metalness: 0.55 }),
  ),
  accents: TRAIN_LIVERIES.map(
    (l) => new THREE.MeshStandardMaterial({ color: l.accent, roughness: 0.4, metalness: 0.3 }),
  ),
};

const trainGeometry = {
  body: new RoundedBoxGeometry(2.12, 2.9, 7, 3, 0.2),
  windowBand: new THREE.BoxGeometry(2.18, 0.5, 5.4),
  accentBand: new THREE.BoxGeometry(2.14, 0.45, 6.6),
  door: new THREE.BoxGeometry(2.18, 1.8, 0.9),
  windshield: new THREE.BoxGeometry(1.6, 0.6, 0.06),
  headlight: new THREE.BoxGeometry(0.18, 0.18, 0.06),
  bogie: new THREE.BoxGeometry(1.7, 0.34, 1.5),
  wheel: new THREE.CylinderGeometry(0.26, 0.26, 0.12, 10),
};

function buildTrainTemplate(liveryIndex) {
  const train = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const part = new THREE.Mesh(geo, mat);
    part.position.set(x, y, z);
    part.castShadow = true;
    train.add(part);
    return part;
  };

  // Shell, livery band, glazed window band (full-width boxes stand a hair
  // proud of the 2.12 shell so the bands read on both sides)
  add(trainGeometry.body, trainMaterials.bodies[liveryIndex], 0, 1.95, 0);
  add(trainGeometry.accentBand, trainMaterials.accents[liveryIndex], 0, 0.9, 0);
  add(trainGeometry.windowBand, trainMaterials.glass, 0, 2.65, 0);

  // Three door panels per side
  for (const z of [-1.8, 0, 1.8]) {
    add(trainGeometry.door, trainMaterials.door, 0, 1.4, z);
  }

  // Approaching face (-z): windshield band + headlight dots
  add(trainGeometry.windshield, trainMaterials.glass, 0, 2.65, -3.49);
  add(trainGeometry.headlight, trainMaterials.headlight, -0.6, 1.1, -3.49);
  add(trainGeometry.headlight, trainMaterials.headlight, 0.6, 1.1, -3.49);

  // Bogies: two dark frames, 2 axles each (4 wheels per bogie, 8 per car)
  for (const bogieZ of [-2.2, 2.2]) {
    add(trainGeometry.bogie, trainMaterials.bogie, 0, 0.45, bogieZ);
    for (const axleZ of [bogieZ - 0.5, bogieZ + 0.5]) {
      for (const x of [-0.82, 0.82]) {
        const wheel = add(trainGeometry.wheel, trainMaterials.bogie, x, 0.26, axleZ);
        wheel.rotation.z = Math.PI / 2;
      }
    }
  }

  return train;
}

const trainTemplates = TRAIN_LIVERIES.map((_, i) => buildTrainTemplate(i));

// Factory: a liveried car parked at (laneX, z), ground line at y = 0
export function createTrain(laneX, z) {
  const train = trainTemplates[Math.floor(Math.random() * trainTemplates.length)].clone();
  train.position.set(laneX, 0, z);
  return train;
}

// ---------------------------------------------------------------------------
// Work-zone barrier (per visual-overhaul D5) — two hazard-striped planks on a
// galvanized frame. The group's bounds match the old solid plank box exactly
// (2.2 x 1.2 x 0.5 at y 0.6), so jump-over / crash-into behavior is unchanged;
// the group registers as the single obstacle.
// ---------------------------------------------------------------------------

const barrierMaterials = {
  plank: new THREE.MeshStandardMaterial({
    map: createHazardTexture(),
    roughness: 0.5,
    metalness: 0.3,
  }),
  frame: new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6, metalness: 0.6 }),
};

const barrierGeometry = {
  // Both striped planks merged: one draw call for the hazard bands
  planks: mergeGeometries([
    new THREE.BoxGeometry(2.2, 0.5, 0.18).translate(0, 0.95, 0), // 0.7..1.2
    new THREE.BoxGeometry(2.2, 0.28, 0.14).translate(0, 0.41, 0), // 0.27..0.55
  ]),
  // Legs plus ground pads — the pads carry the crash box's 0.5 depth
  frame: mergeGeometries([
    new THREE.BoxGeometry(0.09, 1.16, 0.09).translate(-0.95, 0.58, 0),
    new THREE.BoxGeometry(0.09, 1.16, 0.09).translate(0.95, 0.58, 0),
    new THREE.BoxGeometry(0.14, 0.06, 0.5).translate(-0.95, 0.03, 0),
    new THREE.BoxGeometry(0.14, 0.06, 0.5).translate(0.95, 0.03, 0),
  ]),
};

// Factory: barrier parked at (laneX, z), ground line at y = 0
export function createBarrier(laneX, z) {
  const barrier = new THREE.Group();
  const planks = new THREE.Mesh(barrierGeometry.planks, barrierMaterials.plank);
  const frame = new THREE.Mesh(barrierGeometry.frame, barrierMaterials.frame);
  planks.castShadow = true;
  frame.castShadow = true;
  barrier.add(planks, frame);
  barrier.position.set(laneX, 0, z);
  return barrier;
}

// ---------------------------------------------------------------------------
// Signal gantry (per visual-overhaul D5) — portal frame: two posts plus a
// double-plane truss beam carrying a signal head, all merged into shared
// geometries so the whole beam costs one draw call. The beam group keeps its
// origin ON the beam: game.js registers it with position.y = 2.8, which is
// what the roll-under exception (mesh.position.y > 2.5) keys off, and its
// bounds stay within the old overhead beam zone (2.5 x 0.5 x 1.5 at y 2.8) —
// nothing hangs below the truss, or standing runners would start crashing
// through overheads that never touched them. The posts register separately,
// like the old support poles did.
// ---------------------------------------------------------------------------

const gantryMaterials = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.55, metalness: 0.65 }),
  head: new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.5, metalness: 0.4 }),
  lamp: new THREE.MeshStandardMaterial({
    color: 0x0b1f12,
    emissive: 0x37d67a,
    emissiveIntensity: 1.4,
    roughness: 0.3,
    metalness: 0.1,
  }),
};

const gantryGeometry = (() => {
  // Truss: two X-braced planes at the beam-zone depth joined by cross
  // members; every part stays inside the old 2.5 x 0.5 x 1.5 beam box
  const parts = [];
  const half = 1.25; // beam spans the lane (old box width)
  const bay = 0.625;
  const planeZ = 0.7; // truss planes just inside the old box depth
  for (const z of [-planeZ, planeZ]) {
    for (const chordY of [-0.185, 0.185]) {
      parts.push(new THREE.BoxGeometry(2.5, 0.09, 0.08).translate(0, chordY, z));
    }
    for (let i = 0; i <= 4; i++) {
      parts.push(new THREE.BoxGeometry(0.07, 0.28, 0.07).translate(-half + i * bay, 0, z));
    }
    for (let i = 0; i < 4; i++) {
      // X brace per bay, corner to corner between the chord centers
      for (const dir of [1, -1]) {
        const brace = new THREE.BoxGeometry(0.72, 0.055, 0.055);
        brace.rotateZ(dir * Math.atan2(0.37, bay));
        parts.push(brace.translate(-half + (i + 0.5) * bay, 0, z));
      }
    }
  }
  for (const chordY of [-0.185, 0.185]) {
    for (let i = 0; i <= 4; i++) {
      parts.push(new THREE.BoxGeometry(0.08, 0.08, 2 * planeZ).translate(-half + i * bay, chordY, 0));
    }
  }

  // Signal head rides mid-beam with a green aspect on the approach face —
  // inside the beam zone, so mounting it costs no extra crash volume
  const head = new THREE.BoxGeometry(0.44, 0.34, 0.5);
  const lamp = new THREE.BoxGeometry(0.16, 0.16, 0.06).translate(0, 0, 0.28);

  // Post: shaft with a cap under the beam and a base pad at grade
  const post = mergeGeometries([
    new THREE.BoxGeometry(0.14, 2.8, 0.14).translate(0, -1.4, 0),
    new THREE.BoxGeometry(0.22, 0.1, 0.22).translate(0, -0.02, 0),
    new THREE.BoxGeometry(0.24, 0.08, 0.24).translate(0, -2.76, 0),
  ]);

  return { truss: mergeGeometries(parts), head, lamp, post };
})();

// Factory: gantry straddling (laneX, z); the beam origin rides at y 2.8 and
// the posts return alongside it for separate registration
export function createGantry(laneX, z) {
  const beam = new THREE.Group();
  const truss = new THREE.Mesh(gantryGeometry.truss, gantryMaterials.steel);
  const head = new THREE.Mesh(gantryGeometry.head, gantryMaterials.head);
  const lamp = new THREE.Mesh(gantryGeometry.lamp, gantryMaterials.lamp);
  truss.castShadow = true;
  head.castShadow = true;
  beam.add(truss, head, lamp);

  const postL = new THREE.Mesh(gantryGeometry.post, gantryMaterials.steel);
  const postR = new THREE.Mesh(gantryGeometry.post, gantryMaterials.steel);
  postL.castShadow = true;
  postR.castShadow = true;
  postL.position.set(laneX - 1.2, 2.8, z);
  postR.position.set(laneX + 1.2, 2.8, z);

  beam.position.set(laneX, 2.8, z);
  return { beam, posts: [postL, postR] };
}
