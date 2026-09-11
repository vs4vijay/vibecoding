import { describe, test, expect } from "bun:test";
import {
  createMapper,
  findDuplicateBindings,
  BINDINGS_KEY,
} from "../../src/input/mapper";
import { DEFAULT_KEYMAPS, resolveKeymaps } from "../../src/input/keyboard";

class FakeStorage {
  private m = new Map<string, string>();
  getItem(key: string): string | null { return this.m.get(key) ?? null; }
  setItem(key: string, value: string): void { this.m.set(key, value); }
}

describe("bindings mapper", () => {
  test("round trip: remap → persist → fresh mapper load sees the override", () => {
    const storage = new FakeStorage();
    const a = createMapper();
    a.remap(2, "jump", "Quote");
    a.persistBindings(storage);

    const b = createMapper();
    b.loadBindings(storage);
    expect(b.bindings()[2]!["Quote"]).toBe("jump");
    expect(b.bindings()[2]!["Comma"]).toBeUndefined();
  });

  test("persists sparse { [slot]: { [action]: code } } under bantam.bindings.v1", () => {
    const storage = new FakeStorage();
    const m = createMapper();
    m.remap(2, "jump", "Quote");
    m.remap(0, "attack", "KeyQ");
    m.persistBindings(storage);
    expect(JSON.parse(storage.getItem(BINDINGS_KEY)!)).toEqual({
      "0": { attack: "KeyQ" },
      "2": { jump: "Quote" },
    });
  });

  test("unremapped slots keep factory defaults after load", () => {
    const storage = new FakeStorage();
    const m = createMapper();
    m.remap(3, "attack", "NumpadEnter");
    m.persistBindings(storage);

    const loaded = createMapper();
    loaded.loadBindings(storage);
    expect(loaded.bindings()[3]!["NumpadEnter"]).toBe("attack");
    expect(loaded.bindings()[0]!["Comma"]).toBe("attack");
    expect(loaded.bindings()[1]!["KeyG"]).toBe("jump");
  });

  test("corrupt stored payload is ignored, defaults intact", () => {
    const storage = new FakeStorage();
    storage.setItem(BINDINGS_KEY, "{not json");
    const m = createMapper();
    m.loadBindings(storage);
    expect(m.bindings()[0]!["Comma"]).toBe("attack");
  });

  test("loading an empty/null record is a no-op", () => {
    const storage = new FakeStorage();
    const m = createMapper();
    expect(() => m.loadBindings(storage)).not.toThrow();
    expect(m.bindings()[3]!["Numpad0"]).toBe("attack");
  });

  test("duplicate detection spans all slots", () => {
    const m = createMapper({ humanSlots: [0, 2] });
    m.remap(2, "attack", "Comma");           // collides with P1 attack default
    const errs = m.duplicateErrors();
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("Comma");
    expect(errs[0]).toContain("P1");
    expect(errs[0]).toContain("P3");
  });

  test("factory defaults contain exactly the documented P1/P3 overlaps; join fallback resolves them", () => {
    expect(findDuplicateBindings(DEFAULT_KEYMAPS)).toHaveLength(2);   // Comma + Slash shared by P1/P3
    expect(findDuplicateBindings(resolveKeymaps([0, 2]))).toHaveLength(0);
  });
});
