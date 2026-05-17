"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "happns:saved";
const LEGACY_STORAGE_KEY = "meetup-lite:saved";
const CHANGE_EVENT = "happns:saved-change";

export interface SavedEvent {
  id: string;
  groupSlug: string;
  title: string;
  dateTime: string;
  savedAt: string;
}

/**
 * One-shot: if the legacy "meetup-lite:saved" key exists and the new key
 * doesn't, copy entries over. Runs lazily on first read. We never write the
 * legacy key again after this, so it's safe to leave behind in case the user
 * downgrades — but we delete it to keep their localStorage tidy.
 */
function migrateLegacy(): void {
  if (typeof window === "undefined") return;
  const ls = window.localStorage;
  if (ls.getItem(STORAGE_KEY) !== null) return;
  const legacy = ls.getItem(LEGACY_STORAGE_KEY);
  if (legacy === null) return;
  ls.setItem(STORAGE_KEY, legacy);
  ls.removeItem(LEGACY_STORAGE_KEY);
}

function readFromStorage(): SavedEvent[] {
  if (typeof window === "undefined") return [];
  try {
    migrateLegacy();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedEvent);
  } catch {
    return [];
  }
}

function writeToStorage(items: SavedEvent[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function isSavedEvent(v: unknown): v is SavedEvent {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.groupSlug === "string" &&
    typeof r.title === "string" &&
    typeof r.dateTime === "string"
  );
}

function keyOf(groupSlug: string, id: string): string {
  return `${groupSlug}:${id}`;
}

// useSyncExternalStore needs stable references for `getSnapshot` —
// cache the parsed list and only return a new array when the raw JSON changes.
let cachedRaw: string | null = null;
let cachedList: SavedEvent[] = [];

function getSnapshot(): SavedEvent[] {
  if (typeof window === "undefined") return EMPTY;
  migrateLegacy();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  cachedList = readFromStorage();
  return cachedList;
}

const EMPTY: SavedEvent[] = [];

function getServerSnapshot(): SavedEvent[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useSavedEvents(): {
  saved: SavedEvent[];
  isSaved: (groupSlug: string, id: string) => boolean;
  toggleSaved: (item: Omit<SavedEvent, "savedAt">) => void;
  removeSaved: (groupSlug: string, id: string) => void;
} {
  const saved = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isSaved = useCallback(
    (groupSlug: string, id: string) =>
      saved.some((e) => keyOf(e.groupSlug, e.id) === keyOf(groupSlug, id)),
    [saved],
  );

  const toggleSaved = useCallback((item: Omit<SavedEvent, "savedAt">) => {
    const current = readFromStorage();
    const key = keyOf(item.groupSlug, item.id);
    const exists = current.some((e) => keyOf(e.groupSlug, e.id) === key);
    const next = exists
      ? current.filter((e) => keyOf(e.groupSlug, e.id) !== key)
      : [...current, { ...item, savedAt: new Date().toISOString() }];
    writeToStorage(next);
  }, []);

  const removeSaved = useCallback((groupSlug: string, id: string) => {
    const key = keyOf(groupSlug, id);
    const next = readFromStorage().filter(
      (e) => keyOf(e.groupSlug, e.id) !== key,
    );
    writeToStorage(next);
  }, []);

  return { saved, isSaved, toggleSaved, removeSaved };
}
