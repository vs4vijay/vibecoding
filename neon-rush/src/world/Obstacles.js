// Pooled obstacle meshes + registration hook so later phases add types:
//   Obstacles.register(type, factory) — factory() → Object3D with
//   obj.userData.def = { halfW, halfH, halfD, y, jumpable, slideable }
// Hitboxes are FORGIVING: 0.72× the visual size (contract). Hazards are
// red/orange per the readability rule. Zero allocation in update loops:
// spawn/release recycle both the Object3D and its bookkeeping record.
import * as THREE from 'three';
import { Pool } from '../core/Pool.js';
import { COL } from '../core/Palette.js';
import { laneX } from './Chunk.js';
import { shadowSpriteTexture } from '../fx/Textures.js';

export const HIT_SCALE = 0.72; // forgiving hitbox factor

const defs = new Map();
const pools = new Map();
const active = []; // live records: { obj, type, def, chunk, x, y, z, nmDone }

const recordPool = new Pool(
  () => ({ obj: null, type: '', def: null, chunk: null, x: 0, y: 0, z: 0, nmDone: false }),
  (r) => { r.obj = null; r.type = ''; r.def = null; r.chunk = null; r.nmDone = false; },
  'obstacle-records',
);

// --- shared geometry/material caches (built once) ---
const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}

// merged multi-box geometry cache (r1: real silhouettes — posts + panel + base
// in ONE draw). boxes: [cx, cy, cz, w, h, d][]
const mergedCache = new Map();
function mergedBoxes(key, boxes) {
  let g = mergedCache.get(key);
  if (g) return g;
  const pos = [], nor = [], idx = [];
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [cx, cy, cz, w, h, d] of boxes) {
    const half = [w / 2, h / 2, d / 2];
    for (let f = 0; f < 6; f++) {
      const n = FACES[f];
      const u = n[0] !== 0 ? [0, 0, 1] : [1, 0, 0];
      const v = n[1] !== 0 ? [0, 0, 1] : [0, 1, 0];
      const hu = Math.abs(u[0]) * half[0] + Math.abs(u[1]) * half[1] + Math.abs(u[2]) * half[2];
      const hv = Math.abs(v[0]) * half[0] + Math.abs(v[1]) * half[1] + Math.abs(v[2]) * half[2];
      const cn = Math.abs(n[0]) * half[0] + Math.abs(n[1]) * half[1] + Math.abs(n[2]) * half[2];
      const base = pos.length / 3;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let ci = 0; ci < 4; ci++) {
        const su = corners[ci][0], sv = corners[ci][1];
        pos.push(cx + n[0] * cn + u[0] * su * hu, cy + n[1] * cn + v[1] * sv * hv, cz + n[2] * cn + u[2] * su * hu + v[2] * sv * hv);
        nor.push(n[0], n[1], n[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  mergedCache.set(key, g);
  return g;
}

function stripeTexture(colA, colB) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = colB; g.fillRect(0, 0, 128, 128);
  // soft-edged hazard chevrons (r1: the hard-aliased 22px stripes shredded at
  // minification — glow-cushioned strokes survive mipmaps cleanly)
  g.strokeStyle = colA; g.lineCap = 'round';
  g.shadowColor = colA; g.shadowBlur = 10;
  g.lineWidth = 20;
  for (let i = -128; i < 256; i += 52) {
    g.beginPath(); g.moveTo(i, 146); g.lineTo(i + 146, 0); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let STRIPES_RED = null;
let STRIPES_ORANGE = null;

const edgeMats = new Map();
function edgeMat(color) {
  // W1-VIS: rims punch through ACES tonemapping so hazards read at distance
  let m = edgeMats.get(color);
  if (!m) { m = new THREE.LineBasicMaterial({ color, toneMapped: false }); edgeMats.set(color, m); }
  return m;
}

// contact shadow — one shared material, per-type plane scaled by footprint
let shadowMat = null;
function contactShadow(w, d) {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({
      map: shadowSpriteTexture(), transparent: true, opacity: 0.6, depthWrite: false,
    });
  }
  const m = new THREE.Mesh(geoCache.get('shadow') || geoCache.set('shadow', new THREE.PlaneGeometry(1, 1)).get('shadow'), shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  m.position.y = 0.02;
  m.renderOrder = 1;
  return m;
}

function registerBuiltins() {
  STRIPES_RED = stripeTexture('#ff3355', '#180410');
  STRIPES_ORANGE = stripeTexture('#ff7a1a', '#160a03');

  // W1-VIS: bright unlit light bars baked onto hazards (visual only — the
  // hitbox defs below are untouched). Reads at distance pre-bloom.
  const barRed = new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false });
  const barOrange = new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false });

  const hazardRed = new THREE.MeshStandardMaterial({
    color: 0x1c0a12, map: STRIPES_RED, emissive: COL.red, emissiveMap: STRIPES_RED,
    emissiveIntensity: 2.3, metalness: 0.25, roughness: 0.55,
  });
  const hazardOrange = new THREE.MeshStandardMaterial({
    color: 0x1c1206, map: STRIPES_ORANGE, emissive: COL.orange, emissiveMap: STRIPES_ORANGE,
    emissiveIntensity: 2.3, metalness: 0.25, roughness: 0.55,
  });
  const structMat = new THREE.MeshStandardMaterial({
    color: 0x161020, metalness: 0.55, roughness: 0.5,
  });
  const trainMat = new THREE.MeshStandardMaterial({
    color: 0x0d0a20, emissive: COL.magenta, emissiveIntensity: 0.3,
    metalness: 0.6, roughness: 0.35,
  });
  const trainWinMat = new THREE.MeshStandardMaterial({
    color: 0x220018, emissive: COL.red, emissiveIntensity: 1.7,
  });
  const trainSkirtMat = new THREE.MeshStandardMaterial({
    color: 0x12041a, emissive: COL.magenta, emissiveIntensity: 1.5, metalness: 0.3, roughness: 0.4,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x150714, emissive: COL.red, emissiveIntensity: 0.85, metalness: 0.3, roughness: 0.5,
  });

  // barrier — low, JUMPABLE. posts+panel+base silhouette (was one floating
  // card), hatched panel with real depth, hot cap rail, contact shadow.
  // visual grows to ~2.4×0.98 — the def hitbox below is untouched.
  register('barrier', () => {
    const g = new THREE.Group();
    const struct = new THREE.Mesh(mergedBoxes('barrier-struct', [
      [0, -0.45, 0, 2.42, 0.1, 0.72],      // skid base
      [-0.94, 0.0, 0, 0.2, 0.86, 0.24],    // posts
      [0.94, 0.0, 0, 0.2, 0.86, 0.24],
      [0, 0.46, 0, 2.36, 0.1, 0.3],        // top rail (dark)
    ]), structMat);
    const panel = new THREE.Mesh(boxGeo(2.06, 0.5, 0.2), hazardRed); // hatched face
    panel.position.set(0, 0.1, 0);
    const bar = new THREE.Mesh(boxGeo(2.42, 0.1, 0.34), barRed);     // hot cap rail
    bar.position.y = 0.43;
    g.add(struct, panel, bar, contactShadow(3.2, 1.9, -0.48));
    g.userData.def = { halfW: 1.1, halfH: 0.5, halfD: 0.25, y: 0.5, jumpable: true, slideable: false };
    return g;
  });

  // beam — overhead bar, SLIDEABLE. side posts + deep hatched beam + hot
  // lower edge + shadow pool. def untouched.
  register('beam', () => {
    const g = new THREE.Group();
    const struct = new THREE.Mesh(mergedBoxes('beam-struct', [
      [-1.04, -0.42, 0, 0.2, 2.0, 0.24],   // posts
      [1.04, -0.42, 0, 0.2, 2.0, 0.24],
      [0, 0.6, 0, 2.3, 0.12, 0.3],         // cap
    ]), structMat);
    const beam = new THREE.Mesh(boxGeo(2.3, 0.52, 0.24), hazardOrange);
    const bar = new THREE.Mesh(boxGeo(2.36, 0.1, 0.3), barOrange); // hot slide edge
    bar.position.y = -0.29;
    g.add(struct, beam, bar, contactShadow(3.0, 1.5, -1.4));
    g.userData.def = { halfW: 1.1, halfH: 0.4, halfD: 0.25, y: 1.42, jumpable: false, slideable: true };
    return g;
  });

  // train — full block, forces lane change. adds glowing skirt + nose lights.
  register('train', () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(2.3, 3, 14), trainMat);
    const win = new THREE.Mesh(boxGeo(2.34, 0.5, 10), trainWinMat);
    win.position.set(0, 0.75, 0);
    const roofBar = new THREE.Mesh(boxGeo(0.12, 0.1, 13.2), barRed);
    roofBar.position.set(0, 1.52, 0);
    const skirt = new THREE.Mesh(boxGeo(2.34, 0.16, 13.4), trainSkirtMat);
    skirt.position.y = 0.14;
    const nose = new THREE.Mesh(mergedBoxes('train-nose', [
      [-0.72, 0.9, 6.94, 0.34, 0.22, 0.14],
      [0.72, 0.9, 6.94, 0.34, 0.22, 0.14],
    ]), barRed);
    g.add(body, win, roofBar, skirt, nose);
    g.userData.def = { halfW: 1.15, halfH: 1.5, halfD: 7, y: 1.5, jumpable: false, slideable: false };
    return g;
  });

  // wall — hard lane blocker. edge columns + recessed hazard core + bars.
  register('wall', () => {
    const g = new THREE.Group();
    const struct = new THREE.Mesh(mergedBoxes('wall-struct', [
      [-1.08, 1.3, 0, 0.24, 2.72, 0.72],
      [1.08, 1.3, 0, 0.24, 2.72, 0.72],
      [0, 0.06, 0, 2.4, 0.12, 0.78],     // foot
    ]), structMat);
    const panel = new THREE.Mesh(boxGeo(1.9, 2.4, 0.34), wallMat);
    panel.position.y = 1.32;
    const barA = new THREE.Mesh(boxGeo(1.98, 0.12, 0.42), barRed);
    barA.position.y = 2.0;
    const barB = new THREE.Mesh(boxGeo(1.98, 0.12, 0.42), barRed);
    barB.position.y = 0.66;
    g.add(struct, panel, barA, barB, contactShadow(3.1, 2.0));
    g.userData.def = { halfW: 1.15, halfH: 1.3, halfD: 0.3, y: 1.3, jumpable: false, slideable: false };
    return g;
  });

  // [W1-FEEL] mysterybox — world pickup, NOT a hazard (cyan/gold per the
  // readability rule; hazards stay red/orange). Feel.js collects it by
  // proximity BEFORE the player hitbox could ever overlap: its hitbox
  // (0.72 × 0.4 ≈ 0.29 half-extents at y 0.9) is strictly inside the collect
  // zone, and slideable:true doubles as the autopilot hint to slide under it
  // (slide height 0.58 clears the 0.61 hitbox bottom → autopilot grabs it).
  // 2 draw calls per box (body + neon rim), ≤ 2 alive → within the +4 budget.
  const boxBodyMat = new THREE.MeshStandardMaterial({
    color: 0x0a2530, emissive: COL.gold, emissiveIntensity: 1.8,
    metalness: 0.4, roughness: 0.25,
  });
  register('mysterybox', () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(0.9, 0.9, 0.9), boxBodyMat);
    body.position.y = 0.1;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo(0.9, 0.9, 0.9)), edgeMat(COL.cyan));
    g.add(body, edge);
    g.userData.def = { halfW: 0.4, halfH: 0.4, halfD: 0.4, y: 0.9, jumpable: false, slideable: true };
    return g;
  });
}

export function register(type, factory) {
  if (!defs.has(type)) {
    defs.set(type, factory);
    pools.set(type, new Pool(factory, (obj) => { obj.removeFromParent(); }, `obstacle:${type}`));
  }
}
registerBuiltins();

export function spawn(type, chunk, laneIdx, z, xOff = 0) {
  const pool = pools.get(type);
  if (!pool) return null;
  const obj = pool.get();
  const rec = recordPool.get();
  const def = obj.userData.def;
  rec.obj = obj; rec.type = type; rec.def = def;
  rec.chunk = chunk;
  rec.x = laneX(laneIdx) + xOff;
  rec.y = def.y;
  rec.z = z;
  rec.nmDone = false;
  obj.position.set(rec.x, def.y, z);
  chunk.group.add(obj);
  chunk.spawnables.push(rec);
  active.push(rec);
  return rec;
}

function release(rec) {
  const i = active.indexOf(rec);
  if (i >= 0) { active[i] = active[active.length - 1]; active.pop(); }
  if (rec.obj) pools.get(rec.type).release(rec.obj); // reset detaches the mesh from its chunk
  rec.chunk = null;
  recordPool.release(rec);
}

export function releaseAllFor(chunk) {
  const list = chunk.spawnables;
  for (let i = 0; i < list.length; i++) release(list[i]);
  list.length = 0;
}

export function clear() {
  while (active.length) {
    releaseAllFor(active[active.length - 1].chunk);
  }
}

// Release everything strictly ahead of worldZ (used by teleport / forcePhase).
export function releaseAhead(scroll, limitZ) {
  for (let i = active.length - 1; i >= 0; i--) {
    const rec = active[i];
    const wz = rec.chunk.baseZ + scroll + rec.z;
    if (wz < limitZ) {
      const idx = rec.chunk.spawnables.indexOf(rec);
      if (idx >= 0) { rec.chunk.spawnables[idx] = rec.chunk.spawnables[rec.chunk.spawnables.length - 1]; rec.chunk.spawnables.pop(); }
      release(rec);
    }
  }
}

// Consumed-pickup marker in record z — same value Feel.js (BOX_GONE) writes;
// duplicated here because Feel imports this module (no reverse import).
export const COLLECTED_Z = 1e4;

// Read-only query (design D8): nearest ACTIVE hazard strictly ahead of the
// player plane (world z < 0) within `range` meters. Zero allocation — fills
// the caller's `out` ({x,y,z,dist,type,jumpable,slideable}) and returns whether
// anything was found. Optional `kind` ('jump' | 'slide') restricts the match to
// pure jumpable / pure slideable hazards, so a barrier chain can't shadow an
// incoming beam. Mystery boxes are pickups, not hazards: same skip
// Feel.findHazard uses (type + consumed marker).
export function nearestAhead(scroll, range, out, kind) {
  let best = range;
  let found = false;
  for (let i = 0; i < active.length; i++) {
    const o = active[i];
    if (o.type === 'mysterybox' || o.z > COLLECTED_Z) continue;
    if (kind === 'jump' && (!o.def.jumpable || o.def.slideable)) continue;
    if (kind === 'slide' && (!o.def.slideable || o.def.jumpable)) continue;
    const wz = o.chunk.baseZ + scroll + o.z;
    if (wz >= 0) continue;
    const d = -wz;
    if (d < best) {
      best = d;
      out.x = o.x; out.y = o.y; out.z = wz; out.dist = d; out.type = o.type;
      out.jumpable = o.def.jumpable; out.slideable = o.def.slideable;
      found = true;
    }
  }
  return found;
}

export const Obstacles = {
  register, spawn, releaseAllFor, clear, releaseAhead, nearestAhead,
  get active() { return active; },
  get count() { return active.length; },
  HIT_SCALE,
};
