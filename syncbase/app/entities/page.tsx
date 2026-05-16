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
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Entities</h1>
          <p className="muted" style={{ margin: 0 }}>
            Browse the latest version of each ingested record. Configure <em>Display</em> on a source
            to surface human-friendly titles below.
          </p>
        </div>
      </div>
      <form className="card row" style={{ gap: 16 }}>
        <div className="field" style={{ width: 240 }}>
          <label>Source</label>
          <select name="source" defaultValue={sourceName ?? ""}>
            <option value="">(any)</option>
            {srcs.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 100 }}>
          <label>Limit</label>
          <input name="limit" type="number" defaultValue={limit} />
        </div>
        <div className="row" style={{ alignSelf: "flex-end" }}>
          <button type="submit">Filter</button>
        </div>
        <div className="spacer" />
        <p className="muted" style={{ alignSelf: "flex-end", margin: 0 }}>{rows.length} rows</p>
      </form>

      {rows.length === 0 ? (
        <div className="card empty">
          No entities yet. <Link href="/sources">Pick a source</Link> and run an ingest.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Source</th>
                <th>Details</th>
                <th>v</th>
                <th>Storage</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const primary = r.primary_label;
                const others = r.display.filter((d) => !d.primary && d.value);
                return (
                  <tr key={`${r.storage_table}:${r.id}`}>
                    <td>
                      <Link href={`/entities/${r.storage_table}/${r.id}`} style={{ fontWeight: 600 }}>
                        {primary ?? r.external_id}
                      </Link>
                      <div className="dim" style={{ fontSize: "0.78rem" }}>
                        <code>{r.external_id}</code>
                        {primary && <span> · id {r.id}</span>}
                      </div>
                    </td>
                    <td><code>{r.source}</code></td>
                    <td>
                      {others.length === 0 ? (
                        <span className="dim">—</span>
                      ) : (
                        <div className="col-sm">
                          {others.map((d, i) => (
                            <div key={i} style={{ fontSize: "0.85rem" }}>
                              <span className="muted">{d.label}:</span>{" "}
                              <span>{d.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>v{r.version_num}</td>
                    <td><code>{r.storage_table}</code></td>
                    <td className="muted">{fmtTime(r.updated_at)}</td>
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

function fmtTime(t: unknown): string {
  if (!t) return "—";
  try {
    const d = new Date(String(t));
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return String(t); }
}
