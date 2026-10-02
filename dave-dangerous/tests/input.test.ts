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
  it("detach removes the listeners it attached", () => {
    const added: Array<[string, unknown]> = [];
    const removed: Array<[string, unknown]> = [];
    const fakeTarget = {
      addEventListener(type: string, listener: unknown) { added.push([type, listener]); },
      removeEventListener(type: string, listener: unknown) { removed.push([type, listener]); },
    } as unknown as Window;
    const input = new Input();
    input.attach(fakeTarget);
    expect(added.map(([type]) => type)).toEqual(["keydown", "keyup"]);
    input.detach();
    expect(removed).toEqual(added);
  });
  it("press holds the action", () => {
    const input = new Input();
    input.press("left");
    expect(input.read().left).toBe(true);
  });
  it("press accumulates hold frames like a keydown", () => {
    const input = new Input();
    input.press("right");
    input.tick(); input.tick(); input.tick();
    expect(input.holdFrames().right).toBe(3);
  });
  it("press on an already-held action is a no-op (frames not reset)", () => {
    const input = new Input();
    input.press("right");
    input.tick(); input.tick();
    input.press("right");
    input.tick();
    expect(input.holdFrames().right).toBe(3);
  });
  it("release stops holding the action", () => {
    const input = new Input();
    input.press("jump");
    input.release("jump");
    expect(input.read().jump).toBe(false);
  });
  it("queueFire yields exactly one fire edge", () => {
    const input = new Input();
    input.queueFire();
    expect(input.read().fire).toBe(true);
    expect(input.read().fire).toBe(false);
  });
  it("queueFire twice before one read still yields a single edge", () => {
    const input = new Input();
    input.queueFire();
    input.queueFire();
    expect(input.read().fire).toBe(true);
    expect(input.read().fire).toBe(false);
  });
  it("press fire is edge-triggered exactly like AltLeft keydown", () => {
    const input = new Input();
    input.press("fire");
    expect(input.read().fire).toBe(true);
    expect(input.read().fire).toBe(false);
    const viaKey = new Input();
    viaKey.keyDown("AltLeft");
    expect(viaKey.read().fire).toBe(true);
    expect(viaKey.read().fire).toBe(false);
  });
  it("touch release stops an action held by keyboard (shared held set)", () => {
    const input = new Input();
    input.keyDown("ArrowLeft");
    input.release("left");
    expect(input.read().left).toBe(false);
  });
  it("keyboard keyUp stops an action held by touch (shared held set)", () => {
    const input = new Input();
    input.press("left");
    input.keyUp("KeyA");
    expect(input.read().left).toBe(false);
  });
  it("keyboard-held action survives an unrelated touch release", () => {
    const input = new Input();
    input.keyDown("ArrowRight");
    input.release("left");
    expect(input.read().right).toBe(true);
  });
});
