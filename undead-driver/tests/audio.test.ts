import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioEngine } from "../src/core/audio";

describe("audio graceful degradation", () => {
  let saved: { ac?: typeof AudioContext; wkac?: typeof AudioContext };

  beforeEach(() => {
    saved = {};
    if ("AudioContext" in globalThis) saved.ac = globalThis.AudioContext;
    if ("webkitAudioContext" in globalThis)
      saved.wkac = (globalThis as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    delete (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
  });

  afterEach(() => {
    if (saved.ac) globalThis.AudioContext = saved.ac;
    else delete (globalThis as { AudioContext?: unknown }).AudioContext;
    if (saved.wkac)
      (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext =
        saved.wkac;
    else delete (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
    localStorage.clear();
  });

  it("instantiates with AudioContext undefined and never throws", () => {
    const audio = new AudioEngine();
    expect(() => audio.unlock()).not.toThrow();
    expect(() => audio.update(1 / 60, {
      phase: "running",
      speed01: 0.5,
      zombiesActive: true,
      tiltDanger: true,
    })).not.toThrow();
    expect(() => audio.shot()).not.toThrow();
    expect(() => audio.attachThud()).not.toThrow();
    expect(() => audio.scrape()).not.toThrow();
    expect(() => audio.levelUpSting()).not.toThrow();
    expect(() => audio.crashSting()).not.toThrow();
    expect(() => audio.flipRiser()).not.toThrow();
    expect(() => audio.uiClick()).not.toThrow();
    expect(audio.unlocked).toBe(true); // attempted, degraded
  });

  it("setMuted(true) is a safe no-op and persists the preference", () => {
    const audio = new AudioEngine();
    expect(() => audio.setMuted(true)).not.toThrow();
    expect(audio.muted).toBe(true);
    expect(JSON.parse(localStorage.getItem("zh.muted") as string)).toBe(true);
    expect(() => audio.setMuted(false)).not.toThrow();
  });
});
