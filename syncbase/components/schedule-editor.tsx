"use client";
import { useState } from "react";

export function ScheduleEditor({
  sourceId,
  enabled,
  cron,
}: {
  sourceId: number;
  enabled: boolean;
  cron: string | null;
}) {
  const [value, setValue] = useState(cron ?? "");
  const [enabledV, setEnabledV] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/schedules/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: enabledV,
          schedule_cron: value.trim() === "" ? null : value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "save failed");
      } else {
        setMsg("saved");
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="*/5 * * * *"
        style={{ width: 140 }}
      />
      <label className="muted" style={{ fontSize: "0.85em" }}>
        <input
          type="checkbox"
          checked={enabledV}
          onChange={(e) => setEnabledV(e.target.checked)}
        />{" "}
        enabled
      </label>
      <button onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
