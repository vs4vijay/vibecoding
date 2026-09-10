// tests/input/composite.test.ts — per-slot keyboard+gamepad merging.
import { describe, test, expect } from "bun:test";
import { createKeyboardSource, neutralFrame, type EventTargetLike } from "../../src/input/keyboard";
import type { GamepadSnapshot } from "../../src/input/gamepad";
import { createCompositeSource } from "../../src/input/composite";

function fakeTarget(): EventTargetLike & { press(code: string): void; release(code: string): void } {
  const down = new Set<string>();
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const fire = (type: string, code: string): void => {
    for (const h of handlers.get(type) ?? []) h({ code });
  };
  return {
    addEventListener(type: string, fn: (e: unknown) => void) {
      const list = handlers.get(type) ?? [];
      list.push(fn);
      handlers.set(type, list);
    },
    press(code: string) {
      if (!down.has(code)) {
        down.add(code);
        fire("keydown", code);
      }
    },
    release(code: string) {
      if (down.has(code)) {
        down.delete(code);
        fire("keyup", code);
      }
    },
  };
}

const P1 = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Comma: "attack", Period: "jump", Slash: "defend" } as const;

describe("composite source", () => {
  test("keyboard alone drives the frame", () => {
    const t = fakeTarget();
    const src = createCompositeSource({ keyboard: createKeyboardSource(t, { ...P1 }) });
    expect(src.poll()).toEqual(neutralFrame());
    t.press("Comma");
    expect(src.poll().a).toBe(true);       // edge on the poll that sees it
    expect(src.poll().a).toBe(false);      // single tick
  });

  test("resting pad never masks keyboard", () => {
    const t = fakeTarget();
    let pad: GamepadSnapshot = {};
    const src = createCompositeSource({
      keyboard: createKeyboardSource(t, { ...P1 }),
      pads: [() => pad],
    });
    src.poll(); // prime
    t.press("ArrowRight");
    const f = src.poll();
    expect(f.dir.x).toBe(1);
  });

  test("pad button fires one attack edge through the merge", () => {
    const t = fakeTarget();
    let pad: GamepadSnapshot = {};
    const src = createCompositeSource({
      keyboard: createKeyboardSource(t, { ...P1 }),
      pads: [() => pad],
    });
    src.poll();
    pad = { buttons: [{}, {}, { pressed: true }] };   // X = attack
    expect(src.poll().a).toBe(true);
    expect(src.poll().a).toBe(false);
  });

  test("simultaneous kb+pad attack yields a single edge tick", () => {
    const t = fakeTarget();
    let pad: GamepadSnapshot = {};
    const src = createCompositeSource({
      keyboard: createKeyboardSource(t, { ...P1 }),
      pads: [() => pad],
    });
    src.poll();
    t.press("Comma");
    pad = { buttons: [{}, {}, { pressed: true }] };
    expect(src.poll().a).toBe(true);
    expect(src.poll().a).toBe(false);                  // not doubled
  });

  test("pad direction ORs with keyboard direction", () => {
    const t = fakeTarget();
    let pad: GamepadSnapshot = {};
    const src = createCompositeSource({
      keyboard: createKeyboardSource(t, { ...P1 }),
      pads: [() => pad],
    });
    src.poll();
    t.press("ArrowLeft");
    pad = { axes: [0.9] };                             // stick right
    const f = src.poll();
    // Opposing devices cancel at the merged level, matching keyboard semantics.
    expect(f.dir.x).toBe(0);
  });

  test("disconnected pad degrades to keyboard-only", () => {
    const t = fakeTarget();
    let pad: GamepadSnapshot | null = null;
    const src = createCompositeSource({
      keyboard: createKeyboardSource(t, { ...P1 }),
      pads: [() => pad],
    });
    src.poll();
    t.press("Period");
    expect(src.poll().j).toBe(true);
  });
});
