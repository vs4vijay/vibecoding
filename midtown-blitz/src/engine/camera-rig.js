/**
 * Smoothed chase-camera rig (Midtown Blitz engine, task 1.5).
 *
 * Game-agnostic camera-follow machinery for the vehicle-control spec's
 * camera requirement: a smoothed chase view behind + above the target by
 * default, plus at least two view modes switched by the camera-cycle input.
 * The car task (3.2) wires this rig to the real car; this module knows
 * nothing about cars.
 *
 * How it follows: every `update(dt)` the rig computes the current mode's
 * ideal camera position and look-at point from the target's world position
 * + orientation, then moves the camera a frame-rate-independent exponential
 * fraction of the remaining error toward them
 * (`k = 1 - exp(-stiffness * dt)` — a low-pass filter, so the response
 * converges smoothly with no overshoot and identical behavior at any tick
 * or frame rate). Mode switches are deliberate cuts: the rig snaps to the
 * new mode's pose instantly (damping through the car body would look
 * broken), while target *following* is always smoothed.
 *
 * Convention: the target's local +Z axis is "forward" (three's convention
 * for generic Object3Ds and glTF models — `Object3D.getWorldDirection`
 * returns +Z; cameras override it to -Z). Mode offsets are data, so other
 * conventions or extra views are a config change, not a code change.
 *
 * Like loop.js (`frame(nowMs)`) and input.js (`handleKeyDown`), `update`
 * takes dt as a parameter and reads only plain three math — a plain-node
 * harness drives it against real THREE.Object3D/PerspectiveCamera without
 * a browser or renderer.
 */

import * as THREE from 'three';

/** Clamp applied to update()'s dt (negative/zero dt is ignored outright). */
const MAX_DT_S = 0.25;

/**
 * Exponential damping rate (1/s) for the camera *position*: higher snaps
 * tighter. 8 keeps the steady-state trail behind a cornering target to
 * roughly speed/stiffness (~1.5 m at 13 m/s) while still reading as a
 * smoothed follow rather than a welded-on camera.
 */
const DEFAULT_FOLLOW_STIFFNESS = 8;

/**
 * Damping rate for the look-at *point*: kept higher than the position so
 * the view direction settles faster than the framing (no jelly aiming).
 */
const DEFAULT_LOOK_STIFFNESS = 10;

/**
 * Built-in mode definitions: local-space offsets from the target, rotated
 * by the target's world orientation. `position` is where the camera wants
 * to be; `look` is the point it aims at. Both are offsets in target-local
 * meters (+Z = target forward, +Y = up).
 */
const BUILTIN_MODE_DEFS = Object.freeze({
  /** Classic chase view: behind and above, looking a little ahead. */
  chase: Object.freeze({
    position: Object.freeze(new THREE.Vector3(0, 3.2, -7.5)),
    look: Object.freeze(new THREE.Vector3(0, 1.4, 6)),
  }),
  /** Bonnet/hood view: close to the nose, looking far down the road. */
  hood: Object.freeze({
    position: Object.freeze(new THREE.Vector3(0, 1.5, 1.15)),
    look: Object.freeze(new THREE.Vector3(0, 1.25, 30)),
  }),
});

/**
 * A camera view mode: where the camera sits and what it aims at, in
 * target-local space (meters, +Z forward, +Y up).
 *
 * @typedef {object} CameraModeDef
 * @property {THREE.Vector3} position Offset from the target to the camera.
 * @property {THREE.Vector3} look Offset from the target to the aim point.
 */

/**
 * Handle for a created camera rig.
 *
 * @typedef {object} CameraRig
 * @property {(target: object | (() => object | null)) => void} setTarget
 *   Set the follow target: an Object3D or a getter returning one (getter
 *   form lets the game swap cars without re-creating the rig; null disables
 *   following and update() becomes a no-op).
 * @property {() => object | null} getTarget The current target (or null).
 * @property {() => string} getMode Current mode name.
 * @property {() => string[]} getModes All mode names, in cycle order.
 * @property {(name: string) => string} setMode Switch to a named mode
 *   (snaps to its pose) and return the name; throws on unknown names.
 * @property {() => string} cycleMode Advance to the next mode (wrapping),
 *   snap to it, and return the new mode name — the `camera` input's
 *   handler.
 * @property {(dt: number) => void} update Advance the smoothing toward the
 *   current ideal pose. Call once per frame (real frame delta) or per sim
 *   tick (fixed dt); dt <= 0 or non-finite dt is ignored. The very first
 *   update snaps instead of lerping so the rig starts framed.
 * @property {() => void} snap Jump the camera to the current ideal pose
 *   immediately (mode switches, teleports, sim resets).
 * @property {() => { position: THREE.Vector3, look: THREE.Vector3 }} getDesiredPose
 *   Diagnostic: the current mode's ideal camera position and look-at point
 *   in world space (fresh vectors; also handy for camera-shake offsets).
 */

/**
 * Create a smoothed chase-camera rig driving `camera`.
 *
 * @param {THREE.PerspectiveCamera} camera Camera the rig moves (position +
 *   look-at only; fov/aspect stay the caller's).
 * @param {object} [options] Configuration.
 * @param {string[]} [options.modes=['chase','hood']] Mode names in cycle
 *   order; every name must exist in the mode definitions.
 * @param {Record<string, CameraModeDef>} [options.modeDefs] Extra/override
 *   mode definitions merged over the built-ins (lets the car task add e.g.
 *   a cinematic orbit without touching this module).
 * @param {number} [options.followStiffness=8] Damping rate (1/s) for the
 *   camera position; higher = tighter follow. Steady-state trail behind a
 *   moving target is roughly speed / stiffness meters.
 * @param {number} [options.lookStiffness=10] Damping rate (1/s) for the
 *   look-at point; higher = faster aiming.
 * @returns {CameraRig} The rig handle.
 * @throws {TypeError} If modes is empty or names a mode without a
 *   definition.
 */
export function createCameraRig(
  camera,
  {
    modes = ['chase', 'hood'],
    modeDefs = {},
    followStiffness = DEFAULT_FOLLOW_STIFFNESS,
    lookStiffness = DEFAULT_LOOK_STIFFNESS,
  } = {}
) {
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new TypeError('createCameraRig: at least one camera mode is required');
  }
  const defs = { ...BUILTIN_MODE_DEFS, ...modeDefs };
  for (const name of modes) {
    if (!defs[name]) {
      throw new TypeError(`createCameraRig: mode "${name}" has no definition`);
    }
  }

  /** @type {(() => object | null) | null} Target getter (null until set). */
  let targetGetter = null;
  let modeIndex = 0;
  let initialized = false;

  // Smoothed state (the rig's memory between frames).
  const camPos = new THREE.Vector3();
  const lookPos = new THREE.Vector3();

  // Scratch vectors: per-rig so multiple rigs never alias each other.
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();

  /**
   * Compute the current mode's ideal world-space pose for the target's
   * current world transform.
   * @param {object} target THREE.Object3D-like follow target.
   * @returns {void} Writes desiredPos/desiredLook scratch vectors.
   */
  function computeDesired(target) {
    target.getWorldPosition(targetPos);
    target.getWorldQuaternion(targetQuat);
    const def = defs[modes[modeIndex]];
    desiredPos.copy(def.position).applyQuaternion(targetQuat).add(targetPos);
    desiredLook.copy(def.look).applyQuaternion(targetQuat).add(targetPos);
  }

  /**
   * Place the camera exactly on the desired pose (also arms smoothing).
   * @returns {void}
   */
  function snap() {
    const target = targetGetter ? targetGetter() : null;
    if (!target) return;
    computeDesired(target);
    camPos.copy(desiredPos);
    lookPos.copy(desiredLook);
    camera.position.copy(camPos);
    camera.lookAt(lookPos);
    initialized = true;
  }

  return {
    setTarget(target) {
      if (typeof target === 'function') {
        targetGetter = target;
      } else if (target && target.isObject3D) {
        targetGetter = () => target;
      } else {
        throw new TypeError(
          'cameraRig.setTarget: expected an Object3D or a getter returning one'
        );
      }
      initialized = false; // next update snaps to the new target
    },

    getTarget() {
      return targetGetter ? targetGetter() : null;
    },

    getMode() {
      return modes[modeIndex];
    },

    getModes() {
      return modes.slice();
    },

    setMode(name) {
      const index = modes.indexOf(name);
      if (index === -1) {
        throw new TypeError(
          `cameraRig.setMode: unknown mode ${JSON.stringify(name)}; available: ${modes.join(', ')}`
        );
      }
      modeIndex = index;
      snap(); // mode switches are cuts, not lerps (see module header)
      return modes[modeIndex];
    },

    cycleMode() {
      modeIndex = (modeIndex + 1) % modes.length;
      snap();
      return modes[modeIndex];
    },

    update(dt) {
      const target = targetGetter ? targetGetter() : null;
      if (!target) return;
      if (!initialized) {
        snap();
        return;
      }
      if (!Number.isFinite(dt) || dt <= 0) return; // no time -> no motion
      const dtClamped = Math.min(dt, MAX_DT_S);
      computeDesired(target);
      const kPos = 1 - Math.exp(-followStiffness * dtClamped);
      const kLook = 1 - Math.exp(-lookStiffness * dtClamped);
      camPos.lerp(desiredPos, kPos);
      lookPos.lerp(desiredLook, kLook);
      camera.position.copy(camPos);
      camera.lookAt(lookPos);
    },

    snap,

    getDesiredPose() {
      const target = targetGetter ? targetGetter() : null;
      const pose = { position: new THREE.Vector3(), look: new THREE.Vector3() };
      if (!target) return pose;
      computeDesired(target);
      pose.position.copy(desiredPos);
      pose.look.copy(desiredLook);
      return pose;
    },
  };
}
