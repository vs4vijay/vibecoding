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

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{src.name}</h1>
        <Link href="/sources">← back</Link>
      </div>
      <div className="row">
        <span className="muted">storage:</span> <code>{src.storageMode}</code>
        <span className="muted">→</span> <code>{src.storageTable}</code>
        <span className="muted">enabled:</span> <code>{String(src.enabled)}</code>
        <span className="muted">cron:</span> <code>{src.scheduleCron ?? "—"}</code>
      </div>
      <RunButton sourceId={src.id} />
      <h2>Config</h2>
      <details>
        <summary className="muted">http</summary>
        <pre>{JSON.stringify(src.http, null, 2)}</pre>
      </details>
      <details>
        <summary className="muted">pagination</summary>
        <pre>{JSON.stringify(src.pagination, null, 2)}</pre>
      </details>
      <p>
        <span className="muted">records_path:</span> <code>{src.recordsPath}</code>{" "}
        · <span className="muted">external_id_path:</span> <code>{src.externalIdPath}</code>
      </p>
      <h2>Recent runs</h2>
      {recentRuns.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>id</th><th>trigger</th><th>status</th>
              <th>seen</th><th>created</th><th>updated</th><th>skipped</th>
              <th>started</th><th>ended</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td><code>{r.trigger}</code></td>
                <td>
                  <code style={{ color: r.status === "error" ? "#e88" : undefined }}>
                    {r.status}
                  </code>
                </td>
                <td>{r.recordsSeen}</td>
                <td>{r.recordsCreated}</td>
                <td>{r.recordsUpdated}</td>
                <td>{r.recordsSkipped}</td>
                <td className="muted">{String(r.startedAt)}</td>
                <td className="muted">{r.endedAt ? String(r.endedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        <Link href={`/entities?source=${encodeURIComponent(src.name)}`}>
          → Browse entities for this source
        </Link>
      </p>
    </div>
  );
}
