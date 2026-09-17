import { projectForSprite } from "./road";
import type { CameraView } from "./road";
import { getRiderSprite, getTrafficSprite } from "./sprites";
import type { RiderPose } from "./sprites";
import type { RaceState, Rider, TrafficCar } from "../sim/types";
import { clamp } from "../core/math";

// OWNER: Agent D. Draws traffic + riders using road.projectForSprite +
// render/sprites. Contract per .plan.md §5. Do not change signatures.

// Calibration per the road.ts contract: a rider is ~210px tall at projection
// scale 1 (the closest point). Per-frame normalization on the player's own
// projection keeps this true regardless of the absolute scale unit used.
const RIDER_BASE_H = 210;
const RIDER_MAX_H = 460;
const PLAYER_BOOST = 1.15;

// Traffic width as a fraction of the road half-width in screen px.
const CAR_W = 0.22;
const TRUCK_W = 0.26;
const BUS_W = 0.3;

interface Placed {
  x: number;
  y: number;
  scale: number;
}

function project(
  state: RaceState,
  cam: CameraView,
  z: number,
  offsetX: number,
): Placed | null {
  const p = projectForSprite(state, cam, z, offsetX);
  if (!p) return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.scale)) {
    return null;
  }
  if (p.scale <= 0) return null;
  return p;
}

/**
 * Scale factor calibrated once per frame on the player's projection so the
 * player sprite lands at RIDER_BASE_H regardless of the projection's scale
 * convention (any reciprocal-distance scale is fixed by one reference point).
 */
function normFactor(state: RaceState, cam: CameraView): number {
  const p = project(state, cam, state.player.z, state.player.x);
  if (!p) return 1;
  return clamp(RIDER_BASE_H / (RIDER_BASE_H * p.scale), 0.02, 5000);
}

function riderHeight(scale: number, norm: number, isPlayer: boolean): number {
  return clamp(RIDER_BASE_H * scale * norm * (isPlayer ? PLAYER_BOOST : 1), 2, RIDER_MAX_H);
}

function poseFor(r: Rider): RiderPose {
  if (r.downT > 0) return "down";
  if (r.attackT > 0) {
    if (r.attackKind === "kick") return r.attackSide === "left" ? "kick-l" : "kick-r";
    return r.attackSide === "left" ? "punch-l" : "punch-r";
  }
  if (r.hitFlashT > 0) return "hit";
  if (r.lean < -0.25) return "lean-l";
  if (r.lean > 0.25) return "lean-r";
  return "ride";
}

function drawShadow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  g.save();
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.beginPath();
  g.ellipse(x, y, Math.max(3, rx), Math.max(2.5, ry), 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawRiderSprite(
  g: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
): void {
  g.save();
  g.translate(x, y);
  if (rot !== 0) g.rotate(rot);
  g.drawImage(sprite, -w / 2, -h, w, h);
  g.restore();
}

/** White/blue alternating light bar above a cop's helmet. */
function drawCopLights(
  g: CanvasRenderingContext2D,
  x: number,
  topY: number,
  h: number,
  time: number,
): void {
  const bw = Math.max(10, h * 0.24);
  const r = Math.max(2, h * 0.026);
  const y = topY - r * 3;
  const phase = Math.floor(time * 8) % 2 === 0;
  g.save();
  g.fillStyle = "#101018";
  g.fillRect(x - bw / 2, y - r, bw, r * 2);
  g.fillStyle = phase ? "#ff4040" : "#7a1020";
  g.beginPath();
  g.arc(x - bw / 4, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = phase ? "#10307a" : "#3ec6ff";
  g.beginPath();
  g.arc(x + bw / 4, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawRider(
  g: CanvasRenderingContext2D,
  state: RaceState,
  cam: CameraView,
  r: Rider,
  norm: number,
  isPlayer: boolean,
): void {
  const pos = project(state, cam, r.z, r.x);
  if (!pos) return;
  const h = riderHeight(pos.scale, norm, isPlayer);
  const pose = poseFor(r);
  const sprite = getRiderSprite(pose, r.color, r.accent);
  const w = h * (sprite.width / sprite.height);
  drawShadow(g, pos.x, pos.y, w * 0.3, h * 0.03);
  // Deterministic invulnerability flicker (no wall-clock reads).
  if (isPlayer && r.invulnT > 0 && Math.floor(r.invulnT * 10) % 2 === 0) return;
  const rot = pose === "down" ? r.downSpin : 0;
  drawRiderSprite(g, sprite, pos.x, pos.y, w, h, rot);
  if (r.kind === "cop" && pose !== "down") {
    drawCopLights(g, pos.x, pos.y - h, h, state.time);
  }
}

/** Traffic cars, far to near. */
export function drawTraffic(
  g: CanvasRenderingContext2D,
  state: RaceState,
  cam: CameraView,
): void {
  const norm = normFactor(state, cam);
  const cars = state.traffic.filter((c) => c.active).sort((a, b) => b.z - a.z);
  for (const car of cars) {
    drawCar(g, state, cam, car, norm);
  }
}

function drawCar(
  g: CanvasRenderingContext2D,
  state: RaceState,
  cam: CameraView,
  car: TrafficCar,
  norm: number,
): void {
  const pos = project(state, cam, car.z, car.x);
  if (!pos) return;
  const sprite = getTrafficSprite(car.kind, car.color, car.dir);
  const w = trafficWidthPx(state, cam, car, pos, norm);
  if (w < 1) return;
  const h = w * (sprite.height / sprite.width);
  drawShadow(g, pos.x, pos.y, w * 0.36, h * 0.05);
  g.drawImage(sprite, pos.x - w / 2, pos.y - h, w, h);
}

function trafficWidthPx(
  state: RaceState,
  cam: CameraView,
  car: TrafficCar,
  pos: Placed,
  norm: number,
): number {
  const frac = car.kind === "car" ? CAR_W : car.kind === "truck" ? TRUCK_W : BUS_W;
  // Primary calibration: road half-width in px at this z, via an edge probe.
  const edge = project(state, cam, car.z, 1);
  if (edge) {
    const halfRoad = Math.abs(edge.x - pos.x);
    if (halfRoad > 4) return halfRoad * frac;
  }
  // Fallback: size relative to a rider at the same distance.
  const mult = car.kind === "car" ? 1.5 : car.kind === "truck" ? 1.9 : 2.2;
  return riderHeight(pos.scale, norm, false) * mult;
}

/**
 * Rivals + cops far to near, then the player last (largest, bottom center).
 * Pose from rider state (lean / attack side / hit flash / downed tumble via
 * downSpin), with downed riders drawn rotated/skidding. Player invuln
 * flickers. Off-road riders kick up dust via render/fx.
 */
export function drawRiders(
  g: CanvasRenderingContext2D,
  state: RaceState,
  cam: CameraView,
): void {
  const norm = normFactor(state, cam);
  const rivals = state.rivals.slice().sort((a, b) => b.z - a.z);
  for (const r of rivals) {
    drawRider(g, state, cam, r, norm, false);
  }
  drawRider(g, state, cam, state.player, norm, true);
}
