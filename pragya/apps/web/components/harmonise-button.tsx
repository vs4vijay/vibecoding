"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HarmoniseButton({ cohorts }: { cohorts: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(cohorts.slice(0, 2)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(c: string) {
    const next = new Set(selected);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setSelected(next);
  }

  async function run() {
    if (selected.size < 2) {
      setMsg("Pick ≥2 cohorts");
      return;
    }
    setBusy(true);
    setMsg("Enqueueing...");
    try {
      const res = await fetch("/api/harmonisation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cohort_ids: Array.from(selected),
          modalities: ["mri", "biochem", "cognitive"],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = (await res.json()) as { job_id: string };
      setMsg(`Queued ${job_id.slice(0, 12)}... polling`);
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
    <div className="flex items-center gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {cohorts.map((c) => (
          <label key={c} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={selected.has(c)} onChange={() => toggle(c)} />
            <span>{c}</span>
          </label>
        ))}
      </div>
      {msg ? <span className="text-xs text-slate-600">{msg}</span> : null}
      <button className="btn-primary" onClick={run} disabled={busy}>
        Run harmonisation
      </button>
    </div>
  );
}
