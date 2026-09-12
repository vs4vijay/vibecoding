// src/render3d/CameraRig.ts — cinematic camera: eased follow with look-ahead,
// trauma shake, dolly pulses, and a slow diorama pan for the title screen.
//
// Framing contract: the whole 20x13 playfield must stay in frame during play,
// so the camera distance is aspect-aware — the larger of the height fit
// (13 units + letterbox headroom) and the width fit (20 units + headroom).
// Menu mode dollies in (~0.6x) and pans slowly across the level, cropping
// into the world like a diorama.
import * as THREE from "three";
import { TILE, worldTo3D } from "./palette";

const FOV = 40;
const TAN_HALF_FOV = Math.tan(((FOV / 2) * Math.PI) / 180);
const HEADROOM_H = 1.2; // cinematic letterbox headroom beyond the playfield
const HEADROOM_W = 1.0;
const MENU_DIST_SCALE = 0.6; // menu diorama distance, relative to the fit distance
const FOLLOW_DAMP = 5; // exp ease rate for the look target
const VEL_DAMP = 8; // exp ease rate for the look-ahead velocity
const LEAD_TIME = 0.24; // seconds of velocity look-ahead
const LEAD_MAX_X = 1.2;
const LEAD_MAX_Y = 0.8;
const MENU_DAMP = 2.2; // menu blend ease rate (both transitions)
const SHAKE_DECAY = 1.4; // trauma units per second after the hold elapses
const PULSE_DECAY = 6.5; // dolly pulse decay rate

// Playfield bounds in world units via the shared palette mapping (y flips up).
const WORLD = (() => {
  const a = worldTo3D(0, 0); // top-left
  const b = worldTo3D(20 * TILE, 13 * TILE); // bottom-right
  return {
    loX: Math.min(a.x, b.x),
    hiX: Math.max(a.x, b.x),
    loY: Math.min(a.y, b.y),
    hiY: Math.max(a.y, b.y),
  };
})();

/** Deterministic perlin-ish 1D noise: layered incommensurate sines in [-1, 1]. */
function noise1(t: number, seed: number): number {
  return (
    Math.sin(t * 1.7 + seed) * 0.55 +
    Math.sin(t * 3.9 + seed * 2.1) * 0.3 +
    Math.sin(t * 7.3 + seed * 4.7) * 0.15
  );
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private aspect: number;
  private distFit: number; // distance at which the full playfield fits
  private dist: number; // eased distance
  private goal = new THREE.Vector3(); // latest follow target
  private cur = new THREE.Vector3(); // eased look target
  private velX = 0;
  private velY = 0; // smoothed world velocity (u/s) feeding the lead
  private leadX = 0;
  private leadY = 0; // eased look-ahead offset
  private trauma = 0;
  private shakeHold = 0;
  private pulseAmt = 0;
  private menuOn = false;
  private menuBlend = 0;

  constructor(aspect = 16 / 10) {
    this.aspect = aspect;
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 120);
    this.distFit = this.fitDistance();
    this.dist = this.distFit;
    this.goal.set((WORLD.loX + WORLD.hiX) / 2, (WORLD.loY + WORLD.hiY) / 2, 0);
    this.cur.copy(this.goal);
  }

  /** Distance at which the whole playfield fits the current aspect. */
  private fitDistance(): number {
    const halfH = (WORLD.hiY - WORLD.loY) / 2 + HEADROOM_H / 2;
    const halfW = (WORLD.hiX - WORLD.loX) / 2 + HEADROOM_W / 2;
    return Math.max(halfH / TAN_HALF_FOV, halfW / (TAN_HALF_FOV * this.aspect));
  }

  /** Wide view: keep the world fully in frame (headroom spills past edges).
   *  Cropped view: keep the camera inside the world. One clamp handles both. */
  private clampAxis(v: number, half: number, lo: number, hi: number): number {
    const a = lo + half;
    const b = hi - half;
    return clamp(v, Math.min(a, b), Math.max(a, b));
  }

  /** Ease toward framing `target` (world coords). velX/velY is Dave's velocity
   *  in world units/s (sim px/tick * 60 / TILE) and drives the look-ahead. */
  follow(target: THREE.Vector3, dt: number, velX = 0, velY = 0): void {
    this.goal.set(target.x, target.y, 0);
    const k = 1 - Math.exp(-Math.max(dt, 0) * VEL_DAMP);
    this.velX += (velX - this.velX) * k;
    this.velY += (velY - this.velY) * k;
  }

  /** Trauma shake: intensity held for `duration`, then eased back to zero. */
  shake(intensity: number, duration = 0.3): void {
    this.trauma = Math.max(this.trauma, clamp(intensity, 0, 1));
    this.shakeHold = Math.max(this.shakeHold, Math.max(duration, 0));
  }

  /** Quick dolly-in pulse (door open, collect, warp). */
  pulse(amount: number): void {
    this.pulseAmt = Math.max(this.pulseAmt, Math.max(amount, 0));
  }

  /** Title screen: slow pan across the level at a closer diorama distance.
   *  Transitions ease both ways via the menu blend inside update(). */
  setMenuMode(on: boolean, _time: number): void {
    this.menuOn = on;
  }

  update(dt: number, time: number): void {
    const d = clamp(dt, 0, 0.1);

    this.menuBlend += ((this.menuOn ? 1 : 0) - this.menuBlend) * (1 - Math.exp(-d * MENU_DAMP));
    if (this.menuBlend < 0.0005 && !this.menuOn) this.menuBlend = 0;
    if (this.menuBlend > 0.9995 && this.menuOn) this.menuBlend = 1;

    // distance: full-fit in play, closer diorama in menu; pulse dollies in
    const distTarget = this.distFit * (1 - (1 - MENU_DIST_SCALE) * this.menuBlend);
    this.dist += (distTarget - this.dist) * (1 - Math.exp(-d * 3));
    this.pulseAmt *= Math.exp(-d * PULSE_DECAY);
    if (this.pulseAmt < 0.0002) this.pulseAmt = 0;
    const distEff = this.dist * (1 - this.pulseAmt);
    const halfH = distEff * TAN_HALF_FOV;
    const halfW = halfH * this.aspect;

    // goal: blend the follow target toward the menu pan path
    const panX = (WORLD.loX + WORLD.hiX) / 2 + Math.sin(time * 0.13 + 0.4) * 3.4;
    const panY = (WORLD.loY + WORLD.hiY) / 2 + Math.sin(time * 0.083 + 1.9) * 2.1;
    const gx = this.goal.x + (panX - this.goal.x) * this.menuBlend;
    const gy = this.goal.y + (panY - this.goal.y) * this.menuBlend;

    this.cur.x += (gx - this.cur.x) * (1 - Math.exp(-d * FOLLOW_DAMP));
    this.cur.y += (gy - this.cur.y) * (1 - Math.exp(-d * FOLLOW_DAMP));

    // look-ahead lead (fades out in menu), eased separately for weight
    const leadScale = (1 - this.menuBlend) * LEAD_TIME;
    const leadTargetX = clamp(this.velX * leadScale, -LEAD_MAX_X, LEAD_MAX_X);
    const leadTargetY = clamp(this.velY * leadScale, -LEAD_MAX_Y, LEAD_MAX_Y);
    const kLead = 1 - Math.exp(-d * FOLLOW_DAMP * 0.8);
    this.leadX += (leadTargetX - this.leadX) * kLead;
    this.leadY += (leadTargetY - this.leadY) * kLead;

    const cx = this.clampAxis(this.cur.x + this.leadX, halfW, WORLD.loX, WORLD.hiX);
    const cy = this.clampAxis(this.cur.y + this.leadY, halfH, WORLD.loY, WORLD.hiY);

    // trauma shake: multi-sine noise scaled by trauma^2, position + rotation
    if (this.shakeHold > 0) this.shakeHold -= d;
    else this.trauma = Math.max(0, this.trauma - d * SHAKE_DECAY);
    const amp = this.trauma * this.trauma;
    const sx = amp * 0.42 * noise1(time * 29, 0.7);
    const sy = amp * 0.3 * noise1(time * 33, 3.1);
    const sz = amp * 0.2 * noise1(time * 24, 5.3);

    const cam = this.camera;
    cam.position.set(cx + sx, cy + 0.35 + sy, distEff + sz);
    cam.lookAt(cx + sx * 0.4, cy + sy * 0.4, 0);
    cam.rotation.z += amp * 0.02 * noise1(time * 37, 11.4);
    cam.rotation.x += amp * 0.012 * noise1(time * 31, 8.8);
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.distFit = this.fitDistance();
    this.camera.updateProjectionMatrix();
  }

  /** No listeners owned; resets transient motion so a re-attached rig is calm. */
  dispose(): void {
    this.trauma = 0;
    this.shakeHold = 0;
    this.pulseAmt = 0;
    this.menuOn = false;
    this.velX = 0;
    this.velY = 0;
    this.leadX = 0;
    this.leadY = 0;
  }
}
