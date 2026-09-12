// src/audio/audio.ts — pure SimEvent→SFX mapping + gesture-unlocked WebAudio engine.
//
// The mapping (eventToSfx) is pure so Bun tests cover it directly. The engine
// (createAudio) is thin browser glue: the AudioContext is created suspended,
// buffers are lazily decoded on the first user gesture (unlock()), and output
// flows through a Master ← {Music, Sfx} gain chain. Every AudioContext touch
// is runtime-guarded, so the module loads (and mute logic works) under Bun,
// where no WebAudio exists.
import type { SimEvent } from "../sim/types";
import type { StorageLike } from "../input/mapper";

/** Persistence key for the mute flag (survives reload). */
export const MUTED_KEY = "tiny.muted";

/**
 * Spec §4 sound bank keys reachable from simulation events. `whiff` and the
 * `menu_*` keys belong to the bank but have no sim-event trigger yet (UI-side
 * wiring comes later); they ship as assets so wiring them needs no new files.
 */
export type SfxKey =
  | "hit_light" | "hit_heavy" | "block" | "whiff" | "jump" | "land" | "dash"
  | "grab" | "ko" | "weapon_pickup" | "weapon_break" | "item_drop"
  | "cast_fire" | "cast_ice" | "menu_move" | "menu_confirm";

/** One music loop per shipped stage; unknown stages fall back to the default. */
export type MusicKey = "rooftop" | "grassland";

const DEFAULT_MUSIC: MusicKey = "rooftop";

const STAGE_MUSIC: Record<string, MusicKey> = {
  "rooftop-night": "rooftop",
  "grassland-dojo": "grassland",
};

/** Bank manifest — public/assets/audio mirrors these paths exactly. */
export const SFX_FILES: Record<SfxKey, string> = {
  hit_light: "assets/audio/sfx/hit-light.mp3",
  hit_heavy: "assets/audio/sfx/hit-heavy.mp3",
  block: "assets/audio/sfx/block.mp3",
  whiff: "assets/audio/sfx/whiff.mp3",
  jump: "assets/audio/sfx/jump.mp3",
  land: "assets/audio/sfx/land.mp3",
  dash: "assets/audio/sfx/dash.mp3",
  grab: "assets/audio/sfx/grab.mp3",
  ko: "assets/audio/sfx/ko.mp3",
  weapon_pickup: "assets/audio/sfx/weapon-pickup.mp3",
  weapon_break: "assets/audio/sfx/weapon-break.mp3",
  item_drop: "assets/audio/sfx/item-drop.mp3",
  cast_fire: "assets/audio/sfx/cast-fire.mp3",
  cast_ice: "assets/audio/sfx/cast-ice.mp3",
  menu_move: "assets/audio/sfx/menu-move.mp3",
  menu_confirm: "assets/audio/sfx/menu-confirm.mp3",
};

export const MUSIC_FILES: Record<MusicKey, string> = {
  rooftop: "assets/audio/music/rooftop-night-loop.mp3",
  grassland: "assets/audio/music/grassland-dojo-loop.mp3",
};

/**
 * Pure SimEvent → bank-key mapping. Returns null for events with no sound in
 * the spec §4 bank (thrown, itemConsumed, matchEnd); callers skip those.
 */
export function eventToSfx(e: SimEvent): SfxKey | null {
  switch (e.type) {
    case "hit":
      return e.blocked ? "block" : e.heavy ? "hit_heavy" : "hit_light";
    case "ko":
      return "ko";
    case "landed":
      return "land";
    case "jump":
      return "jump";
    case "dash":
      return "dash";
    case "grab":
      return "grab";
    case "castFire":
      return "cast_fire";
    case "castIce":
      return "cast_ice";
    case "weaponPickup":
      return "weapon_pickup";
    case "weaponBreak":
      return "weapon_break";
    case "itemDrop":
      return "item_drop";
    case "thrown":
    case "itemConsumed":
    case "matchEnd":
      return null;
  }
}

export interface AudioEngine {
  /** Route one simulation event to its bank sound (null-mapped events are skipped). */
  onEvent(e: SimEvent): void;
  /** Start (or switch to) the stage's music loop; defers until unlock(). */
  playMusic(stageId: string): void;
  /** Flip the mute flag, persist it under tiny.muted, return the new state. */
  toggleMute(): boolean;
  /** Resume the suspended context and lazily decode every buffer (first gesture). */
  unlock(): Promise<void>;
}

function defaultStorage(): StorageLike | undefined {
  // Guarded so Bun (no window.localStorage in some embeds) never throws.
  if (typeof localStorage === "undefined") return undefined;
  return localStorage;
}

export function createAudio(deps: { storage?: StorageLike } = {}): AudioEngine {
  const storage = deps.storage ?? defaultStorage();

  let muted = storage?.getItem(MUTED_KEY) === "true";

  // --- Context + gain chain (browser-only; undefined under Bun/tests). -------
  const ctx = makeContext();
  let master: GainNode | undefined;
  let musicGain: GainNode | undefined;
  let sfxGain: GainNode | undefined;
  if (ctx) {
    master = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.gain.value = 0.6;
    sfxGain.gain.value = 0.9;
    musicGain.connect(master);
    sfxGain.connect(master);
    master.connect(ctx.destination);
    master.gain.value = muted ? 0 : 1;
  }

  const sfxBuffers = new Map<SfxKey, AudioBuffer>();
  const musicBuffers = new Map<MusicKey, AudioBuffer>();

  let currentMusic: { key: MusicKey; source: AudioBufferSourceNode } | null = null;
  let pendingStageId: string | null = null;
  let unlocking: Promise<void> | null = null;

  function makeContext(): AudioContext | undefined {
    const AC = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
    if (AC === undefined) return undefined;
    try {
      const c = new AC();
      // Contract: context stays suspended until the first gesture unlocks it.
      if (c.state === "running") void c.suspend();
      return c;
    } catch {
      return undefined;
    }
  }

  async function decodeOne(url: string): Promise<AudioBuffer | null> {
    if (ctx === undefined) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null; // Missing/corrupt asset degrades to silence, never a crash.
    }
  }

  async function decodeAll(): Promise<void> {
    if (ctx === undefined) return;
    const jobs: Array<Promise<void>> = [];
    for (const [key, url] of Object.entries(SFX_FILES) as Array<[SfxKey, string]>) {
      jobs.push(
        decodeOne(url).then((buf) => {
          if (buf !== null) sfxBuffers.set(key, buf);
        }),
      );
    }
    for (const [key, url] of Object.entries(MUSIC_FILES) as Array<[MusicKey, string]>) {
      jobs.push(
        decodeOne(url).then((buf) => {
          if (buf !== null) musicBuffers.set(key, buf);
        }),
      );
    }
    await Promise.all(jobs);
  }

  function stopMusic(): void {
    if (currentMusic === null) return;
    try {
      currentMusic.source.stop();
    } catch {
      // Already stopped — nothing to do.
    }
    currentMusic = null;
  }

  function startMusic(key: MusicKey): void {
    if (ctx === undefined || musicGain === undefined) return;
    const buf = musicBuffers.get(key);
    if (buf === undefined) return;
    if (currentMusic?.key === key) return; // Already looping this track.
    stopMusic();
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    source.connect(musicGain);
    source.start();
    currentMusic = { key, source };
  }

  function unlock(): Promise<void> {
    if (ctx === undefined) return Promise.resolve();
    // Memoized so mashing keys coalesces into one decode/resume pass.
    if (unlocking === null) {
      unlocking = (async () => {
        try {
          await ctx.resume();
        } catch {
          // Some browsers reject resume without a trusted gesture; retrying on
          // the next gesture is handled by the caller re-invoking unlock.
        }
        await decodeAll();
        if (pendingStageId !== null) startMusic(STAGE_MUSIC[pendingStageId] ?? DEFAULT_MUSIC);
        unlocking = null; // Allow a fresh pass if resume failed this time.
      })();
    }
    return unlocking;
  }

  function playSfx(key: SfxKey): void {
    if (ctx === undefined || sfxGain === undefined) return;
    const buf = sfxBuffers.get(key);
    if (buf === undefined) return; // Not yet unlocked (or asset failed) — skip.
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(sfxGain);
    source.start();
  }

  return {
    onEvent(e: SimEvent): void {
      const key = eventToSfx(e);
      if (key !== null) playSfx(key);
    },

    playMusic(stageId: string): void {
      const key = STAGE_MUSIC[stageId] ?? DEFAULT_MUSIC;
      if (ctx === undefined || musicBuffers.size === 0) {
        pendingStageId = stageId; // Defer until unlock() finishes decoding.
        return;
      }
      startMusic(key);
    },

    toggleMute(): boolean {
      muted = !muted;
      try {
        storage?.setItem(MUTED_KEY, String(muted));
      } catch {
        // Quota/private-mode failures must not break the toggle.
      }
      if (master !== undefined) master.gain.value = muted ? 0 : 1;
      return muted;
    },

    unlock,
  };
}
