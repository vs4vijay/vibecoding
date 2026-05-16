import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { sources, runs } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { RunButton } from "@/components/run-button";

export const dynamic = "force-dynamic";

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const rows = await db.select().from(sources).where(eq(sources.id, Number(id)));
  if (rows.length === 0) notFound();
  const src = rows[0];
  const recentRuns = await db
    .select()
    .from(runs)
    .where(eq(runs.sourceId, src.id))
    .orderBy(desc(runs.id))
    .limit(10);

  const displayColumns = Array.isArray(src.displayColumns) ? src.displayColumns as any[] : [];
  const typedColumns = Array.isArray(src.typedColumns) ? src.typedColumns as any[] : [];

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{src.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <code>{src.storageMode}</code> mode · stored in <code>{src.storageTable}</code>
          </p>
        </div>
        <div className="row">
          <Link href={`/entities?source=${encodeURIComponent(src.name)}`}>
            <button>Browse entities</button>
          </Link>
          <RunButton sourceId={src.id} />
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge ${src.enabled ? "badge-success" : ""}`}>
          {src.enabled ? "enabled" : "disabled"}
        </span>
        <span className="badge">
          schedule: {src.scheduleCron ? <code>{src.scheduleCron}</code> : "adhoc only"}
        </span>
        <span className="badge">
          {Array.isArray(src.hashFields) && src.hashFields.length > 0
            ? `hash: ${src.hashFields.join(", ")}`
            : "hash: whole record"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>Extraction</div>
          <table>
            <tbody>
              <tr><td className="muted">records_path</td><td><code>{src.recordsPath}</code></td></tr>
              <tr><td className="muted">external_id_path</td><td><code>{src.externalIdPath}</code></td></tr>
            </tbody>
          </table>
        </section>
        <section className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>Display fields</div>
          {displayColumns.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No display fields configured — entities will be identified by <code>external_id</code> only.
            </p>
          ) : (
            <table>
              <thead><tr><th>Label</th><th>JSONPath</th><th>Primary</th></tr></thead>
              <tbody>
                {displayColumns.map((d: any, i: number) => (
                  <tr key={i}>
                    <td>{d.label}</td>
                    <td><code>{d.jsonpath}</code></td>
                    <td>{d.primary ? <span className="badge badge-accent">primary</span> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {typedColumns.length > 0 && (
        <section className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>Typed columns</div>
          <table>
            <thead><tr><th>Name</th><th>JSONPath</th><th>SQL type</th><th>Indexed</th></tr></thead>
            <tbody>
              {typedColumns.map((c: any, i: number) => (
                <tr key={i}>
                  <td><code>{c.name}</code></td>
                  <td><code>{c.jsonpath}</code></td>
                  <td><code>{c.sql_type}</code></td>
                  <td>{c.indexed ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="card-title" style={{ marginBottom: 10 }}>HTTP &amp; pagination config</div>
        <details>
          <summary className="muted">http</summary>
          <pre>{JSON.stringify(src.http, null, 2)}</pre>
        </details>
        <details>
          <summary className="muted">pagination</summary>
          <pre>{JSON.stringify(src.pagination, null, 2)}</pre>
        </details>
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div className="card-header" style={{ padding: "12px 16px 0" }}>
          <div className="card-title">Recent runs</div>
        </div>
        {recentRuns.length === 0 ? (
          <div className="empty">No runs yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>id</th><th>trigger</th><th>status</th>
                <th>seen</th><th>+</th><th>~</th><th>=</th>
                <th>started</th><th>ended</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td><code>{r.trigger}</code></td>
                  <td>
                    <span className={`badge ${r.status === "error" ? "badge-danger" : r.status === "ok" || r.status === "success" ? "badge-success" : "badge-accent"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.recordsSeen}</td>
                  <td>{r.recordsCreated}</td>
                  <td>{r.recordsUpdated}</td>
                  <td>{r.recordsSkipped}</td>
                  <td className="muted">{fmtTime(r.startedAt)}</td>
                  <td className="muted">{r.endedAt ? fmtTime(r.endedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function fmtTime(t: unknown): string {
  if (!t) return "—";
  try {
    const d = new Date(String(t));
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return String(t); }
}
