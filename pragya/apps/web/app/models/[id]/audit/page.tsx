import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db/client";
import { audits, cohorts as cohortsTable, models } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { AuditButton } from "@/components/audit-button";
import { CalibrationChart } from "@/components/calibration-chart";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureSchema();
  const { id } = await params;
  const d = db();
  const m = await d.select().from(models).where(eq(models.id, id)).limit(1);
  if (m.length === 0) {
    return <div className="text-sm text-rose-700">Model not found.</div>;
  }
  const model = m[0]!;
  const ar = await d.select().from(audits).where(eq(audits.modelId, id)).orderBy(desc(audits.createdAt)).limit(1);
  const audit = ar[0] ?? null;
  const cohorts = (await d.select().from(cohortsTable)).map((c) => c.id);

  const overall = (model.metrics as any)?.auroc ?? {};
  const overallAuroc1 = Number(overall["1"] ?? 0);
  const overallAuroc3 = Number(overall["3"] ?? 0);
  const overallAuroc5 = Number(overall["5"] ?? 0);

  const subgroups = (audit?.subgroups ?? []) as Array<any>;

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm text-accent hover:underline" href="/models">← Models</Link>
        <h1 className="mt-2 text-2xl font-semibold font-mono">{model.id}</h1>
        <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-600">
          <span className="pill border-slate-300 bg-slate-50">{model.name} v{model.version}</span>
          {model.isActive ? (
            <span className="pill border-emerald-300 bg-emerald-50 text-emerald-700">active</span>
          ) : null}
          <span className="pill border-slate-300 bg-slate-50">AUROC 1/3/5y: {overallAuroc1.toFixed(2)} / {overallAuroc3.toFixed(2)} / {overallAuroc5.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex justify-end">
        <AuditButton modelId={model.id} cohorts={cohorts} />
      </div>

      {audit ? (
        <>
          <section className="card p-4">
            <h2 className="label">Calibration</h2>
            <p className="mt-1 text-xs text-slate-500">Predicted vs observed risk on held-out split.</p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
              {Object.entries((audit.calibration ?? {}) as Record<string, any[]>).map(([h, bins]) => (
                <CalibrationChart key={h} horizon={h} bins={bins as any} />
              ))}
            </div>
          </section>

          <section className="card overflow-hidden">
            <h2 className="label px-4 pt-4">Subgroup fairness</h2>
            <p className="mt-1 px-4 text-xs text-slate-500">
              Per-subgroup AUROC. Cells highlighted if any horizon's AUROC drops &gt;10% from overall.
            </p>
            <table className="mt-3 w-full text-xs">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Subgroup</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">N</th>
                  <th className="px-3 py-2">AUROC 1y</th>
                  <th className="px-3 py-2">AUROC 3y</th>
                  <th className="px-3 py-2">AUROC 5y</th>
                  <th className="px-3 py-2">ECE avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subgroups.map((s, i) => (
                  <Row
                    key={`${s.subgroup}-${s.value}-${i}`}
                    sub={s}
                    overall1={overallAuroc1}
                    overall3={overallAuroc3}
                    overall5={overallAuroc5}
                  />
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <p className="text-sm text-slate-500">No audit yet. Click "Run audit".</p>
      )}
    </div>
  );
}

function Row({
  sub,
  overall1,
  overall3,
  overall5,
}: {
  sub: any;
  overall1: number;
  overall3: number;
  overall5: number;
}) {
  const a1 = Number(sub.auroc?.["1"] ?? 0);
  const a3 = Number(sub.auroc?.["3"] ?? 0);
  const a5 = Number(sub.auroc?.["5"] ?? 0);
  const drift = (v: number, o: number) => (o > 0 ? Math.abs(o - v) / o : 0);
  const flag1 = drift(a1, overall1) > 0.1 ? "bg-rose-50" : "";
  const flag3 = drift(a3, overall3) > 0.1 ? "bg-rose-50" : "";
  const flag5 = drift(a5, overall5) > 0.1 ? "bg-rose-50" : "";
  const eceVals = Object.values(sub.calibration_error ?? {}) as number[];
  const eceAvg = eceVals.length ? (eceVals.reduce((a, b) => a + Number(b), 0) / eceVals.length).toFixed(3) : "-";
  return (
    <tr>
      <td className="px-3 py-2">{sub.subgroup}</td>
      <td className="px-3 py-2 font-mono">{sub.value}</td>
      <td className="px-3 py-2">{sub.n}</td>
      <td className={`px-3 py-2 ${flag1}`}>{a1.toFixed(2)}</td>
      <td className={`px-3 py-2 ${flag3}`}>{a3.toFixed(2)}</td>
      <td className={`px-3 py-2 ${flag5}`}>{a5.toFixed(2)}</td>
      <td className="px-3 py-2">{eceAvg}</td>
    </tr>
  );
}
