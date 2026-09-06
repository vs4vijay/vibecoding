import * as THREE from "three";
import type { CarState } from "../game/car";

const BODY_COLOR = 0xb3341f;
const CABIN_COLOR = 0x20140e;
const HEADLIGHT_COLOR = 0xffe9a8;
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
 * emissive headlight boxes with a SpotLight per side + blob shadow disc.
 * update() mutates transforms only.
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
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.45, 1.8),
    new THREE.MeshLambertMaterial({ color: CABIN_COLOR }),
  );
  cabin.position.set(0, 1.05, 0.2);
  body.add(chassis, cabin);

  // Headlights: emissive boxes on the nose plus a real SpotLight per side.
  const lampGeo = new THREE.BoxGeometry(0.34, 0.16, 0.08);
  const lampMat = new THREE.MeshBasicMaterial({ color: HEADLIGHT_COLOR });
  for (const sx of [-0.62, 0.62]) {
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(sx, 0.62, 2.24);
    body.add(lamp);
    const spot = new THREE.SpotLight(HEADLIGHT_COLOR, 2.2, 40, 0.5, 0.45, 1.4);
    spot.position.set(sx, 0.62, 2.2);
    spot.target.position.set(sx * 2, -0.4, 30);
    body.add(spot, spot.target);
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
    root.add(wheel);
    wheels.push(wheel);
  }

  // Blob shadow: flat dark disc under the hull, slightly above the road.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.3, 20),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

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
