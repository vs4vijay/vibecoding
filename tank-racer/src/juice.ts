// Phase 9: cheap juice particles — dust puffs, impact sparks, wreck bursts,
// skid marks, boost flames.
//
// Same pooled-pattern approach as the smoke puffs in weapons.ts: shared
// geometry + materials, short-lived meshes scaled/faded per frame, removed on
// expiry. All spawn calls are rate-gated by the callers, so worst-case counts
// stay tiny (a handful of live meshes) and fps is unaffected.
//
// Deliberate exception to the shared-material rule: skid marks clone the dark
// decal material per mark, because a ground decal "fading" via the scale
// envelope looks wrong — it must fade opacity, and shared materials can't do
// that per-mesh. Clones are disposed on removal (expiry, FIFO overflow,
// reset); the geometry stays shared.

import * as THREE from "three";
import type { TankState } from "./tank";

/** Tan dust kicked up by drifting/hard-turning tanks. */
const dustGeo = new THREE.SphereGeometry(0.7, 6, 4);
const dustMat = new THREE.MeshLambertMaterial({
  color: 0xc9a86a,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

/** Bright spark flash at a shell impact point. */
const sparkGeo = new THREE.SphereGeometry(0.28, 6, 4);
const sparkMat = new THREE.MeshBasicMaterial({
  color: 0xffd75e,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});

/** Dark smoke chunk for the big wreck burst (reuses weapons' palette). */
const burstGeo = new THREE.SphereGeometry(1.1, 7, 5);
const burstMat = new THREE.MeshLambertMaterial({
  color: 0x3a352c,
  transparent: true,
  opacity: 0.8,
});
const fireGeo = new THREE.SphereGeometry(0.8, 7, 5);
const fireMat = new THREE.MeshBasicMaterial({
  color: 0xff8830,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
});

const MARK_LIFE = 3.5; // s a mark stays visible, fading linearly
const MARK_CAP = 48; // FIFO: overflow disposes the OLDEST mark
const MARK_Y = 0.07; // above road (y=0.02) and ice overlay (y=0.045)
const MARK_OPACITY = 0.55; // start opacity; update() fades to 0 over MARK_LIFE

/**
 * Rubber skid-mark decal: flat quad lying on the road. Shared geometry (the
 * flattening is baked in so per-mark meshes only set rotation.y = heading),
 * but the material is a TEMPLATE cloned per mark — see the header note.
 */
const skidGeo = new THREE.PlaneGeometry(0.55, 2.2);
skidGeo.rotateX(-Math.PI / 2);
const skidMatTemplate = new THREE.MeshBasicMaterial({
  color: 0x151515,
  transparent: true,
  opacity: MARK_OPACITY,
  depthWrite: false,
});

interface Particle {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  startScale: number;
  grow: number; // scale change per second
  rise: number; // upward drift (u/s)
}

/** Ground decal that fades via per-mark cloned material opacity. */
interface Mark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial; // the clone, not the shared template
  age: number;
  life: number;
}

export interface Juice {
  /** One dust puff behind a tank (call rate-gated). */
  dust(tank: TankState): void;
  /** One dark rubber decal under a hard-cornering tank (call rate-gated). */
  skid(tank: TankState): void;
  /** One exhaust flame behind a boosting tank (call rate-gated; stop calling when boost ends). */
  flame(tank: TankState): void;
  /** Small spark cluster where a shell landed (target position). */
  impactSparks(x: number, y: number, z: number): void;
  /** Big multi-particle explosion for a wreck. */
  wreckBurst(x: number, y: number, z: number): void;
  /** Advance all particles and skid marks; call once per frame. */
  update(dt: number): void;
  /** Remove every live particle and mark (race restart / track switch). */
  reset(): void;
}

export function createJuice(scene: THREE.Scene): Juice {
  const particles: Particle[] = [];
  const marks: Mark[] = [];

  function spawn(
    x: number,
    y: number,
    z: number,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    life: number,
    startScale: number,
    grow: number,
    rise: number,
  ): void {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(startScale);
    scene.add(mesh);
    particles.push({ mesh, age: 0, life, startScale, grow, rise });
  }

  function update(dt: number): void {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        scene.remove(p.mesh);
        particles.splice(i, 1);
        continue;
      }
      p.mesh.position.y += p.rise * dt;
      // Grow/shrink over life; materials are module-shared so "fading" is
      // done with an envelope that holds the size, then collapses to zero.
      const t = p.age / p.life;
      const env = t < 0.7 ? 1 : Math.max(0.01, 1 - (t - 0.7) / 0.3);
      p.mesh.scale.setScalar(Math.max(0.01, (p.startScale + p.grow * p.age) * env));
    }
    // Skid marks fade via their per-mark cloned material instead (see header).
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i];
      m.age += dt;
      if (m.age >= m.life) {
        scene.remove(m.mesh);
        m.mat.dispose();
        marks.splice(i, 1);
        continue;
      }
      m.mat.opacity = MARK_OPACITY * (1 - m.age / m.life);
    }
  }

  return {
    dust(tank) {
      // Behind the hull, low to the ground, opposite the travel direction
      spawn(
        tank.position.x - Math.sin(tank.heading) * 2.2 + (Math.random() - 0.5),
        0.5,
        tank.position.z - Math.cos(tank.heading) * 2.2 + (Math.random() - 0.5),
        dustGeo,
        dustMat,
        0.55,
        0.5 + Math.random() * 0.3,
        1.6,
        1.1,
      );
    },
    skid(tank) {
      // Flat quad at the rear axle line, aligned with the heading. The
      // flattening is baked into the shared geometry, so a plain rotation.y
      // lays the streak along the travel direction (heading 0 = +Z).
      // Lateral jitter ±0.3 makes repeated marks read as two tire lines.
      const h = tank.heading;
      const j = (Math.random() - 0.5) * 0.6;
      const mat = skidMatTemplate.clone(); // per-mark: fades opacity, not scale
      const mesh = new THREE.Mesh(skidGeo, mat);
      mesh.rotation.y = h;
      mesh.position.set(
        tank.position.x - Math.sin(h) * 2.2 + Math.cos(h) * j,
        MARK_Y,
        tank.position.z - Math.cos(h) * 2.2 - Math.sin(h) * j,
      );
      mesh.renderOrder = 1; // draw above road / ice overlay
      scene.add(mesh);
      marks.push({ mesh, mat, age: 0, life: MARK_LIFE });
      // FIFO cap: the oldest mark goes, its clone disposed, geometry shared
      if (marks.length > MARK_CAP) {
        const oldest = marks.shift();
        if (oldest) {
          scene.remove(oldest.mesh);
          oldest.mat.dispose();
        }
      }
    },
    flame(tank) {
      // Jet of fire from the hull rear: small start that SHRINKS with upward
      // drift reads as exhaust, not an explosion. Caller stops calling when
      // the boost ends.
      spawn(
        tank.position.x - Math.sin(tank.heading) * 2.2 + (Math.random() - 0.5),
        0.8,
        tank.position.z - Math.cos(tank.heading) * 2.2 + (Math.random() - 0.5),
        fireGeo,
        fireMat,
        0.3,
        0.55,
        -1.6,
        2.4,
      );
    },
    impactSparks(x, y, z) {
      // A tight cluster reads as a spark flash without per-spark physics
      for (let i = 0; i < 4; i++) {
        spawn(
          x + (Math.random() - 0.5) * 1.6,
          y + Math.random() * 1.2,
          z + (Math.random() - 0.5) * 1.6,
          sparkGeo,
          sparkMat,
          0.22 + Math.random() * 0.1,
          0.7 + Math.random() * 0.5,
          -1.5,
          2.5,
        );
      }
    },
    wreckBurst(x, y, z) {
      // Fireball core + ring of smoke chunks — noticeably bigger than a puff
      spawn(x, y + 1.2, z, fireGeo, fireMat, 0.45, 1.4, 5.5, 2.2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        spawn(
          x + Math.cos(a) * 1.4,
          y + 0.8 + Math.random() * 1.4,
          z + Math.sin(a) * 1.4,
          burstGeo,
          burstMat,
          0.9 + Math.random() * 0.3,
          0.8 + Math.random() * 0.5,
          1.4,
          1.8,
        );
      }
    },
    update,
    reset() {
      for (const p of particles) scene.remove(p.mesh);
      particles.length = 0;
      for (const m of marks) {
        scene.remove(m.mesh);
        m.mat.dispose();
      }
      marks.length = 0;
    },
  };
}
