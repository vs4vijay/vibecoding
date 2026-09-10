import { describe, test, expect } from "bun:test";
import padSnap from "../fixtures/pad-snapshot.json";
import { createGamepadSource } from "../../src/input/gamepad";

describe("gamepad source (standard mapping)", () => {
  test("button2=attack, button0=jump, axis0 drives dir", () => {
    const src = createGamepadSource(0, padSnap as never);   // injected snapshot for tests
    const f = src.poll();
    expect(f.a).toBe(true);
    expect(f.j).toBe(false);
  });

  test("axis0=1 pushes dir.x right", () => {
    const src = createGamepadSource(0, padSnap as never);
    expect(src.poll().dir.x).toBe(1);
  });

  test("dpad buttons steer: 14 left, 13 down", () => {
    const snap = {
      axes: [0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 13 || i === 14 })),
    };
    const f = createGamepadSource(0, snap as never).poll();
    expect(f.dir).toEqual({ x: -1, z: 1 });
  });

  test("button0 jump edges once per press; button1 defends as a level", () => {
    const snap = {
      axes: [0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
    };
    const src = createGamepadSource(0, snap as never);
    snap.buttons[0]!.pressed = true;
    expect(src.poll().j).toBe(true);
    expect(src.poll().j).toBe(false);       // held, no new edge
    snap.buttons[1]!.pressed = true;
    expect(src.poll().dHeld).toBe(true);
    snap.buttons[0]!.pressed = false;
    snap.buttons[1]!.pressed = false;
    expect(src.poll()).toEqual({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } });
  });

  test("small stick deflection stays inside the dead zone", () => {
    const snap = { axes: [0.2, -0.2], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
    const f = createGamepadSource(0, snap as never).poll();
    expect(f.dir).toEqual({ x: 0, z: 0 });
  });

  test("short button arrays do not crash (lenient hardware)", () => {
    const snap = { axes: [0, 0], buttons: [{ pressed: true }] };   // only button0 present
    const f = createGamepadSource(0, snap as never).poll();
    expect(f.j).toBe(true);
    expect(f.a).toBe(false);
  });

  test("without injected snapshot, headless env polls NEUTRAL", () => {
    const f = createGamepadSource(3).poll();
    expect(f).toEqual({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } });
  });
});
