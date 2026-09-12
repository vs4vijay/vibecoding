import { describe, test, expect } from "bun:test";
import { eventToSfx, createAudio } from "../../src/audio/audio";

describe("sim-event to sfx mapping", () => {
  test("covers the spec bank", () => {
    expect(eventToSfx({ type: "hit", attacker: 1, victim: 2, damage: 8, heavy: false, blocked: false })).toBe("hit_light");
    expect(eventToSfx({ type: "hit", attacker: 1, victim: 2, damage: 16, heavy: true, blocked: false })).toBe("hit_heavy");
    expect(eventToSfx({ type: "ko", victim: 2 })).toBe("ko");
    expect(eventToSfx({ type: "weaponBreak", defId: "knife" })).toBe("weapon_break");
    expect(eventToSfx({ type: "castFire", who: 1 })).toBe("cast_fire");
  });
});


/** Minimal StorageLike fake (same shape as input/mapper tests use). */
function fakeStorage(): { store: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, v),
  };
}

describe("mute persistence", () => {
  test("toggleMute flips, persists tiny.muted, and reports the new state", () => {
    const s = fakeStorage();
    const audio = createAudio({ storage: s });
    expect(audio.toggleMute()).toBe(true);
    expect(s.store.get("tiny.muted")).toBe("true");
    expect(audio.toggleMute()).toBe(false);
    expect(s.store.get("tiny.muted")).toBe("false");
  });

  test("muted state survives reload (restored from storage)", () => {
    const s = fakeStorage();
    s.setItem("tiny.muted", "true");
    const audio = createAudio({ storage: s });
    // Restored muted: next toggle un-mutes and persists "false".
    expect(audio.toggleMute()).toBe(false);
    expect(s.store.get("tiny.muted")).toBe("false");
  });
});

describe("headless safety (no AudioContext in Bun)", () => {
  test("engine calls are no-ops, never throw", async () => {
    const audio = createAudio({ storage: fakeStorage() });
    audio.onEvent({ type: "hit", attacker: 1, victim: 2, damage: 8, heavy: true, blocked: false });
    audio.onEvent({ type: "matchEnd", winnerTeam: "draw" });
    audio.playMusic("rooftop-night");
    await audio.unlock(); // resolves even without a context
  });
});
