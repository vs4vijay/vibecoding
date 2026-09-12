// src/render3d/Particles.ts — pooled GPU particle systems for gameplay + ambience.
import * as THREE from "three";
import { worldCenter, PALETTE } from "./palette";

export type BurstKind = "collect" | "death" | "dust" | "spark" | "ember";

interface Pool {
  mesh: THREE.Points;
  positions: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  max: number;
  head: number;
}

const EXHAUST_RATE = 46; // puffs per second while the jet burns

export class Particles {
  private pools = new Map<BurstKind, Pool>();
  private scene: THREE.Scene;
  private exhaustAcc = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    for (const kind of ["collect", "death", "dust", "spark", "ember"] as BurstKind[]) {
      this.pools.set(kind, this.makePool(kind, 128));
    }
  }

  private makePool(kind: BurstKind, max: number): Pool {
    const positions = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) positions[i * 3 + 1] = -999; // park unused slots offscreen
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const color = kind === "death" ? 0xff8855 : kind === "dust" ? 0x8899a8 : PALETTE.emberHot;
    const mat = new THREE.PointsMaterial({ color, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Points(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return { mesh, positions, vel: new Float32Array(max * 3), life: new Float32Array(max), max, head: 0 };
  }

  burst(kind: BurstKind, at: { x: number; y: number }, count = 12, speed = 2.5): void {
    const pool = this.pools.get(kind);
    if (!pool) return;
    const c = worldCenter(at.x, at.y);
    for (let i = 0; i < count; i++) {
      const idx = pool.head;
      pool.head = (pool.head + 1) % pool.max;
      pool.positions[idx * 3] = c.x;
      pool.positions[idx * 3 + 1] = c.y;
      pool.positions[idx * 3 + 2] = 0.3;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      pool.vel[idx * 3] = Math.cos(a) * s;
      pool.vel[idx * 3 + 1] = Math.sin(a) * s + (kind === "ember" ? 1.5 : 0);
      pool.life[idx] = 0.6 + Math.random() * 0.5;
    }
  }

  /** Continuous jetpack exhaust: hot ember/smoke puffs dragged downward from
   *  the flame anchor. `at` is WORLD-space (DaveView.exhaustAnchor()) — unlike
   *  burst(), which takes sim pixels. Rate-based: spawns 0-2 puffs per call
   *  from dt; stops naturally when calls stop. No allocations. */
  jetpackExhaust(at: { x: number; y: number }, dt: number): void {
    const embers = this.pools.get("ember");
    const smoke = this.pools.get("dust");
    if (!embers || !smoke) return;
    this.exhaustAcc = Math.min(this.exhaustAcc + Math.max(dt, 0) * EXHAUST_RATE, 2);
    while (this.exhaustAcc >= 1) {
      this.exhaustAcc -= 1;
      const pool: Pool = Math.random() < 0.22 ? smoke : embers;
      const idx = pool.head;
      pool.head = (pool.head + 1) % pool.max;
      pool.positions[idx * 3] = at.x + (Math.random() - 0.5) * 0.16;
      pool.positions[idx * 3 + 1] = at.y - 0.08 - Math.random() * 0.08;
      pool.positions[idx * 3 + 2] = 0.28;
      pool.vel[idx * 3] = (Math.random() - 0.5) * 0.8;
      if (pool === embers) {
        pool.vel[idx * 3 + 1] = -(1.7 + Math.random() * 1.5);
        pool.life[idx] = 0.28 + Math.random() * 0.24;
      } else {
        pool.vel[idx * 3 + 1] = -(0.8 + Math.random() * 0.6);
        pool.life[idx] = 0.45 + Math.random() * 0.3;
      }
    }
  }

  update(dt: number): void {
    for (const pool of this.pools.values()) {
      let alive = false;
      for (let i = 0; i < pool.max; i++) {
        if ((pool.life[i] ?? 0) <= 0) continue;
        alive = true;
        pool.life[i] = (pool.life[i] ?? 0) - dt;
        pool.vel[i * 3 + 1] = (pool.vel[i * 3 + 1] ?? 0) - 4 * dt;
        pool.positions[i * 3] = (pool.positions[i * 3] ?? 0) + (pool.vel[i * 3] ?? 0) * dt;
        pool.positions[i * 3 + 1] = (pool.positions[i * 3 + 1] ?? 0) + (pool.vel[i * 3 + 1] ?? 0) * dt;
        if ((pool.life[i] ?? 0) <= 0) pool.positions[i * 3 + 1] = -999;
      }
      if (alive) pool.mesh.geometry.attributes.position!.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      pool.mesh.geometry.dispose();
      (pool.mesh.material as THREE.Material).dispose();
      this.scene.remove(pool.mesh);
    }
    this.pools.clear();
  }
}
