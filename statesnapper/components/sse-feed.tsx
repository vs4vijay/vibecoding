"use client";
import { useEffect, useState } from "react";

type Event = {
  type: "created" | "updated";
  table: string;
  source: string;
  external_id: string;
  hash?: string;
  old_hash?: string;
  new_hash?: string;
  ts: number;
};

export function SseFeed() {
  const [events, setEvents] = useState<Event[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/changes/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("entity_changed", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents((prev) => [{ ...parsed, ts: Date.now() }, ...prev].slice(0, 50));
      } catch {}
    });
    return () => es.close();
  }, []);

  return (
    <div className="col">
      <p className="muted">
        <span style={{ color: connected ? "#7e7" : "#e88" }}>●</span>{" "}
        {connected ? "live" : "disconnected"} · {events.length} events
      </p>
      {events.length === 0 ? (
        <p className="muted">No events yet. Run a source to see changes appear here.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>when</th><th>type</th><th>source</th>
              <th>external_id</th><th>table</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <td className="muted">{new Date(e.ts).toLocaleTimeString()}</td>
                <td><code>{e.type}</code></td>
                <td><code>{e.source}</code></td>
                <td><code>{e.external_id}</code></td>
                <td><code>{e.table}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
