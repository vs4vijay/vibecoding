// tests/input.test.ts
import { describe, expect, it } from "vitest";
import { Input } from "../src/core/Input";

function press(input: Input, code: string) {
  input.keyDown(code);
}
function release(input: Input, code: string) {
  input.keyUp(code);
}

describe("Input", () => {
  it("maps key codes to actions", () => {
    const input = new Input();
    press(input, "ArrowLeft");
    press(input, "Space");
    press(input, "ControlLeft");
    press(input, "AltLeft");
    const s = input.read();
    expect(s.left).toBe(true);
    expect(s.jump).toBe(true);
    expect(s.jetpack).toBe(true);
    expect(s.fire).toBe(true);
    expect(s.right).toBe(false);
  });
  it("tracks hold frames", () => {
    const input = new Input();
    press(input, "ArrowRight");
    input.tick(); input.tick(); input.tick();
    const buf = input.holdFrames();
    expect(buf.right).toBe(3);
    expect(buf.left).toBe(0);
  });
  it("fire is edge-triggered (consumed after one read)", () => {
    const input = new Input();
    press(input, "AltLeft");
    expect(input.read().fire).toBe(true);
    expect(input.read().fire).toBe(false);
  });
  it("release clears action", () => {
    const input = new Input();
    press(input, "KeyA");
    release(input, "KeyA");
    expect(input.read().left).toBe(false);
  });
});
