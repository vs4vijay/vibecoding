import Link from "next/link";
import { ensureSchema } from "@/lib/db/bootstrap";
import { listCohorts, listParticipants } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

function getParam(sp: SP, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await ensureSchema();
  const sp = await searchParams;

  const cohort = getParam(sp, "cohort") || undefined;
  const sex = getParam(sp, "sex") as "M" | "F" | undefined;
  const urbanRural = getParam(sp, "urban_rural") as "urban" | "rural" | undefined;
  const educationTier = getParam(sp, "education") as "low" | "mid" | "high" | undefined;
  const ageMin = getParam(sp, "age_min") ? Number(getParam(sp, "age_min")) : undefined;
  const ageMax = getParam(sp, "age_max") ? Number(getParam(sp, "age_max")) : undefined;
  const page = getParam(sp, "page") ? Number(getParam(sp, "page")) : 1;

  const { rows, total, pageSize } = await listParticipants({
    cohort,
    sex,
    urbanRural,
    educationTier,
    ageMin,
    ageMax,
    page,
    pageSize: 50,
  });
  const cohorts = await listCohorts();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Participants</h1>
          <p className="mt-1 text-sm text-slate-600">{total.toLocaleString()} total</p>
        </div>
        {total === 0 ? (
          <p className="text-sm text-slate-500">
            Empty? Run: <code className="rounded bg-slate-100 px-1 py-0.5">bun run seed:synth -- --participants 500 --visits-per 4 --cohort SYNTH-A --seed 42</code>
          </p>
        ) : null}
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4" action="/participants" method="get">
        <Field label="Cohort">
          <select name="cohort" defaultValue={cohort ?? ""} className="select">
            <option value="">all</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.id}</option>
            ))}
          </select>
        </Field>
        <Field label="Sex">
          <select name="sex" defaultValue={sex ?? ""} className="select">
            <option value="">any</option>
            <option value="F">F</option>
            <option value="M">M</option>
          </select>
        </Field>
        <Field label="Urban/Rural">
          <select name="urban_rural" defaultValue={urbanRural ?? ""} className="select">
            <option value="">any</option>
            <option value="urban">urban</option>
            <option value="rural">rural</option>
          </select>
        </Field>
        <Field label="Education">
          <select name="education" defaultValue={educationTier ?? ""} className="select">
            <option value="">any</option>
            <option value="low">low (&lt;6y)</option>
            <option value="mid">mid (6-11y)</option>
            <option value="high">high (12+y)</option>
          </select>
        </Field>
        <Field label="Age ≥">
          <input className="input w-20" name="age_min" type="number" defaultValue={ageMin ?? ""} />
        </Field>
        <Field label="Age ≤">
          <input className="input w-20" name="age_max" type="number" defaultValue={ageMax ?? ""} />
        </Field>
        <button className="btn-primary" type="submit">Apply</button>
        <Link className="btn" href="/participants">Reset</Link>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Cohort</th>
              <th className="px-3 py-2">Age</th>
              <th className="px-3 py-2">Sex</th>
              <th className="px-3 py-2">Edu</th>
              <th className="px-3 py-2">Urban/Rural</th>
              <th className="px-3 py-2">ApoE4</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link className="text-accent hover:underline" href={`/participants/${r.id}`}>{r.id}</Link>
                </td>
                <td className="px-3 py-2">{r.cohortId}</td>
                <td className="px-3 py-2">{r.ageBaseline.toFixed(1)}</td>
                <td className="px-3 py-2">{r.sex}</td>
                <td className="px-3 py-2">{r.educationYears}</td>
                <td className="px-3 py-2">{r.urbanRural}</td>
                <td className="px-3 py-2">{r.apoe4Carrier ? "yes" : "no"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-center text-slate-500" colSpan={7}>
                  No participants match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              className="btn"
              href={{ pathname: "/participants", query: { ...sp, page: page - 1 } as any }}
            >
              ← Prev
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              className="btn"
              href={{ pathname: "/participants", query: { ...sp, page: page + 1 } as any }}
            >
              Next →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col text-xs text-slate-500">
      <span className="mb-1">{label}</span>
      {children}
    </label>
  );
}
