import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureSchema } from "@/lib/db/bootstrap";
import { getParticipantDetail } from "@/lib/db/queries";
import { PredictButton } from "@/components/predict-button";
import { RiskChart } from "@/components/risk-chart";

export const dynamic = "force-dynamic";

export default async function ParticipantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureSchema();
  const { id } = await params;
  const detail = await getParticipantDetail(id);
  if (!detail) notFound();

  const { participant, visits, outcome, predictions } = detail;
  // Group predictions by run (madeAt) so we can show the most recent at the top.
  const latestModelId = predictions[0]?.modelId;
  const latestSet = predictions.filter((p) => p.modelId === latestModelId);

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm text-accent hover:underline" href="/participants">← Participants</Link>
        <h1 className="mt-2 text-2xl font-semibold font-mono">{participant.id}</h1>
        <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-600">
          <span className="pill border-slate-300 bg-slate-50">cohort: {participant.cohortId}</span>
          <span className="pill border-slate-300 bg-slate-50">age: {participant.ageBaseline.toFixed(1)}</span>
          <span className="pill border-slate-300 bg-slate-50">sex: {participant.sex}</span>
          <span className="pill border-slate-300 bg-slate-50">edu: {participant.educationYears}y</span>
          <span className="pill border-slate-300 bg-slate-50">{participant.urbanRural}</span>
          <span className={`pill ${participant.apoe4Carrier ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-slate-50"}`}>
            ApoE4 {participant.apoe4Carrier ? "+" : "−"}
          </span>
          {outcome ? (
            <span className={`pill ${outcome.mciStatus ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-300 bg-slate-50"}`}>
              outcome: {outcome.mciStatus ? `MCI @ ${outcome.timeYears.toFixed(1)}y` : `censored ${outcome.timeYears.toFixed(1)}y`}
            </span>
          ) : null}
        </div>
      </div>

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="label">Risk prediction</h2>
          <PredictButton participantId={participant.id} />
        </div>
        {latestSet.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No predictions yet. Click "Run prediction".</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <RiskChart predictions={latestSet} />
            <PredictionTable predictions={latestSet} />
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="label px-4 pt-4">Visits ({visits.length})</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">Memory</th>
                <th className="px-3 py-2">MMSE</th>
                <th className="px-3 py-2">Hippo L/R</th>
                <th className="px-3 py-2">Cortical thick.</th>
                <th className="px-3 py-2">HbA1c</th>
                <th className="px-3 py-2">SBP/DBP</th>
                <th className="px-3 py-2">BMI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visits.map((v) => (
                <tr key={v.id}>
                  <td className="px-3 py-2 font-mono">{v.visitIndex}</td>
                  <td className="px-3 py-2">{v.ageAtVisit.toFixed(1)}</td>
                  <td className="px-3 py-2">{v.cognitive?.memory.toFixed(2) ?? "-"}</td>
                  <td className="px-3 py-2">{v.cognitive?.mmse.toFixed(1) ?? "-"}</td>
                  <td className="px-3 py-2">
                    {v.mri ? `${Math.round(v.mri.hippocampusL)}/${Math.round(v.mri.hippocampusR)}` : "-"}
                  </td>
                  <td className="px-3 py-2">{v.mri?.corticalThicknessMean.toFixed(2) ?? "-"}</td>
                  <td className="px-3 py-2">{v.biochem?.hba1c.toFixed(1) ?? "-"}</td>
                  <td className="px-3 py-2">
                    {v.biochem ? `${Math.round(v.biochem.sbp)}/${Math.round(v.biochem.dbp)}` : "-"}
                  </td>
                  <td className="px-3 py-2">{v.biochem?.bmi.toFixed(1) ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {predictions.length > latestSet.length ? (
        <section className="card overflow-hidden">
          <h2 className="label px-4 pt-4">Prediction history</h2>
          <PredictionHistory predictions={predictions.slice(latestSet.length)} />
        </section>
      ) : null}
    </div>
  );
}

function PredictionTable({ predictions }: { predictions: any[] }) {
  const sorted = [...predictions].sort((a, b) => a.horizonYears - b.horizonYears);
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-2 py-1 text-left">Horizon</th>
          <th className="px-2 py-1 text-left">Risk</th>
          <th className="px-2 py-1 text-left">80% CI</th>
          <th className="px-2 py-1 text-left">95% CI</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.id} className="border-t border-slate-100">
            <td className="px-2 py-1">{p.horizonYears}y</td>
            <td className="px-2 py-1 font-semibold">{(p.riskPoint * 100).toFixed(1)}%</td>
            <td className="px-2 py-1 text-slate-600">
              [{(p.riskLo80 * 100).toFixed(1)}, {(p.riskHi80 * 100).toFixed(1)}]
            </td>
            <td className="px-2 py-1 text-slate-600">
              [{(p.riskLo95 * 100).toFixed(1)}, {(p.riskHi95 * 100).toFixed(1)}]
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PredictionHistory({ predictions }: { predictions: any[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left">When</th>
          <th className="px-3 py-2 text-left">Model</th>
          <th className="px-3 py-2 text-left">Horizon</th>
          <th className="px-3 py-2 text-left">Risk</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {predictions.map((p) => (
          <tr key={p.id}>
            <td className="px-3 py-2">{new Date(p.madeAt).toLocaleString()}</td>
            <td className="px-3 py-2">{p.modelName ?? p.modelId}@{p.modelVersion ?? "?"}</td>
            <td className="px-3 py-2">{p.horizonYears}y</td>
            <td className="px-3 py-2">{(p.riskPoint * 100).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
