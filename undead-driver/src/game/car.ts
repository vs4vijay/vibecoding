import { CONFIG } from "../config";

const C = CONFIG.car;
const RAIL_X = CONFIG.road.halfWidth;
const RAIL_LIMIT = RAIL_X - C.halfWidth;

export type CarSide = "left" | "right";
export type CarEvent = { kind: "scrape"; side: CarSide } | { kind: "flipped" };
export type CarState = {
  x: number;
  vx: number;
  speed: number;
  tilt: number;
  leftWeight: number;
  rightWeight: number;
  flipTimer: number;
  alive: boolean;
  scrapeCooldown: number;
  cruiseSpeed: number;
};

export function createCar(cruiseSpeed: number): CarState {
  return {
    x: 0,
    vx: 0,
    speed: cruiseSpeed * 0.85,
    tilt: 0,
    leftWeight: 0,
    rightWeight: 0,
    flipTimer: 0,
    alive: true,
    scrapeCooldown: 0,
    cruiseSpeed: cruiseSpeed,
  };
}

export function addWeight(car: CarState, side: CarSide, w: number): void {
  const k = side === "left" ? "leftWeight" : "rightWeight";
  car[k] += w;
}

export function removeWeightFrom(car: CarState, side: CarSide, w: number): void {
  const k = side === "left" ? "leftWeight" : "rightWeight";
  car[k] = Math.max(0, car[k] - w);
}

export function stepCar(car: CarState, steer: number, dt: number): CarEvent[] {
  const events: CarEvent[] = [];
  if (!car.alive) return events;

  // longitudinal + lateral easing toward targets; scrapes bleed speed off
  const ease = C.steerAccel * dt;
  car.speed += clamp(car.cruiseSpeed - car.speed, -ease, ease);
  car.vx += clamp(steer * C.steerMaxSpeed - car.vx, -ease, ease);

  // rails: invariant |x| <= RAIL_LIMIT; outward crossing -> clamp, bounce inward, periodic scrape
  car.scrapeCooldown -= dt;
  const nextX = car.x + car.vx * dt;
  const hitSide: CarSide | null =
    nextX >= RAIL_LIMIT && car.vx > 0 ? "right" : nextX <= -RAIL_LIMIT && car.vx < 0 ? "left" : null;
  if (hitSide) {
    car.x = hitSide === "right" ? RAIL_LIMIT : -RAIL_LIMIT;
    car.vx = hitSide === "right" ? -C.railBounceVx : C.railBounceVx;
    if (car.scrapeCooldown <= 0) {
      car.scrapeCooldown = C.scrapeTickS;
      car.speed = Math.max(C.speedFloor, car.speed - C.scrapeSpeedLoss);
      events.push({ kind: "scrape", side: hitSide });
    }
  } else {
    car.x = nextX;
  }

  const imbalance = (car.rightWeight - car.leftWeight) / C.capacityPerSide;
  const target = clamp(imbalance, -1, 1);
  car.tilt += clamp(target - car.tilt, -C.tiltRate * dt, C.tiltRate * dt);
  if (Math.abs(imbalance) >= 1) {
    car.flipTimer += dt;
    if (car.flipTimer >= C.flipWindowS) {
      car.alive = false;
      events.push({ kind: "flipped" });
    }
  } else {
    car.flipTimer = Math.max(0, car.flipTimer - 2 * dt);
  }

  return events;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

