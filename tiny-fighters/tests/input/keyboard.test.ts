import { describe, test, expect } from "bun:test";
import { createKeyboardSource, DEFAULT_KEYMAPS, resolveKeymaps } from "../../src/input/keyboard";

class FakeTarget {
  handlers = new Map<string, (e: unknown) => void>();
  addEventListener(t: string, fn: (e: unknown) => void) { this.handlers.set(t, fn); }
  fire(type: string, code: string) { this.handlers.get(type)?.({ code }); }
}

describe("keyboard source", () => {
  test("P1 defaults match spec table", () => {
    const p1 = DEFAULT_KEYMAPS[0]!;
    expect(p1["Comma"]).toBe("attack");     // , 
    expect(p1["Period"]).toBe("jump");      // .
    expect(p1["Slash"]).toBe("defend");     // /
    expect(p1["ArrowRight"]).toBe("right");
  });

  test("edges: attack true only on transition tick", () => {
    const t = new FakeTarget();
    const src = createKeyboardSource(t, DEFAULT_KEYMAPS[0]!);
    t.fire("keydown", "Comma");
    expect(src.poll().a).toBe(true);
    expect(src.poll().a).toBe(false);       // still held, no new edge
    t.fire("keyup", "Comma");
    expect(src.poll().a).toBe(false);
  });

  test("exactly four default keymaps (P1-P4)", () => {
    expect(DEFAULT_KEYMAPS).toHaveLength(4);
  });

  test("P2 defaults match spec table", () => {
    const p2 = DEFAULT_KEYMAPS[1]!;
    expect(p2["KeyW"]).toBe("up");
    expect(p2["KeyA"]).toBe("left");
    expect(p2["KeyS"]).toBe("down");
    expect(p2["KeyD"]).toBe("right");
    expect(p2["KeyF"]).toBe("attack");
    expect(p2["KeyG"]).toBe("jump");
    expect(p2["KeyH"]).toBe("defend");
  });

  test("P3 defaults match spec table", () => {
    const p3 = DEFAULT_KEYMAPS[2]!;
    expect(p3["KeyI"]).toBe("up");
    expect(p3["KeyJ"]).toBe("left");
    expect(p3["KeyK"]).toBe("down");
    expect(p3["KeyL"]).toBe("right");
    expect(p3["Semicolon"]).toBe("attack");
    expect(p3["Comma"]).toBe("jump");
    expect(p3["Slash"]).toBe("defend");
  });

  test("P4 defaults match spec table (numpad)", () => {
    const p4 = DEFAULT_KEYMAPS[3]!;
    expect(p4["Numpad8"]).toBe("up");
    expect(p4["Numpad4"]).toBe("left");
    expect(p4["Numpad5"]).toBe("down");
    expect(p4["Numpad6"]).toBe("right");
    expect(p4["Numpad0"]).toBe("attack");
    expect(p4["NumpadDecimal"]).toBe("jump");
    expect(p4["NumpadAdd"]).toBe("defend");
  });

  test("directions are level-sampled; opposing keys cancel to neutral", () => {
    const t = new FakeTarget();
    const src = createKeyboardSource(t, DEFAULT_KEYMAPS[0]!);
    t.fire("keydown", "ArrowRight");
    t.fire("keydown", "ArrowUp");
    expect(src.poll().dir).toEqual({ x: 1, z: -1 });
    t.fire("keydown", "ArrowLeft");         // right+left cancel
    expect(src.poll().dir.x).toBe(0);
    t.fire("keyup", "ArrowLeft");
    t.fire("keyup", "ArrowRight");
    expect(src.poll().dir).toEqual({ x: 0, z: -1 });  // up still held
  });

  test("dHeld is a held-level signal, not an edge", () => {
    const t = new FakeTarget();
    const src = createKeyboardSource(t, DEFAULT_KEYMAPS[0]!);
    t.fire("keydown", "Slash");
    expect(src.poll().dHeld).toBe(true);
    expect(src.poll().dHeld).toBe(true);    // still held → stays true
    t.fire("keyup", "Slash");
    expect(src.poll().dHeld).toBe(false);
  });

  test("jump edges once per physical press", () => {
    const t = new FakeTarget();
    const src = createKeyboardSource(t, DEFAULT_KEYMAPS[0]!);
    t.fire("keydown", "Period");
    expect(src.poll().j).toBe(true);
    expect(src.poll().j).toBe(false);
    t.fire("keyup", "Period");
    t.fire("keydown", "Period");
    expect(src.poll().j).toBe(true);
  });

  test("unknown codes are ignored", () => {
    const t = new FakeTarget();
    const src = createKeyboardSource(t, DEFAULT_KEYMAPS[0]!);
    t.fire("keydown", "Escape");
    t.fire("keydown", "ShiftLeft");
    expect(src.poll()).toEqual({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } });
  });

  test("P3 Quote/Enter fallback applied only when P1 AND P3 both join", () => {
    const solo = resolveKeymaps([2]);
    expect(solo[2]!["Comma"]).toBe("jump");
    expect(solo[2]!["Slash"]).toBe("defend");

    const both = resolveKeymaps([0, 2]);
    expect(both[2]!["Quote"]).toBe("jump");
    expect(both[2]!["Enter"]).toBe("defend");
    expect(both[2]!["Comma"]).toBeUndefined();   // freed for P1 attack
    expect(both[2]!["Slash"]).toBeUndefined();
    expect(both[0]!["Comma"]).toBe("attack");    // P1 untouched

    expect(resolveKeymaps([1, 2])[2]!["Comma"]).toBe("jump");  // P2 joining changes nothing
  });
});
