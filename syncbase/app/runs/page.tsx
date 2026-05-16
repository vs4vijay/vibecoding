import { getDb } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const db = getDb();
  const rows = await db.select().from(runs).orderBy(desc(runs.id)).limit(100);
  return (
    <div className="col">
      <h1>Runs</h1>
      <p className="muted">{rows.length} rows</p>
      <table>
        <thead>
          <tr>
            <th>id</th><th>source</th><th>trigger</th><th>status</th>
            <th>seen</th><th>created</th><th>updated</th><th>skipped</th>
            <th>error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
              <td style={{ color: "#e88" }}>{r.errorMessage ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
