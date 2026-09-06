import { describe, expect, it } from "vitest";
import { AudioEngine, SFX_PARAMS, type SfxId } from "../src/audio/AudioEngine";

describe("AudioEngine", () => {
  it("SFX_PARAMS covers every sfx id", () => {
    const ids: SfxId[] = ["jump", "land", "shoot", "collect", "trophy", "hurt", "die", "jetpack", "door", "warp", "oneup", "gun"];
    for (const id of ids) expect(SFX_PARAMS[id], id).toBeDefined();
  });
  it("gracefully no-ops without AudioContext", () => {
    const a = new AudioEngine(null);
    expect(a.supported).toBe(false);
    expect(() => a.playSfx("jump")).not.toThrow();
    a.setMuted(true);
    expect(a.muted).toBe(true);
  });
});
