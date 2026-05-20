"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type HarmRun = { id: string; cohortIds: string[] | null; status: string };

export function TrainButton({
  cohorts,
  harmonisationRuns,
}: {
  cohorts: string[];
  harmonisationRuns: HarmRun[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(cohorts));
  const [harmId, setHarmId] = useState<string>(harmonisationRuns[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(c: string) {
    const next = new Set(selected);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setSelected(next);
  }

  async function run() {
    if (selected.size === 0) {
      setMsg("Pick ≥1 cohort");
      return;
    }
    setBusy(true);
    setMsg("Enqueueing...");
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cohort_ids: Array.from(selected),
          modalities: ["mri", "biochem", "cognitive"],
          horizons_years: [1, 3, 5],
          ensemble_size: 3,
          seed: 42,
          harmonisation_run_id: harmId || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = (await res.json()) as { job_id: string };
      setMsg(`Queued ${job_id.slice(0, 12)}... training`);
      for (let i = 0; i < 120; i++) {
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
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {cohorts.map((c) => (
          <label key={c} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={selected.has(c)} onChange={() => toggle(c)} />
            <span>{c}</span>
          </label>
        ))}
        <label className="ml-3 inline-flex items-center gap-1">
          <span className="text-slate-500">harmonised:</span>
          <select className="select" value={harmId} onChange={(e) => setHarmId(e.target.value)}>
            <option value="">(none)</option>
            {harmonisationRuns.map((h) => (
              <option key={h.id} value={h.id}>
                {h.id.slice(0, 16)} ({(h.cohortIds ?? []).join(",")})
              </option>
            ))}
          </select>
        </label>
        {msg ? <span className="text-xs text-slate-600">{msg}</span> : null}
        <button className="btn-primary" onClick={run} disabled={busy}>
          {busy ? "Training..." : "Train model"}
        </button>
      </div>
    </div>
  );
}
