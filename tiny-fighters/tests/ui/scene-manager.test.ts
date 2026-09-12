// tests/ui/scene-manager.test.ts — brief Step 1 tests verbatim + stack semantics.
import { describe, test, expect } from "bun:test";
import { SceneManager } from "../../src/ui/scene-manager";

function mkScene(name: string) {
  return { name, entered: 0, exited: 0,
    enter() { this.entered++; }, exit() { this.exited++; },
    update() {}, root: { style: {} } as unknown as HTMLElement };
}

describe("scene manager", () => {
  test("replace swaps and exits old", () => {
    const sm = new SceneManager();
    const a = mkScene("a"); const b = mkScene("b");
    sm.replace(a); sm.replace(b);
    expect(a.exited).toBe(1); expect(b.entered).toBe(1);
  });

  test("pause overlay is not a scene", () => {
    const sm = new SceneManager();
    const battle = mkScene("battle");
    sm.replace(battle);
    sm.overlay(mkScene("pause"));                 // overlay stack separate
    expect(sm.active()).toBe(battle);
  });

  test("push stacks; pop restores and exits top", () => {
    const sm = new SceneManager();
    const a = mkScene("a"); const b = mkScene("b");
    sm.replace(a);
    sm.push(b);
    expect(sm.active()).toBe(b);
    expect(a.exited).toBe(1);
    sm.pop();
    expect(a.entered).toBe(2);                    // initial + re-entered on reveal
    expect(a.exited).toBe(1);
    expect(b.exited).toBe(1);
  });

  test("pop with nothing to pop is a no-op", () => {
    const sm = new SceneManager();
    const only = mkScene("only");
    sm.replace(only);
    sm.pop();
    expect(sm.active()).toBe(only);
    expect(only.exited).toBe(0);
  });

  test("update and draw reach only the active scene", () => {
    const sm = new SceneManager();
    let aUpd = 0, bUpd = 0;
    const a = { ...mkScene("a"), update() { aUpd++; } };
    const b = { ...mkScene("b"), update() { bUpd++; } };
    sm.replace(a); sm.replace(b);
    sm.update(16);
    sm.draw();
    expect(aUpd).toBe(0);
    expect(bUpd).toBe(1);
  });
});
