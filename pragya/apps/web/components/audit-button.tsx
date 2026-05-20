"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuditButton({ modelId, cohorts }: { modelId: string; cohorts: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg("Enqueueing...");
    try {
      const res = await fetch(`/api/models/${modelId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort_ids: cohorts, seed: 42 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = (await res.json()) as { job_id: string };
      setMsg(`Queued ${job_id.slice(0, 12)}... auditing`);
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await fetch(`/api/jobs/${job_id}`).then((r) => r.json());
        if (j.status === "succeeded") {
          setMsg("Done.");
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
        Run audit
      </button>
    </div>
  );
}
