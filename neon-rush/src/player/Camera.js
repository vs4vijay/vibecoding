// Smooth-follow camera behind the player, lead in movement direction,
// FOV 60→75 with speed, trauma-decay shake, phase dolly hook.
// Updated in the FIXED step (so warp() lands correct), applied at render.
//
// Death-cam hold (r1b): the Feel.js 2 s replay/dolly owns the camera while it
// runs, but the framing it HANDS BACK renders for the whole WRECKED screen
// through apply(). We ease that held pose into a rule-of-thirds crane: higher,
// pulled left, wreck clear of the centered UI, with a slow cinematic drift.
// Photo mode snaps straight to the refined frame (deterministic screenshots).
// Camera-only — no gameplay behavior is touched.
import { Vector3 } from 'three';
import { bus } from '../core/EventBus.js';

const DESIRED = new Vector3();
const LOOK = new Vector3();
const damp = (a, b, k, dt) => a + (b - a) * Math.min(1, k * dt);
const PHOTO_DEATH = typeof location !== 'undefined' &&
  location.search.indexOf('photo=death') >= 0;

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.pos = new Vector3(0, 4.4, 7.6);
    this.look = new Vector3(0, 1.6, -6);
    this.fov = 60;
    this.fovApplied = 60;
    this.trauma = 0;
    this.fovKick = 0;
    this.t = 0;
    this.menuSway = 0;
    // death-cam hold state: -1 inactive, else seconds since death
    this.deathT = -1;
    this._dcLast = 0;
    this._dcFast = false;
    bus.on('death', () => { this.deathT = 0; this._dcFast = PHOTO_DEATH; this._dcLast = 0; });
    bus.on('run:start', () => { this.deathT = -1; });
    bus.on('ui:screen', (s) => { if (s === 'menu') this.deathT = -1; });
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  // 1.5 s phase-transition dolly hook (cinematics come later).
  phaseDolly() {
    this.fovKick = 9;
    this.shake(0.22);
  }

  snap(ctx) {
    this.update(1 / 60, ctx);
    this.update(1 / 60, ctx);
    this.trauma = 0;
    this.apply();
  }

  update(dt, ctx) {
    this.t += dt;
    const p = ctx.player;
    const speed = ctx.speed;

    if (ctx.menuMode) {
      // attract mode: slow sway around the runner
      this.menuSway += dt;
      DESIRED.set(Math.sin(this.menuSway * 0.4) * 2.4, 4.7 + Math.sin(this.menuSway * 0.23) * 0.5, 8.6);
      LOOK.set(p.x * 0.4, 1.35, -8);
      this.fov = damp(this.fov, 58, 3, dt);
    } else {
      const hint = ctx.phase && ctx.phase.cameraHint;
      const baseFov = hint ? hint.fov : 60;
      const dist = (hint ? hint.dist : 7.6) + Math.max(0, speed - 12) * 0.035;
      // r6: follow/look lateral gains are per-phase (visual framing only).
      // Wide-field phases (hopper's ±9.4 grid) set small gains so the camera
      // stays ANCHORED on the playfield instead of swinging the world across
      // the frame — full 1.25× lateral follow put half the frame off-field.
      const followX = hint && hint.followX != null ? hint.followX : 0.82;
      const lookX = hint && hint.lookX != null ? hint.lookX : 1.25;
      const height = (hint ? hint.height : 4.4) + p.y * 0.3;
      DESIRED.set(p.x * followX, height, dist);
      LOOK.set(p.x * lookX, 1.6 + p.y * 0.55, -6);
      const targetFov = baseFov + (speed - 12) / 28 * 15; // 60 → 75
      this.fov = damp(this.fov, targetFov, 4, dt);
    }

    const kPos = ctx.menuMode ? 3 : 11;
    this.pos.x = damp(this.pos.x, DESIRED.x, kPos, dt);
    this.pos.y = damp(this.pos.y, DESIRED.y, kPos, dt);
    this.pos.z = damp(this.pos.z, DESIRED.z, kPos, dt);
    this.look.x = damp(this.look.x, LOOK.x, kPos + 2, dt);
    this.look.y = damp(this.look.y, LOOK.y, kPos + 2, dt);
    this.look.z = damp(this.look.z, LOOK.z, kPos + 2, dt);

    this.fovKick *= Math.exp(-3 * dt);
    this.trauma = Math.max(0, this.trauma - 1.6 * dt);
  }

  apply() {
    // death-cam hold: refine the framing the dolly handed back (see header).
    // Runs before the pose write below; while Feel's cinematic is still active
    // it simply overwrites the camera, so this only takes over at handover.
    if (this.deathT >= 0) {
      const now = performance.now() / 1000;
      if (!this._dcLast) this._dcLast = now;
      const dtr = Math.min(0.1, Math.max(0, now - this._dcLast));
      this._dcLast = now;
      this.deathT += dtr;
      // target offset from the held look anchor: crane up + slide left so the
      // wreck sits on the right third, clear of the centered WRECKED UI
      const tx = -3.0 + Math.sin(now * 0.21) * 0.55;
      const ty = 2.9 + Math.sin(now * 0.16 + 1.3) * 0.28;
      const tz = 5.4;
      const ox = this.pos.x - this.look.x, oy = this.pos.y - this.look.y, oz = this.pos.z - this.look.z;
      const k = this._dcFast ? 1 : Math.min(1, 1.5 * dtr); // photo snaps, live eases
      this.pos.set(
        this.look.x + (ox + (tx - ox) * k),
        this.look.y + (oy + (ty - oy) * k),
        this.look.z + (oz + (tz - oz) * k),
      );
    }
    const t2 = this.trauma * this.trauma;
    const s = this.t * 91;
    const sx = (Math.sin(s * 1.1) + Math.sin(s * 2.3 + 1.7)) * 0.5 * t2 * 0.4;
    const sy = (Math.sin(s * 1.7 + 0.4) + Math.sin(s * 2.9)) * 0.5 * t2 * 0.3;
    const cam = this.cam;
    cam.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    cam.lookAt(this.look.x + sx * 0.5, this.look.y + sy * 0.5, this.look.z);
    cam.rotation.z += (Math.sin(s * 1.3) * t2) * 0.05;
    const f = this.fov + this.fovKick;
    if (Math.abs(f - this.fovApplied) > 0.01) {
      cam.fov = f;
      cam.updateProjectionMatrix();
      this.fovApplied = f;
    }
  }
}
