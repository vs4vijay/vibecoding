import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { Controller } from '../src/player/Controller';
import { createSnail } from '../src/player/Snail';
import { TrackCurve } from '../src/track/TrackCurve';
import type { LateralInput } from '../src/core/Input';
import type { Vec3Tuple } from '../src/track/TrackCurve';
import { SpeedModifiers } from '../src/systems/SpeedMods';

const CONTROL_POINTS: Vec3Tuple[] = [
  [0, 0, 0],
  [0, 0, -200],
  [60, 8, -400],
  [0, 14, -600],
];

/** Mutable steering stub — stands in for the keyboard Input in unit tests. */
function makeInput(lateral = 0): LateralInput & { setLateral(value: number): void } {
  const holder = { value: lateral };
  return {
    get lateral() {
      return holder.value;
    },
    setLateral(value: number) {
      holder.value = value;
    },
  };
}

interface Harness {
  controller: Controller;
  snail: ReturnType<typeof createSnail>;
  input: ReturnType<typeof makeInput>;
  track: TrackCurve;
}

const ROAD_HALF_WIDTH = 7;

function makeController(roadHalfWidth = ROAD_HALF_WIDTH): Harness {
  const track = new TrackCurve(CONTROL_POINTS);
  const snail = createSnail();
  const input = makeInput();
  const controller = new Controller({
    track,
    snail,
    input,
    cruiseSpeed: 30,
    roadHalfWidth,
  });
  controller.applyVisual(1);
  return { controller, snail, input, track };
}

describe('Controller', () => {
  it('auto-forwards at cruise speed along the track', () => {
    const { controller } = makeController();

    controller.update(1);
    expect(controller.s).toBeCloseTo(30, 6);
    expect(controller.speed).toBeCloseTo(30, 9);
    expect(controller.x).toBe(0);

    controller.update(0.5);
    expect(controller.s).toBeCloseTo(45, 6);
  });

  it('steers laterally with the input axis', () => {
    // Wide road so the clamp never engages in this test.
    const { controller, input } = makeController(100);

    input.setLateral(1);
    controller.update(1);
    expect(controller.x).toBeCloseTo(20, 6); // lateralSpeed 20 u/s

    input.setLateral(-1);
    controller.update(0.5);
    expect(controller.x).toBeCloseTo(10, 6); // +20 then -10
  });

  it('clamps x to the road edge minus the margin', () => {
    const { controller, input } = makeController();

    input.setLateral(1);
    for (let i = 0; i < 30; i += 1) controller.update(1 / 60);
    expect(controller.x).toBeCloseTo(ROAD_HALF_WIDTH - 1.2, 6);

    input.setLateral(-1);
    for (let i = 0; i < 200; i += 1) controller.update(1 / 60);
    expect(controller.x).toBeCloseTo(-(ROAD_HALF_WIDTH - 1.2), 6);
  });

  it('places the snail on the road and banks it with steering', () => {
    const { controller, snail, input, track } = makeController();

    controller.applyVisual(1);
    const frame = track.sToWorld(0, 0);
    expect(snail.group.position.distanceTo(frame.position)).toBeLessThan(1e-6);
    // No steering → the bank quaternion contributes nothing.
    expect(snail.group.quaternion.angleTo(frame.quaternion)).toBeLessThan(1e-9);

    input.setLateral(1);
    controller.update(1 / 60); // ~68% of full bank after one step at rate 18
    controller.applyVisual(1);

    // Steering right must dip the snail's local right side below horizontal.
    const worldRight = new THREE.Vector3(1, 0, 0).applyQuaternion(snail.group.quaternion);
    expect(worldRight.y).toBeLessThan(-0.01);

    // ...while staying anchored on the track frame at the current (s, x).
    const anchored = track.sToWorld(controller.s, controller.x);
    expect(snail.group.position.distanceTo(anchored.position)).toBeLessThan(1e-6);
  });

  it('interpolates visuals between the previous and current sim states', () => {
    const { controller, snail } = makeController();

    controller.update(1); // s: 0 → 30
    controller.applyVisual(0);
    const atPrev = snail.group.position.clone();

    controller.applyVisual(1);
    const atCurrent = snail.group.position.clone();

    controller.applyVisual(0.5);
    const atMid = snail.group.position;

    // alpha=0 sits at the previous state (s=0), alpha=1 at s=30; the midpoint
    // of the two frame positions is close to the 50% interpolated position.
    const midExpected = atPrev.clone().add(atCurrent).multiplyScalar(0.5);
    expect(atMid.distanceTo(midExpected)).toBeLessThan(0.5);
    expect(atPrev.distanceTo(atMid)).toBeGreaterThan(0);
  });

  it('reset returns the snail to the start line with zero steering', () => {
    const { controller, snail, input } = makeController();

    input.setLateral(1);
    controller.update(2);
    controller.reset();
    controller.applyVisual(1);

    expect(controller.s).toBe(0);
    expect(controller.x).toBe(0);
    expect(controller.smoothedSteering).toBe(0);
    expect(snail.group.position.distanceTo(new THREE.Vector3(0, 0, 0))).toBeLessThan(1e-6);
  });

  it('rides the speed modifiers: −40% for 2 s after an asteroid hit, then cruise', () => {
    const track = new TrackCurve(CONTROL_POINTS);
    const input = makeInput();
    const speedMods = new SpeedModifiers();
    const controller = new Controller({
      track,
      snail: createSnail(),
      input,
      cruiseSpeed: 30,
      roadHalfWidth: 7,
      speedModifiers: speedMods,
    });

    // Cruise before contact.
    expect(controller.speed).toBe(30);

    // Asteroid contact applies −40% for 2 s; the Controller consumes it.
    speedMods.apply('asteroid', 0.6, 2);
    controller.update(1);
    expect(controller.speedMultiplier).toBeCloseTo(0.6, 9);
    expect(controller.speed).toBeCloseTo(18, 9);
    expect(controller.s).toBeCloseTo(18, 6); // advanced exactly 18, not 30

    controller.update(1); // the second slowed second
    expect(controller.speed).toBeCloseTo(18, 9);
    expect(controller.s).toBeCloseTo(36, 6);

    // Timer expires → back to full cruise on the next step.
    controller.update(1 / 60);
    expect(controller.speedMultiplier).toBe(1);
    expect(controller.speed).toBe(30);

    // reset clears any manual multiplier too.
    speedMods.apply('asteroid', 0.6, 2);
    controller.update(1 / 60);
    controller.reset();
    expect(controller.speedMultiplier).toBe(1);
  });

  it('works without a speed-modifier source (backward compatible)', () => {
    const { controller } = makeController();
    controller.speedMultiplier = 0.5; // manual hook still available
    controller.update(1);
    expect(controller.s).toBeCloseTo(15, 9);
  });
});

describe('Controller airborne (jump-pod flight)', () => {
  it('carries a fixed-duration parabola: rises to the peak, lands after the flight time', () => {
    const { controller } = makeController();

    expect(controller.airborne).toBe(false);
    expect(controller.airHeight).toBe(0);
    expect(controller.launch({ duration: 1.4, peakHeight: 7 })).toBe(true);
    expect(controller.airborne).toBe(true);

    // Cruise 30 × 1.4 s = 42 units of forward travel over the whole arc.
    controller.update(0.7);
    expect(controller.airProgress).toBeCloseTo(0.5, 6);
    expect(controller.airHeight).toBeCloseTo(7, 6); // 4·peak·0.5·0.5 = peak
    expect(controller.s).toBeCloseTo(21, 6);

    controller.update(0.7);
    expect(controller.airborne).toBe(false); // touched down on this step
    expect(controller.airHeight).toBe(0);
    expect(controller.s).toBeCloseTo(42, 6);

    // Grounded steps stay grounded.
    controller.update(0.5);
    expect(controller.s).toBeCloseTo(57, 6);
  });

  it('keeps air control: steering works mid-flight', () => {
    const { controller, input } = makeController();
    controller.launch({ duration: 1.4, peakHeight: 7 });

    input.setLateral(1);
    controller.update(0.7);
    expect(controller.x).toBeGreaterThan(0); // steered across the void
    expect(controller.airborne).toBe(true);
  });

  it('launching while airborne is a no-op (no chain launches)', () => {
    const { controller } = makeController();
    controller.launch({ duration: 1.4, peakHeight: 7 });
    controller.update(0.3);
    expect(controller.launch({ duration: 1.4, peakHeight: 7 })).toBe(false);
    controller.update(1.1); // the original arc still completes on schedule
    expect(controller.airborne).toBe(false);
    expect(controller.s).toBeCloseTo(42, 6);
  });

  it('interpolates the visual along the arc: lifted at the peak, nose leading the climb', () => {
    const { controller, snail, track } = makeController();
    controller.launch({ duration: 1.4, peakHeight: 7 });

    // Early in the flight the s ≈ 6 pose sits on the flat opening stretch.
    controller.update(0.2);
    controller.applyVisual(1);
    const grounded = track.sToWorld(controller.s, controller.x);
    expect(snail.group.position.y - grounded.position.y).toBeCloseTo(28 * (1 / 7) * (6 / 7), 3);
    // Nose above horizontal on the climb (local -Z through the pose quaternion).
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(snail.group.quaternion);
    expect(forward.y).toBeGreaterThan(0);

    // Apex: full peak height above the road.
    controller.update(0.5);
    controller.applyVisual(1);
    const groundedApex = track.sToWorld(controller.s, controller.x);
    expect(snail.group.position.y - groundedApex.position.y).toBeCloseTo(7, 4);

    // Touchdown on schedule.
    controller.update(0.7);
    expect(controller.airborne).toBe(false);
    expect(controller.s).toBeCloseTo(42, 6);
  });

  it('reset clears the airborne state along with the rest of the sim', () => {
    const { controller } = makeController();
    controller.launch();
    controller.update(0.2);
    controller.reset();
    expect(controller.airborne).toBe(false);
    expect(controller.airHeight).toBe(0);
    expect(controller.airProgress).toBe(0);
  });

  it('rejects malformed launch parameters', () => {
    const { controller } = makeController();
    expect(() => controller.launch({ duration: 0 })).toThrow(RangeError);
    expect(() => controller.launch({ duration: -1 })).toThrow(RangeError);
    expect(() => controller.launch({ peakHeight: -2 })).toThrow(RangeError);
  });
});
