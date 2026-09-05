// Test-support shim: Bun 1.3.x does not provide a `localStorage` global, but
// the modules under test (championship.ts, ghost.ts) touch it inside their
// persistence functions. This Map-backed stand-in satisfies them without any
// DOM — install it once per test file, clear between tests.

export function installMemStorage(): void {
  const backing = new Map<string, string>();
  const shim = {
    getItem(key: string): string | null {
      return backing.has(key) ? backing.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      backing.set(key, String(value));
    },
    removeItem(key: string): void {
      backing.delete(key);
    },
    clear(): void {
      backing.clear();
    },
    key(index: number): string | null {
      return Array.from(backing.keys())[index] ?? null;
    },
    get length(): number {
      return backing.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });
}

/** Wipe every key (call in afterEach so tests stay order-independent). */
export function resetMemStorage(): void {
  globalThis.localStorage.clear();
}
