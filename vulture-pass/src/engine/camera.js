// High-angle perspective follow camera (D3) with velocity look-ahead and a
// screen→ground unproject helper for mouse aim.

import * as THREE from 'three';

export function createFollowCamera(opts = {}) {
  const {
    fov = 55,
    pitchDeg = 75,
    distance = 17, // horizontal offset behind the car
    height = 34, // vertical offset above the car
    lookAhead = 0.65,
    lookAheadMax = 14,
    followLerp = 6.5,
    near = 0.1,
    far = 600,
  } = opts;

  const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, near, far);

  const followPoint = new THREE.Vector3();
  const lookPoint = new THREE.Vector3();
  const behindDir = new THREE.Vector3(0, 0, 1); // smoothed horizontal "behind" direction
  const tmpLA = new THREE.Vector3();
  let primed = false;

  // Track a moving object. `heading` and `velocity` are plain {x, z} objects
  // (horizontal vectors); heading drives the behind-bias, velocity the
  // look-ahead.
  function follow(pos, heading, velocity, dt) {
    if (!primed) {
      followPoint.copy(pos);
      lookPoint.copy(pos);
      primed = true;
    }
    const k = 1 - Math.exp(-followLerp * dt);
    followPoint.lerp(pos, k);

    const vx = velocity?.x ?? 0;
    const vz = velocity?.z ?? 0;
    tmpLA.set(vx * lookAhead, 0, vz * lookAhead);
    if (tmpLA.length() > lookAheadMax) tmpLA.setLength(lookAheadMax);
    tmpLA.add(pos);
    lookPoint.lerp(tmpLA, k);

    const hx = heading?.x ?? 0;
    const hz = heading?.z ?? 0;
    const hLenSq = hx * hx + hz * hz;
    if (hLenSq > 0.001) {
      const inv = 1 / Math.sqrt(hLenSq);
      // ease the behind-direction toward the car's facing (manual lerp — inputs are plain objects)
      const t = Math.min(1, k * 1.4);
      behindDir.x += (hx * inv - behindDir.x) * t;
      behindDir.z += (hz * inv - behindDir.z) * t;
      const bLen = Math.hypot(behindDir.x, behindDir.z) || 1;
      behindDir.x /= bLen;
      behindDir.z /= bLen;
      behindDir.y = 0;
    }

    camera.position.set(
      followPoint.x - behindDir.x * distance,
      followPoint.y + height,
      followPoint.z - behindDir.z * distance
    );
    camera.lookAt(lookPoint);
  }

  function snapTo(pos, heading = null) {
    primed = false;
    if (heading) {
      const hx = heading.x ?? 0;
      const hz = heading.z ?? 0;
      const len = Math.hypot(hx, hz) || 1;
      behindDir.set(hx / len, 0, hz / len);
    }
    follow(pos, heading, { x: 0, z: 0 }, 1);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  // Unproject client-pixel coordinates onto the y=0 ground plane.
  function screenToGround(clientX, clientY, out = new THREE.Vector3()) {
    ndc.x = (clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    out.copy(ray.origin).addScaledVector(ray.direction, t);
    return out;
  }

  return { camera, follow, snapTo, resize, screenToGround, pitchDeg };
}
