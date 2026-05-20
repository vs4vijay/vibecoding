"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EnqueueNoopButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function enqueue() {
    setBusy(true);
    setMsg("Enqueueing...");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "noop", payload: { sleep_ms: 1000 } }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = (await res.json()) as { id: string };
      setMsg(`Queued ${id.slice(0, 12)}...`);
      router.refresh();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg ? <span className="text-xs text-slate-600">{msg}</span> : null}
      <button className="btn-primary" onClick={enqueue} disabled={busy}>
        Enqueue noop
      </button>
    </div>
  );
}
