import * as THREE from "three";
import { mulberry32 } from "../util/Rng";

/** Drifting pollen motes — cheap ambience that catches the light.
 *  Positions are a PURE function of (windTime, focus, wind): no integration,
 *  so pinned shots are pixel-stable across runs. */
export class Pollen {
  readonly points: THREE.Points;

  private readonly count = 260;
  private readonly box = new THREE.Vector3(26, 5, 26);
  private readonly base: Float32Array; // per-mote phase seeds
  private readonly origin: Float32Array; // per-mote anchor in the volume
  private readonly positions: Float32Array;
  private readonly colors: Float32Array; // rgba — alpha fades motes near the lens

  constructor(seed: number) {
    const rng = mulberry32(seed);
    this.origin = new Float32Array(this.count * 3);
    this.base = new Float32Array(this.count);
    this.positions = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      this.base[i] = rng() * Math.PI * 2;
      this.origin[i * 3] = (rng() - 0.5) * this.box.x;
      this.origin[i * 3 + 1] = (rng() - 0.5) * this.box.y;
      this.origin[i * 3 + 2] = (rng() - 0.5) * this.box.z;
      this.colors[i * 4] = 1;
      this.colors[i * 4 + 1] = 0.953;
      this.colors[i * 4 + 2] = 0.84;
      this.colors[i * 4 + 3] = 1;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    // 4-component color: per-mote alpha (near-lens fade) on top of the tint.
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));

    const mat = new THREE.PointsMaterial({
      map: Pollen.makeSprite(),
      size: 0.055,
      transparent: true,
      opacity: 0.6,
      vertexColors: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** Slow curl-ish drift inside a volume that follows the player. */
  update(t: number, focus: THREE.Vector3, windDir: THREE.Vector2, camPos?: THREE.Vector3): void {
    const p = this.positions;
    const col = this.colors;
    for (let i = 0; i < this.count; i++) {
      const ph = this.base[i];
      const i3 = i * 3;
      p[i3] =
        this.origin[i3] +
        Math.sin(t * 0.4 + ph) * 0.55 +
        windDir.x * 0.4 * (0.5 + 0.5 * Math.sin(t * 0.21 + ph * 1.3));
      p[i3 + 1] = this.origin[i3 + 1] + Math.sin(t * 0.53 + ph * 1.7) * 0.3 + 0.4;
      p[i3 + 2] =
        this.origin[i3 + 2] +
        Math.cos(t * 0.33 + ph * 0.9) * 0.55 +
        windDir.y * 0.4 * (0.5 + 0.5 * Math.sin(t * 0.17 + ph));
      // Wrap into the volume around the focus point.
      for (let a = 0; a < 3; a++) {
        const half = a === 1 ? this.box.y / 2 : a === 0 ? this.box.x / 2 : this.box.z / 2;
        const c = a === 1 ? focus.y + 1.2 : a === 0 ? focus.x : focus.z;
        let v = p[i3 + a] - c;
        if (v > half) v -= half * 2;
        else if (v < -half) v += half * 2;
        p[i3 + a] = c + v;
      }
      // Fade motes that drift toward the lens: a huge soft dot there reads
      // as a rendering blob, not pollen.
      if (camPos) {
        const dx = p[i3] - camPos.x;
        const dy = p[i3 + 1] - camPos.y;
        const dz = p[i3 + 2] - camPos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        col[i * 4 + 3] = THREE.MathUtils.smoothstep(d, 1.15, 1.7);
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Soft round sprite drawn on a canvas. */
  private static makeSprite(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
