// src/core/Events.ts
import type { GameEvent } from "./types";

type Handler<T extends GameEvent["type"]> = (e: Extract<GameEvent, { type: T }>) => void;
const listeners = new Map<GameEvent["type"], Set<Handler<GameEvent["type"]>>>();

export function on<T extends GameEvent["type"]>(type: T, fn: Handler<T>): () => void {
  let set = listeners.get(type);
  if (!set) { set = new Set(); listeners.set(type, set); }
  set.add(fn as unknown as Handler<GameEvent["type"]>);
  return () => { set!.delete(fn as unknown as Handler<GameEvent["type"]>); };
}

export function emit(e: GameEvent): void {
  const set = listeners.get(e.type);
  if (!set) return;
  for (const fn of [...set]) (fn as (ev: GameEvent) => void)(e);
}

export function clearAll(): void { listeners.clear(); }
