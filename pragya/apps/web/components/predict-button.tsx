"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PredictButton({ participantId }: { participantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg("Enqueuing prediction job...");
    try {
      const res = await fetch(`/api/participants/${participantId}/predict`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { job_id: string };
      setMsg(`Queued (job ${data.job_id.slice(0, 8)})... polling`);
      // Poll until the job moves out of queued/running.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await fetch(`/api/jobs/${data.job_id}`).then((r) => r.json());
        if (j.status === "succeeded") {
          setMsg(`Done.`);
          router.refresh();
          break;
        }
        if (j.status === "failed") {
          setMsg(`Failed: ${j.error}`);
          break;
        }
      }
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg ? <span className="text-xs text-slate-600">{msg}</span> : null}
      <button className="btn-primary" onClick={run} disabled={busy}>
        {busy ? "Running..." : "Run prediction"}
      </button>
    </div>
  );
}
