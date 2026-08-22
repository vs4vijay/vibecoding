const NS = "zh.";

/**
 * localStorage may be absent outside browsers (vitest node env, workers,
 * hardened sandboxes that throw on access). When missing we install an
 * in-memory shim as `globalThis.localStorage` so bare `localStorage`
 * references keep working; browsers always keep their native storage.
 */
function resolveStorage(): Storage {
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch {
    // Access itself threw (sandbox) — fall through to the shim.
  }
  const map = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
  globalThis.localStorage = shim;
  return shim;
}

const storage = resolveStorage();

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(NS + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  storage.setItem(NS + key, JSON.stringify(value));
}
