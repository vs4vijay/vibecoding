// Phase 14: Ghost Car — recording, persistence and cosmetic playback.
//
// During a race game.ts samples P1 every ~100ms as {t, x, z, h} where t is
// lap-relative seconds. When a lap beats the stored best for that track, the
// flat sample buffer is saved to localStorage keyed per track. On later races
// a translucent cyan tank mesh replays the lap on loop by interpolating
// between samples. The ghost is purely cosmetic: it never enters world.tanks,
// so shells/AI/standings/minimap are untouched by construction.

import * as THREE from "three";
import { createTankMesh } from "./tank";

/** Seconds between recorded samples (~10 Hz). */
export const GHOST_SAMPLE_INTERVAL = 0.1;

/** Storage version — bump if the format ever changes; old blobs are dropped. */
export const GHOST_FORMAT_VERSION = 1;

/**
 * One stored ghost lap. `samples` is a FLAT array with stride 4:
 * [t0, x0, z0, h0, t1, x1, z1, h1, …] — t = seconds from lap start,
 * x/z world coords, h = hull heading (radians). Flat keeps the JSON small.
 * `lap` = the recorded lap time in seconds (≈ last sample's t).
 */
export interface GhostRecording {
  v: number;
  /** Lap duration in seconds (redundant with the last sample; speeds checks). */
  lap: number;
  /** Flat stride-4 sample buffer, coords rounded to 2 decimals. */
  samples: number[];
}

function ghostKey(trackId: string): string {
  return `tankracer.ghost.${trackId}`;
}

/**
 * Load + validate a track's ghost recording. Returns null on missing key,
 * parse errors, wrong version, malformed buffers or non-finite numbers —
 * a corrupted blob must never crash the race loop, just disable the ghost.
 */
export function loadGhost(trackId: string): GhostRecording | null {
  try {
    const raw = localStorage.getItem(ghostKey(trackId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GhostRecording>;
    if (parsed.v !== GHOST_FORMAT_VERSION) return null;
    if (typeof parsed.lap !== "number" || !(parsed.lap > 0)) return null;
    if (!Array.isArray(parsed.samples)) return null;
    // Need at least 2 complete samples to interpolate between
    if (
      parsed.samples.length < 8 ||
      parsed.samples.length % 4 !== 0 ||
      !parsed.samples.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      return null;
    }
    // Samples must be time-ascending within the lap (guards against garbage)
    for (let i = 4; i < parsed.samples.length; i += 4) {
      if (parsed.samples[i] <= parsed.samples[i - 4]) return null;
    }
    return { v: GHOST_FORMAT_VERSION, lap: parsed.lap, samples: parsed.samples };
  } catch {
    return null; // private mode, quota errors, JSON.parse throws — all → no ghost
  }
}

/** Persist a ghost recording. Failures (quota/private mode) silently skip. */
export function storeGhost(trackId: string, rec: GhostRecording): void {
  try {
    localStorage.setItem(ghostKey(trackId), JSON.stringify(rec));
  } catch {
    /* records just won't persist */
  }
}

// ---------------------------------------------------------------------------
// Recorder — fed once per simulated frame while P1 races
// ---------------------------------------------------------------------------

export interface GhostRecorder {
  /** Best completed lap captured this race (null = none finished yet). */
  bestTime: number | null;
  bestSamples: number[] | null;
  reset(): void;
  /** Accumulate one frame of P1 driving; emits a sample every ~100 ms. */
  observe(dt: number, x: number, z: number, heading: number): void;
  /**
   * Finalize the lap that just ended (call exactly once per P1 "lap" progress
   * event). Keeps the buffer if it beat everything seen this race, then starts
   * a fresh one for the next lap.
   */
  completeLap(): void;
}

export function createGhostRecorder(): GhostRecorder {
  let buf: number[] = [];
  let elapsed = 0; // accumulated sim dt since lap start (= current sample clock)
  let pending = 0; // time since the last emitted sample

  return {
    bestTime: null,
    bestSamples: null,

    reset() {
      buf = [];
      elapsed = 0;
      pending = 0;
      this.bestTime = null;
      this.bestSamples = null;
    },

    observe(dt, x, z, heading) {
      elapsed += dt;
      pending += dt;
      if (pending < GHOST_SAMPLE_INTERVAL) return;
      pending -= GHOST_SAMPLE_INTERVAL;
      // Round to keep each number ~5 chars in JSON (2 decimals everywhere)
      buf.push(
        round2(elapsed),
        round2(x),
        round2(z),
        round2(heading),
      );
    },

    completeLap() {
      // A valid lap needs ≥2 samples and a sane duration (wreck-respawn
      // shortcuts can produce near-zero junk laps — drop those).
      if (buf.length >= 8 && elapsed > 5) {
        if (this.bestTime === null || elapsed < this.bestTime) {
          this.bestTime = elapsed;
          this.bestSamples = buf.slice();
        }
      }
      buf = [];
      elapsed = 0;
      pending = 0;
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Playback — a translucent cyan-white clone of the standard tank mesh
// ---------------------------------------------------------------------------

const GHOST_OPACITY = 0.35;

export interface GhostPlayer {
  root: THREE.Group;
  /** Show + rewind to t=0 (race start). */
  begin(rec: GhostRecording): void;
  /** Advance playback; loops seamlessly across the last→first sample gap. */
  update(dt: number): void;
  /** Hide (title screen / disabled toggle). */
  hide(): void;
}

/**
 * Build the cosmetic ghost tank. Reuses createTankMesh (same low-poly look),
 * then makes every material transparent, shadow-free and depth-write-free so
 * it reads as a hologram and can't z-fight the road.
 */
export function createGhostPlayer(scene: THREE.Scene): GhostPlayer {
  const mesh = createTankMesh(0x7fe9ff, 0xd9fbff); // cyan-white hologram livery
  mesh.root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    m.castShadow = false;
    const mat = m.material as THREE.MeshLambertMaterial | undefined;
    if (mat) {
      mat.transparent = true;
      mat.opacity = GHOST_OPACITY;
      mat.depthWrite = false;
    }
  });
  mesh.root.visible = false;
  scene.add(mesh.root);

  let rec: GhostRecording | null = null;
  let clock = 0;

  return {
    root: mesh.root,

    begin(newRec) {
      rec = newRec;
      clock = 0;
      mesh.root.visible = newRec.samples.length >= 8;
    },

    update(dt) {
      if (!rec || !mesh.root.visible) return;
      const s = rec.samples;
      const n = s.length / 4;
      const duration = Math.max(rec.lap, s[(n - 1) * 4]);
      clock += dt;
      if (clock >= duration) clock -= duration; // seamless loop restart

      // Locate the segment containing `clock`. Samples are ~100ms apart and
      // n ≤ a few hundred, so a linear scan is fine (and allocation-free).
      // Forward segments run sample[i] → sample[i+1]; once clock passes the
      // last sample's t we're on the WRAP segment sample[n-1] → sample[0].
      let i = 0;
      while (i <= n - 2 && s[(i + 1) * 4] <= clock) i++;
      const wrapped = i === n - 1;

      const idxA = i * 4;
      const idxB = wrapped ? 0 : (i + 1) * 4;
      const ta = s[idxA];
      // Unwrapped end time: past the lap edge the next tick is firstSample+lap
      const tb = wrapped ? duration + s[0] : s[idxB];
      const span = tb - ta;
      // Clamp: in the tiny gap before the first sample (lap restart), hold
      // near sample 0 rather than extrapolating backwards past the line.
      const alpha = span > 0 ? Math.min(1, Math.max(0, (clock - ta) / span)) : 0;

      mesh.root.position.set(
        lerp(s[idxA + 1], s[idxB + 1], alpha),
        0,
        lerp(s[idxA + 2], s[idxB + 2], alpha),
      );
      mesh.root.rotation.y = lerpAngle(s[idxA + 3], s[idxB + 3], alpha);
    },

    hide() {
      mesh.root.visible = false;
      rec = null;
    },
  };
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** Shortest-path angle lerp — headings may straddle the ±π wrap. */
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
