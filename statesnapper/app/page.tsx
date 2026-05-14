import Link from "next/link";
import { getDb, getDriver } from "@/lib/db";
import { sources, runs, changeLog, entities } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = getDb();
  const [srcs, recentRuns, recentChanges, counts] = await Promise.all([
    db.select().from(sources).orderBy(desc(sources.id)),
    db.select().from(runs).orderBy(desc(runs.id)).limit(5),
    db.select().from(changeLog).orderBy(desc(changeLog.id)).limit(10),
    db.execute(sql`SELECT
        (SELECT count(*)::int FROM ${sources}) AS sources,
        (SELECT count(*)::int FROM ${entities}) AS entities,
        (SELECT count(*)::int FROM ${changeLog}) AS changes,
        (SELECT count(*)::int FROM ${runs}) AS runs`),
  ]);
  const stats: any = ((counts as any).rows ?? counts)[0] ?? {};

  return (
    <div className="col">
      <h1>statesnapper</h1>
      <p className="muted">
        Stateful API ingest with DB-layer versioning. Driver: <code>{getDriver()}</code>
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Stat label="sources" value={stats.sources ?? srcs.length} href="/sources" />
        <Stat label="entities" value={stats.entities ?? 0} href="/entities" />
        <Stat label="changes" value={stats.changes ?? 0} href="/changes" />
        <Stat label="runs" value={stats.runs ?? 0} href="/runs" />
      </div>

      <h2>Recent changes</h2>
      {recentChanges.length === 0 ? (
        <p className="muted">No changes yet. <Link href="/sources/new">Create a source</Link> to get started.</p>
      ) : (
        <table>
          <thead>
            <tr><th>id</th><th>type</th><th>source</th><th>external_id</th><th>when</th></tr>
          </thead>
          <tbody>
            {recentChanges.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td><code>{c.changeType}</code></td>
                <td><code>{c.source}</code></td>
                <td><code>{c.externalId}</code></td>
                <td className="muted">{String(c.changedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent runs</h2>
      {recentRuns.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>id</th><th>source</th><th>trigger</th><th>status</th>
              <th>seen</th><th>created</th><th>updated</th><th>skipped</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.sourceName}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      style={{
        border: "1px solid #2a2a2a",
        borderRadius: 6,
        padding: 12,
        textDecoration: "none",
        color: "inherit",
        display: "block",
      }}
    >
      <div className="muted" style={{ fontSize: "0.8em" }}>{label}</div>
      <div style={{ fontSize: "1.6em", fontWeight: 600 }}>{value}</div>
    </Link>
  );
}
