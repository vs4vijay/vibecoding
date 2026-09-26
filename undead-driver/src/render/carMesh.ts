import * as THREE from "three";
import type { CarState } from "../game/car";
import { CONFIG } from "../config";
import { buildBeamCrossGeometry, makeBeamMaterial } from "./scene";

const BODY_COLOR = 0xc94b2e;
const CABIN_COLOR = 0x20140e;
const HEADLIGHT_COLOR = 0xffe9a8;
const TAILLIGHT_COLOR = 0xff2a1a;
const WHEEL_RADIUS = 0.34;

export type CarMesh = {
  /** Whole-car group (positioned at world x/z, rolled/yawed by sim state). */
  root: THREE.Group;
  /** Body+cabin subgroup carrying roll and yaw only. */
  body: THREE.Group;
  wheels: THREE.Mesh[];
};

/**
 * Pooled car rig built once: hull box + cabin + 4 cylinder wheels + two
 * emissive headlight boxes with a SpotLight + beam fake per side + two red
 * tail-light boxes on the rear. update() mutates transforms only.
 */
export function createCarMesh(scene: THREE.Scene): CarMesh {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.55, 4.4),
    new THREE.MeshLambertMaterial({ color: BODY_COLOR }),
  );
  chassis.position.y = 0.55;
  chassis.castShadow = true; // real sun shadow (task 2.1) supersedes the blob read
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.45, 1.8),
    new THREE.MeshLambertMaterial({ color: CABIN_COLOR }),
  );
  cabin.position.set(0, 1.05, 0.2);
  cabin.castShadow = true;
  body.add(chassis, cabin);

  // ── Headlights (task 2.2) ────────────────────────────────────────────────
  // Emissive boxes on the nose, a real SpotLight per side tuned from
  // CONFIG.look.headlights (the D4-bounded real-light budget), and a subtle
  // additive crossed-quad beam fake per side (buildBeamCrossGeometry).
  const lampGeo = new THREE.BoxGeometry(0.34, 0.16, 0.08);
  const lampMat = new THREE.MeshBasicMaterial({ color: HEADLIGHT_COLOR });
  const hl = CONFIG.look.headlights;
  const beamLen = CONFIG.look.headBeam.length;
  // Beam geometry: trapezoid from the lamp housing out to the cone's full
  // spread at beamLength (matches the spotlight's cone angle).
  const beamGeo = buildBeamCrossGeometry(
    0.3,
    2 * Math.tan(THREE.MathUtils.degToRad(hl.angleDeg)) * beamLen,
    beamLen,
  );
  const beamMat = makeBeamMaterial(hl.color, CONFIG.look.headBeam.opacity);
  for (const sx of [-0.62, 0.62]) {
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(sx, 0.62, 2.24);
    body.add(lamp);
    const spot = new THREE.SpotLight(
      hl.color,
      hl.intensity,
      hl.range,
      THREE.MathUtils.degToRad(hl.angleDeg),
      hl.penumbra,
      hl.decay,
    );
    spot.position.set(sx, 0.62, 2.2);
    spot.target.position.set(sx * 2, -0.4, 30);
    body.add(spot, spot.target);
    // Beam fake hangs from the lamp, aimed like the spot (mostly +z with the
    // spot's slight downward pitch). Local -y is the beam axis, so the base
    // orientation maps -y → +z; the small +x rotation adds the downward tilt.
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(sx, 0.62, 2.24);
    beam.rotation.x =
      -Math.PI / 2 +
      Math.atan2(0.62 - -0.4, 30 - 2.2);
    body.add(beam);
  }

  // Tail lights: emissive red boxes on the rear face — the side the chase
  // camera sees — mirroring the headlamp offsets. MeshBasicMaterial ignores
  // scene lighting, so they read as lit at any sun angle.
  const tailMat = new THREE.MeshBasicMaterial({ color: TAILLIGHT_COLOR });
  for (const sx of [-0.62, 0.62]) {
    const tail = new THREE.Mesh(lampGeo, tailMat);
    tail.position.set(sx, 0.62, -2.24);
    body.add(tail);
  }

  // Wheels: cylinders tipped so their axis runs along x.
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.26, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14100c });
  const wheels: THREE.Mesh[] = [];
  for (const [wx, wz] of [
    [-0.95, 1.35],
    [0.95, 1.35],
    [-0.95, -1.45],
    [0.95, -1.45],
  ] as const) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, WHEEL_RADIUS, wz);
    wheel.castShadow = true;
    root.add(wheel);
    wheels.push(wheel);
  }

  // Blob shadow retired (task 2.1): the texel-snapped directional sun now
  // casts the car's contact shadow (spec: "distinct from any legacy
  // blob-shadow"), and the old disc double-darkened the shadow floor.

  scene.add(root);
  return { root, body, wheels };
}

/**
 * Per-frame binding: world placement from lateral x + traveled z; roll from
 * weight tilt, yaw from lateral velocity, spin from forward speed.
 */
export function updateCarMesh(
  mesh: CarMesh,
  car: CarState,
  carZ: number,
  _dt: number,
): void {
  mesh.root.position.set(car.x, 0, carZ);
  mesh.body.rotation.z = -car.tilt * 0.5;
  mesh.body.rotation.y = -car.vx * 0.02;
  const spin = (car.speed / WHEEL_RADIUS) * _dt;
  for (const w of mesh.wheels) w.rotateX(spin);
}
