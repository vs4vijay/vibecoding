import { getDb } from "@/lib/db";
import { ddlLog } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function DdlLogPage() {
  const db = getDb();
  const rows = await db.select().from(ddlLog).orderBy(desc(ddlLog.id)).limit(200);
  return (
    <div className="col">
      <h1>DDL log</h1>
      <p className="muted">{rows.length} statements</p>
      <table>
        <thead>
          <tr><th>id</th><th>applied</th><th>source_id</th><th>kind</th><th>success</th><th>statement</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td className="muted">{String(r.appliedAt)}</td>
              <td>{r.sourceId ?? "—"}</td>
              <td><code>{r.kind}</code></td>
              <td>
                <code style={{ color: r.success ? "#7e7" : "#e88" }}>
                  {String(r.success)}
                </code>
              </td>
              <td>
                <pre style={{ maxHeight: 200, margin: 0, fontSize: "0.85em" }}>
                  {r.statement}
                </pre>
                {r.error && <p style={{ color: "#e88" }}>{r.error}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
