// Transient combat visuals: tracers, muzzle flashes, sparks, explosions,
// skid marks. Everything is short-lived and pooled-by-GC (dozens max).

import * as THREE from 'three';
import { palette } from '../data/palette.js';

export function createFx(scene) {
  const active = [];

  function add(mesh, dur, onUpdate) {
    scene.add(mesh);
    active.push({ mesh, t: 0, dur, onUpdate });
  }

  function spawnTracer(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.5) return;
    const geo = new THREE.BoxGeometry(len, 0.09, 0.09);
    const mat = new THREE.MeshBasicMaterial({ color: palette.tracer, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x1 + x2) / 2, 1.25, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    add(m, 0.09, (fx, k) => {
      mat.opacity = 0.95 * (1 - k);
      m.scale.x = 1 - k * 0.7;
    });
  }

  function spawnMuzzle(x, z) {
    const mat = new THREE.MeshBasicMaterial({ color: palette.muzzle, transparent: true });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), mat);
    m.position.set(x, 1.3, z);
    add(m, 0.07, (fx, k) => {
      mat.opacity = 1 - k;
      m.scale.setScalar(1 + k);
    });
  }

  function spawnSpark(x, z, color = palette.muzzle) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), mat);
    m.position.set(x, 1.1, z);
    add(m, 0.16, (fx, k) => {
      mat.opacity = 1 - k;
      m.scale.setScalar(0.6 + k * 1.6);
    });
  }

  function spawnSkid(x, z, heading) {
    const geo = new THREE.PlaneGeometry(1.0, 0.28);
    const mat = new THREE.MeshBasicMaterial({ color: palette.shadow, transparent: true, opacity: 0.35 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -heading;
    m.position.set(x, 0.045, z);
    add(m, 3.5, (fx, k) => {
      mat.opacity = 0.35 * (1 - k);
    });
  }

  function spawnExplosion(x, z) {
    // flash core
    const coreMat = new THREE.MeshBasicMaterial({ color: palette.explosionCore, transparent: true });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), coreMat);
    core.position.set(x, 1.5, z);
    add(core, 0.32, (fx, k) => {
      coreMat.opacity = 1 - k;
      core.scale.setScalar(1 + k * 4.5);
    });
    // fire shell
    const fireMat = new THREE.MeshBasicMaterial({ color: palette.explosion, transparent: true, opacity: 0.85 });
    const fire = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 10), fireMat);
    fire.position.set(x, 1.8, z);
    add(fire, 0.55, (fx, k) => {
      fireMat.opacity = 0.85 * (1 - k);
      fire.scale.setScalar(1 + k * 2.4);
    });
    // debris shards
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 8 + Math.random() * 14;
      const mat = new THREE.MeshBasicMaterial({ color: palette.burnt, transparent: true });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
      m.position.set(x, 1.2, z);
      const vx = Math.cos(a) * sp;
      const vz = Math.sin(a) * sp;
      let vy = 6 + Math.random() * 8;
      add(m, 1.1, (fx, k, dt) => {
        vy -= 22 * dt;
        m.position.x += vx * dt;
        m.position.z += vz * dt;
        m.position.y += vy * dt;
        if (m.position.y < 0.15) {
          m.position.y = 0.15;
          vy = 0;
        }
        m.rotation.x += 8 * dt;
        m.rotation.y += 6 * dt;
        mat.opacity = 1 - k;
      });
    }
    // smoke puffs
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: palette.smoke, transparent: true, opacity: 0.5 });
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), mat);
      m.position.set(x + (Math.random() - 0.5) * 3, 1.5 + Math.random(), z + (Math.random() - 0.5) * 3);
      const rise = 1.5 + Math.random() * 2;
      add(m, 1.6, (fx, k, dt) => {
        m.position.y += rise * dt;
        m.scale.setScalar(1 + k * 2.2);
        mat.opacity = 0.5 * (1 - k);
      });
    }
  }

  // Returns a per-frame updater; dt here is render time (visuals only).
  function update(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const fx = active[i];
      fx.t += dt;
      const k = Math.min(1, fx.t / fx.dur);
      fx.onUpdate(fx, k, dt);
      if (fx.t >= fx.dur) {
        scene.remove(fx.mesh);
        fx.mesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        active.splice(i, 1);
      }
    }
  }

  function clear() {
    for (const fx of active) {
      scene.remove(fx.mesh);
      fx.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    active.length = 0;
  }

  return { spawnTracer, spawnMuzzle, spawnSpark, spawnSkid, spawnExplosion, update, clear, get count() { return active.length; } };
}
