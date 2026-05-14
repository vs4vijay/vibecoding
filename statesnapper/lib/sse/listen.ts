import { listen } from "../db";

export type EntityChangedEvent = {
  type: "created" | "updated";
  table: string;
  source: string;
  external_id: string;
  hash?: string;
  old_hash?: string;
  new_hash?: string;
};

export async function subscribeEntityChanges(
  onEvent: (ev: EntityChangedEvent, raw: string) => void
): Promise<() => void> {
  const unlisten = await listen("entity_changed", (payload) => {
    try {
      const ev = JSON.parse(payload) as EntityChangedEvent;
      onEvent(ev, payload);
    } catch {
      // ignore unparseable payloads
    }
  });
  return unlisten;
}
