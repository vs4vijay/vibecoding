"use client";
import { useState } from "react";

export function RunButton({ sourceId }: { sourceId: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function go() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/sources/${sourceId}/run`, { method: "POST" });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col">
      <button onClick={go} disabled={busy}>
        {busy ? "Running…" : "Run now"}
      </button>
      {result && (
        <pre style={{ margin: 0 }}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
