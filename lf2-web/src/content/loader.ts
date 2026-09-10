// Content loader pipeline (spec §3.7):
//   fetch-all → parse → validate per kind → cross-link → deep-freeze → cache.
// Every violation across every file accumulates; a single ContentLoadError
// reports them all only at the end.
import type { CharacterSheet, Layer, StageRuntime } from "../sim/types";
import type { ItemDef, WeaponDef } from "../sim/world";
import {
  crossLinkCharacterSheet,
  crossLinkDrops,
  validateCharacterSheet,
  validateItems,
  validateStage,
  validateWeapons,
  type FieldError,
} from "./schema";

/** Thrown once, after all files are processed, listing every violation. */
export class ContentLoadError extends Error {
  readonly errors: FieldError[];

  constructor(errors: FieldError[]) {
    super(
      `content load failed with ${errors.length} error(s):\n`
      + errors.map((e) => `${e.file} :: ${e.pointer} — ${e.message}`).join("\n"),
    );
    this.name = "ContentLoadError";
    this.errors = errors;
  }
}

export interface ContentCache {
  sheets: Map<string, CharacterSheet>;
  stages: Map<string, StageRuntime & { layers: Layer[] }>;
  weapons: Record<string, WeaponDef>;
  items: Record<string, ItemDef>;
  errors: FieldError[];
}

const DATA_BASE = "/assets-data/";

export const CHARACTER_FILES = [
  "brawler", "swordsman", "fire-caster", "ice-caster", "ninja", "support-mage",
] as const;

export const STAGE_FILES = ["grassland-dojo", "rooftop-night"] as const;

const MANIFEST: readonly string[] = [
  ...CHARACTER_FILES.map((id) => `characters/${id}.json`),
  ...STAGE_FILES.map((id) => `stages/${id}.json`),
  "weapons.json",
  "items.json",
];

type Obj = Record<string, unknown>;

interface LoadedFile {
  name: string;
  value?: unknown;
  /** Fetch/HTTP-level failure (JSON syntax error, non-2xx, network). */
  fatal?: FieldError;
}

async function readAll(inject?: Record<string, unknown>, base = DATA_BASE): Promise<LoadedFile[]> {
  if (inject !== undefined) {
    return Object.entries(inject).map(([name, value]) => ({ name, value }));
  }
  return Promise.all(
    MANIFEST.map(async (path): Promise<LoadedFile> => {
      try {
        const res = await fetch(base + path);
        if (!res.ok) {
          return { name: path, fatal: { file: path, pointer: "", message: `fetch failed with HTTP ${res.status}` } };
        }
        return { name: path, value: await res.json() };
      } catch (e) {
        const message = e instanceof SyntaxError
          ? `JSON syntax error: ${e.message}`
          : `fetch failed: ${String(e)}`;
        return { name: path, fatal: { file: path, pointer: "", message } };
      }
    }),
  );
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const obj: object = value;
  for (const child of Object.values(obj)) deepFreeze(child);
  Object.freeze(obj);
}

/**
 * Loads all game content. Pass `inject` to bypass fetching (tests feed
 * fixture/data objects keyed by manifest-relative paths like
 * `"characters/brawler.json"`).
 */
export async function loadAllContent(
  inject?: Record<string, unknown>,
  fetchBase = DATA_BASE,
): Promise<ContentCache> {
  const loaded = await readAll(inject, fetchBase);
  const errors: FieldError[] = [];

  let weaponsRaw: Obj | undefined;
  let itemsRaw: Obj | undefined;
  const stageRaws: Array<{ name: string; raw: Obj }> = [];

  for (const f of loaded) {
    if (f.fatal !== undefined) {
      errors.push(f.fatal);
      continue;
    }
    const raw = f.value;
    let errs: FieldError[];
    if (f.name.startsWith("characters/")) {
      errs = [...validateCharacterSheet(raw, f.name), ...crossLinkCharacterSheet(raw, f.name)];
    } else if (f.name.startsWith("stages/")) {
      errs = validateStage(raw, f.name);
      if (isObj(raw)) stageRaws.push({ name: f.name, raw });
    } else if (f.name === "weapons.json") {
      errs = validateWeapons(raw, f.name);
      if (errs.length === 0 && isObj(raw)) weaponsRaw = raw;
    } else if (f.name === "items.json") {
      errs = validateItems(raw, f.name);
      if (errs.length === 0 && isObj(raw)) itemsRaw = raw;
    } else {
      errs = [{ file: f.name, pointer: "", message: "unknown content file" }];
    }
    errors.push(...errs);
  }

  // Cross-stage link: drop tables must reference declared weapons ∪ items.
  if (weaponsRaw !== undefined && itemsRaw !== undefined) {
    for (const { name, raw } of stageRaws) {
      errors.push(...crossLinkDrops(raw, weaponsRaw, itemsRaw, name));
    }
  }

  if (errors.length > 0) throw new ContentLoadError(errors);

  const sheets = new Map<string, CharacterSheet>();
  const stages = new Map<string, StageRuntime & { layers: Layer[] }>();
  const weapons: Record<string, WeaponDef> = {};
  const items: Record<string, ItemDef> = {};

  for (const f of loaded) {
    if (f.fatal !== undefined) continue;
    const raw = f.value;
    if (f.name.startsWith("characters/") && isObj(raw)) {
      deepFreeze(raw);
      // Trust boundary: raw passed validateCharacterSheet + cross-link above.
      const sheet = raw as unknown as CharacterSheet;
      sheets.set(String(sheet.id), sheet);
    } else if (f.name.startsWith("stages/") && isObj(raw)) {
      deepFreeze(raw);
      // Trust boundary: raw passed validateStage + drop cross-link above.
      const stage = raw as unknown as StageRuntime & { layers: Layer[] };
      stages.set(String(stage.id), stage);
    } else if (f.name === "weapons.json" && isObj(raw)) {
      deepFreeze(raw);
      Object.assign(weapons, raw as Record<string, WeaponDef>);
    } else if (f.name === "items.json" && isObj(raw)) {
      deepFreeze(raw);
      Object.assign(items, raw as Record<string, ItemDef>);
    }
  }

  return { sheets, stages, weapons, items, errors: [] };
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
