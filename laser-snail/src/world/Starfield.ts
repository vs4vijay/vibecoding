import * as THREE from 'three';

export interface StarfieldOptions {
  /** Number of stars. Defaults to 2600. */
  count?: number;
  /** Inner radius of the star shell, in world units. Defaults to 320. */
  innerRadius?: number;
  /** Outer radius of the star shell, in world units. Defaults to 720. */
  outerRadius?: number;
  /** Point size in world units. Defaults to 1.2. */
  size?: number;
}

export interface Starfield {
  points: THREE.Points;
  /** Advances the slow background drift by `dt` seconds. */
  update(dt: number): void;
}

// Mostly white with the occasional cyan/violet tint, matching the neon palette.
const STAR_PALETTE = [0xcfd8ff, 0xffffff, 0x8fe8ff, 0xbfa8ff] as const;

/**
 * Builds a sphere-distributed star backdrop from a single THREE.Points.
 * Stars sit on shells between innerRadius and outerRadius — far enough to
 * never intersect gameplay geometry, dense enough to read as a galaxy.
 */
export function createStarfield(options: StarfieldOptions = {}): Starfield {
  const count = options.count ?? 2600;
  const innerRadius = options.innerRadius ?? 320;
  const outerRadius = options.outerRadius ?? 720;
  const size = options.size ?? 1.2;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    // Uniform direction on the unit sphere, pushed out to a random shell radius.
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const radius = innerRadius + Math.random() * (outerRadius - innerRadius);
    positions[i * 3] = s * Math.cos(theta) * radius;
    positions[i * 3 + 1] = u * radius;
    positions[i * 3 + 2] = s * Math.sin(theta) * radius;

    color.setHex(STAR_PALETTE[Math.floor(Math.random() * STAR_PALETTE.length)]);
    color.multiplyScalar(0.55 + Math.random() * 0.45); // per-star brightness variance
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false, // stars must stay crisp above the fog that swallows the road
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'starfield';

  return {
    points,
    update(dt: number): void {
      points.rotation.y += dt * 0.004; // barely-there drift keeps the sky alive
    },
  };
}
