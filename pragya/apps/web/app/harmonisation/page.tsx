import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { harmonisationRuns, cohorts as cohortsTable } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { HarmoniseButton } from "@/components/harmonise-button";
import { HarmonisationBefore } from "@/components/harmonisation-before";

export const dynamic = "force-dynamic";

export default async function HarmonisationPage() {
  await ensureSchema();
  const d = db();
  const runs = await d.select().from(harmonisationRuns).orderBy(desc(harmonisationRuns.startedAt)).limit(50);
  const cohortRows = await d.select().from(cohortsTable);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Harmonisation</h1>
          <p className="mt-1 text-sm text-slate-600">Cross-cohort ComBat-style correction</p>
        </div>
        <HarmoniseButton cohorts={cohortRows.map((c) => c.id)} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Run ID</th>
              <th className="px-3 py-2">Cohorts</th>
              <th className="px-3 py-2">Modalities</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Finished</th>
              <th className="px-3 py-2">Mean shift reduction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((r) => {
              const before = r.beforeMeans ?? {};
              const after = r.afterMeans ?? {};
              const reduction = computeReduction(before, after);
              return (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.id.slice(0, 16)}</td>
                  <td className="px-3 py-2">{(r.cohortIds ?? []).join(", ")}</td>
                  <td className="px-3 py-2">{(r.modalities ?? []).join(", ")}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">{r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "-"}</td>
                  <td className="px-3 py-2">
                    {reduction !== null ? `${(reduction * 100).toFixed(1)}%` : "-"}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  No runs yet. Seed at least two cohorts and click "Run harmonisation".
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {runs[0] ? (
        <section className="card p-4">
          <h2 className="label">Latest run: per-cohort means</h2>
          <HarmonisationBefore
            before={runs[0].beforeMeans ?? {}}
            after={runs[0].afterMeans ?? {}}
          />
        </section>
      ) : null}
    </div>
  );
}

function computeReduction(
  before: Record<string, Record<string, number>>,
  after: Record<string, Record<string, number>>,
): number | null {
  // Average across modalities of (max - min) cohort mean reduction.
  let totalBefore = 0;
  let totalAfter = 0;
  let count = 0;
  for (const m of Object.keys(before)) {
    const bs = Object.values(before[m] ?? {});
    const as_ = Object.values(after[m] ?? {});
    if (bs.length < 2 || as_.length < 2) continue;
    const sb = Math.max(...bs) - Math.min(...bs);
    const sa = Math.max(...as_) - Math.min(...as_);
    totalBefore += sb;
    totalAfter += sa;
    count += 1;
  }
  if (count === 0 || totalBefore === 0) return null;
  return 1 - totalAfter / totalBefore;
}
