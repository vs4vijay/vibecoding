import { mlClient } from "@/lib/api-client/ml";
import { getConfig } from "@/lib/config";
import { ensureSchema } from "@/lib/db/bootstrap";

export const dynamic = "force-dynamic";

type MLStatus =
  | { ok: true; version: string }
  | { ok: false; error: string };

async function getMLStatus(): Promise<MLStatus> {
  try {
    const h = await mlClient().health();
    return { ok: true, version: h.version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export default async function HomePage() {
  await ensureSchema();
  const cfg = getConfig();
  const ml = await getMLStatus();
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">DRISHTI</h1>
        <p className="mt-1 text-sm text-slate-600">
          Dementia Risk & Imaging-Subgroup Health Trajectory Index. v1 prototype.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="label">Service status</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusCard label="Web" value="ok" tone="ok" sub={`${cfg.NODE_ENV} / ${cfg.DB_DRIVER}`} />
          <StatusCard
            label="ML"
            value={ml.ok ? "ok" : "down"}
            tone={ml.ok ? "ok" : "bad"}
            sub={ml.ok ? `v${ml.version}` : ml.error.slice(0, 80)}
          />
          <StatusCard
            label="Worker"
            value="separate process"
            tone="info"
            sub="see /jobs for activity"
          />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="label">Next steps</h2>
        <ul className="mt-2 list-inside list-disc text-sm">
          <li>
            Seed synthetic cohort: <code className="rounded bg-slate-100 px-1 py-0.5">bun run seed:synth -- --participants 500 --visits-per 4 --cohort SYNTH-A --seed 42</code>
          </li>
          <li>Browse participants at <code className="rounded bg-slate-100 px-1 py-0.5">/participants</code></li>
          <li>Train a model from <code className="rounded bg-slate-100 px-1 py-0.5">/models</code></li>
        </ul>
      </section>
    </div>
  );
}

function StatusCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "ok" | "bad" | "info";
}) {
  const colour =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "bad"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <div className={`rounded-md border p-3 ${colour}`}>
      <div className="label">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub ? <div className="text-xs opacity-80">{sub}</div> : null}
    </div>
  );
}
