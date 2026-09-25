// ORB FIELD — open-arena stretch (slither/merge/Fruit-Ninja fusion). [W1-PHASES]
// Lane structure relaxes: hold ←/→ (or A/D) to steer freely across the wide
// field; soft barrier posts mark the edge (no death — you just slide).
//   - Plasma orbs (cyan) stream along glowing dotted curl paths; magnet radius
//     grows with your combo tier.
//   - Merge chips (triangle/square/hex × cyan/magenta/gold): collect 3 of a
//     kind → they merge up a tier, worth 5× — fires bus 'coin:x'{tier} (the
//     FX layer already listens) + a toast.
//   - Every ~8 s a 2 s SLOW-MO SLASH WINDOW opens (Time.scale hook): data
//     fruit (emissive icosahedra) spin through — pass through them to slash
//     for coin bursts.
import * as THREE from 'three';
import { Phase, suppressRunObstacles, captureAnim, wrapActions, expirePopups } from './Phase.js';
import { COL } from '../core/Palette.js';
import { FX } from '../fx/FX.js';
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';
import { economy } from '../game/Economy.js'; // MAGNET CORE implant (design D2)
import { makeOrbFloor } from '../fx/Shaders.js';
import { glowSpriteTexture } from '../fx/Textures.js';

const EDGE_X = 6.6;          // soft barrier
const ORB_N = 44;
const ORB_SPAN = 175;        // leapfrog distance
const CHIP_N = 12;
const CHIP_SPAN = 150;
const FRUIT_N = 6;
const SLASH_CYCLE = 8;       // s between windows
const SLASH_LEN = 2.0;       // window length (game seconds)
const SLASH_SCALE = 0.45;

// module scratch — zero allocs
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _perShape = [0, 0, 0];
// r4: chips are COLLECTIBLES — the whole token family sits in the cyan/gold
// pickup colors (readability rule). Magenta lives in the danger family and
// made the chips read as hazards/rocks among the glowing orbs. r4b: peaks
// trimmed under the 0.85 bloom luminance — the old 1.55-1.75 greens/blues
// bloomed into white blobs at close range and lost the gem silhouette.
// r6: deeper still — the near-camera chip + its additive halo stacked past
// the tone curve into a washed flat white poly; these tints keep the hue
// under the bloom line while the halo supplies the glow.
// r10: MINT IS GONE (the critic's "paper scraps" — a third hue broke the
// cyan/gold token language). The three chip variants are now bright cyan,
// deep teal (same hue family, clearly darker tier) and amber gold — all
// lit, all pickup-colored, distinguishable by brightness tier.
// r12: cyan pair DEEPENED one more step — at chip-pass distance the additive
// halo stacked the old albedos past the tone curve into washed PALE SHARDS
// (white-cyan slivers, no gem read). Less white in the albedo; the halo
// (also trimmed) carries the glow, the facets carry the gem.
const CYAN_HOT = new THREE.Color(0.10, 0.52, 0.66);
const TEAL_DEEP = new THREE.Color(0.05, 0.30, 0.40);
const GOLD_HOT = new THREE.Color(1.0, 0.52, 0.10);

// r6: ONE gold identity for the data fruit — unlit HDR gold with BAKED
// per-face brightness variation, so the fruit reads faceted GOLD at every
// distance and angle (the old lit standard material swung between flat matte
// cream on shadow sides and a white-hot blob facing the key light).
function goldFacetGeometry(geo, seed) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
  for (let f = 0; f < n / 3; f++) {
    const b = 0.70 + rnd() * 0.44;
    for (let k = 0; k < 3; k++) {
      const o = (f * 3 + k) * 3;
      col[o] = b; col[o + 1] = b; col[o + 2] = b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// r10: chips get the SAME baked-facet treatment as the fruit — a plain
// cylinder under MeshBasicMaterial renders as one flat unshaded slab (the
// critic's "washed sticky-note square"). Per-triangle brightness variation
// keeps the facets readable at every angle.
function chipGeometry(sides) {
  // toNonIndexed first: per-triangle facets need unique vertices
  const g = goldFacetGeometry(new THREE.CylinderGeometry(0.46, 0.52, 0.22, sides, 1).toNonIndexed(), 0xD1CE + sides);
  return g;
}

export class OrbPhase extends Phase {
  id = 'orb';
  title = 'ORB FIELD';
  duration = 40;
  weight = 1.0;
  cameraHint = { fov: 70, height: 5.4, dist: 9.0 };

  constructor() {
    super();
    this.t = 0;
    this.px = 0; this.pvx = 0;
    this.orbs = [];
    this.chips = [];
    this.counts = new Int8Array(9); // shape*3 + color → collected count
    this.chipU = 0;
    this.fruits = [];
    this.slowCycle = 5;    // first window arrives a bit sooner
    this.inWindow = false;
    this.winT = 0;
    this.startU = 0;
    this.magnetR = 2.2;
    this.magnetBonus = 0; // run-scoped, set in enter() from the MAGNET CORE implant
    this._built = false;
    this._anim = null;
    this._unwrap = null;
  }

  orbX(u, ph1, ph2) {
    return 2.3 * Math.sin(u * 0.05 + ph1) + 1.2 * Math.sin(u * 0.023 + ph2);
  }
  orbY(u, ph1) {
    return 1.15 + 0.5 * Math.sin(u * 0.037 + ph1 * 1.7);
  }

  _build(scene) {
    if (this._built) return;
    this._built = true;
    this._scene = scene;

    // plasma orbs — two instanced meshes (cyan stream + gold stream) so the
    // field reads as cyan/gold plasma per the readability rule
    this.orbMat = new THREE.MeshStandardMaterial({
      color: 0x03282c, emissive: 0x00f0ff, emissiveIntensity: 2.4, metalness: 0.2, roughness: 0.3,
    });
    this.orbGoldMat = new THREE.MeshStandardMaterial({
      color: 0x2a2004, emissive: COL.gold, emissiveIntensity: 2.4, metalness: 0.2, roughness: 0.3,
    });
    this.orbIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 12, 9), this.orbMat, ORB_N);
    this.orbIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbIM.frustumCulled = false;
    this.orbIM.count = 0;   // r10: counts start at 0 (photo first frame never runs update())
    this.orbGoldIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 12, 9), this.orbGoldMat, ORB_N);
    this.orbGoldIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbGoldIM.frustumCulled = false;
    this.orbGoldIM.count = 0;

    // merge chips — 3 instanced meshes (one per shape); instance colors carry
    // the cyan/teal/gold neon token language (unlit = pure signal) over the
    // r10 baked-facet geometry. r4: an additive halo quad rides each chip so
    // the tokens read EMISSIVE among the glowing orbs instead of matte
    // placeholder rocks. r10: halo strengthened — at gameplay distances the
    // old 0.26 quad was too weak to read, leaving flat paper-sliver chips.
    this.chipGeo = [chipGeometry(3), chipGeometry(4), chipGeometry(6)];
    this.chipMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, vertexColors: true });
    this.chipIM = [];
    for (let s = 0; s < 3; s++) {
      const im = new THREE.InstancedMesh(this.chipGeo[s], this.chipMat, 6);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;   // r10: no identity-at-origin instances on frame 1
      this.chipIM.push(im);
    }
    this.chipCols = [CYAN_HOT, TEAL_DEEP, GOLD_HOT];
    this.chipHaloMat = new THREE.MeshBasicMaterial({
      map: glowSpriteTexture('#ffffff'), transparent: true, opacity: 0.38,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.chipHaloIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.chipHaloMat, CHIP_N);
    this.chipHaloIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chipHaloIM.frustumCulled = false;
    this.chipHaloIM.renderOrder = 3;
    this.chipHaloIM.count = 0;

    // data fruit — emissive gold icosahedra ("data fruit" the copy promises;
    // r6: unlit faceted gold + tightened halo — see goldFacetGeometry above).
    // r6b verify: ACES lifts a natural gold input to cream on screen — the
    // body tint is biased LOW in G/B (amber-heavy) so the tonemapped output
    // is saturated gold, sitting under the bloom line with the halo carrying
    // the glow. Facets stay visible at every distance.
    this.fruitMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.fruitMat.color.setRGB(1.05, 0.48, 0.07);
    this.fruitGeo = goldFacetGeometry(new THREE.IcosahedronGeometry(0.46, 0), 0x0F00D);
    this.fruitIM = new THREE.InstancedMesh(this.fruitGeo, this.fruitMat, FRUIT_N);
    this.fruitIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fruitIM.frustumCulled = false;
    this.fruitIM.count = 0;
    this.fruitHaloMat = new THREE.MeshBasicMaterial({
      map: glowSpriteTexture('#ffd24a'), transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    });
    this.fruitHaloIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.fruitHaloMat, FRUIT_N);
    this.fruitHaloIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fruitHaloIM.frustumCulled = false;
    this.fruitHaloIM.renderOrder = 3;
    this.fruitHaloIM.count = 0;

    // soft barrier posts — cyan light columns marking the field edge (safe)
    this.postMat = new THREE.MeshBasicMaterial({ color: 0x00c8ff, toneMapped: false });
    this.postIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.6, 0.2), this.postMat, 16);
    this.postIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.postIM.frustumCulled = false;

    // open-arena floor: the run road's full neon language (white-hot rails,
    // dashes, sun column, pulse) continues across the arena — mesh-fixed shader
    // from fx/Shaders.js so it never seams or dies to black (r1b)
    this.arenaMesh = makeOrbFloor(90, 300);
    this.arenaMesh.position.set(0, -0.02, -100);

    // magnet field — soft cyan pool under the runner, scaled to the pull radius
    this.magnetMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        map: glowSpriteTexture('#00f0ff'), transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.magnetMesh.rotation.x = -Math.PI / 2;
    this.magnetMesh.renderOrder = 2;

    // streamline guides: dashed lines following the orb paths (rebuilt as they
    // scroll past; 3 draw calls)
    this.lines = [];
    for (let i = 0; i < 3; i++) {
      const n = 56;
      const pos = new Float32Array(n * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.LineDashedMaterial({
        color: 0x35e8ff, dashSize: 0.7, gapSize: 0.7, transparent: true, opacity: 0.95,
      });
      const line = new THREE.Line(g, mat);
      line.frustumCulled = false;
      line.userData.n = n;
      line.userData.step = 4;
      this.lines.push(line);
    }
  }

  _rebuildLine(line, u0) {
    const n = line.userData.n, step = line.userData.step;
    const pos = line.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const u = u0 + i * step;
      pos[i * 3] = this.orbX(u, line.userData.ph1, line.userData.ph2);
      pos[i * 3 + 1] = this.orbY(u, line.userData.ph1);
      pos[i * 3 + 2] = -(u - this._lineBase);
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.computeLineDistances();
    line.userData.u0 = u0;
  }

  enter(ctx) {
    this._build(window.__NR.scene);
    const scene = this._scene;
    const track = ctx.track;
    const rng = ctx.rng || ctx.track.rng; // ctx.rng is null until first fixed step
    this.t = 0;
    this.px = 0; this.pvx = 0;
    this.startU = track.scroll;
    this.counts.fill(0);
    this.magnetBonus = economy.has('perk:magnet') ? 1.4 : 0; // read once per entry

    suppressRunObstacles(track.scroll);
    expirePopups();
    track.clearCoins();
    if (track.floor) { track.floor.visible = false; this._floorHidden = true; }
    scene.add(this.arenaMesh);

    // orbs: leapfrogging stream
    this.orbs.length = 0;
    for (let i = 0; i < ORB_N; i++) {
      this.orbs.push({
        u: track.scroll + 8 + (i / ORB_N) * ORB_SPAN + rng() * 3,
        ph1: rng() * 6.28, ph2: rng() * 6.28,
        mx: 0, my: 0, spin: rng() * 6.28,
      });
    }
    this._pathPh1 = [this.orbs[2].ph1, this.orbs[7].ph1, this.orbs[13].ph1];
    this._pathPh2 = [this.orbs[2].ph2, this.orbs[7].ph2, this.orbs[13].ph2];

    // chips
    this.chips.length = 0;
    this.chipU = track.scroll + 30;
    for (let i = 0; i < CHIP_N; i++) {
      this.chips.push({
        u: this.chipU + rng() * 12,
        shape: (rng() * 3) | 0, color: (rng() * 3) | 0,
        ph1: rng() * 6.28, taken: false,
      });
      this.chipU += CHIP_SPAN / CHIP_N;
    }

    // fruits (spawned per window)
    this.fruits.length = 0;
    this.slowCycle = 5;
    this.inWindow = false;
    this.winT = 0;

    // streamline guides
    this._lineBase = track.scroll;
    for (let i = 0; i < 3; i++) {
      const line = this.lines[i];
      line.userData.ph1 = this._pathPh1[i];
      line.userData.ph2 = this._pathPh2[i];
      this._rebuildLine(line, track.scroll + 6);
      scene.add(line);
    }

    scene.add(this.orbIM, this.orbGoldIM, this.fruitIM, this.fruitHaloIM, this.postIM, this.magnetMesh);
    for (let s = 0; s < 3; s++) scene.add(this.chipIM[s]);
    scene.add(this.chipHaloIM);

    // r10: lay the world out immediately — the photo API's first frame (at=0)
    // never runs update(), and every instanced mesh must show its finished
    // layout, not identity-at-origin instances
    this._writeWorld(track.scroll, 1);

    // free steering: movement presses are ours
    this._unwrap = wrapActions(ctx.input, (a) => {
      if (ctx.game.state !== 'RUN') return false;
      return a === 'left' || a === 'right' || a === 'up' || a === 'down';
    });

    this._anim = captureAnim(ctx);
    this._armRunStartCleanup(ctx);
  }

  exit(ctx) {
    this._disarmRunStartCleanup();
    if (this._unwrap) { this._unwrap(); this._unwrap = null; }
    if (this._anim) { this._anim.restore(); this._anim = null; }
    // slow-mo safety: always restore global time scale
    ctx.time.scale = 1;
    this._scene.remove(this.orbIM, this.orbGoldIM, this.fruitIM, this.fruitHaloIM, this.postIM,
      this.arenaMesh, this.magnetMesh, this.chipHaloIM);
    if (this._floorHidden && ctx.track.floor) { ctx.track.floor.visible = true; this._floorHidden = false; }
    for (let s = 0; s < 3; s++) this._scene.remove(this.chipIM[s]);
    for (let i = 0; i < 3; i++) this._scene.remove(this.lines[i]);
    this.orbs.length = 0;
    this.chips.length = 0;
    this.fruits.length = 0;
  }

  collectChip(ctx, chip) {
    const idx = chip.shape * 3 + chip.color;
    this.counts[idx]++;
    const pl = { x: this.px, y: 1, z: 0, value: 1 };
    bus.emit('coin', pl);
    sound('coin');
    if (this.counts[idx] >= 3) {
      this.counts[idx] = 0;
      // MERGE → next tier, worth 5×: 'coin:x' drives the FX popup/burst; the
      // extra coins are credited directly (runCoins +5 total)
      bus.emit('coin:x', { tier: 2, position: { x: this.px, y: 1.2, z: 0 } });
      for (let i = 0; i < 4; i++) ctx.scoring.addCoin();
      bus.emit('ui:toast', { msg: 'CHIP MERGED — 5× COINS', kind: 'fever' });
      FX.ring(_p.set(this.px, 1.1, 0), { to: 2.6, dur: 0.5, color: this.chipCols[chip.color], alpha: 1.1 });
      for (let i = 0; i < 14; i++) {
        FX.spark(this.px, 1.1, 0.4, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 3,
          0.4 + Math.random() * 0.3, 0.3 + Math.random() * 0.3, this.chipCols[chip.color], 5, 2);
      }
      sound('combo', { tier: 2 });
    }
  }

  openWindow(ctx) {
    this.inWindow = true;
    this.winT = 0;
    ctx.time.scale = SLASH_SCALE;
    bus.emit('ui:toast', { msg: 'SLASH WINDOW — SLICE THE FRUIT', kind: 'fever' });
    // seed the fruit salvo. r4: the first fruits launch ~7 m out so they are
    // on screen within a beat of the toast (previously 14 m out — the window
    // opened on an empty road and the copy promised fruit that never showed).
    const rng = ctx.rng;
    this.fruits.length = 0;
    for (let i = 0; i < FRUIT_N; i++) {
      this.fruits.push({
        u: ctx.track.scroll + 7 + i * 8 + rng() * 3,
        ph: rng() * 6.28, amp: 2 + rng() * 3.4,
        y: 0.9 + rng() * 1.7, spin: rng() * 6.28, taken: false,
      });
    }
  }

  update(dt, ctx) {
    const track = ctx.track;
    const scroll = track.scroll;
    const p = ctx.player;
    const inp = ctx.input;
    this.t += dt;
    suppressRunObstacles(scroll);

    // ---- free steering -----------------------------------------------------
    const dir = (inp.held('right') ? 1 : 0) - (inp.held('left') ? 1 : 0);
    const target = dir * 7.5;
    this.pvx += (target - this.pvx) * Math.min(1, 9 * dt);
    this.px += this.pvx * dt;
    if (this.px > EDGE_X) { this.px = EDGE_X; this.pvx = Math.min(this.pvx, 0); }
    if (this.px < -EDGE_X) { this.px = -EDGE_X; this.pvx = Math.max(this.pvx, 0); }
    p.x = this.px;
    p.slideT = 0;
    p.group.position.set(this.px, 0, 0);
    p.group.rotation.z = Math.max(-0.3, Math.min(0.3, -this.pvx * 0.045));

    // combo-scaled magnet (+ flat bonus while MAGNET CORE is owned)
    const tier = ctx.scoring.comboTier || 1;
    this.magnetR = 1.9 + Math.min(5, tier) * 0.75 + this.magnetBonus;

    // ---- orbs --------------------------------------------------------------
    const chestY = p.y + 0.8;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      const wz = scroll - o.u;
      if (wz > 12) {
        o.u += ORB_SPAN;
        o.ph1 = ctx.rng() * 6.28; o.ph2 = ctx.rng() * 6.28;
        o.mx = 0; o.my = 0;
        continue;
      }
      const bx = this.orbX(o.u, o.ph1, o.ph2);
      const by = this.orbY(o.u, o.ph1);
      const dx = bx + o.mx - this.px;
      const dy = by + o.my - chestY;
      const dist = Math.sqrt(dx * dx + dy * dy + wz * wz);
      if (dist < this.magnetR) {
        // pull the orb toward the player (offset decays as it closes)
        const k = Math.min(1, 7 * dt);
        o.mx += (this.px - bx - o.mx) * k;
        o.my += (chestY - by - o.my) * k;
        o.u += (scroll - o.u) * Math.min(1, 5 * dt);
      } else {
        o.mx *= Math.max(0, 1 - 3 * dt);
        o.my *= Math.max(0, 1 - 3 * dt);
      }
      if (dist < 1.15) {
        o.u += ORB_SPAN;
        o.mx = 0; o.my = 0;
        const pl = { x: this.px, y: chestY, z: 0, value: 1 };
        bus.emit('coin', pl);
        sound('coin');
      }
    }

    // ---- chips --------------------------------------------------------------
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      const wz = scroll - chip.u;
      if (wz > 12) { // leapfrog back ahead of the player
        chip.u += CHIP_SPAN + 12;
        chip.shape = (ctx.rng() * 3) | 0;
        chip.color = (ctx.rng() * 3) | 0;
        chip.ph1 = ctx.rng() * 6.28;
        continue;
      }
      const cx = this.orbX(chip.u, chip.ph1, chip.ph1 * 0.6) * 1.15;
      if (Math.abs(wz) < 1.2 && Math.abs(cx - this.px) < 1.1) {
        this.collectChip(ctx, chip);
        chip.u += CHIP_SPAN;
        chip.shape = (ctx.rng() * 3) | 0;
        chip.color = (ctx.rng() * 3) | 0;
        chip.ph1 = ctx.rng() * 6.28;
      }
    }

    // ---- slash window (global slow-mo via the Time hook) ---------------------
    if (!this.inWindow) {
      this.slowCycle += dt;
      if (this.slowCycle >= SLASH_CYCLE) this.openWindow(ctx);
    } else {
      this.winT += dt;
      if (this.winT >= SLASH_LEN) {
        this.inWindow = false;
        this.slowCycle = 0;
        ctx.time.scale = 1;
        this.fruits.length = 0;
      }
    }
    for (let i = this.fruits.length - 1; i >= 0; i--) {
      const f = this.fruits[i];
      const wz = scroll - f.u;
      if (wz > 12) { this.fruits.splice(i, 1); continue; }
      const fx = Math.sin(f.ph + this.t * 0.9) * f.amp;
      if (!f.taken && Math.abs(wz) < 1.4 &&
          Math.abs(fx - this.px) < 1.3 && Math.abs(f.y - chestY) < 1.5) {
        f.taken = true;
        _p.set(fx, f.y, wz);
        FX.ring(_p, { to: 2.2, dur: 0.4, color: GOLD_HOT, alpha: 1 });
        const pl = { x: fx, y: f.y, z: wz, value: 1 };
        bus.emit('coin', pl); // FX listens → burst; Scoring adds the coin
        bus.emit('coin', pl);
        sound('coin');
        this.fruits.splice(i, 1);
      }
    }

    // ---- instance writes + scene dressing pose -------------------------------
    this._writeWorld(scroll, tier);

    this._anim.play(this.inWindow ? 'drift' : 'run', dt, Math.min(1.6, ctx.speed / 14 + Math.abs(this.pvx) * 0.05));
  }

  // r10: all instanced writes + scene-level poses in ONE writer shared by
  // update() and enter() — the photo API's first frame (at=0) never runs
  // update(), so enter() must lay the world out itself (a max-count identity
  // InstancedMesh renders a blob of instances at the origin).
  _writeWorld(scroll, tier) {
    let no = 0, nGold = 0;
    _e.set(0, 0, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
    const pulse = 1 + Math.sin(this.t * 5) * 0.1;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      const bx = this.orbX(o.u, o.ph1, o.ph2) + o.mx;
      const by = this.orbY(o.u, o.ph1) + o.my;
      _p.set(bx, by, scroll - o.u);
      _s.set(pulse, pulse, pulse);
      _m.compose(_p, _q, _s);
      if (i % 4 === 0) this.orbGoldIM.setMatrixAt(nGold++, _m);   // gold streak
      else this.orbIM.setMatrixAt(no++, _m);
    }
    _s.set(1, 1, 1);
    this.orbIM.count = no;
    this.orbGoldIM.count = nGold;
    this.orbIM.instanceMatrix.needsUpdate = true;
    this.orbGoldIM.instanceMatrix.needsUpdate = true;

    // magnet field pool under the runner (pulses with the pull radius)
    this.magnetMesh.position.set(this.px, 0.03, 0);
    const mr = this.magnetR * (1 + Math.sin(this.t * 2.6) * 0.04);
    this.magnetMesh.scale.set(mr, mr, 1);
    this.magnetMesh.material.opacity = 0.20 + Math.min(5, tier) * 0.022;

    _perShape[0] = 0; _perShape[1] = 0; _perShape[2] = 0;
    let nh = 0;
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      const im = this.chipIM[chip.shape];
      if (_perShape[chip.shape] >= 6) continue;
      const cx = this.orbX(chip.u, chip.ph1, chip.ph1 * 0.6) * 1.15;
      // r10b: gentler z-tilt — at 0.5 rad the thin token spent too long at
      // grazing angles reading as a paper sliver; 0.35 keeps the lively spin
      // while presenting the faceted faces to the camera more often.
      // r12: the yaw no longer rotates THROUGH edge-on (a frozen frame caught
      // ~half the chips as 1-pixel pale shards — the "flat shard" beat). The
      // token now ROCKS ±31° around its face-on orientation, so at every
      // instant every chip presents its faceted faces; the bob + halo keep
      // the motion read.
      _e.set(0, Math.sin(this.t * 1.4 + chip.ph1) * 0.55, 0.35);
      _q.setFromEuler(_e);
      const cb = 1 + Math.sin(this.t * 3 + chip.ph1 * 2) * 0.12;
      _s.set(cb, cb, cb);
      const cy = 1.0 + Math.sin(this.t * 2 + chip.ph1) * 0.18;
      const cz = scroll - chip.u;
      _p.set(cx, cy, cz);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(_perShape[chip.shape], _m);
      im.setColorAt(_perShape[chip.shape], this.chipCols[chip.color]);
      _perShape[chip.shape]++;
      // additive halo quad (billboard upright — the camera looks down -z).
      // r10: bound to EVERY chip at ALL gameplay distances — bigger quad and
      // a stronger tint so the glow reads at mid-range, not just up close.
      if (nh < CHIP_N) {
        _q.identity();
        _s.set(2.3 * cb, 2.3 * cb, 1);
        _p.set(cx, cy, cz + 0.01);
        _m.compose(_p, _q, _s);
        this.chipHaloIM.setMatrixAt(nh, _m);
        // r12: 0.55 → 0.46 — with the deepened albedos the old scalar stacked
        // past the tone curve at chip-pass distance (the pale-shard read)
        _c.copy(this.chipCols[chip.color]).multiplyScalar(0.46);
        this.chipHaloIM.setColorAt(nh, _c);
        nh++;
      }
    }
    for (let s = 0; s < 3; s++) {
      this.chipIM[s].count = _perShape[s];
      this.chipIM[s].instanceMatrix.needsUpdate = true;
      if (this.chipIM[s].instanceColor) this.chipIM[s].instanceColor.needsUpdate = true;
    }
    this.chipHaloIM.count = nh;
    this.chipHaloIM.instanceMatrix.needsUpdate = true;
    if (this.chipHaloIM.instanceColor) this.chipHaloIM.instanceColor.needsUpdate = true;

    let nf = 0;
    let nfh = 0;
    for (let i = 0; i < this.fruits.length && nf < FRUIT_N; i++) {
      const f = this.fruits[i];
      if (f.taken) continue;
      const fx = Math.sin(f.ph + this.t * 0.9) * f.amp;
      _e.set(this.t * 2.2 + f.spin, this.t * 1.7, f.ph);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      const fy = f.y + Math.sin(this.t * 2 + f.ph) * 0.3;
      const fz = scroll - f.u;
      _p.set(fx, fy, fz);
      _m.compose(_p, _q, _s);
      this.fruitIM.setMatrixAt(nf++, _m);
      _q.identity();
      _s.set(2.2, 2.2, 1);
      _p.set(fx, fy, fz + 0.01);
      _m.compose(_p, _q, _s);
      this.fruitHaloIM.setMatrixAt(nfh++, _m);
    }
    this.fruitIM.count = nf;
    this.fruitIM.instanceMatrix.needsUpdate = true;
    this.fruitHaloIM.count = nfh;
    this.fruitHaloIM.instanceMatrix.needsUpdate = true;

    // soft barrier posts ring the field
    let np = 0;
    const cycle = Math.floor((scroll - this.startU) / 22) * 22;
    for (let i = 0; i < 8; i++) {
      const u = this.startU + i * 22 + cycle;
      const wz = scroll - u;
      if (wz > 12 || wz < -170) continue;
      for (const side of [-1, 1]) {
        _e.set(0, 0, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
        _p.set(side * (EDGE_X + 0.6), 0.8, wz);
        _m.compose(_p, _q, _s);
        this.postIM.setMatrixAt(np++, _m);
      }
    }
    this.postIM.count = np;
    this.postIM.instanceMatrix.needsUpdate = true;

    this.arenaMesh.position.z = scroll - 100;

    // streamline guides ride with the world; rebuild as they pass
    for (let i = 0; i < 3; i++) {
      const line = this.lines[i];
      line.position.z = scroll - this._lineBase;
      if (line.position.z > 130) {
        this._lineBase += 130;
        this._rebuildLine(line, this._lineBase + 6);
        line.position.z = scroll - this._lineBase;
      }
    }
  }
}
