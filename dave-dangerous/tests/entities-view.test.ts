// tests/entities-view.test.ts — EntitiesView checks that run without WebGL.
// The view builds only plain three.js CPU-side objects (no canvas textures, no
// renderer), so it constructs fine under node; these tests drive the
// sync/update loop directly with fixed timesteps for determinism.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EntitiesView } from "../src/render3d/EntitiesView";
import type { BulletView, EnemyView, ItemView } from "../src/render3d/viewTypes";

const STEP = 1 / 60;

function makeView(): { scene: THREE.Scene; ev: EntitiesView } {
  const scene = new THREE.Scene();
  return { scene, ev: new EntitiesView(scene) };
}

function run(ev: EntitiesView, seconds: number, t0 = 0): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) ev.update(STEP, t0 + i * STEP);
}

function allMeshes(ev: EntitiesView): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  ev.root.traverse(o => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function itemMesh(ev: EntitiesView, kind: string): THREE.Mesh {
  const mesh = allMeshes(ev).find(m => m.name === `item:${kind}`);
  if (!mesh) throw new Error(`missing item mesh for ${kind}`);
  return mesh;
}

function makeItem(type: string, x = 64, y = 32): ItemView {
  return { type, pos: { x, y }, collected: false };
}
function makeEnemy(x = 160, y = 96): EnemyView {
  return { pos: { x, y }, dead: false };
}
function makeBullet(x = 100, y = 50): BulletView {
  return { pos: { x, y }, vel: { x: 6, y: 0 }, spent: false, owner: "dave" };
}

describe("EntitiesView", () => {
  it("constructs without WebGL and registers shared per-kind materials", () => {
    const { scene, ev } = makeView();
    for (const key of ["orb", "blueDiamond", "redDiamond", "ring", "crown", "scepter", "trophy", "gun", "jetpack", "oneUp", "spiderBody", "spiderEye", "bullet", "doorFrame", "doorPanel", "doorSigil", "doorShaft"]) {
      expect(ev.kindMaterials.get(key), key).toBeInstanceOf(THREE.Material);
    }
    expect(scene.children).toContain(ev.root);
    expect(() => ev.update(STEP, 0)).not.toThrow(); // update before any sync
    ev.dispose();
    expect(scene.children).not.toContain(ev.root);
  });

  it("shares one material per kind across instances", () => {
    const { ev } = makeView();
    const items = [makeItem("blueDiamond", 32, 32), makeItem("blueDiamond", 48, 32), makeItem("orb", 64, 32)];
    const enemies = [makeEnemy(160, 96), makeEnemy(240, 96)];
    ev.syncItems(items);
    ev.syncEnemies(enemies);
    ev.update(STEP, 0);

    const diamonds = allMeshes(ev).filter(m => m.name === "item:blueDiamond");
    expect(diamonds).toHaveLength(2);
    const diaMat = ev.kindMaterials.get("blueDiamond")!;
    expect(diamonds[0]!.material).toBe(diaMat);
    expect(diamonds[1]!.material).toBe(diaMat); // same object, not a clone

    // two spiders = 2 abdomens + 2 cephalothoraxes + 6 legs each share spiderBody
    const spiderMat = ev.kindMaterials.get("spiderBody")!;
    const spiderMeshes = allMeshes(ev).filter(m => m.material === spiderMat);
    expect(spiderMeshes).toHaveLength(16);

    // 5 entities but only 4 distinct materials across all of their meshes
    // (door rig meshes are excluded — they are always present)
    const entityMeshes = allMeshes(ev).filter(m => !m.name.startsWith("door"));
    const unique = new Set(entityMeshes.map(m => m.material));
    expect(unique.size).toBe(4);
  });

  it("items spin, bob and breathe as time advances", () => {
    const { ev } = makeView();
    ev.syncItems([makeItem("trophy", 64, 32), makeItem("ring", 96, 32)]);
    const mesh = itemMesh(ev, "trophy");
    const rot1 = mesh.rotation.y;
    const ys: number[] = [];
    const scales: number[] = [];
    for (let i = 0; i < 120; i++) {
      ev.update(STEP, i * STEP);
      ys.push(mesh.position.y);
      scales.push(mesh.scale.x);
    }
    expect(mesh.rotation.y).toBeGreaterThan(rot1 + 0.5); // spin advanced
    const ySpread = Math.max(...ys) - Math.min(...ys);
    expect(ySpread).toBeGreaterThan(0.05); // idle bob amplitude visible
    const baseY = -(32 / 16) - 0.5;
    expect(Math.max(...ys)).toBeGreaterThan(baseY); // bob rides on exact sim center
    const scaleSpread = Math.max(...scales) - Math.min(...scales);
    expect(scaleSpread).toBeGreaterThan(0.04); // breath
  });

  it("collected items tween out eased before hiding", () => {
    const { ev } = makeView();
    const it = makeItem("orb", 64, 32);
    ev.syncItems([it]);
    ev.update(STEP, 0);
    it.collected = true;
    ev.syncItems([it]);
    run(ev, 0.1, STEP);
    expect(itemMesh(ev, "orb").visible).toBe(true); // still easing out
    expect(itemMesh(ev, "orb").scale.x).toBeLessThan(1);
    run(ev, 0.6, 0.2);
    expect(itemMesh(ev, "orb").visible).toBe(false);
  });

  it("spiders stay pinned to exact sim positions while their bodies animate", () => {
    const { ev } = makeView();
    const e = makeEnemy(160, 96);
    ev.syncEnemies([e]);
    const node = ev.root.getObjectByName("spider")!;
    const body = node.children[0]!;
    const bodyY: number[] = [];
    for (let i = 0; i < 90; i++) {
      ev.update(STEP, i * STEP);
      bodyY.push(body.position.y);
    }
    // gameplay position is never eased/offset
    expect(node.position.x).toBe(160 / 16 + 0.5);
    expect(node.position.y).toBe(-(96 / 16) - 0.5);
    // ...while the view-only body group bobs
    expect(Math.max(...bodyY) - Math.min(...bodyY)).toBeGreaterThan(0.01);
  });

  it("spiders ease their facing toward movement direction", () => {
    const { ev } = makeView();
    const e = makeEnemy(160, 96);
    ev.syncEnemies([e]);
    run(ev, 0.3);
    e.pos.x -= 16; // moved one tile left between syncs
    ev.syncEnemies([e]);
    run(ev, 0.1, 0.4);
    const mid = ev.root.getObjectByName("spider")!.rotation.y;
    expect(mid).toBeGreaterThan(0.05); // turning, not snapped
    expect(mid).toBeLessThan(Math.PI);
    run(ev, 0.8, 0.6);
    expect(ev.root.getObjectByName("spider")!.rotation.y).toBeCloseTo(Math.PI, 2);
  });

  it("dead spiders curl and shrink, then hide", () => {
    const { ev } = makeView();
    const e = makeEnemy(160, 96);
    ev.syncEnemies([e]);
    ev.update(STEP, 0);
    const node = ev.root.getObjectByName("spider")!;
    const body = node.children[0]!;
    e.dead = true;
    ev.syncEnemies([e]);
    run(ev, 0.1, STEP);
    expect(body.scale.x).toBeLessThan(1); // shrinking, not snapped away
    expect(node.visible).toBe(true);
    run(ev, 0.6, 0.2);
    expect(node.visible).toBe(false);
  });

  it("door opening eases over ~0.6 s, converges, and never snaps", () => {
    const { ev } = makeView();
    const door = { pos: { x: 32, y: 32 }, opened: false };
    ev.syncDoor(door);
    run(ev, 0.3);
    const hinge = ev.root.getObjectByName("doorHinge")!;
    expect(hinge.rotation.y).toBe(0);

    door.opened = true;
    ev.syncDoor(door);
    ev.update(STEP, 0.4);
    const firstStep = hinge.rotation.y;
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThan(0.2); // eased start, not a snap to full swing

    run(ev, 0.3, 0.4 + STEP);
    const mid = hinge.rotation.y;
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(1.6);

    run(ev, 1.0, 0.8);
    const open = hinge.rotation.y;
    expect(open).toBeCloseTo(1.95, 5); // ramp reached its target
    run(ev, 0.5, 1.9);
    expect(hinge.rotation.y).toBeCloseTo(open, 6); // fully settled

    // light shaft is grown and lit while open
    const shaft = ev.root.getObjectByName("doorShaft")! as THREE.Mesh;
    expect(shaft.visible).toBe(true);
    expect((shaft.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.1);

    door.opened = false;
    ev.syncDoor(door);
    run(ev, 1.2, 2.5);
    expect(hinge.rotation.y).toBeCloseTo(0, 5);
    expect(shaft.visible).toBe(false);
  });

  it("bullets spawn with a muzzle-flash scale-out and settle to tracer size", () => {
    const { ev } = makeView();
    const b = makeBullet();
    ev.syncBullets([b]);
    const mesh = allMeshes(ev).find(m => m.name === "bullet")!;
    expect(mesh.rotation.z).toBeCloseTo(0, 5); // oriented along +x velocity
    const scales: number[] = [];
    for (let i = 0; i < 40; i++) {
      ev.update(STEP, i * STEP);
      scales.push(mesh.scale.x);
    }
    expect(Math.max(...scales)).toBeGreaterThan(2.2); // flash pops past rest size
    expect(mesh.scale.x).toBeCloseTo(1.9, 3); // settled stretched tracer
    expect(mesh.scale.y).toBeCloseTo(0.75, 3);
  });

  it("spent bullets hide immediately (gameplay collision may snap)", () => {
    const { ev } = makeView();
    const b = makeBullet();
    ev.syncBullets([b]);
    ev.update(STEP, 0);
    b.spent = true;
    ev.syncBullets([b]);
    ev.update(STEP, STEP);
    expect(allMeshes(ev).find(m => m.name === "bullet")!.visible).toBe(false);
  });

  it("prunes entities that leave the sync lists", () => {
    const { ev } = makeView();
    const a = makeItem("orb", 32, 32);
    const b = makeItem("ring", 48, 32);
    ev.syncItems([a, b]);
    expect(allMeshes(ev).filter(m => m.name.startsWith("item:"))).toHaveLength(2);
    ev.syncItems([a]);
    expect(allMeshes(ev).filter(m => m.name.startsWith("item:"))).toHaveLength(1);
    ev.syncItems([]);
    expect(allMeshes(ev).filter(m => m.name.startsWith("item:"))).toHaveLength(0);
  });

  it("dispose is idempotent and frees shared materials exactly once", () => {
    const { ev } = makeView();
    ev.syncItems([makeItem("orb", 32, 32)]);
    ev.syncEnemies([makeEnemy()]);
    let disposed = 0;
    ev.kindMaterials.get("orb")!.addEventListener("dispose", () => disposed++);
    ev.dispose();
    expect(disposed).toBe(1);
    expect(() => ev.dispose()).not.toThrow();
    expect(disposed).toBe(1); // second call frees nothing again
    // sync/update after dispose are safe no-ops
    expect(() => {
      ev.syncItems([makeItem("orb", 32, 32)]);
      ev.update(STEP, 0);
    }).not.toThrow();
  });
});
