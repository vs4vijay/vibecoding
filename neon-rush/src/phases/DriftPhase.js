// DRIFT — Sling-Drift hold-to-drift around a curving highway. [W1-PHASES]
// The road centerline is a smooth seeded curve C(u) (sum of 3 sines, growing
// amplitude). The player auto-follows the center (it stays under the camera);
// HOLDING drift applies centrifugal swing — hold through a bend to chain a
// drift multiplier (×2, ×3… +10 style per link, bus 'style:drift'), release to
// grip back to center. Off-road (beyond the hot rails) = death wall; rails
// glow white-hot as you near the edge. Fairness: no obstacle content at all —
// the only hazard is player-held drift.
import * as THREE from 'three';
import { Phase, suppressRunObstacles, captureAnim, CoinSet, expirePopups } from './Phase.js';
import { Pool } from '../core/Pool.js';
import { COL } from '../core/Palette.js';
import { FX } from '../fx/FX.js';
import { bus } from '../core/EventBus.js';
import { sound } from '../core/Sound.js';
import { makeDriftRibbonMaterial } from '../fx/Shaders.js';
import { gridTerrainTexture } from '../fx/Textures.js';

const RAIL_X = 4.72;        // visual rail (death wall) half-width
const EDGE_KILL = 4.32;     // forgiving 0.72-style margin inside the rail
const SECTIONS = 46;        // road ribbon cross-sections
const SEC_LEN = 6;          // m per section (276 m of visible road)
const MAX_AMP = 12.8;       // ≈ ±5 lanes at full growth
const AMP_RAMP = 550;       // m over which curve amplitude grows to full
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const CHAIN_SWING = 0.55;   // min centrifugal swing that counts as threading a bend

// module scratch — zero allocs in update loops
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const SKID = new THREE.Color(1.4, 1.9, 2.3);
const sstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  // crisp apex chevron: white core + tight magenta rim (the old giant
  // shadowBlur halo smeared into a stray streak across the road lane)
  // [FX r2, debt #8 — visual-only] grazing-angle smear: flat road quads sit at
  // ~6-9° from the chase camera's view axis, so vertical minification is
  // ~9:1 and the fat magenta rim owned the coarse mips — the chevron read as
  // a horizontal magenta streak lying across the lane. Thinner rim, fatter
  // white core, and anisotropic filtering keep the APEX readable at distance.
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(255,43,214,0.8)'; g.shadowBlur = 3;
  g.strokeStyle = '#ff2bd6'; g.lineWidth = 16;
  g.beginPath();
  g.moveTo(22, 86); g.lineTo(64, 38); g.lineTo(106, 86);
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = '#ffffff'; g.lineWidth = 12;
  g.beginPath();
  g.moveTo(26, 84); g.lineTo(64, 42); g.lineTo(102, 84);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const rn = (typeof window !== 'undefined' && window.__NR && window.__NR.renderer) || null;
  t.anisotropy = rn ? Math.min(16, rn.capabilities.getMaxAnisotropy()) : 8;
  return t;
}

export class DriftPhase extends Phase {
  id = 'drift';
  title = 'DRIFT SECTOR';
  duration = 40;
  weight = 1.1;
  cameraHint = { fov: 66, height: 3.9, dist: 8.6 };

  constructor() {
    super();
    this.t = 0;
    this.px = 0;        // drift offset from road center
    this.pvx = 0;       // lateral velocity
    this.holdDir = 1;   // last significant swing direction
    this.chain = 0;     // drift chain (×2 ×3 …)
    this.chainT = 0;
    this.offT = 0;      // time since last held
    this.startU = 0;
    // curve coefficients (seeded at enter)
    this.k1 = 0; this.k2 = 0; this.k3 = 0;
    this.p1 = 0; this.p2 = 0; this.p3 = 0;
    // built once
    this._built = false;
    this._anim = null;
    this._restoreApply = null;
    this._restoreDress = null;
    this._floorHidden = false;
    this._skidAcc = 0;
    this._lastToast = 0;
  }

  // ---- curve field ----------------------------------------------------------
  ampScale(u) {
    return 0.4 + 0.6 * Math.min(1, Math.max(0, (u - this.startU) / AMP_RAMP));
  }
  C(u) {
    const a = this.ampScale(u) * MAX_AMP;
    return a * (0.55 * Math.sin(this.k1 * u + this.p1)
      + 0.30 * Math.sin(this.k2 * u + this.p2)
      + 0.15 * Math.sin(this.k3 * u + this.p3));
  }
  C1(u) {
    const a = this.ampScale(u) * MAX_AMP;
    return a * (0.55 * this.k1 * Math.cos(this.k1 * u + this.p1)
      + 0.30 * this.k2 * Math.cos(this.k2 * u + this.p2)
      + 0.15 * this.k3 * Math.cos(this.k3 * u + this.p3));
  }
  C2(u) {
    const a = this.ampScale(u) * MAX_AMP;
    return -a * (0.55 * this.k1 * this.k1 * Math.sin(this.k1 * u + this.p1)
      + 0.30 * this.k2 * this.k2 * Math.sin(this.k2 * u + this.p2)
      + 0.15 * this.k3 * this.k3 * Math.sin(this.k3 * u + this.p3));
  }
  // u offset of the strongest bend ahead (test/debug hook)
  strongestBendAhead(u) {
    let best = 0, bestV = 0;
    for (let d = 0; d <= 260; d += 10) {
      const v = Math.abs(this.C2(u + d));
      if (v > bestV) { bestV = v; best = d; }
    }
    return best;
  }

  _build(scene) {
    if (this._built) return;
    this._built = true;
    this._scene = scene;

    // --- road ribbon + shoulders: ONE mesh, shader-dressed (r2). 6 verts per
    // section: [shL-outer, shL-inner, roadL, roadR, shR-inner, shR-outer].
    // aRib = (lateral region, track-space u) drives the shoulder/road shader —
    // hot magenta kiss at the rails, flowing energy bands, sparse cyan pools;
    // the old flat magenta planes are gone.
    const VPS = 6; // verts per section
    const verts = (SECTIONS + 1) * VPS;
    const pos = new Float32Array(verts * 3);
    const rib = new Float32Array(verts * 2);
    for (let i = 0; i <= SECTIONS; i++) {
      const o = i * VPS, ro = i * VPS * 2;
      rib[ro + 0] = 0; rib[ro + 1] = 0;   // shoulder L outer
      rib[ro + 2] = 1; rib[ro + 3] = 0;   // shoulder L inner (rails kiss)
      rib[ro + 4] = -1; rib[ro + 5] = 0;  // road L
      rib[ro + 6] = -2; rib[ro + 7] = 0;  // road R
      rib[ro + 8] = 1; rib[ro + 9] = 0;   // shoulder R inner
      rib[ro + 10] = 0; rib[ro + 11] = 0; // shoulder R outer
    }
    const idx = [];
    for (let i = 0; i < SECTIONS; i++) {
      const a = i * VPS;
      // winding: up-facing (verts ordered L→R, next section is further −Z)
      for (const c of [0, 2, 4]) {          // shoulderL · road · shoulderR
        idx.push(a + c, a + c + 1, a + VPS + c, a + c + 1, a + VPS + c + 1, a + VPS + c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRib', new THREE.BufferAttribute(rib, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.ribMat2 = makeDriftRibbonMaterial();
    this.roadMesh = new THREE.Mesh(g, this.ribMat2);
    this.roadMesh.position.y = 0.04;
    this.roadMesh.frustumCulled = false;
    this.ribUV = rib;

    // --- hot rails: two strips, 4 verts per section [outL, inL, inR, outR] ---
    const rv = (SECTIONS + 1) * 4;
    const rpos = new Float32Array(rv * 3);
    const rcol = new Float32Array(rv * 3);
    for (let i = 0; i < rv; i++) { rcol[i * 3] = 2.4; rcol[i * 3 + 1] = 0.32; rcol[i * 3 + 2] = 0.45; }
    const ridx = [];
    for (let i = 0; i < SECTIONS; i++) {
      const a = i * 4;
      ridx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);       // left strip
      ridx.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);   // right strip
    }
    const rg = new THREE.BufferGeometry();
    this.railPos = rpos; this.railCol = rcol;
    rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3).setUsage(THREE.DynamicDrawUsage));
    rg.setAttribute('color', new THREE.BufferAttribute(rcol, 3).setUsage(THREE.DynamicDrawUsage));
    rg.setIndex(ridx);
    this.railMesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    this.railMesh.position.y = 0.1;
    this.railMesh.frustumCulled = false;

    // --- horizon terrain: the ribbon only spans ±8.5 m — past it, the sky
    // dome's bright below-horizon band used to show under the ridge line and
    // read as two endless flat magenta planes. A vast fogged survey-grid plain
    // (vertex-color fade = fog, zero per-frame cost) fills the flanks and
    // grounds the horizon. Static in world space: the drift camera never
    // translates along z, the road scrolls underneath it.
    this.terrainGeo = new THREE.PlaneGeometry(560, 620, 1, 8);
    this.terrainGeo.rotateX(-Math.PI / 2);
    {
      const pc = this.terrainGeo.attributes.position;
      const cols = new Float32Array(pc.count * 3);
      for (let i = 0; i < pc.count; i++) {
        const z = pc.getZ(i);                          // +310 (behind) .. -310
        const k = 1.0 - Math.min(1, Math.max(0, (240 - z) / 500)) * 0.92;
        cols[i * 3] = k; cols[i * 3 + 1] = k; cols[i * 3 + 2] = k;
      }
      this.terrainGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }
    this.terrainTex = gridTerrainTexture();
    this.terrainTex.repeat.set(11, 12);
    this.terrainMat = new THREE.MeshBasicMaterial({
      map: this.terrainTex, vertexColors: true,
    });
    this.terrainMat.color.setRGB(0.92, 0.66, 1.0);     // dusk-magenta tint
    this.terrain = new THREE.Mesh(this.terrainGeo, this.terrainMat);
    this.terrain.position.set(0, -0.22, -180);

    // --- apex chevrons (instanced, lie on the road pointing into the bend) ---
    this.chevMat = new THREE.MeshBasicMaterial({
      map: chevronTexture(), transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, opacity: 0.9,
    });
    this.chevIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.0, 3.0), this.chevMat, 7);
    this.chevIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chevIM.frustumCulled = false;

    // --- edge pylons (instanced, both sides every 18 m) — dark delineator
    // body + hot emissive core so posts read as lit markers, not cyan sticks
    this.pylonMat = new THREE.MeshBasicMaterial({ color: 0x0a5a6e, toneMapped: false });
    this.pylonIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.7, 0.16), this.pylonMat, 30);
    this.pylonIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pylonIM.frustumCulled = false;
    this.pylonCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.pylonCoreMat.color.setRGB(0.9, 3.0, 3.4);
    this.pylonCoreIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 1.45, 0.07), this.pylonCoreMat, 30);
    this.pylonCoreIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pylonCoreIM.frustumCulled = false;

    this.coins = new CoinSet(scene, 80, 'drift:coins');
  }

  enter(ctx) {
    this._build(window.__NR.scene);
    const track = ctx.track;
    const rng = ctx.rng || ctx.track.rng; // ctx.rng is null until first fixed step
    this.t = 0;
    this.px = 0; this.pvx = 0; this.chain = 0; this.chainT = 0; this.offT = 1;
    this.holdDir = rng() < 0.5 ? -1 : 1;
    this.startU = track.scroll;

    // seeded curve: wavelengths 290/180/120 m-ish
    const w1 = 240 * (0.9 + rng() * 0.25), w2 = 150 * (0.9 + rng() * 0.25), w3 = 105 * (0.9 + rng() * 0.25);
    this.k1 = Math.PI * 2 / w1; this.k2 = Math.PI * 2 / w2; this.k3 = Math.PI * 2 / w3;
    this.p1 = rng() * Math.PI * 2; this.p2 = rng() * Math.PI * 2; this.p3 = rng() * Math.PI * 2;

    // (re-)attach scene-level dressing — exit() detaches, _build runs once
    this._scene.add(this.roadMesh, this.railMesh, this.chevIM, this.pylonIM,
      this.pylonCoreIM, this.terrain);

    suppressRunObstacles(track.scroll);
    expirePopups();
    track.clearCoins();

    // the straight grid floor (with baked straight rails) is replaced by the
    // curved ribbon; W1-VIS's floor mesh is restored on exit
    if (track.floor) { track.floor.visible = false; this._floorHidden = true; }

    // hide chunk dressing (straight-road props would misalign with the curve);
    // the Props dresser is dressers[0] by registration order — spliced out for
    // the phase and re-inserted at 0 on exit.
    const dressers = track.dressers;
    this._propsDresser = dressers.length ? dressers[0] : null;
    if (this._propsDresser) {
      const i = dressers.indexOf(this._propsDresser);
      if (i >= 0) dressers.splice(i, 1);
    }
    for (let c = 0; c < track.chunks.length; c++) {
      const att = track.chunks[c].attached;
      for (let k = 0; k < att.length; k++) att[k].visible = false;
    }

    // banking: phase-owned camera roll applied after the rig's own apply()
    const rig = ctx.camera;
    const prevApply = rig.apply;
    const self = this;
    const patched = function () {
      prevApply.call(rig);
      rig.cam.rotation.z += self.roll;
    };
    rig.apply = patched;
    this._restoreApply = () => { if (rig.apply === patched) rig.apply = prevApply; };
    this.roll = 0;

    // coins trail the road center
    for (let d = 16; d < 260; d += 24) {
      const lane = rng() < 0.5 ? -1.7 : 1.7;
      for (let j = 0; j < 4; j++) {
        const u = this.startU + d + j * 3;
        this.coins.add(u, this.C(u) + lane, 0.55, rng() * 6.28);
      }
    }

    this._anim = captureAnim(ctx);
    this._armRunStartCleanup(ctx);
  }

  exit(ctx) {
    this._disarmRunStartCleanup();
    if (this._anim) { this._anim.restore(); this._anim = null; }
    if (this._restoreApply) { this._restoreApply(); this._restoreApply = null; }
    const track = ctx.track;
    if (this._floorHidden && track.floor) { track.floor.visible = true; this._floorHidden = false; }
    if (this._propsDresser) {
      const d = track.dressers;
      if (d.indexOf(this._propsDresser) < 0) d.unshift(this._propsDresser);
      this._propsDresser = null;
    }
    for (let c = 0; c < track.chunks.length; c++) {
      const att = track.chunks[c].attached;
      for (let k = 0; k < att.length; k++) att[k].visible = true;
    }
    this.coins.clear();
    this._scene.remove(this.roadMesh, this.railMesh, this.chevIM, this.pylonIM,
      this.pylonCoreIM, this.terrain);
  }

  // roadside arch gates riding the curve (pooled, 2 draws each)
  decorate(chunk, rng) {
    if (!this._archPool) {
      const structMat = new THREE.MeshStandardMaterial({ color: 0x120c26, metalness: 0.55, roughness: 0.45 });
      const glowMat = new THREE.MeshBasicMaterial({ color: COL.magenta, toneMapped: false });
      this._archPool = new Pool(() => {
        const grp = new THREE.Group();
        const g = new THREE.BoxGeometry(0.5, 6.2, 0.5);
        const l = new THREE.Mesh(g, structMat); l.position.set(-5.4, 3.1, 0);
        const r = new THREE.Mesh(g, structMat); r.position.set(5.4, 3.1, 0);
        const top = new THREE.Mesh(new THREE.BoxGeometry(11.3, 0.55, 0.6), structMat); top.position.y = 6.35;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.16, 0.16), glowMat); bar.position.set(0, 6.12, 0.32);
        grp.add(l, r, top, bar);
        return grp;
      }, (o) => o.removeFromParent(), 'drift:arch');
    }
    if (rng() > 0.6) return;
    const arch = this._archPool.get();
    arch.userData.onRelease = (o) => this._archPool.release(o);
    const zLocal = -(6 + rng() * 46);
    const u = -chunk.baseZ - zLocal;
    arch.position.set(this.C(u), 0, zLocal);
    arch.rotation.y = -Math.atan(this.C1(u));
    chunk.attach(arch);
  }

  update(dt, ctx) {
    const p = ctx.player;
    const v = ctx.speed;
    const scroll = ctx.track.scroll;
    this.t += dt;
    const u0 = scroll;
    suppressRunObstacles(scroll);

    let held = ctx.input.held('drift');
    const curv = this.C2(u0);
    const swing = Math.max(-5.2, Math.min(5.2, -curv * v * v * 3.4));
    if (p.autopilot) held = Math.abs(swing) > 0.7 && Math.abs(this.px) < 3.0; // attract AI drifts the bend

    if (held) {
      this.offT = 0;
      if (Math.abs(swing) > 0.6) this.holdDir = swing > 0 ? 1 : -1;
      const base = Math.abs(swing) < 0.6 ? this.holdDir * 1.8 : 0;
      this.pvx += (swing * 1.15 + base) * dt;
      // drift chain: threading a real bend while swung out
      if (Math.abs(swing) > CHAIN_SWING && Math.abs(this.px) > 0.55) {
        this.chainT += dt;
        if (this.chainT > 0.55) {
          this.chainT = 0;
          this.chain = Math.min(this.chain + 1, 8);
          ctx.scoring.addStyle(10);
          bus.emit('style:drift', { chain: this.chain });
          if (this.chain >= 2 && this.chain > this._lastToast) {
            this._lastToast = this.chain;
            bus.emit('ui:toast', { msg: `DRIFT ×${this.chain + 1}`, kind: 'style' });
          }
          FX.spawnPop('gain', 10, 0, 2.25);
        }
      }
      // skid spray
      this._skidAcc += dt;
      while (this._skidAcc > 0.05) {
        this._skidAcc -= 0.05;
        FX.spark(p.x - Math.sign(this.pvx) * 0.3, 0.12, 0.5,
          -this.pvx * 0.4 + (Math.random() - 0.5), 1 + Math.random() * 2, 2 + Math.random() * 3,
          0.3, 0.3 + Math.random() * 0.25, SKID, 3, 2.4);
      }
    } else {
      this.offT += dt;
      // grip: spring back to the racing line
      this.pvx += (-this.px * 6.2 - this.pvx * 4.6) * dt;
      if (this.offT > 0.8 || Math.abs(swing) < 0.3) { this.chain = 0; this.chainT = 0; this._lastToast = 0; }
    }
    this.px += this.pvx * dt;
    if (this.px > 5.4) { this.px = 5.4; this.pvx = Math.min(this.pvx, 0); }
    if (this.px < -5.4) { this.px = -5.4; this.pvx = Math.max(this.pvx, 0); }

    // the player RIDES the centerline: world x = C(u) + drift offset. The
    // auto-follow keeps the road under the camera; px is the player-held swing.
    const cx = this.C(u0);
    p.slideT = 0;
    p.x = cx + this.px;
    p.group.position.set(cx + this.px, 0, 0);
    p.group.rotation.y = -Math.atan(this.C1(u0)) * 0.85; // face down the road
    p.group.rotation.z = Math.max(-0.55, Math.min(0.55, -this.pvx * 0.11));
    this._anim.play(held ? 'drift' : 'run', dt, Math.min(1.6, v / 14));

    // death wall — beyond the rails (offset from center, §12 fair margin);
    // suppressed in the final 1.2 reaction-seconds of the phase
    // §12.3: nothing may kill within the final 1.2 reaction-seconds of the phase
    const calmExit = ctx.game.phaseRemain() < 1.25;
    if (!p.dead && calmExit === false && Math.abs(this.px) > EDGE_KILL) {
      p.kill('drift-edge');
      ctx.camera.shake(0.4);
    }

    // banking roll (applied post-apply via the patched rig)
    this.roll = Math.max(-0.2, Math.min(0.2, -this.pvx * 0.03 - this.C1(u0) * 0.5));

    // ---- road ribbon ---------------------------------------------------------
    const pos = this.roadMesh.geometry.attributes.position.array;
    const ribUV = this.ribUV;
    const rpos = this.railPos;
    const rcol = this.railCol;
    const warn = Math.max(0, (Math.abs(this.px) - 2.6) / (EDGE_KILL - 2.6));
    for (let i = 0; i <= SECTIONS; i++) {
      const d = -6 + i * SEC_LEN;
      const u = scroll + d;
      const cx = this.C(u);
      const z = -d;
      const o = i * 18; // 6 verts × 3: [shL-out, shL-in, roadL, roadR, shR-in, shR-out]
      pos[o] = cx - 8.5; pos[o + 1] = -0.12; pos[o + 2] = z;
      pos[o + 3] = cx - 4.7; pos[o + 4] = 0; pos[o + 5] = z;
      pos[o + 6] = cx - 4.7; pos[o + 7] = 0; pos[o + 8] = z;
      pos[o + 9] = cx + 4.7; pos[o + 10] = 0; pos[o + 11] = z;
      pos[o + 12] = cx + 4.7; pos[o + 13] = 0; pos[o + 14] = z;
      pos[o + 15] = cx + 8.5; pos[o + 16] = -0.12; pos[o + 17] = z;
      const ro2 = i * 12; // aRib u per section
      ribUV[ro2 + 1] = u; ribUV[ro2 + 3] = u; ribUV[ro2 + 5] = u;
      ribUV[ro2 + 7] = u; ribUV[ro2 + 9] = u; ribUV[ro2 + 11] = u;
      // rails: [outL, inL, inR, outR]
      const ro = i * 12;
      rpos[ro] = cx - RAIL_X; rpos[ro + 1] = 0; rpos[ro + 2] = z;
      rpos[ro + 3] = cx - RAIL_X + 0.17; rpos[ro + 4] = 0; rpos[ro + 5] = z;
      rpos[ro + 6] = cx + RAIL_X - 0.17; rpos[ro + 7] = 0; rpos[ro + 8] = z;
      rpos[ro + 9] = cx + RAIL_X; rpos[ro + 10] = 0; rpos[ro + 11] = z;
      // near-edge warning: rails blaze white-hot close to the kill line
      const hot = 1 + warn * 1.6;
      for (let k2 = 0; k2 < 4; k2++) {
        const co = ro + k2 * 3;
        rcol[co] = 2.4 * hot; rcol[co + 1] = 0.32 + warn * 1.4; rcol[co + 2] = 0.45 + warn * 1.2;
      }
    }
    this.roadMesh.geometry.attributes.position.needsUpdate = true;
    this.roadMesh.geometry.attributes.aRib.needsUpdate = true;
    this.ribMat2.uniforms.uScroll.value = scroll;
    this.ribMat2.uniforms.uTime.value = this.t;
    this.railMesh.geometry.attributes.position.needsUpdate = true;
    this.railMesh.geometry.attributes.color.needsUpdate = true;

    // ---- chevrons + pylons ------------------------------------------------------
    // additive chevrons fade out near the horizon and softly near the camera —
    // flat white quads at grazing angles used to smear across the lane
    for (let i = 0; i < 7; i++) {
      const u = scroll + 14 + i * 20;
      const cx = this.C(u);
      const yaw = Math.atan(this.C1(u));
      _e.set(-Math.PI / 2, 0, 0);
      _q.setFromEuler(_e);
      _q2.setFromAxisAngle(Y_AXIS, -yaw);
      _q.premultiply(_q2);
      _s.set(1, 1, 1);
      const side = this.C1(u) > 0 ? 1 : -1;
      _p.set(cx + side * 3.4, 0.09, -(u - scroll));
      _m.compose(_p, _q, _s);
      this.chevIM.setMatrixAt(i, _m);
      const dist = u - scroll;
      const k = (1 - sstep(dist, 62, 112)) * (0.35 + 0.65 * sstep(dist, 4, 14));
      _c.setRGB(k, k, k);
      this.chevIM.setColorAt(i, _c);
    }
    this.chevIM.count = 7;
    this.chevIM.instanceMatrix.needsUpdate = true;
    if (this.chevIM.instanceColor) this.chevIM.instanceColor.needsUpdate = true;

    let np = 0;
    for (let i = 0; i < 30; i += 2) {
      const u = scroll - 6 + (i >> 1) * 18;
      const cx = this.C(u);
      _e.set(0, 0, 0); _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _p.set(cx - 5.15, 0.75, -(u - scroll));
      _m.compose(_p, _q, _s);
      this.pylonIM.setMatrixAt(np, _m);
      this.pylonCoreIM.setMatrixAt(np, _m);
      np++;
      _p.set(cx + 5.15, 0.75, -(u - scroll));
      _m.compose(_p, _q, _s);
      this.pylonIM.setMatrixAt(np, _m);
      this.pylonCoreIM.setMatrixAt(np, _m);
      np++;
    }
    this.pylonIM.count = np;
    this.pylonCoreIM.count = np;
    this.pylonIM.instanceMatrix.needsUpdate = true;
    this.pylonCoreIM.instanceMatrix.needsUpdate = true;

    this.coins.update(dt, scroll, p);
  }
}
