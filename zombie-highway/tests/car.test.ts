import { describe, expect, it } from "vitest";
import { addWeight, createCar, removeWeightFrom, stepCar } from "../src/game/car";

const DT = 1 / 60;
function simulate(car: ReturnType<typeof createCar>, steer: number, seconds: number) {
  const events = [];
  for (let i = 0; i < seconds / DT; i++) events.push(...stepCar(car, steer, DT));
  return events;
}

describe("stepCar", () => {
  it("steers right and clamps at rail with scrape event + bounce", () => {
    const car = createCar(28);
    simulate(car, 1, 2);
    expect(car.x).toBeLessThanOrEqual(7 - 0.95 + 1e-6);
    expect(car.vx).toBeLessThanOrEqual(0); // bounced inward
  });
  it("accumulates speed toward cruise speed", () => {
    const car = createCar(34);
    simulate(car, 0, 3);
    expect(car.speed).toBeCloseTo(34, 0); // eased to cruise
  });
});

describe("tipping", () => {
  it("flips after ~1.2s sustained overload on one side", () => {
    const car = createCar(28);
    addWeight(car, "right", 4); // capacity is 4 -> instant critical
    const events = simulate(car, 0, 1.4);
    expect(events.some((e) => e.kind === "flipped")).toBe(true);
    expect(car.alive).toBe(false);
  });
  it("can be saved: removing weight before the window lets flipTimer decay", () => {
    const car = createCar(28);
    addWeight(car, "right", 4);
    simulate(car, 0, 0.6); // inside the 1.2s window
    removeWeightFrom(car, "right", 4);
    const events = simulate(car, 0, 1.5);
    expect(events.some((e) => e.kind === "flipped")).toBe(false);
    expect(car.alive).toBe(true);
  });
  it("balanced weights give zero tilt", () => {
    const car = createCar(28);
    addWeight(car, "left", 2);
    addWeight(car, "right", 2);
    simulate(car, 0, 2);
    expect(Math.abs(car.tilt)).toBeLessThan(0.01);
  });
});
