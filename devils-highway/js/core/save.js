/**
 * @file core/save.js — versioned localStorage (bible rule 6): endless.save.v1.
 * Settings persistence (quality), best distances, currency for later slices.
 * All access guarded — private-mode storage must degrade silently.
 */
import { CONFIG } from "./config.js";

const DEFAULTS = Object.freeze({
  v: 1,
  settings: { quality: null, timeOfDay: null },
  best: { run: 0, drive: 0, ride: 0 },
  currency: 0,
  lastMode: "drive",
});

function merge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    const b = base ? base[k] : undefined;
    const p = patch[k];
    out[k] =
      p && typeof p === "object" && !Array.isArray(p) && b && typeof b === "object"
        ? merge(b, p)
        : p;
  }
  return out;
}

export function loadSave() {
  let data = merge(DEFAULTS, {});
  try {
    const raw = localStorage.getItem(CONFIG.SAVE_KEY);
    if (raw) data = merge(DEFAULTS, JSON.parse(raw));
  } catch {
    /* corrupt/unavailable storage — keep defaults */
  }
  return data;
}

export function saveSave(data) {
  try {
    data.v = 1;
    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(data));
  } catch {
    /* degrade silently */
  }
}

export function saveSettings(save, patch) {
  save.settings = { ...save.settings, ...patch };
  saveSave(save);
  return save.settings;
}

/** @returns {boolean} true when a new best was recorded. */
export function recordBest(save, mode, distance) {
  if (!["run", "drive", "ride"].includes(mode)) return false;
  const d = Math.max(0, Math.floor(distance));
  if (d <= (save.best[mode] || 0)) return false;
  save.best[mode] = d;
  saveSave(save);
  return true;
}
