import Link from "next/link";
import { getDb } from "@/lib/db";
import { changeLog, sources } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { SseFeed } from "@/components/sse-feed";

export const dynamic = "force-dynamic";

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const source = sp.source;
  const limit = Math.min(parseInt(sp.limit ?? "100", 10) || 100, 500);

  const db = getDb();
  const rows = source
    ? await db
        .select()
        .from(changeLog)
        .where(eq(changeLog.source, source))
        .orderBy(desc(changeLog.id))
        .limit(limit)
    : await db.select().from(changeLog).orderBy(desc(changeLog.id)).limit(limit);
  const srcs = await db.select().from(sources);

  return (
    <div className="col">
      <h1>Changes</h1>
      <h2>Live feed</h2>
      <SseFeed />
      <h2>History</h2>
      <form className="row">
        <label>
          source:{" "}
          <select name="source" defaultValue={source ?? ""}>
            <option value="">(any)</option>
            {srcs.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>
      <p className="muted">{rows.length} rows</p>
      <table>
        <thead>
          <tr>
            <th>id</th><th>type</th><th>source</th><th>external_id</th>
            <th>storage</th><th>old_hash</th><th>new_hash</th><th>changed_at</th>
            <th>consumed</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td><code>{r.changeType}</code></td>
              <td><code>{r.source}</code></td>
              <td><code>{r.externalId}</code></td>
              <td><code>{r.storageTable}</code></td>
              <td className="muted">{r.oldHash?.slice(0, 8) ?? "—"}</td>
              <td className="muted">{r.newHash?.slice(0, 8) ?? "—"}</td>
              <td className="muted">{String(r.changedAt)}</td>
              <td>{r.consumedAt ? "yes" : <span className="muted">no</span>}</td>
              <td>
                <Link href={`/entities/${r.storageTable}/${r.entityId}`}>entity</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
