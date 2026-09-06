import * as THREE from "three";

const POOL_SIZE = 200;
/** Particle lifetime; also the muzzle flash duration. */
const LIFE_S = 0.35;
const MUZZLE_LIFE_S = 0.06;
/** Burst spread speed in m/s. */
const SPEED = 4;

type Quad = {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  total: number;
  flash: boolean;
};

/**
 * Pooled particle quads (200) + one billboarded muzzle flash quad. All meshes
 * are constructed here and recycled forever — update paths never allocate.
 * Quads face the camera via a shared quaternion when one is provided.
 */
export class Fx {
  private readonly quads: Quad[] = [];
  private readonly flash: Quad;
  private readonly camQuat: THREE.Quaternion | null;
  private cursor = 0;

  constructor(scene: THREE.Scene, cameraQuat: THREE.Quaternion | null = null) {
    this.camQuat = cameraQuat;
    const geo = new THREE.PlaneGeometry(0.22, 0.22);
    const flashGeo = new THREE.PlaneGeometry(1.1, 0.7);

    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.quads.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        total: LIFE_S,
        flash: false,
      });
    }

    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      depthWrite: false,
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.visible = false;
    scene.add(flashMesh);
    this.flash = {
      mesh: flashMesh,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      total: MUZZLE_LIFE_S,
      flash: true,
    };
  }

  /** Spawns n debris sparks at a world point (round-robin over the pool). */
  burst(x: number, y: number, z: number, color: number, n = 10): void {
    for (let k = 0; k < n; k++) {
      const q = this.quads[this.cursor];
      this.cursor = (this.cursor + 1) % POOL_SIZE;
      const a = Math.random() * Math.PI * 2;
      const up = 1 + Math.random() * 2.5;
      q.vx = Math.cos(a) * SPEED * (0.3 + Math.random() * 0.7);
      q.vy = up * SPEED * 0.45;
      q.vz = Math.sin(a) * SPEED * (0.3 + Math.random() * 0.7);
      q.life = LIFE_S;
      q.total = LIFE_S;
      q.mesh.position.set(x, y, z);
      q.mesh.visible = true;
      (q.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      (q.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    }
  }

  /** One-shot gun flash at the muzzle; ~60 ms. */
  muzzleFlash(x: number, y: number, z: number): void {
    this.flash.mesh.position.set(x, y, z);
    this.flash.life = MUZZLE_LIFE_S;
    this.flash.mesh.visible = true;
  }

  /** Advances every live quad; hides expired ones. */
  update(dt: number): void {
    for (const q of this.quads) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) {
        q.mesh.visible = false;
        continue;
      }
      // Gravity pulls debris down through the flight.
      q.vy -= 9.8 * dt;
      q.mesh.position.x += q.vx * dt;
      q.mesh.position.y += q.vy * dt;
      q.mesh.position.z += q.vz * dt;
      (q.mesh.material as THREE.MeshBasicMaterial).opacity =
        q.life / q.total;
      if (this.camQuat) q.mesh.quaternion.copy(this.camQuat);
    }
    if (this.flash.life > 0) {
      this.flash.life -= dt;
      if (this.flash.life <= 0) this.flash.mesh.visible = false;
      else if (this.camQuat) this.flash.mesh.quaternion.copy(this.camQuat);
    }
  }

  /** Hides every particle; called on run reset. */
  clear(): void {
    for (const q of this.quads) {
      q.life = 0;
      q.mesh.visible = false;
    }
    this.flash.life = 0;
    this.flash.mesh.visible = false;
  }
}
