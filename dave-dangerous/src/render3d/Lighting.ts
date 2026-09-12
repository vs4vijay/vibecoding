// src/render3d/Lighting.ts — the light rig. Core-owned: agents may call in, not rewrite.
import * as THREE from "three";
import { PALETTE } from "./palette";

/** Pooled, flicker-capable point light with auto-fade for one-shot emitters. */
interface Emitter {
  light: THREE.PointLight;
  base: number;
  speed: number;
  phase: number;
  ttl: number; // seconds; <= 0 = persistent
  fade: number; // seconds of fade-out once ttl elapsed
}

export class LightingRig {
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private emitters: Emitter[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.hemi = new THREE.HemisphereLight(0x2a4a5a, 0x0a0c10, 0.55);
    scene.add(this.hemi);

    // warm key from upper-left front; casts the world's shadows
    this.key = new THREE.DirectionalLight(0xffe0b0, 1.35);
    this.key.position.set(-7, 12, 9);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -14;
    this.key.shadow.camera.right = 14;
    this.key.shadow.camera.top = 10;
    this.key.shadow.camera.bottom = -8;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 60;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    scene.add(this.key);
    scene.add(this.key.target);

    // cool rim from behind/above to cut silhouettes out of the fog
    this.rim = new THREE.DirectionalLight(0x6fc3d8, 0.7);
    this.rim.position.set(5, 6, -8);
    scene.add(this.rim);

    scene.add(new THREE.AmbientLight(PALETTE.cavernSlate, 0.18));
  }

  /** Persistent or fading point light. Returns the raw light for positioning. */
  addEmitter(pos: THREE.Vector3, color: number, intensity: number, distance: number, opts?: { ttl?: number; fade?: number; speed?: number }): THREE.PointLight {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.emitters.push({
      light, base: intensity,
      speed: opts?.speed ?? 9,
      phase: Math.random() * Math.PI * 2,
      ttl: opts?.ttl ?? 0,
      fade: opts?.fade ?? 0.4,
    });
    return light;
  }

  update(dt: number, time: number): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]!;
      // candle-like double-sine flicker
      const f = 0.82 + 0.12 * Math.sin(time * e.speed + e.phase) + 0.06 * Math.sin(time * e.speed * 2.7 + e.phase * 1.7);
      let intensity = e.base * f;
      if (e.ttl > 0) {
        e.ttl -= dt;
        if (e.ttl <= 0) {
          e.fade -= dt;
          intensity *= Math.max(0, e.fade / 0.4);
          if (e.fade <= 0) {
            this.scene.remove(e.light);
            e.light.dispose();
            this.emitters.splice(i, 1);
            continue;
          }
        }
      }
      e.light.intensity = intensity;
    }
  }

  dispose(): void {
    for (const e of this.emitters) {
      this.scene.remove(e.light);
      e.light.dispose();
    }
    this.emitters = [];
  }
}
