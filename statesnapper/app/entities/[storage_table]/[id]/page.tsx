import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { EntityVersionExplorer } from "@/components/entity-version-explorer";

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

  const db = getDb();
  const cur: any = await db.execute(
    sql`SELECT * FROM ${sql.identifier(storage_table)} WHERE id = ${Number(id)}`
  );
  const curRows = cur.rows ?? cur;
  if (!curRows.length) notFound();
  const entity = curRows[0];

  const vers: any = await db.execute(
    sql`SELECT * FROM ${sql.identifier(versionsTable)} WHERE entity_id = ${Number(id)} ORDER BY version_num ASC`
  );
  const versions = vers.rows ?? vers;

  return (
    <div className="col">
      <h1>
        <code>{entity.source}</code> · <code>{entity.external_id}</code>
      </h1>
      <p className="muted">
        version: <code>v{entity.version_num}</code> · hash:{" "}
        <code style={{ fontSize: "0.75em" }}>{entity.content_hash}</code> · updated:{" "}
        {String(entity.updated_at)}
      </p>
      <h2>Current payload</h2>
      <pre>{JSON.stringify(entity.payload, null, 2)}</pre>
      <h2>Version timeline</h2>
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
  );
}
