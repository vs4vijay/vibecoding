import Link from "next/link";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { listEntities } from "@/lib/entities-query";

export const dynamic = "force-dynamic";

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const sourceName = sp.source;
  const limit = parseInt(sp.limit ?? "50", 10) || 50;
  const rows = await listEntities({ sourceName, limit });
  const db = getDb();
  const srcs = await db.select().from(sources);

  return (
    <div className="col">
      <h1>Entities</h1>
      <form className="row">
        <label>
          source:{" "}
          <select name="source" defaultValue={sourceName ?? ""}>
            <option value="">(any)</option>
            {srcs.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          limit:{" "}
          <input name="limit" type="number" defaultValue={limit} style={{ width: 80 }} />
        </label>
        <button type="submit">Filter</button>
      </form>
      <p className="muted">{rows.length} rows</p>
      <table>
        <thead>
          <tr>
            <th>id</th><th>source</th><th>external_id</th><th>v</th><th>hash</th>
            <th>storage</th><th>updated_at</th><th>payload</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.storage_table}:${r.id}`}>
              <td>
                <Link href={`/entities/${r.storage_table}/${r.id}`}>{r.id}</Link>
              </td>
              <td><code>{r.source}</code></td>
              <td><code>{r.external_id}</code></td>
              <td>{r.version_num}</td>
              <td><code style={{ fontSize: "0.75em" }}>{r.content_hash.slice(0, 10)}…</code></td>
              <td><code>{r.storage_table}</code></td>
              <td className="muted">{String(r.updated_at)}</td>
              <td>
                <details>
                  <summary className="muted">view</summary>
                  <pre style={{ maxHeight: 200, margin: 0 }}>
                    {JSON.stringify(r.payload, null, 2)}
                  </pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
