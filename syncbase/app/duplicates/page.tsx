import Link from "next/link";
import { listIntraSourcePairs, listClusters } from "@/lib/duplicates-query";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const sourceFilter = sp.source ?? "";
  const limit = parseInt(sp.limit ?? "100", 10) || 100;
  const [pairs, clusters] = await Promise.all([
    listIntraSourcePairs({ source: sourceFilter || undefined, limit }),
    listClusters({ limit: 50 }),
  ]);
  const db = getDb();
  const srcs = await db.select().from(sources);

  return (
    <div className="col">
      <div>
        <h1>Duplicates</h1>
        <p className="muted" style={{ margin: 0 }}>
          Intra-source near-duplicates (D1) and cross-source clusters (D2). Operator decisions persist
          in <code>entity_duplicate_overrides</code> — the next <code>bun bin/cli.ts dedup</code> run
          respects them.
        </p>
      </div>

      <form className="card row" style={{ gap: 12 }}>
        <div className="field" style={{ width: 240 }}>
          <label>Source (intra-pairs)</label>
          <select name="source" defaultValue={sourceFilter}>
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
          <button type="submit">Apply</button>
        </div>
      </form>

      <section>
        <h2>Intra-source pairs ({pairs.length})</h2>
        {pairs.length === 0 ? (
          <div className="card empty">
            None yet. Configure <code>dedup</code> on a source and run{" "}
            <code>bun bin/cli.ts dedup</code>.
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Canonical</th>
                  <th>Duplicate</th>
                  <th>Sim</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.source}</code></td>
                    <td>
                      <Link href={`/entities/entities/${p.canonical_id}`} style={{ fontWeight: 600 }}>
                        {p.canonical_title ?? `#${p.canonical_id}`}
                      </Link>
                      <div className="dim" style={{ fontSize: "0.75rem" }}>id {p.canonical_id}</div>
                    </td>
                    <td>
                      <Link href={`/entities/entities/${p.duplicate_id}`} style={{ fontWeight: 600 }}>
                        {p.duplicate_title ?? `#${p.duplicate_id}`}
                      </Link>
                      <div className="dim" style={{ fontSize: "0.75rem" }}>id {p.duplicate_id}</div>
                    </td>
                    <td>{p.similarity.toFixed(3)}</td>
                    <td><code>{p.status}</code></td>
                    <td>
                      <OverrideButtons source={p.source} a={p.canonical_id} b={p.duplicate_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Cross-source clusters ({clusters.length})</h2>
        {clusters.length === 0 ? (
          <div className="card empty">
            None yet. Configure <code>cross_dedup</code> on ≥2 sources and run{" "}
            <code>bun bin/cli.ts dedup --cross-source</code>.
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {clusters.map((c) => (
              <div key={c.cluster_id} className="card col" style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>Cluster #{c.cluster_id}</strong>
                  <span className="dim">{c.member_count} members</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {c.members.map((m) => (
                    <li key={`${m.source}:${m.id}`}>
                      <code>{m.source}</code>{" "}
                      <Link href={`/entities/entities/${m.id}`}>
                        {m.title ?? `#${m.id}`}
                      </Link>{" "}
                      <span className="dim" style={{ fontSize: "0.78rem" }}>
                        · {m.role}{m.score != null ? ` · score ${m.score.toFixed(3)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OverrideButtons({ source, a, b }: { source: string; a: number; b: number }) {
  // Plain form POST → /api/duplicates accepts application/x-www-form-urlencoded
  // and redirects back to /duplicates on success. Keeps this page an RSC.
  const button = (decision: "same" | "different") => (
    <form action="/api/duplicates" method="post" style={{ display: "inline" }}>
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="entity_a_id" value={a} />
      <input type="hidden" name="entity_b_id" value={b} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit">{decision === "same" ? "✓ same" : "✗ different"}</button>
    </form>
  );
  return (
    <div className="row" style={{ gap: 6 }}>
      {button("same")}
      {button("different")}
    </div>
  );
}
