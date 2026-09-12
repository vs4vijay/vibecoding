// tests/audio-cinematic.test.ts — CinematicAudio behaviour without WebAudio.
// Mirrors tests/audio.test.ts conventions: node-safe, no fake AudioContext —
// every call path must degrade to a silent no-op when the context is absent,
// and state-only APIs (mute/settings) must work without a context at all.
import { describe, expect, it } from "vitest";
import { CinematicAudio, type AudioSettings, type MusicTrack } from "../src/audio/CinematicAudio";
import { SFX_PARAMS } from "../src/audio/AudioEngine";
import type { SfxId } from "../src/audio/AudioEngine";

const TRACKS: MusicTrack[] = ["menu", "cave", "danger"];
const SFX_IDS = Object.keys(SFX_PARAMS) as SfxId[];

describe("CinematicAudio", () => {
  it("covers the full SfxId vocabulary", () => {
    expect(SFX_IDS).toEqual(
      expect.arrayContaining([
        "jump", "land", "shoot", "collect", "trophy", "hurt",
        "die", "jetpack", "door", "warp", "oneup", "gun",
      ]),
    );
    expect(SFX_IDS).toHaveLength(12);
  });

  it("gracefully no-ops without an AudioContext", () => {
    const a = new CinematicAudio();
    expect(() => {
      a.unlock();
      a.unlock(); // repeated unlock stays safe
      for (const id of SFX_IDS) a.playSfx(id);
      a.playMusic("menu");
      a.update(1 / 60);
      a.stopMusic();
    }).not.toThrow();
    expect(a.muted).toBe(false);
    a.dispose();
  });

  it("setMuted / muted round-trip", () => {
    const a = new CinematicAudio();
    a.setMuted(true);
    expect(a.muted).toBe(true);
    a.setMuted(false);
    expect(a.muted).toBe(false);
    a.dispose();
  });

  it("setSettings accepts the game settings shape (full, partial, out-of-range)", () => {
    const a = new CinematicAudio();
    const full: AudioSettings = { master: 0.8, music: 0.7, sfx: 0.9 };
    expect(() => {
      a.setSettings(full);
      a.setSettings({});
      a.setSettings({ master: 1.5, music: -0.5 }); // clamped internally
      a.setSettings({ sfx: 0.4 });
      a.setSettings(full);
    }).not.toThrow();
    a.dispose();
  });

  it("repeated playMusic calls transition (and repeat) without throwing", () => {
    const a = new CinematicAudio();
    expect(() => {
      for (const track of TRACKS) a.playMusic(track);
      a.playMusic("cave");
      a.playMusic("cave"); // same-track repeat must not restart the groove
      a.update(1 / 60);
      a.stopMusic();
      a.stopMusic(); // idempotent
      a.update(1 / 60);
    }).not.toThrow();
    a.dispose();
  });

  it("update tolerates degenerate dt values while a track is live", () => {
    const a = new CinematicAudio();
    a.playMusic("danger");
    expect(() => {
      a.update(0);
      a.update(-1);
      a.update(1e9);
      a.update(Number.NaN);
    }).not.toThrow();
    a.dispose();
  });

  it("dispose is idempotent and parks every entry point", () => {
    const a = new CinematicAudio();
    a.playMusic("cave");
    a.dispose();
    expect(() => {
      a.dispose();
      a.unlock();
      for (const id of SFX_IDS) a.playSfx(id);
      a.playMusic("menu");
      a.update(1 / 60);
      a.stopMusic();
    }).not.toThrow();
    expect(a.muted).toBe(false);
  });

  it("mute state survives live call chains", () => {
    const a = new CinematicAudio();
    a.playMusic("cave");
    a.setMuted(true);
    expect(a.muted).toBe(true);
    expect(() => {
      a.update(1 / 60);
      a.playSfx("shoot");
      a.setSettings({ music: 0.2 });
    }).not.toThrow();
    a.setMuted(false);
    expect(a.muted).toBe(false);
    a.dispose();
  });
});
