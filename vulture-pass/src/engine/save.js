// Versioned localStorage save (D10): serializes GameState with a version
// field; defensive load — unknown version or parse error → null (caller
// offers new game, never crashes).

const KEY = 'vulture-pass-save-v1';
const VERSION = 1;

export function saveGame(state) {
  try {
    const snapshot = { ...state, version: VERSION, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(snapshot));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (data.version !== VERSION) return null; // unknown version → ignore
    // minimal shape validation: a handful of load-bearing fields
    if (typeof data.money !== 'number' || typeof data.day !== 'number' || !data.location) {
      return null;
    }
    return data;
  } catch {
    return null; // parse error → ignore save
  }
}

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
