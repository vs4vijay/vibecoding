// src/render3d/EntitiesView.ts — spider / item / exit door / bullet views for
// the "CATACOMB DEPTHS" overhaul. Owns the 3D presentation of every non-Dave
// gameplay entity. Sim positions are synced EXACTLY each frame (view easing is
// applied to orientation, bob and death choreography only — gameplay collision
// still snaps, everything else eases per DESIGN).
//
// Motion (DESIGN: "every entity animates"):
//   items    continuous Y spin + phase-offset idle bob + scale breath +
//            per-kind emissive pulse; collect-out is an eased rise/spin/shrink
//            tween (trophy and every other collectible variant included)
//   spiders  leg fidget proportional to observed movement, abdomen bob, body
//            sway, eased facing turns, eased curl-and-shrink death
//   door     eased swing-open over ~0.6 s + growing light shaft + emissive ramp
//   bullets  eased spawn pop with muzzle-flash scale-out, stretched tracer body
//
// 60 fps discipline: ONE material and ONE geometry per entity kind, allocated
// once in the constructor and shared by every instance (per-instance variation
// is transforms only; the per-kind emissive pulse runs through the shared
// material). Hot paths (sync*/update) allocate nothing: records are pooled in
// arrays with generation-based pruning and positions are written in place.
// No canvas textures are used, so the whole file stays node-safe for vitest.
//
// Exposed for tests/orchestration: root, kindMaterials (per-kind shared
// material registry), syncItems/syncDoor/syncEnemies/syncBullets, update,
// dispose (idempotent).
import * as THREE from "three";
import { PALETTE, TILE } from "./palette";
import type { ItemView, EnemyView, BulletView, DoorView } from "./viewTypes";

// --- easing helpers (pure, allocation-free) ----------------------------------
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smooth01(t: number): number {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

const DOOR_OPEN_TIME = 0.6; // DESIGN: closed→open must ease over ~0.6 s
const COLLECT_TIME = 0.32; // item collect-out tween duration
const DEATH_TIME = 0.42; // spider death curl duration
// Sim patrol speed is 0.5 px/tick → 0.5 * 60 ticks/s / 16 px/tile world units/s.
const SPIDER_CRUISE = 1.875;
const GOLD_ANGLE = 2.399963229728653; // rad; spreads per-instance phases evenly

// Per-kind item looks (color / emissive / PBR response). Geometry is chosen in
// the constructor so every instance of a kind shares one geometry + material.
interface ItemLook {
  color: number;
  emissive: number;
  glow: number;
  rough: number;
  metal: number;
}
const ITEM_LOOK: Record<string, ItemLook> = {
  orb: { color: 0x6fe0d0, emissive: 0x1fa392, glow: 0.9, rough: 0.2, metal: 0.1 },
  blueDiamond: { color: 0x86b9ff, emissive: 0x2f62d8, glow: 0.85, rough: 0.18, metal: 0.1 },
  redDiamond: { color: 0xff7a5f, emissive: 0xd83a2f, glow: 0.85, rough: 0.18, metal: 0.1 },
  ring: { color: PALETTE.gold, emissive: 0x7a5210, glow: 0.5, rough: 0.3, metal: 0.9 },
  crown: { color: PALETTE.gold, emissive: 0x7a5210, glow: 0.55, rough: 0.32, metal: 0.9 },
  scepter: { color: 0xcdb06a, emissive: 0x8a5c12, glow: 0.6, rough: 0.3, metal: 0.85 },
  trophy: { color: PALETTE.emberHot, emissive: 0xcf7a1a, glow: 1.1, rough: 0.28, metal: 0.7 },
  gun: { color: 0x9aa3ad, emissive: 0x000000, glow: 0, rough: 0.42, metal: 0.85 },
  jetpack: { color: 0x9aa3ad, emissive: 0x552a08, glow: 0.25, rough: 0.45, metal: 0.8 },
  oneUp: { color: 0x6fce85, emissive: 0x2f8a48, glow: 0.7, rough: 0.35, metal: 0.05 },
};

// --- per-entity records (view state; created once per sim entity) ------------
interface ItemRecord {
  src: object;
  node: THREE.Mesh;
  basePos: THREE.Vector3; // exact sim center; bob is applied on top in update
  phase: number;
  spin: number;
  collected: boolean;
  collectT: number; // <0 → not collected; else seconds since collect
  seen: number;
}

interface EnemyRecord {
  src: object;
  node: THREE.Group; // pinned to the exact sim position (never eased)
  body: THREE.Group; // view-only bob / sway / death choreography
  legs: THREE.Group[];
  legRest: number[]; // per-leg rest rotation.z
  yaw: number;
  dirTarget: number;
  lastX: number;
  moveTarget: number;
  moveN: number;
  phase: number;
  dead: boolean;
  deathT: number; // <0 → alive
  seen: number;
}

interface BulletRecord {
  src: object;
  node: THREE.Mesh;
  age: number;
  spent: boolean;
  seen: number;
}

interface PulseMat {
  mat: THREE.MeshStandardMaterial;
  base: number;
  off: number;
}

interface ItemKind {
  mat: THREE.MeshStandardMaterial;
  geo: THREE.BufferGeometry;
}

export class EntitiesView {
  readonly root = new THREE.Group();
  /** Shared per-kind materials (item kinds + spider/door/bullet parts). Every
   *  instance of a kind references the same material object. */
  readonly kindMaterials: ReadonlyMap<string, THREE.Material>;

  private itemRecs = new Map<object, ItemRecord>();
  private itemList: ItemRecord[] = [];
  private enemyRecs = new Map<object, EnemyRecord>();
  private enemyList: EnemyRecord[] = [];
  private bulletRecs = new Map<object, BulletRecord>();
  private bulletList: BulletRecord[] = [];
  private itemKinds = new Map<string, ItemKind>();

  // door rig
  private doorGrp: THREE.Group;
  private doorHinge: THREE.Group;
  private doorShaft: THREE.Mesh;
  private doorSigilMat: THREE.MeshStandardMaterial;
  private doorShaftMat: THREE.MeshBasicMaterial;
  private doorOpened = false;
  private doorT = 0; // eased open timeline (s), target DOOR_OPEN_TIME when open

  // shared-per-kind emissive pulsers (item kinds)
  private pulseMats: PulseMat[] = [];

  // spider / bullet shared geometry (single instance per kind)
  private spiderGeos: { abdomen: THREE.BufferGeometry; ceph: THREE.BufferGeometry; eye: THREE.BufferGeometry; leg: THREE.BufferGeometry };
  private spiderMat: THREE.MeshStandardMaterial;
  private bulletGeo: THREE.BufferGeometry;
  private lastSyncAt = 0;

  // owned resources (disposed once)
  private ownedGeos: THREE.BufferGeometry[] = [];
  private ownedMats: THREE.Material[] = [];

  private gen = 0;
  private phaseSeq = 0;
  private lastNow = 0;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.root.name = "entities";
    const mats = new Map<string, THREE.Material>();
    const mat = <T extends THREE.Material>(key: string, m: T): T => {
      mats.set(key, m);
      this.ownedMats.push(m);
      return m;
    };
    const geo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.ownedGeos.push(g);
      return g;
    };

    // --- items: one material + one geometry per kind, shared by all instances
    let kindIdx = 0;
    for (const [kind, look] of Object.entries(ITEM_LOOK)) {
      const m = mat(kind, new THREE.MeshStandardMaterial({
        color: look.color,
        emissive: look.emissive,
        emissiveIntensity: look.glow,
        roughness: look.rough,
        metalness: look.metal,
      }));
      this.pulseMats.push({ mat: m, base: look.glow, off: kindIdx * 0.73 });
      this.itemKinds.set(kind, { mat: m, geo: geo(this.itemGeometry(kind)) });
      kindIdx++;
    }

    // --- spider: body + emissive eyes -------------------------------------
    const spiderMat = mat("spiderBody", new THREE.MeshStandardMaterial({
      color: PALETTE.spiderBody, roughness: 0.55, metalness: 0.08,
    }));
    mat("spiderEye", new THREE.MeshBasicMaterial({ color: PALETTE.spiderEyes }));
    const abdomenGeo = geo(new THREE.SphereGeometry(0.34, 12, 10));
    const cephGeo = geo(new THREE.SphereGeometry(0.2, 10, 8));
    const eyeGeo = geo(new THREE.SphereGeometry(0.034, 6, 6));
    const legGeo = geo(new THREE.CapsuleGeometry(0.028, 0.32, 3, 6));
    this.spiderGeos = { abdomen: abdomenGeo, ceph: cephGeo, eye: eyeGeo, leg: legGeo };
    this.spiderMat = spiderMat;

    // --- bullet -------------------------------------------------------------
    mat("bullet", new THREE.MeshBasicMaterial({ color: PALETTE.bullet }));
    this.bulletGeo = geo(new THREE.SphereGeometry(0.09, 8, 6));

    // --- exit door ----------------------------------------------------------
    mat("doorFrame", new THREE.MeshStandardMaterial({ color: 0x2b3a41, roughness: 0.9, metalness: 0.05 }));
    const panelMat = mat("doorPanel", new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.68, metalness: 0.15 }));
    this.doorSigilMat = mat("doorSigil", new THREE.MeshStandardMaterial({
      color: 0x1c1208, emissive: PALETTE.ember, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.2,
    }));
    this.doorShaftMat = mat("doorShaft", new THREE.MeshBasicMaterial({
      color: PALETTE.emberHot, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));

    this.doorGrp = new THREE.Group();
    this.doorGrp.name = "door";
    const pillarGeo = geo(new THREE.BoxGeometry(0.18, 2.24, 0.52));
    const lintelGeo = geo(new THREE.BoxGeometry(1.2, 0.22, 0.52));
    const stepGeo = geo(new THREE.BoxGeometry(1.2, 0.1, 0.52));
    const panelGeo = geo(new THREE.BoxGeometry(0.84, 1.86, 0.12));
    const sigilGeo = geo(new THREE.BoxGeometry(0.12, 0.12, 0.045));
    const shaftGeo = geo(new THREE.PlaneGeometry(0.8, 1.9));
    for (const side of [1, -1] as const) {
      const pillar = new THREE.Mesh(pillarGeo, mats.get("doorFrame")!);
      pillar.name = "doorFrame";
      pillar.position.set(side * 0.51, 0, -0.06);
      pillar.castShadow = true;
      this.doorGrp.add(pillar);
    }
    const lintel = new THREE.Mesh(lintelGeo, mats.get("doorFrame")!);
    lintel.name = "doorFrame";
    lintel.position.set(0, 1.02, -0.06);
    lintel.castShadow = true;
    this.doorGrp.add(lintel);
    const step = new THREE.Mesh(stepGeo, mats.get("doorFrame")!);
    step.name = "doorFrame";
    step.position.set(0, -1.0, -0.06);
    this.doorGrp.add(step);

    this.doorHinge = new THREE.Group();
    this.doorHinge.name = "doorHinge";
    this.doorHinge.position.set(-0.42, 0, 0);
    this.doorGrp.add(this.doorHinge);
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.name = "doorPanel";
    panel.position.set(0.42, 0, 0);
    panel.castShadow = true;
    this.doorHinge.add(panel);
    const sigil = new THREE.Mesh(sigilGeo, this.doorSigilMat);
    sigil.name = "doorSigil";
    sigil.position.set(0.42, 0.12, 0.075);
    this.doorHinge.add(sigil);

    this.doorShaft = new THREE.Mesh(shaftGeo, this.doorShaftMat);
    this.doorShaft.name = "doorShaft";
    this.doorShaft.position.set(0, -0.93, 0.36);
    this.doorShaft.scale.set(1, 0.02, 1);
    this.doorShaft.visible = false;
    this.doorGrp.add(this.doorShaft);

    this.root.add(this.doorGrp);
    scene.add(this.root);
    this.kindMaterials = mats;
  }

  /** Per-kind shared item geometry (diamonds, relics, gear). */
  private itemGeometry(kind: string): THREE.BufferGeometry {
    switch (kind) {
      case "orb": return new THREE.IcosahedronGeometry(0.32, 0);
      case "blueDiamond":
      case "redDiamond": return new THREE.OctahedronGeometry(0.4);
      case "ring": return new THREE.TorusGeometry(0.22, 0.085, 10, 20);
      case "crown": return new THREE.CylinderGeometry(0.3, 0.24, 0.3, 8);
      case "scepter": return new THREE.CylinderGeometry(0.05, 0.1, 0.72, 8);
      case "trophy": return new THREE.CylinderGeometry(0.3, 0.1, 0.42, 10);
      case "gun": return new THREE.BoxGeometry(0.42, 0.18, 0.14);
      case "jetpack": return new THREE.CylinderGeometry(0.17, 0.17, 0.52, 10);
      case "oneUp": return new THREE.IcosahedronGeometry(0.3, 0);
      default: return new THREE.OctahedronGeometry(0.4);
    }
  }

  private nextPhase(): number {
    const p = (this.phaseSeq * GOLD_ANGLE) % (Math.PI * 2);
    this.phaseSeq++;
    return p;
  }

  // -------------------------------------------------------------------------
  // per-frame sync (exact sim positions; allocates only on first sight of an
  // entity — hot loop reuses records and writes transforms in place)
  // -------------------------------------------------------------------------

  syncItems(items: ItemView[]): void {
    if (this.disposed) return;
    this.gen++;
    const g = this.gen;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      let rec = this.itemRecs.get(it);
      if (!rec) {
        const kind = this.itemKinds.get(it.type) ?? this.itemKinds.get("orb")!;
        const mesh = new THREE.Mesh(kind.geo, kind.mat);
        mesh.name = `item:${it.type}`;
        this.root.add(mesh);
        rec = {
          src: it, node: mesh, basePos: new THREE.Vector3(), phase: this.nextPhase(),
          spin: 0, collected: false, collectT: -1, seen: 0,
        };
        this.itemRecs.set(it, rec);
        this.itemList.push(rec);
      }
      rec.seen = g;
      rec.collected = it.collected;
      if (it.collected && rec.collectT < 0) rec.collectT = 0;
      rec.basePos.set(it.pos.x / TILE + 0.5, -(it.pos.y / TILE) - 0.5, 0);
      rec.node.position.set(rec.basePos.x, rec.basePos.y, 0);
    }
    this.pruneStale(this.itemRecs, this.itemList, g);
  }

  syncDoor(door: DoorView): void {
    if (this.disposed) return;
    this.doorOpened = door.opened;
    // door spans two tiles (16×32 px): center on the full extent
    this.doorGrp.position.set(door.pos.x / TILE + 0.5, -(door.pos.y / TILE) - 1, 0);
  }

  syncEnemies(enemies: EnemyView[]): void {
    if (this.disposed) return;
    this.gen++;
    const g = this.gen;
    const dtSync = Math.max(0, this.lastNow - this.lastSyncAt);
    this.lastSyncAt = this.lastNow;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      let rec = this.enemyRecs.get(e);
      if (!rec) {
        rec = this.createEnemyRecord(e);
        this.enemyRecs.set(e, rec);
        this.enemyList.push(rec);
      }
      rec.seen = g;
      rec.node.position.set(e.pos.x / TILE + 0.5, -(e.pos.y / TILE) - 0.5, 0);
      if (e.dead && !rec.dead) {
        rec.dead = true;
        rec.deathT = 0;
      }
      // movement inference (view-only): feeds leg fidget amplitude + facing
      const wx = rec.node.position.x;
      const dx = wx - rec.lastX;
      rec.lastX = wx;
      if (dx > 1e-5) rec.dirTarget = 1;
      else if (dx < -1e-5) rec.dirTarget = -1;
      rec.moveTarget = clamp01(Math.abs(dx) / Math.max(1e-4, dtSync * SPIDER_CRUISE));
    }
    this.pruneStale(this.enemyRecs, this.enemyList, g);
  }

  private createEnemyRecord(e: EnemyView): EnemyRecord {
    const node = new THREE.Group();
    node.name = "spider";
    const body = new THREE.Group();
    node.add(body);

    const abdomen = new THREE.Mesh(this.spiderGeos.abdomen, this.spiderMat);
    abdomen.scale.set(1.15, 0.85, 0.95);
    abdomen.position.set(-0.06, 0.18, 0);
    abdomen.castShadow = true;
    body.add(abdomen);
    const ceph = new THREE.Mesh(this.spiderGeos.ceph, this.spiderMat);
    ceph.scale.set(1.1, 0.8, 0.9);
    ceph.position.set(0.14, 0.14, 0);
    ceph.castShadow = true;
    body.add(ceph);
    for (const side of [1, -1] as const) {
      const eye = new THREE.Mesh(this.spiderGeos.eye, this.kindMaterials.get("spiderEye")!);
      eye.position.set(0.28, 0.19, side * 0.06);
      body.add(eye);
    }

    // six legs in a side-view fan (3 per depth side), tips resting on the ground
    const legs: THREE.Group[] = [];
    const legRest: number[] = [];
    const fan = [0.95, 0.3, -0.55];
    for (const side of [1, -1] as const) {
      for (let l = 0; l < fan.length; l++) {
        const hip = new THREE.Group();
        hip.position.set((l - 1) * 0.14, 0.1, side * 0.15);
        const seg = new THREE.Mesh(this.spiderGeos.leg, this.spiderMat);
        seg.position.y = -0.17;
        hip.add(seg);
        const rest = fan[l]! * (side === 1 ? 1 : 0.92);
        hip.rotation.z = rest;
        legRest.push(rest);
        legs.push(hip);
        body.add(hip);
      }
    }

    node.visible = true;
    this.root.add(node);
    return {
      src: e, node, body, legs, legRest,
      yaw: 0, dirTarget: 1, lastX: node.position.x, moveTarget: 0, moveN: 0,
      phase: this.nextPhase(), dead: false, deathT: -1, seen: 0,
    };
  }

  syncBullets(bullets: BulletView[]): void {
    if (this.disposed) return;
    this.gen++;
    const g = this.gen;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i]!;
      let rec = this.bulletRecs.get(b);
      if (!rec) {
        const mesh = new THREE.Mesh(this.bulletGeo, this.kindMaterials.get("bullet")!);
        mesh.name = "bullet";
        // orient the stretched tracer along the sim velocity (y flips to world)
        mesh.rotation.z = Math.atan2(-b.vel.y, b.vel.x);
        mesh.position.set(b.pos.x / TILE + 0.125, -(b.pos.y / TILE) - 0.125, 0);
        this.root.add(mesh);
        rec = { src: b, node: mesh, age: 0, spent: false, seen: 0 };
        this.bulletRecs.set(b, rec);
        this.bulletList.push(rec);
      }
      rec.seen = g;
      rec.spent = b.spent;
      rec.node.position.set(b.pos.x / TILE + 0.125, -(b.pos.y / TILE) - 0.125, 0);
    }
    this.pruneStale(this.bulletRecs, this.bulletList, g);
  }

  /** Swap-pop every record whose generation marker is stale, detaching its
   *  node from the scene graph (records own no GPU resources — geos/mats are
   *  shared per kind and freed once in dispose). */
  private pruneStale<T extends { seen: number; src: object; node: THREE.Object3D }>(map: Map<object, T>, list: T[], gen: number): void {
    for (let i = list.length - 1; i >= 0; i--) {
      const rec = list[i]!;
      if (rec.seen === gen) continue;
      const last = list.pop()!;
      if (i < list.length) list[i] = last;
      map.delete(rec.src);
      this.root.remove(rec.node);
    }
  }

  // -------------------------------------------------------------------------
  // per-frame animation — all eased, zero allocations
  // -------------------------------------------------------------------------

  update(dt: number, time: number): void {
    if (this.disposed) return;
    const d = Math.min(dt, 0.1);

    // per-kind emissive pulse (shared materials pulse in unison per kind)
    const pm = this.pulseMats;
    for (let i = 0; i < pm.length; i++) {
      const p = pm[i]!;
      p.mat.emissiveIntensity = p.base * (0.82 + 0.28 * Math.sin(time * 2.5 + p.off));
    }

    // --- items: spin / bob / breath / collect-out ---------------------------
    const items = this.itemList;
    for (let i = 0; i < items.length; i++) {
      const rec = items[i]!;
      const mesh = rec.node;
      const phase = rec.phase;
      if (rec.collectT >= 0) {
        // eased collect-out: rise + wind-up spin + shrink (transform-only)
        rec.collectT += d;
        const k = clamp01(rec.collectT / COLLECT_TIME);
        mesh.visible = k < 1;
        const s = 1 - smooth01(k);
        mesh.scale.setScalar(Math.max(0.001, s));
        mesh.position.set(rec.basePos.x, rec.basePos.y + 0.4 * smooth01(k), 0);
        mesh.rotation.y = rec.spin + k * 6.5;
        continue;
      }
      mesh.visible = true;
      rec.spin += d * (1.35 + 0.45 * Math.sin(phase * 3.1)); // per-instance spin rate
      mesh.rotation.y = rec.spin;
      mesh.rotation.x = 0.16 * Math.sin(time * 1.25 + phase * 1.7);
      mesh.position.set(rec.basePos.x, rec.basePos.y + 0.07 * Math.sin(time * 2 + phase), 0);
      mesh.scale.setScalar(1 + 0.05 * Math.sin(time * 2.15 + phase * 1.3));
    }

    // --- spiders: facing / fidget / bob / death ------------------------------
    const enemies = this.enemyList;
    for (let i = 0; i < enemies.length; i++) {
      const rec = enemies[i]!;
      const targetYaw = rec.dirTarget === 1 ? 0 : Math.PI;
      rec.yaw += (targetYaw - rec.yaw) * (1 - Math.exp(-d * 9));
      rec.node.rotation.y = rec.yaw;
      rec.moveN += (rec.moveTarget - rec.moveN) * (1 - Math.exp(-d * 8));

      if (rec.deathT >= 0) rec.deathT += d;
      const p = rec.deathT < 0 ? 0 : smooth01(Math.min(1, rec.deathT / DEATH_TIME));
      rec.node.visible = !rec.dead || rec.deathT < DEATH_TIME;

      // body bob + sway (view-only offsets on a child group, never the node)
      rec.body.position.y = 0.03 * Math.sin(time * 4.6 + rec.phase) - 0.14 * p;
      rec.body.rotation.z = 0.05 * Math.sin(time * 2.9 + rec.phase * 1.1);
      rec.body.scale.setScalar(Math.max(0.02, 1 - 0.96 * p));

      const fidget = 0.15 * (0.3 + 0.7 * rec.moveN) * (1 - p);
      const legs = rec.legs;
      for (let l = 0; l < legs.length; l++) {
        const leg = legs[l]!;
        const rest = rec.legRest[l]!;
        // rest → fidget while alive; fold under the body on death
        leg.rotation.z = rest + Math.sin(time * 6.3 + rec.phase + l * 1.13) * fidget + (0.05 - rest) * p;
      }
    }

    // --- bullets: spawn pop + muzzle-flash scale-out -------------------------
    const bullets = this.bulletList;
    for (let i = 0; i < bullets.length; i++) {
      const rec = bullets[i]!;
      const mesh = rec.node;
      if (rec.spent) {
        mesh.visible = false; // spent = gameplay collision → snap is allowed
        continue;
      }
      rec.age += d;
      mesh.visible = true;
      const spawn = smooth01(Math.min(rec.age / 0.07, 1));
      const flash = 1 + 2.2 * Math.exp(-rec.age * 14);
      mesh.scale.set(1.9 * flash * spawn, 0.75 * flash * spawn, 0.75 * flash * spawn);
    }

    // --- door: eased open/close timeline + light shaft + emissive ramp ------
    if (this.doorOpened) this.doorT = Math.min(this.doorT + d, DOOR_OPEN_TIME);
    else this.doorT = Math.max(this.doorT - d * 1.7, 0);
    const amt = smooth01(this.doorT / DOOR_OPEN_TIME);
    this.doorHinge.rotation.y = amt * 1.95;
    const shaftY = Math.max(0.02, amt);
    this.doorShaft.visible = amt > 0.02;
    this.doorShaft.scale.set(0.85 + 0.3 * amt, shaftY, 1);
    this.doorShaft.position.y = -0.93 + 0.95 * shaftY;
    this.doorShaftMat.opacity = (0.3 + 0.06 * Math.sin(time * 7.3)) * amt;
    this.doorSigilMat.emissiveIntensity = 0.45 + 0.3 * Math.sin(time * 2.3) + 3.0 * amt;

    this.lastNow = time;
  }

  /** Free shared geometries/materials once, detach from the scene. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    this.ownedGeos = [];
    this.ownedMats = [];
    this.itemRecs.clear();
    this.itemList.length = 0;
    this.enemyRecs.clear();
    this.enemyList.length = 0;
    this.bulletRecs.clear();
    this.bulletList.length = 0;
    this.root.removeFromParent();
  }
}
