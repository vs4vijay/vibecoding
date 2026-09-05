// Shared time formatting — one implementation for the HUD lap readout, the
// results/podium tables and the title-screen best times, so every race time
// on screen renders identically.

const SECONDS_PER_MINUTE = 60;

/** m:ss.t formatting shared by HUD + screens callers (e.g. 83.42 → "01:23.4"). */
export function formatRaceTime(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = Math.floor(seconds % SECONDS_PER_MINUTE);
  const t = Math.floor((seconds * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
}
