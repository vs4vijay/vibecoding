import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { EntityVersionExplorer } from "@/components/entity-version-explorer";
import { getEntity } from "@/lib/entities-query";

export const dynamic = "force-dynamic";

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/i;

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ storage_table: string; id: string }>;
}) {
  const { storage_table, id } = await params;
  if (!TABLE_RE.test(storage_table)) notFound();
  const versionsTable = `${storage_table}_versions`;

  const data = await getEntity(storage_table, Number(id));
  if (!data) notFound();
  const { entity, display, primary_label, source } = data;

  const db = getDb();
  const vers: any = await db.execute(
    sql`SELECT * FROM ${sql.identifier(versionsTable)} WHERE entity_id = ${Number(id)} ORDER BY version_num ASC`
  );
  const versions = vers.rows ?? vers;

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{primary_label ?? entity.external_id}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <code>{entity.source}</code> · <code>{entity.external_id}</code>
            {source && <> · <Link href={`/sources/${source.id}`}>source config</Link></>}
          </p>
        </div>
        <Link href={`/entities?source=${encodeURIComponent(entity.source)}`} className="muted">
          ← back to {entity.source}
        </Link>
      </div>

      <div className="row wrap" style={{ gap: 12 }}>
        <span className="badge badge-accent">v{entity.version_num}</span>
        <span className="muted">hash <code style={{ fontSize: "0.78rem" }}>{String(entity.content_hash).slice(0, 12)}…</code></span>
        <span className="muted">updated {fmtTime(entity.updated_at)}</span>
        <span className="muted">first seen {fmtTime(entity.first_seen_at)}</span>
      </div>

      {display.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>Display fields</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {display.map((d, i) => (
              <div key={i}>
                <div className="dim" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {d.label} {d.primary && <span className="badge badge-accent" style={{ marginLeft: 4 }}>primary</span>}
                </div>
                <div style={{ fontSize: "0.95rem", marginTop: 2 }}>
                  {d.value ?? <span className="dim">—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Current payload</div>
        <pre>{JSON.stringify(entity.payload, null, 2)}</pre>
      </div>

      <div className="card">
        <div className="card-title">Version timeline</div>
        <EntityVersionExplorer
          storageTable={storage_table}
          entityId={Number(id)}
          currentVersionNum={entity.version_num}
          versions={versions.map((v: any) => ({
            version_num: v.version_num,
            valid_from: String(v.valid_from),
            valid_to: String(v.valid_to),
          }))}
        />
      </div>
    </div>
  );
}

function fmtTime(t: unknown): string {
  if (!t) return "—";
  try {
    const d = new Date(String(t));
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return String(t); }
}
