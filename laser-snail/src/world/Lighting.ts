import * as THREE from 'three';

import { AMBIENT_INTENSITY, CYAN_INTENSITY, KEY_INTENSITY, MAGENTA_INTENSITY, RIM_INTENSITY } from '../render/tuning';

/**
 * Phase-0 lighting rig tuned for emissive neon on a dark background:
 * a soft ambient fill, a cool key light, cyan and magenta point accents from
 * either side, and a faint blue back light for rim separation.
 */
export function createLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighting';

  const ambient = new THREE.AmbientLight(0x2a3550, AMBIENT_INTENSITY);
  ambient.name = 'ambient-fill';

  const key = new THREE.DirectionalLight(0xbfd4ff, KEY_INTENSITY);
  key.name = 'key-light';
  key.position.set(4, 7, 4);

  const cyanAccent = new THREE.PointLight(0x36e6ff, CYAN_INTENSITY, 0, 2);
  cyanAccent.name = 'cyan-accent';
  cyanAccent.position.set(-3.5, 2, 3);

  const magentaAccent = new THREE.PointLight(0xff4fd8, MAGENTA_INTENSITY, 0, 2);
  magentaAccent.name = 'magenta-accent';
  magentaAccent.position.set(3.5, -0.5, 2.5);

  const backRim = new THREE.PointLight(0x88aaff, RIM_INTENSITY, 0, 2);
  backRim.name = 'back-rim';
  backRim.position.set(0, 3, -4);

  group.add(ambient, key, cyanAccent, magentaAccent, backRim);
  return group;
}
