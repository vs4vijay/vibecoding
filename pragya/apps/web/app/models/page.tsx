import { desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db/client";
import { cohorts as cohortsTable, harmonisationRuns, models } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { TrainButton } from "@/components/train-button";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  await ensureSchema();
  const d = db();
  const ms = await d.select().from(models).orderBy(desc(models.createdAt)).limit(50);
  const cohorts = (await d.select().from(cohortsTable)).map((c) => c.id);
  const harm = await d
    .select({ id: harmonisationRuns.id, cohortIds: harmonisationRuns.cohortIds, status: harmonisationRuns.status })
    .from(harmonisationRuns)
    .orderBy(desc(harmonisationRuns.startedAt))
    .limit(10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Models</h1>
          <p className="mt-1 text-sm text-slate-600">{ms.length} models</p>
        </div>
        <TrainButton cohorts={cohorts} harmonisationRuns={harm} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">AUROC (1/3/5y)</th>
              <th className="px-3 py-2">ECE</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ms.map((m) => {
              const auroc = (m.metrics as any)?.auroc ?? {};
              const cale = (m.metrics as any)?.calibration_error ?? {};
              const auh = [auroc["1"], auroc["3"], auroc["5"]].map((v) =>
                v !== undefined ? Number(v).toFixed(2) : "-",
              );
              const eceAvg = Object.values(cale).length
                ? (Object.values(cale).reduce((a: any, b: any) => a + Number(b), 0) /
                    Object.values(cale).length).toFixed(3)
                : "-";
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-mono text-[11px]">{m.id.slice(0, 24)}</td>
                  <td className="px-3 py-2">{m.name}</td>
                  <td className="px-3 py-2">{m.version}</td>
                  <td className="px-3 py-2">
                    {m.isActive ? (
                      <span className="pill border-emerald-300 bg-emerald-50 text-emerald-700">active</span>
                    ) : (
                      <span className="pill border-slate-300 bg-slate-50 text-slate-500">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{auh.join(" / ")}</td>
                  <td className="px-3 py-2">{eceAvg}</td>
                  <td className="px-3 py-2">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <Link className="text-accent hover:underline text-xs" href={`/models/${m.id}/audit`}>
                      Audit →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {ms.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                  No models yet. Click "Train model".
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
