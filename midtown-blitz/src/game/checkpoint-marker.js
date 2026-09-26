/**
 * Checkpoint world marker (Midtown Blitz game, task 5.3).
 *
 * The in-world half of the checkpoint guidance (race-events spec: "the
 * checkpoint itself SHALL be visually marked in the world … identifiable in
 * the world by its marker before the player reaches it" at any distance):
 * a tall thin light beam plus a flat ring/gate at the checkpoint's ground
 * position, in the UI's amber accent so the HUD and the world read as one
 * system.
 *
 * Always-visible-through-fog contract: both parts use additive-blended,
 * fog:false, depthWrite:false MeshBasicMaterials — the city fog cannot
 * swallow the marker, and it never occludes itself (additive glow, like the
 * lane-marking approach of keeping guidance graphics cheap and unlit).
 *
 * One marker instance serves the whole game: `set(position)` MOVES it to the
 * current target (or hides it with null); task 5.4's race machine and the
 * ?debug T test route in main.js both drive it that way. `update(dt, camera)`
 * runs the gentle pulse (ring scale + beam/ring opacity breathing) and fades
 * the marker out as the camera gets very close, so driving through the gate
 * does not white the screen out. Everything reuses preallocated geometry/
 * materials/vectors — no per-frame allocation.
 *
 * Draw cost: exactly 2 draws while visible, 0 while hidden (group.visible =
 * false skips the draw), so the boot draw-call budget is untouched until a
 * checkpoint is actually targeted.
 */

import * as THREE from 'three';

/** Beam height in m (tall enough to read over the roofs from any distance). */
const BEAM_HEIGHT_M = 140;

/** Beam radii in m (thin column, slightly wider at the base). */
const BEAM_RADIUS_TOP_M = 1.2;
const BEAM_RADIUS_BOTTOM_M = 2.2;

/** Ring/gate radius in m (spans roughly the road width). */
const RING_RADIUS_M = 7;
/** Ring tube thickness in m. */
const RING_TUBE_M = 0.45;
/** Ring height above the checkpoint's ground (m). */
const RING_Y_M = 1.1;

/** Marker accent (the UI amber). */
const MARKER_COLOR = 0xffd452;

/** Base (far) opacities the pulse breathes around. */
const BEAM_OPACITY = 0.2;
const RING_OPACITY = 0.85;

/** Pulse rates (rad/s) — slow, calm. */
const PULSE_RATE = 2.2;
/** Ring pulse scale amplitude. */
const PULSE_SCALE = 0.07;
/** Beam opacity pulse amplitude. */
const PULSE_BEAM = 0.07;
/** Ring opacity pulse amplitude. */
const PULSE_RING = 0.12;

/** Camera distance (m) below which the marker starts fading out. */
const FADE_NEAR_M = 16;
/** Camera distance (m) at/below which the marker is fully faded. */
const FADE_ZERO_M = 4;

/**
 * Handle for a created checkpoint marker.
 *
 * @typedef {object} CheckpointMarker
 * @property {THREE.Group} group The marker group (added to the scene,
 *   hidden until set()).
 * @property {(position: { x: number, y?: number, z: number } | null) => void} set
 *   Move the marker to a world position (y defaults to 0, road level) or
 *   hide it (null). Cheap — call on every checkpoint advance.
 * @property {(dt: number, camera: object) => void} update Per-frame pulse +
 *   near-fade (camera needs only `position`; wall-clock cosmetic — safe to
 *   skip while the sim is frozen).
 * @property {() => boolean} isVisible Whether the marker is currently shown.
 */

/**
 * Create the checkpoint marker and add it to the scene (hidden).
 * @param {THREE.Scene} scene Scene to add the marker group to.
 * @returns {CheckpointMarker} The marker handle.
 */
export function createCheckpointMarker(scene) {
  const group = new THREE.Group();
  group.visible = false;

  // Light beam: tall thin open-ended cylinder, additive so it glows over
  // everything without depth-writing.
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: MARKER_COLOR,
    transparent: true,
    opacity: BEAM_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(BEAM_RADIUS_TOP_M, BEAM_RADIUS_BOTTOM_M, BEAM_HEIGHT_M, 10, 1, true),
    beamMaterial
  );
  beam.position.y = BEAM_HEIGHT_M / 2;
  group.add(beam);

  // Ring/gate: flat torus lying on the road at the checkpoint.
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: MARKER_COLOR,
    transparent: true,
    opacity: RING_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS_M, RING_TUBE_M, 8, 40),
    ringMaterial
  );
  ring.rotation.x = -Math.PI / 2; // lie flat in the x/z plane
  ring.position.y = RING_Y_M;
  group.add(ring);

  scene.add(group);

  let pulsePhase = 0;
  /** @type {THREE.Vector3} */
  const toCamera = new THREE.Vector3();

  /** @type {CheckpointMarker} */
  const marker = {
    group,

    /**
     * Move the marker to a world position (or hide it).
     * @param {{ x: number, y?: number, z: number } | null} position Target
     *   ground position, or null to hide.
     * @returns {void}
     */
    set(position) {
      if (!position || typeof position.x !== 'number' || typeof position.z !== 'number') {
        group.visible = false;
        return;
      }
      group.position.set(position.x, position.y ?? 0, position.z);
      group.visible = true;
    },

    /**
     * Per-frame pulse + near-camera fade (cosmetic; wall-clock dt).
     * @param {number} dt Frame delta in seconds.
     * @param {{ position: THREE.Vector3 }} camera Camera (position read).
     * @returns {void}
     */
    update(dt, camera) {
      if (!group.visible) return;
      pulsePhase += dt * PULSE_RATE;
      const wobble = 0.5 + 0.5 * Math.sin(pulsePhase);
      ring.scale.setScalar(1 + PULSE_SCALE * Math.sin(pulsePhase));
      // Near fade: as the camera closes in, fade both parts so driving
      // through the gate never blows out the screen.
      toCamera.subVectors(camera.position, group.position);
      const d = toCamera.length();
      const near = Math.min(1, Math.max(0, (d - FADE_ZERO_M) / (FADE_NEAR_M - FADE_ZERO_M)));
      beamMaterial.opacity = (BEAM_OPACITY + PULSE_BEAM * wobble) * near;
      ringMaterial.opacity = (RING_OPACITY - PULSE_RING * wobble) * near;
    },

    /** @returns {boolean} Whether the marker is shown. */
    isVisible() {
      return group.visible;
    },
  };

  return marker;
}
