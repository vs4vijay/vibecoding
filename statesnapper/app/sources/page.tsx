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
        <h1>Sources</h1>
        <Link href="/sources/new"><button>New source</button></Link>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No sources yet. <Link href="/sources/new">Create one</Link>.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>name</th>
              <th>enabled</th>
              <th>storage</th>
              <th>cron</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td><Link href={`/sources/${r.id}`}>{r.name}</Link></td>
                <td>{r.enabled ? "yes" : "no"}</td>
                <td><code>{r.storageMode}</code></td>
                <td>{r.scheduleCron ?? <span className="muted">—</span>}</td>
                <td><Link href={`/sources/${r.id}`}>open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
