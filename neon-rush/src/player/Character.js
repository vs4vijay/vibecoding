// NEON RUSH — procedural low-poly cyber-runner (W1-CHAR).
//
// Articulated Group hierarchy (no SkinnedMesh): hips → spine/neck/shoulders,
// hips → thighs → knees → ankles. ~640 tris, 3 shared materials, 12 rig draw
// calls (+1 blob shadow; accessories are separate per-skin meshes).
//
// Emissive accents (chest, belt, spine stripe, visor, tips) live in the SAME
// merged mesh as body parts via a shared 1-bit emissiveMap: each part's UVs are
// remapped into the black or white half of a tiny canvas texture, so accents
// bloom (threshold 0.85) while the body stays flat-readable — no extra draws.
//
// Surface contract (Player.js): new Character(skinId), .group, .play(anim, dt,
// speedNorm) for run/jump/slide/dead/flap/fly/drift, .setBlink/.setBlinkOff,
// ._mats[1].emissive = accent (FX trail color reads it). Extras: .setSkin(id),
// .skinId, .trailAnchor. Zero allocations in play().
import {
  Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, Color, Object3D,
  BufferGeometry, BufferAttribute, CanvasTexture, NearestFilter, PointLight,
  BoxGeometry, CylinderGeometry, SphereGeometry, CircleGeometry,
} from 'three';
import { bus } from '../core/EventBus.js';
import { resolveSkin, DEFAULT_SKIN } from './skins.js';

// ---- rig constants (meters; feet sole = y 0, faces −Z) -------------------------
const HIP_Y = 0.895;        // hips group height (thigh pivot 0.845 → sole 0)
const THIGH_PIV_Y = -0.05;  // thigh pivot below hips origin
const THIGH_LEN = 0.42;     // thigh pivot → knee
const SHIN_LEN = 0.38;      // knee → ankle
const SPINE_Y = 0.12;       // spine pivot above hips
const SHOULDER_Y = 0.375;   // shoulder pivot above spine
const SHOULDER_X = 0.26;
const NECK_Y = 0.44;        // neck pivot above spine
const ELBOW_LEN = 0.3;
const KNEE_DROOP = 0.1;     // tiny rest flex so knees never look welded

// pose channels — named number bags created once (zero alloc in play).
// Plain objects, NOT typed arrays: typed arrays silently drop named writes.
const CHANNELS = [
  'hipY', 'hipX', 'hipRY', 'hipRZ',
  'spX', 'spY', 'spZ', 'headX', 'headY',
  'sLx', 'sLy', 'sLz', 'eL', 'sRx', 'sRy', 'sRz', 'eR',
  'tLx', 'tLz', 'kL', 'aL', 'tRx', 'tRz', 'kR', 'aR',
  'rigX', 'rigY', 'rigZ',
];
const zeroPose = () => { const o = {}; for (const k of CHANNELS) o[k] = 0; return o; };

const BLEND = 14;      // crossfade rate (≈120 ms to settle)
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const max0 = (v) => v > 0 ? v : 0;

// ---- geometry helpers (construction-time only) --------------------------------

// paint a part's vertices (Color.set handles sRGB→linear)
function paint(geo, hex) {
  const c = new Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(arr, 3));
  return geo;
}

// remap UVs into the black (off) or white (on) half of the shared emissive map
function emissiveUV(geo, on) {
  const uv = geo.attributes.uv.array;
  const base = on ? 0.585 : 0.015;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = uv[i] * 0.4 + base;
    uv[i + 1] = uv[i + 1] * 0.9 + 0.05;
  }
  return geo;
}

// transformed part spec: P(box(...), x, y, z, rx, ry, rz, sx, sy, sz)
function P(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  if (x || y || z) g.translate(x, y, z);
  return g;
}

// merge parts into one flat-shaded, vertex-colored mesh; records slot ranges so
// setSkin() can repaint colors without touching geometry. EVERY part's UVs are
// remapped into the black or white half of the shared emissive mask (p.emis) —
// raw 0..1 UVs would sample across both halves and light the wrong faces.
function buildMesh(parts, material) {
  const geos = [];
  let total = 0;
  for (const p of parts) {
    const g = p.g.toNonIndexed();
    emissiveUV(g, !!p.emis);
    if (!g.attributes.color) paint(g, '#ffffff');
    total += g.attributes.position.count;
    geos.push(g);
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  const slots = [];
  let o = 0;
  for (let i = 0; i < parts.length; i++) {
    const g = geos[i];
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    col.set(g.attributes.color.array, o * 3);
    slots.push({ slot: parts[i].slot, start: o, count: n });
    o += n;
    g.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const mesh = new Mesh(geo, material);
  mesh.userData.slots = slots;
  return mesh;
}

// shared 1-bit emissive mask: u<0.5 black, u>0.5 white (NearestFilter, no bleed)
function makeEmissiveMap() {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 4;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 16, 4);
  g.fillStyle = '#fff'; g.fillRect(9, 0, 7, 4);
  const t = new CanvasTexture(cv);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// slot → palette key (per-skin `slots` hex overrides win)
function slotHex(def, slot) {
  const ov = def.slots && def.slots[slot];
  if (ov) return ov;
  switch (slot) {
    case 'torso': case 'head': case 'forearm': case 'shin': return def.c.primary;
    case 'pelvis': case 'arm': case 'leg': return def.c.secondary;
    case 'hand': case 'foot': return def.c.dark;
    default: return def.c.accent; // accent/visor/scarf/crest/drone/dec*
  }
}

export class Character {
  constructor(skinId = DEFAULT_SKIN) {
    const def = resolveSkin(skinId);

    // --- materials (shared across skins; setSkin respecifies everything) -------
    const eMap = makeEmissiveMap();
    const std = (extra) => new MeshStandardMaterial({
      vertexColors: true, flatShading: true, color: 0xffffff,
      roughness: 0.45, metalness: 0.3, ...extra,
    });
    this.matTorso = std({ emissiveMap: eMap, emissive: 0x000000 });
    this.matHead = std({ emissiveMap: eMap, emissive: 0x000000 });
    this.matBody = std();
    // _mats[1].emissive = accent → FX.accentColor() compatibility (trail tint)
    this._mats = [this.matTorso, this.matHead, this.matBody];
    this._paintMeshes = []; // vertex-colored meshes, repainted by setSkin

    // --- hierarchy -------------------------------------------------------------
    const root = new Group();
    this.group = root;

    const rig = new Group();          // death pitch/spin, drift roll, squash
    this.rig = rig;
    root.add(rig);

    const shadow = new Mesh(
      new CircleGeometry(0.4, 18),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow); // stays on the ground; play() cancels out root.y
    this.shadow = shadow;

    const glow = new PointLight(0xffffff, 1.1, 3.4, 2);
    glow.position.set(0, 1.0, 0.45);
    rig.add(glow);
    this.glowLight = glow;

    const trailAnchor = new Object3D();
    trailAnchor.position.set(0, 0.6, 0.45);
    rig.add(trailAnchor);
    this.trailAnchor = trailAnchor;

    // hips → legs
    const hips = new Group();
    hips.position.y = HIP_Y;
    rig.add(hips);
    this.hips = hips;

    // spine → torso, head, arms
    const spine = new Group();
    spine.position.y = SPINE_Y;
    hips.add(spine);
    this.spine = spine;

    const neck = new Group();
    neck.position.y = NECK_Y;
    spine.add(neck);
    this.neck = neck;

    // --- merged meshes ----------------------------------------------------------
    // torso: pelvis + tapered chest + emissive belt/chest-plate/spine-stripe
    const torsoMesh = buildMesh([
      { slot: 'pelvis', g: P(new BoxGeometry(0.3, 0.2, 0.21), 0, -0.09, 0) },
      { slot: 'torso', g: P(new CylinderGeometry(0.205, 0.15, 0.42, 7), 0, 0.19, 0, 0, 0, 0, 1, 1, 0.66) },
      { slot: 'accent', emis: true, g: P(new BoxGeometry(0.315, 0.05, 0.225), 0, 0.005, 0) },
      { slot: 'accent', emis: true, g: P(new BoxGeometry(0.16, 0.12, 0.06), 0, 0.27, -0.115) },
      { slot: 'accent', emis: true, g: P(new BoxGeometry(0.055, 0.26, 0.05), 0, 0.2, 0.105) },
    ], this.matTorso);
    spine.add(torsoMesh);
    this._paintMeshes.push(torsoMesh);

    // head: faceted helmet + jaw + emissive visor
    const headMesh = buildMesh([
      { slot: 'head', g: P(new SphereGeometry(0.145, 7, 5), 0, 0.135, 0, 0, 0, 0, 1, 1.08, 1.02) },
      { slot: 'head', g: P(new BoxGeometry(0.12, 0.07, 0.12), 0, 0.045, -0.02) },
      { slot: 'visor', emis: true, g: P(new BoxGeometry(0.185, 0.07, 0.065), 0, 0.145, -0.12, -0.08) },
    ], this.matHead);
    neck.add(headMesh);
    this._paintMeshes.push(headMesh);

    // arms (upper: deltoid+box; lower: forearm+hand) — bend at elbow group
    const limbSide = (sign) => {
      const shoulder = new Group();
      shoulder.position.set(sign * SHOULDER_X, SHOULDER_Y, 0);
      spine.add(shoulder);
      const upper = buildMesh([
        { slot: 'arm', g: P(new SphereGeometry(0.082, 6, 4), 0, -0.015, 0) },
        { slot: 'arm', g: P(new BoxGeometry(0.105, 0.27, 0.105), 0, -0.165, 0) },
      ], this.matBody);
      shoulder.add(upper);
      this._paintMeshes.push(upper);
      const elbow = new Group();
      elbow.position.y = -ELBOW_LEN;
      shoulder.add(elbow);
      const fore = buildMesh([
        { slot: 'forearm', g: P(new BoxGeometry(0.088, 0.24, 0.088), 0, -0.12, 0) },
        { slot: 'hand', g: P(new BoxGeometry(0.092, 0.115, 0.095), 0, -0.285, 0) },
      ], this.matBody);
      elbow.add(fore);
      this._paintMeshes.push(fore);
      return { shoulder, elbow, upper, fore };
    };
    const armL = limbSide(-1), armR = limbSide(1);
    this.shoulderL = armL.shoulder; this.elbowL = armL.elbow;
    this.shoulderR = armR.shoulder; this.elbowR = armR.elbow;

    // legs (thigh; shin; foot) — knee + ankle groups
    const legSide = (sign) => {
      const thigh = new Group();
      thigh.position.set(sign * 0.105, THIGH_PIV_Y, 0);
      hips.add(thigh);
      const thighM = buildMesh([
        { slot: 'leg', g: P(new SphereGeometry(0.09, 6, 4), 0, -0.012, 0) },
        { slot: 'leg', g: P(new BoxGeometry(0.135, 0.36, 0.135), 0, -0.2, 0) },
      ], this.matBody);
      thigh.add(thighM);
      this._paintMeshes.push(thighM);
      const knee = new Group();
      knee.position.y = -THIGH_LEN;
      thigh.add(knee);
      const shinM = buildMesh([
        { slot: 'shin', g: P(new SphereGeometry(0.08, 6, 4), 0, -0.008, 0) },
        { slot: 'shin', g: P(new BoxGeometry(0.105, 0.36, 0.105), 0, -0.19, 0) },
      ], this.matBody);
      knee.add(shinM);
      this._paintMeshes.push(shinM);
      const ankle = new Group();
      ankle.position.y = -SHIN_LEN;
      knee.add(ankle);
      const footM = buildMesh([
        { slot: 'foot', g: P(new BoxGeometry(0.105, 0.075, 0.28), 0, -0.0005, -0.075) },
        { slot: 'foot', g: P(new BoxGeometry(0.09, 0.05, 0.07), 0, -0.017, -0.2) },
      ], this.matBody);
      ankle.add(footM);
      this._paintMeshes.push(footM);
      return { thigh, knee, ankle, thighM, shinM, footM };
    };
    const legL = legSide(-1), legR = legSide(1);
    this.thighL = legL.thigh; this.kneeL = legL.knee; this.ankleL = legL.ankle;
    this.thighR = legR.thigh; this.kneeR = legR.knee; this.ankleR = legR.ankle;
    this._legM = [legL.thighM, legL.shinM, legL.footM, legR.thighM, legR.shinM, legR.footM];
    this._armM = [armL.upper, armL.fore, armR.upper, armR.fore];

    // --- accessories (prebuilt once, toggled per skin) ---------------------------
    this._acc = {};
    const acc = this._acc;

    acc.hood = [buildMesh([
      { slot: 'arm', g: P(new CylinderGeometry(0.055, 0.2, 0.28, 6), 0, 0.27, 0.05, 0.42) },
      { slot: 'arm', g: P(new BoxGeometry(0.21, 0.09, 0.24), 0, 0.05, 0.07) },
    ], this.matBody)];
    neck.add(acc.hood[0]);

    const scarfA = new Group(); scarfA.position.set(0.05, 0.31, 0.1);
    const scarfAM = buildMesh([{ slot: 'scarf', g: P(new BoxGeometry(0.11, 0.045, 0.24), 0, 0, 0.12) }], this.matBody);
    scarfA.add(scarfAM);
    const scarfB = new Group(); scarfB.position.set(0, 0, 0.24);
    const scarfBM = buildMesh([{ slot: 'scarf', g: P(new BoxGeometry(0.095, 0.04, 0.22), 0, 0, 0.11) }], this.matBody);
    scarfB.add(scarfBM);
    scarfA.add(scarfB);
    neck.add(scarfA);
    acc.scarf = [scarfA, scarfB, scarfAM, scarfBM];
    this.scarfA = scarfA; this.scarfB = scarfB;

    const dronePivot = new Group();
    dronePivot.position.set(0, 1.18, 0);
    const droneBody = buildMesh([
      { slot: 'drone', g: P(new SphereGeometry(0.09, 6, 5), 0.55, 0, 0.1, 0, 0, 0, 1, 0.82, 1) },
      { slot: 'drone', g: P(new CylinderGeometry(0.13, 0.13, 0.02, 8), 0.55, 0.03, 0.1) },
    ], this.matBody);
    const droneEye = buildMesh([
      { slot: 'accent', emis: true, g: P(new BoxGeometry(0.06, 0.03, 0.02), 0.55, 0.005, -0.005) },
    ], this.matHead);
    dronePivot.add(droneBody, droneEye);
    rig.add(dronePivot);
    acc.drone = [dronePivot, droneBody, droneEye];
    this.dronePivot = dronePivot;

    const padL = buildMesh([{ slot: 'arm', g: P(new BoxGeometry(0.15, 0.085, 0.17), -0.015, 0.03, 0) }], this.matBody);
    const padR = buildMesh([{ slot: 'arm', g: P(new BoxGeometry(0.15, 0.085, 0.17), 0.015, 0.03, 0) }], this.matBody);
    armL.shoulder.add(padL); armR.shoulder.add(padR);
    acc.pads = [padL, padR];

    acc.crest = [buildMesh([
      { slot: 'crest', g: P(new BoxGeometry(0.035, 0.15, 0.2), 0, 0.28, 0.03, 0.18) },
    ], this.matBody)];
    neck.add(acc.crest[0]);

    acc.antenna = [buildMesh([
      { slot: 'head', g: P(new CylinderGeometry(0.008, 0.012, 0.17, 4), 0.07, 0.32, 0.02, 0, 0, -0.15) },
      { slot: 'accent', emis: true, g: P(new SphereGeometry(0.024, 5, 4), 0.082, 0.405, 0.017) },
    ], this.matHead)];
    neck.add(acc.antenna[0]);

    acc.decals = [buildMesh([
      { slot: 'dec1', g: P(new BoxGeometry(0.09, 0.09, 0.015), -0.06, 0.24, -0.15, 0, 0, 0.3) },
      { slot: 'dec2', g: P(new BoxGeometry(0.06, 0.06, 0.015), 0.07, 0.16, -0.14, 0, 0, -0.2) },
      { slot: 'dec3', g: P(new BoxGeometry(0.14, 0.03, 0.015), 0.02, 0.05, -0.145, 0, 0, 0.12) },
    ], this.matBody)];
    spine.add(acc.decals[0]);

    const circL = buildMesh([
      { slot: 'accent', emis: true, g: P(new BoxGeometry(0.02, 0.26, 0.02), -0.068, -0.2, 0) },
    ], this.matHead);
    const circR = buildMesh([
      { slot: 'accent', emis: true, g: P(new BoxGeometry(0.02, 0.26, 0.02), 0.068, -0.2, 0) },
    ], this.matHead);
    legL.thigh.add(circL); legR.thigh.add(circR);
    acc.circuit = [circL, circR];

    this._accMeshes = {};
    for (const k in acc) {
      this._accMeshes[k] = acc[k];
      for (const o of acc[k]) if (o.isMesh) this._paintMeshes.push(o);
    }

    // --- animation state (all numbers, zero alloc in play) -----------------------
    this._cur = zeroPose();
    this._tgt = zeroPose();
    this.anim = '';
    this.ph = 0;          // run cycle phase
    this.jt = 0;          // time in jump
    this.ft = 0;          // generic state time (flap/fly/drift/idle)
    this.fp = 0;          // flap wing phase
    this._lastY = 0;      // root height (landing detect)
    this._jumpLastY = 0;  // root height last frame (rise/fall velocity in jump)
    this._sqT = 0;        // landing squash timer
    this._pulse = 0;      // combo emissive pulse
    this._glowBase = 1;   // tier-scaled emissive base
    this._deadDim = 1;
    this._time = 0;
    this._hipBase = HIP_Y; // hips height, scales with leg length (feet stay on y=0)
    this._skinDef = def;

    this._applyProportions(def);
    this.setSkin(def.id);

    bus.on('combo:change', (e) => {
      this._pulse = 1;
      const tier = e && e.tier ? e.tier : 1;
      this._glowBase = 0.9 + Math.min(tier, 8) * 0.12;
    });
  }

  // ---- skin switching (materials + flags only — geometry never rebuilds) -------
  setSkin(id) {
    const def = resolveSkin(id);
    this._skinDef = def;
    this.skinId = def.id;

    // repaint vertex-color slots
    const c = new Color();
    for (const mesh of this._paintMeshes) this._repaint(mesh, def, c);

    // materials
    const alpha = def.alpha || 1;
    const trans = alpha < 1;
    for (const mat of this._mats) {
      mat.metalness = def.metal;
      mat.roughness = def.rough;
      mat.transparent = trans;
      mat.opacity = alpha;
      mat.needsUpdate = true;
    }
    const glow = 1.6 * def.glow;
    this.matTorso.emissive.set(def.c.accent);
    this.matHead.emissive.set(def.c.accent);
    this.matTorso.emissiveIntensity = glow;
    this.matHead.emissiveIntensity = glow * 1.3;
    this.glowLight.color.set(def.c.accent);
    this.glowLight.intensity = trans ? 0.5 : 1.1;

    // accessories
    for (const k in this._accMeshes) {
      const on = !!def.acc[k];
      for (const o of this._accMeshes[k]) o.visible = on;
    }

    this._applyProportions(def);
  }

  _repaint(mesh, def, c) {
    const attr = mesh.geometry.attributes.color;
    const arr = attr.array;
    for (const s of mesh.userData.slots) {
      c.set(slotHex(def, s.slot));
      // emissive parts carry a dark albedo so lamp light doesn't stack on the
      // emissive and blow the bloom threshold
      if (s.slot === 'accent' || s.slot === 'visor') {
        c.r *= 0.14; c.g *= 0.14; c.b *= 0.14;
      }
      const end = (s.start + s.count) * 3;
      for (let i = s.start * 3; i < end; i += 3) {
        arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b;
      }
    }
    attr.needsUpdate = true;
  }

  _applyProportions(def) {
    this.spine.scale.set(def.w, 1, def.w);
    this.hips.scale.set(def.w, 1, def.w);
    this.neck.scale.setScalar(def.head);
    const legLen = def.len;
    this.thighL.scale.y = legLen; this.thighR.scale.y = legLen;
    this.kneeL.scale.y = legLen; this.kneeR.scale.y = legLen; // shin scales too
    const armLen = 0.5 + legLen * 0.5;
    this.shoulderL.scale.y = armLen; this.shoulderR.scale.y = armLen;
    this.elbowL.scale.y = armLen; this.elbowR.scale.y = armLen;
    for (const m of this._armM) m.scale.set(def.thick, 1, def.thick);
    for (const m of this._legM) m.scale.set(def.thick, 1, def.thick);
    this.rig.scale.setScalar(def.scale);
    // hips ride at the top of the (scaled) leg chain so the soles stay at y=0
    this._hipBase = HIP_Y * legLen;
  }

  // ---- animation ---------------------------------------------------------------
  // anim: 'run' | 'jump' | 'slide' | 'dead' | 'flap' | 'fly' | 'drift'
  // speedNorm: ctx.speed / 14, clamped ~0..1.6 (Player passes it)
  play(anim, dt, speedNorm = 1) {
    dt = dt > 0.1 ? 0.1 : dt;
    this._time += dt;
    const sn = clamp(speedNorm, 0, 1.6);

    if (anim !== this.anim) {
      this.anim = anim;
      this.jt = 0;
      this.ft = 0;
      this._jumpLastY = this.group.position.y;
      this._deadSnap = anim === 'dead';
      if (anim === 'dead') this._deadDim = 0.3;
      else this._deadDim = 1;
    }

    const tgt = this._tgt;
    switch (anim) {
      case 'jump': this._poseJump(tgt, dt, sn); break;
      case 'slide': this._poseSlide(tgt, dt); break;
      case 'dead': this._poseDead(tgt); break;
      case 'flap': this._poseFlap(tgt, dt); break;
      case 'fly': this._poseFly(tgt, dt); break;
      case 'drift': this._poseDrift(tgt, dt); break;
      default: sn <= 0.02 ? this._poseIdle(tgt, dt) : this._poseRun(tgt, dt, sn); break;
    }

    // crossfade current → target (dead snaps for impact; world freezes anyway)
    const cur = this._cur;
    if (this._deadSnap) {
      for (const k of CHANNELS) cur[k] = tgt[k];
      this._deadSnap = false;
    } else {
      const f = Math.min(1, BLEND * dt);
      for (const k of CHANNELS) cur[k] += (tgt[k] - cur[k]) * f;
    }
    this._apply(cur);

    // landing squash (detect ground contact from root height)
    const y = this.group.position.y;
    if (this._lastY > 0.14 && y <= 0.06 && anim !== 'dead') this._sqT = 0.1;
    this._lastY = y;

    // shadow sticks to the ground regardless of jump height
    this.shadow.position.y = 0.02 - y;
    const ss = Math.max(0.55, 1 - y * 0.16);
    this.shadow.scale.set(ss, ss, 1);
    this.shadow.material.opacity = 0.42 * Math.max(0.3, 1 - y * 0.2);
    if (this._sqT > 0) this._sqT -= dt;

    // combo emissive pulse + death dim (tuned so accents pop over bloom
    // threshold 0.85 while lit body albedo stays below it)
    this._pulse *= Math.exp(-3.2 * dt);
    const g = this._glowBase * (1 + 0.75 * this._pulse) * this._deadDim * this._skinDef.glow;
    this.matTorso.emissiveIntensity = 1.6 * g;
    this.matHead.emissiveIntensity = 2.1 * g;

    // accessories that flutter/orbit
    if (this.scarfA.visible) this._animScarf(sn);
    if (this.dronePivot.visible) this._animDrone(dt);
  }

  // run gait. Phase bookkeeping (left leg): p=π/2 → heel contact (thigh max
  // forward), π/2..π → stance, ~π..4.2 → toe-off + early swing, knee flexion
  // peaks mid-swing (thigh swinging through under the body), so the stance leg
  // stays straight and the foot plants. Hips ride highest at the flight moment.
  _poseRun(tgt, dt, sn) {
    this.ph += dt * (8.2 + 3.6 * Math.min(sn, 1.5));
    const p = this.ph;
    const s = Math.sin(p);
    const c = Math.cos(p);

    tgt.hipY = -0.022 + 0.042 * Math.pow(Math.abs(c), 1.2);
    tgt.hipX = 0.02 * Math.sin(p + 0.5);
    tgt.hipRY = 0.15 * s;
    tgt.hipRZ = 0.05 * s;

    tgt.spX = -(0.13 + 0.11 * Math.min(1, sn));
    tgt.spY = -0.2 * s;
    tgt.spZ = -0.04 * s;
    tgt.headX = 0.1 + 0.02 * sn;
    tgt.headY = -(tgt.spY + tgt.hipRY) * 0.55;

    tgt.sLx = -0.9 * s - 0.08;
    tgt.eL = 0.7 + 0.62 * max0(-s);
    tgt.sLz = -0.12 - 0.07 * max0(-s);
    tgt.sLy = 0;
    tgt.sRx = 0.9 * s - 0.08;
    tgt.eR = 0.7 + 0.62 * max0(s);
    tgt.sRz = 0.12 + 0.07 * max0(s);
    tgt.sRy = 0;

    tgt.tLx = 0.75 * s - 0.05;
    tgt.kL = 0.1 + 1.3 * max0(c) * max0(s + 0.35) + 0.3 * max0(s * c);
    tgt.aL = 0.15 * max0(s) * max0(c)
      - 0.55 * max0(-s) * max0(-c)
      + 0.3 * max0(-s) * max0(c);
    tgt.tLz = 0.02;
    tgt.tRx = -0.75 * s - 0.05;
    tgt.kR = 0.1 + 1.3 * max0(-c) * max0(-s + 0.35) + 0.3 * max0(s * c);
    tgt.aR = 0.15 * max0(-s) * max0(-c)
      - 0.55 * max0(s) * max0(c)
      + 0.3 * max0(s) * max0(-c);
    tgt.tRz = -0.02;

    tgt.rigX = 0; tgt.rigY = 0; tgt.rigZ = 0;
  }

  _poseIdle(tgt, dt) {
    this.ft += dt;
    const b = Math.sin(this.ft * 2.1);
    tgt.hipY = -0.02 + 0.012 * b;
    tgt.hipX = 0; tgt.hipRY = 0.04 * Math.sin(this.ft * 0.6); tgt.hipRZ = 0;
    tgt.spX = -0.04 + 0.018 * b;
    tgt.spY = -0.04 * Math.sin(this.ft * 0.6);
    tgt.spZ = 0;
    tgt.headX = 0.03;
    tgt.headY = 0.14 * Math.sin(this.ft * 0.53);
    tgt.sLx = 0.06 + 0.02 * b; tgt.sLy = 0; tgt.sLz = -0.1; tgt.eL = 0.3;
    tgt.sRx = 0.06 + 0.02 * b; tgt.sRy = 0; tgt.sRz = 0.1; tgt.eR = 0.3;
    tgt.tLx = -0.03; tgt.tLz = 0.01; tgt.kL = KNEE_DROOP; tgt.aL = 0;
    tgt.tRx = -0.03; tgt.tRz = -0.01; tgt.kR = KNEE_DROOP; tgt.aR = 0;
    tgt.rigX = 0; tgt.rigY = 0; tgt.rigZ = 0;
  }

  // jump: anticipate crouch → stretch+tuck on rise → legs extend, arms out on fall
  _poseJump(tgt, dt, sn) {
    this.jt += dt;
    const y = this.group.position.y;
    const v = dt > 0 ? (y - this._jumpLastY) / dt : 0;
    this._jumpLastY = y;
    const w = clamp(v / 4, -1, 1);          // −1 falling … +1 rising
    const mix = w * 0.5 + 0.5;

    if (this.jt < 0.075 && y < 0.15) {
      // anticipation crouch (blended quickly by the crossfade damping)
      tgt.hipY = -0.13; tgt.hipX = 0; tgt.hipRY = 0; tgt.hipRZ = 0;
      tgt.spX = 0.12; tgt.spY = 0; tgt.spZ = 0;
      tgt.headX = -0.06; tgt.headY = 0;
      tgt.sLx = -0.75; tgt.sLy = 0; tgt.sLz = -0.25; tgt.eL = 0.5;
      tgt.sRx = -0.75; tgt.sRy = 0; tgt.sRz = 0.25; tgt.eR = 0.5;
      tgt.tLx = -0.2; tgt.tLz = 0.05; tgt.kL = 0.85; tgt.aL = 0.15;
      tgt.tRx = -0.2; tgt.tRz = -0.05; tgt.kR = 0.85; tgt.aR = 0.15;
      tgt.rigX = 0; tgt.rigY = 0; tgt.rigZ = 0;
      return;
    }

    // rise pose
    let hipY = 0.02, spX = -0.16, headX = 0.14;
    let tLx = 0.95, kL = 1.45, aL = 0.25, tRx = 0.3, kR = 0.85, aR = 0.1;
    let sLx = -2.4, eL = 0.35, sLz = -0.3, sRx = -2.15, eR = 0.5, sRz = 0.3;
    let rigX = -0.06;
    // fall pose
    if (mix < 1) {
      const f = 1 - mix;
      hipY += (0 - hipY) * f; spX += (-0.1 - spX) * f; headX += (0.18 - headX) * f;
      tLx += (0.55 - tLx) * f; kL += (0.45 - kL) * f; aL += (0.35 - aL) * f;
      tRx += (0.3 - tRx) * f; kR += (0.55 - kR) * f; aR += (0.2 - aR) * f;
      sLx += (-0.55 - sLx) * f; eL += (0.45 - eL) * f; sLz += (-1.05 - sLz) * f;
      sRx += (-0.4 - sRx) * f; eR += (0.45 - eR) * f; sRz += (1.05 - sRz) * f;
      rigX += (0.02 - rigX) * f;
    }
    tgt.hipY = hipY; tgt.hipX = 0; tgt.hipRY = 0; tgt.hipRZ = 0;
    tgt.spX = spX; tgt.spY = 0; tgt.spZ = 0;
    tgt.headX = headX + 0.08; tgt.headY = 0;
    tgt.sLx = sLx; tgt.sLy = 0; tgt.sLz = sLz; tgt.eL = eL;
    tgt.sRx = sRx; tgt.sRy = 0; tgt.sRz = sRz; tgt.eR = eR;
    tgt.tLx = tLx; tgt.tLz = 0.04; tgt.kL = kL; tgt.aL = aL;
    tgt.tRx = tRx; tgt.tRz = -0.04; tgt.kR = kR; tgt.aR = aR;
    tgt.rigX = rigX; tgt.rigY = 0; tgt.rigZ = 0;
  }

  // slide: deep crouch, lead leg extended, trail leg folded, chin up —
  // low wide silhouette readable from behind
  _poseSlide(tgt, dt) {
    this.ft += dt;
    tgt.hipY = -0.52; tgt.hipX = 0; tgt.hipRY = 0.28; tgt.hipRZ = 0.04;
    tgt.spX = 0.62; tgt.spY = 0.1; tgt.spZ = 0.05;
    tgt.headX = -0.58; tgt.headY = -0.12;
    tgt.sLx = -0.5; tgt.sLy = 0; tgt.sLz = -0.55; tgt.eL = 0.3;
    tgt.sRx = 0.95; tgt.sRy = 0; tgt.sRz = 0.35; tgt.eR = 0.45;
    tgt.tLx = 1.3; tgt.tLz = 0.08; tgt.kL = 0.12; tgt.aL = -0.35;
    tgt.tRx = -0.75; tgt.tRz = -0.1; tgt.kR = 2.0; tgt.aR = 0.5;
    tgt.rigX = 0; tgt.rigY = 0; tgt.rigZ = 0.1;
  }

  // dead: ragdoll collapse — face-plant arc, twist, limbs sprawled, glow dies.
  // Snaps on the first frame (DEAD state freezes updates after the kill call).
  _poseDead(tgt) {
    tgt.hipY = 0; tgt.hipX = 0; tgt.hipRY = 0.45; tgt.hipRZ = 0.08;
    tgt.spX = 0.35; tgt.spY = -0.2; tgt.spZ = -0.12;
    tgt.headX = 0.55; tgt.headY = 0.35;
    tgt.sLx = -2.55; tgt.sLy = 0; tgt.sLz = -0.75; tgt.eL = 0.3;
    tgt.sRx = 1.05; tgt.sRy = 0; tgt.sRz = 0.5; tgt.eR = 0.65;
    tgt.tLx = -0.3; tgt.tLz = 0.18; tgt.kL = 0.55; tgt.aL = 0.3;
    tgt.tRx = 0.4; tgt.tRz = -0.15; tgt.kR = 0.95; tgt.aR = -0.2;
    tgt.rigX = -1.18; tgt.rigY = 0.55; tgt.rigZ = 0.12;
  }

  // flap: wing-arm downstroke sweep + body pitch-up impulse
  _poseFlap(tgt, dt) {
    this.ft += dt; this.fp += dt * 12;
    const wing = Math.cos(this.fp);
    tgt.hipY = 0.01 * Math.sin(this.fp * 2); tgt.hipX = 0; tgt.hipRY = 0; tgt.hipRZ = 0;
    tgt.spX = -0.1; tgt.spY = 0; tgt.spZ = 0;
    tgt.headX = 0.25; tgt.headY = 0;
    tgt.sLx = 0.25; tgt.sLy = 0; tgt.sLz = -1.15 - 0.85 * wing; tgt.eL = 0.35;
    tgt.sRx = 0.25; tgt.sRy = 0; tgt.sRz = 1.15 + 0.85 * wing; tgt.eR = 0.35;
    tgt.tLx = -0.18; tgt.tLz = 0.05; tgt.kL = 0.75; tgt.aL = 0.2;
    tgt.tRx = -0.3; tgt.tRz = -0.05; tgt.kR = 0.9; tgt.aR = 0.2;
    tgt.rigX = 0.14 + 0.06 * Math.cos(this.fp + 1);
    tgt.rigY = 0; tgt.rigZ = 0;
  }

  // fly: superman pose, legs trailing, subtle drift wobble, gaze forward
  _poseFly(tgt, dt) {
    this.ft += dt;
    const t = this.ft;
    tgt.hipY = 0.02 * Math.sin(t * 3.1); tgt.hipX = 0; tgt.hipRY = 0; tgt.hipRZ = 0;
    tgt.spX = 0.1; tgt.spY = 0; tgt.spZ = 0;
    tgt.headX = 1.02; tgt.headY = 0;
    tgt.sLx = 2.45; tgt.sLy = 0; tgt.sLz = -0.15; tgt.eL = 0.12;
    tgt.sRx = 2.3; tgt.sRy = 0; tgt.sRz = 0.15; tgt.eR = 0.2;
    tgt.tLx = -0.22; tgt.tLz = 0.04; tgt.kL = 0.4; tgt.aL = -0.35;
    tgt.tRx = -0.34; tgt.tRz = -0.04; tgt.kR = 0.55; tgt.aR = -0.3;
    tgt.rigX = -1.18 + 0.05 * Math.sin(t * 2.3);
    tgt.rigY = 0.04 * Math.sin(t * 0.9);
    tgt.rigZ = 0.05 * Math.sin(t * 1.4);
  }

  // drift: crouched stagger stance, twisted into the turn, inside arm out.
  // Turn direction read from the root z-tilt set by Player/phase.
  _poseDrift(tgt, dt) {
    this.ft += dt;
    const lean = clamp(this.group.rotation.z * -2.2, -1, 1);
    tgt.hipY = -0.28; tgt.hipX = 0.03 * lean; tgt.hipRY = 0.35 * lean; tgt.hipRZ = 0.06 * lean;
    tgt.spX = -0.32; tgt.spY = 0.5 * lean; tgt.spZ = -0.1 * lean;
    tgt.headX = 0.1; tgt.headY = -0.35 * lean;
    tgt.sLx = 0.35; tgt.sLy = 0; tgt.sLz = -1.25; tgt.eL = 0.3;
    tgt.sRx = 0.55; tgt.sRy = 0; tgt.sRz = 0.55; tgt.eR = 0.7;
    tgt.tLx = 0.8; tgt.tLz = 0.06; tgt.kL = 0.9; tgt.aL = 0.1;
    tgt.tRx = -0.65; tgt.tRz = -0.06; tgt.kR = 1.25; tgt.aR = 0.3;
    tgt.rigX = 0; tgt.rigY = 0;
    tgt.rigZ = 0.16 * lean + 0.03 * Math.sin(this.ft * 6);
  }

  // write pose channels to the node hierarchy (numbers only — no allocs)
  _apply(c) {
    const rig = this.rig;
    this.hips.position.set(c.hipX, this._hipBase + c.hipY, 0);
    this.hips.rotation.set(0, c.hipRY, c.hipRZ);
    this.spine.rotation.set(c.spX, c.spY, c.spZ);
    this.neck.rotation.set(c.headX, c.headY, 0);

    this.shoulderL.rotation.set(c.sLx, c.sLy, c.sLz);
    this.shoulderR.rotation.set(c.sRx, c.sRy, c.sRz);
    this.elbowL.rotation.x = c.eL;
    this.elbowR.rotation.x = c.eR;

    this.thighL.rotation.set(c.tLx, 0, c.tLz);
    this.thighR.rotation.set(c.tRx, 0, c.tRz);
    this.kneeL.rotation.x = -c.kL;
    this.kneeR.rotation.x = -c.kR;
    this.ankleL.rotation.x = c.aL;
    this.ankleR.rotation.x = c.aR;

    rig.rotation.set(c.rigX, c.rigY, c.rigZ);

    // landing squash on top of the skin's base scale
    const base = this._skinDef.scale;
    const q = this._sqT > 0 ? 0.15 * (this._sqT / 0.1) : 0;
    rig.scale.set(base * (1 + q * 0.55), base * (1 - q), base * (1 + q * 0.55));
  }

  _animScarf(sn) {
    const t = this._time;
    const lift = 0.5 + 0.3 * sn; // tail streams back and up
    this.scarfA.rotation.x = lift + 0.16 * Math.sin(t * 9.1);
    this.scarfA.rotation.y = -0.35 + 0.14 * Math.sin(t * 5.7);
    this.scarfB.rotation.x = lift * 0.8 + 0.26 * Math.sin(t * 9.1 + 0.9);
    this.scarfB.rotation.y = -0.3 + 0.2 * Math.sin(t * 5.7 + 0.6);
  }

  _animDrone(dt) {
    const t = this._time;
    this.dronePivot.rotation.y += dt * 2.2;
    this.dronePivot.children[0].position.y = 0.06 * Math.sin(t * 3.1);
    this.dronePivot.children[1].position.y = 0.06 * Math.sin(t * 3.1);
    this.dronePivot.rotation.x = 0.06 * Math.sin(t * 1.7);
  }

  // ---- invulnerability blink (revive flash) — contract from W0 ------------------
  setBlink(on) {
    this.group.visible = !on || (performance.now() % 200) < 120;
  }

  setBlinkOff() {
    this.group.visible = true;
  }
}
