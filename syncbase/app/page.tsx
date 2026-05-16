import Link from "next/link";
import { getDb, getDriver } from "@/lib/db";
import { sources, runs, changeLog, entities } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = getDb();
  const [srcs, recentRuns, recentChanges, counts] = await Promise.all([
    db.select().from(sources).orderBy(desc(sources.id)),
    db.select().from(runs).orderBy(desc(runs.id)).limit(6),
    db.select().from(changeLog).orderBy(desc(changeLog.id)).limit(8),
    db.execute(sql`SELECT
        (SELECT count(*)::int FROM ${sources}) AS sources,
        (SELECT count(*)::int FROM ${entities}) AS entities,
        (SELECT count(*)::int FROM ${changeLog}) AS changes,
        (SELECT count(*)::int FROM ${runs}) AS runs`),
  ]);
  const stats: any = ((counts as any).rows ?? counts)[0] ?? {};
  const enabledCount = srcs.filter((s) => s.enabled).length;

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Stateful API ingest with DB-layer versioning · driver{" "}
            <code>{getDriver()}</code> · {enabledCount}/{srcs.length} sources enabled
          </p>
        </div>
        <div className="row">
          <Link href="/sources/new"><button className="btn-primary">+ New source</button></Link>
        </div>
      </div>

      <div className="stats-grid">
        <Stat label="Sources"  value={stats.sources ?? srcs.length} sub={`${enabledCount} enabled`} href="/sources" />
        <Stat label="Entities" value={stats.entities ?? 0} sub="across all storage tables" href="/entities" />
        <Stat label="Changes"  value={stats.changes ?? 0}  sub="lifetime change_log rows" href="/changes" />
        <Stat label="Runs"     value={stats.runs ?? 0}     sub="ingest executions" href="/runs" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <Card title="Recent changes" link={{ href: "/changes", label: "View all →" }}>
          {recentChanges.length === 0 ? (
            <Empty>
              No changes yet. <Link href="/sources/new">Create a source</Link> to get started.
            </Empty>
          ) : (
            <table>
              <thead>
                <tr><th>type</th><th>source</th><th>external_id</th><th>when</th></tr>
              </thead>
              <tbody>
                {recentChanges.map((c) => (
                  <tr key={c.id}>
                    <td><ChangeBadge type={c.changeType} /></td>
                    <td><code>{c.source}</code></td>
                    <td>
                      <Link href={`/entities/${c.storageTable}/${c.entityId}`}>
                        <code>{c.externalId}</code>
                      </Link>
                    </td>
                    <td className="muted">{fmtTime(c.changedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent runs" link={{ href: "/runs", label: "View all →" }}>
          {recentRuns.length === 0 ? (
            <Empty>No runs yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr><th>source</th><th>status</th><th>seen</th><th>+</th><th>~</th><th>=</th></tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id}>
                    <td>{r.sourceName}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.recordsSeen}</td>
                    <td className="muted">{r.recordsCreated}</td>
                    <td className="muted">{r.recordsUpdated}</td>
                    <td className="muted">{r.recordsSkipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {srcs.length === 0 && (
        <Card title="Get started">
          <ol style={{ paddingLeft: 18 }}>
            <li>Create a <Link href="/sources/new">new source</Link> — paste an HTTP config, click <strong>Test</strong> to verify extraction, then <strong>Save</strong>.</li>
            <li>Trigger an adhoc run from the source page, or set a cron in <Link href="/schedules">Schedules</Link>.</li>
            <li>Browse <Link href="/entities">Entities</Link> and watch the live <Link href="/changes">Changes</Link> feed.</li>
          </ol>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, sub, href }: { label: string; value: number; sub?: string; href: string }) {
  return (
    <Link href={href} className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value.toLocaleString()}</div>
      {sub && <div className="delta">{sub}</div>}
    </Link>
  );
}

function Card({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">{title}</div>
        {link && <Link href={link.href} className="muted" style={{ fontSize: "0.85rem" }}>{link.label}</Link>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

function ChangeBadge({ type }: { type: string }) {
  const cls =
    type === "created" ? "badge-success" :
    type === "updated" ? "badge-accent" :
    "badge";
  return <span className={`badge ${cls}`}>{type}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ok" || status === "success" ? "badge-success" :
    status === "error" ? "badge-danger" :
    status === "running" ? "badge-accent" :
    "badge";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function fmtTime(t: unknown): string {
  if (!t) return "—";
  try {
    const d = new Date(String(t));
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return String(t); }
}
