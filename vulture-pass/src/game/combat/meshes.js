// Car + prop meshes built from three primitives with palette-locked colors
// (D11 — no modelling pipeline, silhouettes over detail).

import * as THREE from 'three';
import { palette } from '../data/palette.js';

const geoCache = new Map();
function box(w, h, d, color) {
  const key = `box${w},${h},${d},${color}`;
  if (!geoCache.has(key)) {
    geoCache.set(key, [
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }),
    ]);
  }
  const [g, m] = geoCache.get(key);
  return new THREE.Mesh(g, m);
}

function cyl(r, h, color, seg = 10) {
  const key = `cyl${r},${h},${color},${seg}`;
  if (!geoCache.has(key)) {
    geoCache.set(
      key,
      [new THREE.CylinderGeometry(r, r, h, seg), new THREE.MeshLambertMaterial({ color })]
    );
  }
  const [g, m] = geoCache.get(key);
  return new THREE.Mesh(g, m);
}

const shadowMat = new THREE.MeshBasicMaterial({ color: palette.shadow, transparent: true, opacity: 0.3 });

// A car group faces +x when heading = 0. Wheels spin with speed; front wheels
// yaw with steer. Mount stubs mark left/right weapon positions.
export function buildCarMesh({ body, stripe = null, scale = 1 }) {
  const g = new THREE.Group();

  const chassis = box(4.4 * scale, 0.9, 2.1 * scale, body);
  chassis.position.y = 0.75;
  g.add(chassis);

  const cabin = box(1.9 * scale, 0.8, 1.7 * scale, palette.burnt);
  cabin.position.set(-0.3 * scale, 1.55, 0);
  g.add(cabin);

  const hoodStripe = box(2.2 * scale, 0.08, 0.55 * scale, stripe ?? palette.roofRust);
  hoodStripe.position.set(1.5 * scale, 1.22, 0);
  g.add(hoodStripe);

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: palette.burnt });
  const hubMat = new THREE.MeshLambertMaterial({ color: palette.rockDark });
  for (const [wx, wz, front] of [
    [1.4 * scale, 1.05 * scale, 1],
    [1.4 * scale, -1.05 * scale, 1],
    [-1.4 * scale, 1.05 * scale, 0],
    [-1.4 * scale, -1.05 * scale, 0],
  ]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, wheelMat);
    tire.rotation.z = Math.PI / 2; // spin around z (car-local lateral axis)
    const hub = cyl(0.28, 0.46, palette.rockDark);
    hub.rotation.z = Math.PI / 2;
    w.add(tire);
    w.add(hub);
    w.position.set(wx, 0.55, wz);
    g.add(w);
    wheels.push({ group: w, tire, front: !!front });
  }

  // mount stubs: left is -z side, right is +z (car faces +x)
  const mountL = box(0.9, 0.35, 0.5, palette.wood);
  mountL.position.set(0.4, 1.35, -1.25 * scale);
  g.add(mountL);
  const mountR = mountL.clone();
  mountR.position.z = 1.25 * scale;
  g.add(mountR);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.4 * scale, 18), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  g.add(shadow);

  return { group: g, wheels, mounts: { left: mountL, right: mountR } };
}

export function buildRockMesh(w, d, color = palette.rock) {
  const g = new THREE.Group();
  const r = box(w, w * 0.6, d, color);
  r.position.y = w * 0.3;
  r.rotation.y = (w * 7 + d * 13) % Math.PI; // deterministic-ish variation
  g.add(r);
  const cap = box(w * 0.6, w * 0.3, d * 0.6, palette.rockDark);
  cap.position.y = w * 0.72;
  g.add(cap);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(Math.max(w, d) * 0.7, 14), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  g.add(shadow);
  return g;
}

export function buildScrubMesh() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const arm = cyl(0.12, 0.9, palette.scrub, 6);
    arm.position.set((i - 1) * 0.25, 0.45, i * 0.14 - 0.14);
    arm.rotation.z = (i - 1) * 0.45;
    g.add(arm);
  }
  return g;
}

// Floating health bar (billboard-ish: lies flat, readable from the high cam).
export function buildHealthBar(scale = 1) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4 * scale, 0.42),
    new THREE.MeshBasicMaterial({ color: palette.shadow, transparent: true, opacity: 0.75, depthWrite: false })
  );
  bg.rotation.x = -Math.PI / 2;
  g.add(bg);
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2 * scale, 0.26),
    new THREE.MeshBasicMaterial({ color: '#c0492f', depthWrite: false })
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.02;
  // anchor left so it drains right-to-left
  fill.geometry.translate(1.6 * scale, 0, 0);
  fill.position.x = -1.6 * scale;
  g.add(fill);
  g.position.y = 3.1;
  return { group: g, fill, bg };
}

export const burntMat = new THREE.MeshLambertMaterial({ color: palette.burnt });
