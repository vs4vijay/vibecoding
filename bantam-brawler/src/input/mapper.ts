// src/input/mapper.ts — key remapping + persistence under localStorage["bantam.bindings.v1"].
// Storage is injected so Bun tests never touch window.localStorage.
import { MAX_FIGHTERS } from "../sim/constants";
import {
  DEFAULT_KEYMAPS,
  resolveKeymaps,
  type Action,
  type Keymap,
} from "./keyboard";

export const BINDINGS_KEY = "bantam.bindings.v1";

const ACTIONS: readonly Action[] = [
  "attack", "jump", "defend", "up", "down", "left", "right",
];

/** Stored shape: sparse overrides keyed by slot, e.g. { "2": { jump: "Quote" } }. */
export type BindingOverrides = Record<string, Partial<Record<Action, string>>>;

/** Subset of DOM Storage the mapper needs; satisfied by localStorage and test fakes. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Duplicate-binding detection ACROSS all slots: any event.code claimed by more
 * than one player is reported (same-slot collisions are impossible by
 * construction — remap unbinds the code's previous action first).
 */
export function findDuplicateBindings(maps: Keymap[]): string[] {
  const owners = new Map<string, number[]>();
  maps.forEach((map, slot) => {
    for (const code of Object.keys(map)) {
      const list = owners.get(code);
      if (list === undefined) owners.set(code, [slot]);
      else list.push(slot);
    }
  });
  const errors: string[] = [];
  for (const [code, slots] of owners) {
    if (slots.length > 1) {
      errors.push(`"${code}" is bound for multiple players: ${slots.map((s) => `P${s + 1}`).join(", ")}`);
    }
  }
  return errors.sort();
}

/** Overlay sparse overrides onto resolved base maps (an override replaces the action's old key entirely). */
function applyOverrides(base: Keymap[], overrides: BindingOverrides): Keymap[] {
  const out = base.map((m) => ({ ...m }));
  for (const [slotStr, actions] of Object.entries(overrides)) {
    const slot = Number(slotStr);
    const map = Number.isInteger(slot) ? out[slot] : undefined;
    if (map === undefined) continue;
    for (const [action, code] of Object.entries(actions)) {
      if (isAction(action) && typeof code === "string") bind(map, action, code);
    }
  }
  return out;
}
function bind(map: Keymap, action: Action, code: string): void {
  for (const [c, a] of Object.entries(map)) {
    if (a === action || c === code) delete map[c];
  }
  map[code] = action;
}

function isAction(v: unknown): v is Action {
  return typeof v === "string" && (ACTIONS as readonly string[]).includes(v);
}

function sanitize(raw: unknown): BindingOverrides {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: BindingOverrides = {};
  for (const [slotStr, actions] of Object.entries(raw as Record<string, unknown>)) {
    const slot = Number(slotStr);
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_FIGHTERS) continue;
    if (actions === null || typeof actions !== "object") continue;
    const entry: Partial<Record<Action, string>> = {};
    for (const [action, code] of Object.entries(actions as Record<string, unknown>)) {
      if (isAction(action) && typeof code === "string" && code.length > 0) entry[action] = code;
    }
    if (Object.keys(entry).length > 0) out[String(slot)] = entry;
  }
  return out;
}

export interface Mapper {
  /** Effective keymaps (defaults + join fallback + loaded/remapped overrides). */
  bindings(): Keymap[];
  /** Rebind one action; unbinds the code's and the action's previous claims in that slot. */
  remap(slot: number, action: Action, code: string): void;
  /** Cross-slot duplicate report for the CURRENT bindings ([] when clean). */
  duplicateErrors(): string[];
  /** Write sparse overrides to storage. */
  persistBindings(storage: StorageLike): void;
  /** Read + sanitize overrides from storage; corrupt payloads are ignored. */
  loadBindings(storage: StorageLike): void;
}

export function createMapper(options?: { humanSlots?: number[] }): Mapper {
  const humanSlots = options?.humanSlots ?? [0];
  let overrides: BindingOverrides = {};

  const effective = (): Keymap[] =>
    applyOverrides(resolveKeymaps(humanSlots), overrides);

  return {
    bindings: effective,

    remap(slot, action, code) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_FIGHTERS) {
        throw new RangeError(`mapper: slot ${slot} outside 0..${MAX_FIGHTERS - 1}`);
      }
      if (!isAction(action)) throw new TypeError(`mapper: unknown action "${String(action)}"`);
      if (typeof code !== "string" || code.length === 0) throw new TypeError("mapper: code must be a non-empty event.code");
      const slotOverrides = overrides[String(slot)] ?? {};
      slotOverrides[action] = code;
      overrides[String(slot)] = slotOverrides;
    },

    duplicateErrors: () => findDuplicateBindings(effective()),

    persistBindings(storage) {
      storage.setItem(BINDINGS_KEY, JSON.stringify(overrides));
    },

    loadBindings(storage) {
      const raw = storage.getItem(BINDINGS_KEY);
      if (raw === null) return;
      try {
        overrides = sanitize(JSON.parse(raw));
      } catch {
        overrides = {}; // corrupt payload → factory behavior, never crash boot
      }
    },
  };
}
