import Link from "next/link";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const db = getDb();
  const rows = await db.select().from(sources).orderBy(desc(sources.id));
  return (
    <div className="col">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Sources</h1>
          <p className="muted" style={{ margin: 0 }}>
            HTTP endpoints statesnapper polls. Each source describes the request, extraction, storage,
            and display configuration.
          </p>
        </div>
        <Link href="/sources/new"><button className="btn-primary">+ New source</button></Link>
      </div>
      {rows.length === 0 ? (
        <div className="card empty">
          No sources yet. <Link href="/sources/new">Create one</Link> to get started.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Enabled</th>
                <th>Storage</th>
                <th>Schedule</th>
                <th>Display fields</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const display = Array.isArray(r.displayColumns) ? r.displayColumns as any[] : [];
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/sources/${r.id}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                      <div className="dim" style={{ fontSize: "0.78rem" }}>id {r.id}</div>
                    </td>
                    <td>
                      <span className={`badge ${r.enabled ? "badge-success" : ""}`}>
                        {r.enabled ? "enabled" : "disabled"}
                      </span>
                    </td>
                    <td>
                      <code>{r.storageMode}</code>
                      <div className="dim" style={{ fontSize: "0.78rem" }}>{r.storageTable}</div>
                    </td>
                    <td>
                      {r.scheduleCron
                        ? <code>{r.scheduleCron}</code>
                        : <span className="dim">adhoc only</span>}
                    </td>
                    <td>
                      {display.length === 0
                        ? <span className="dim">—</span>
                        : <span className="muted">{display.map((d) => d.label).join(", ")}</span>}
                    </td>
                    <td><Link href={`/sources/${r.id}`}>open →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
