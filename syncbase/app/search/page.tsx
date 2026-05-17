import Link from "next/link";
import { searchEntities } from "@/lib/search";
import { getDb } from "@/lib/db";
import { sources } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string; category?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const sourceFilter = sp.source ?? "";
  const categoryFilter = sp.category ?? "";
  const limit = parseInt(sp.limit ?? "50", 10) || 50;

  const db = getDb();
  const srcs = await db.select().from(sources);
  const categories = Array.from(
    new Set(srcs.map((s) => (s as any).category as string | null).filter(Boolean))
  ) as string[];

  const result = q
    ? await searchEntities({ q, limit, source: sourceFilter || undefined, category: categoryFilter || undefined })
    : { hits: [], took_ms: 0 };

  return (
    <div className="col">
      <div>
        <h1>Search</h1>
        <p className="muted" style={{ margin: 0 }}>
          Full-text + fuzzy across every ingested record. Powered by Postgres tsvector +
          pg_trgm — typos and partial matches both work.
        </p>
      </div>

      <form className="card col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Try: ajmer, bengaluru, timber, 2026_MH, refNo, address fragment…"
            style={{ flex: 1, fontSize: "1rem" }}
            autoFocus
          />
          <button type="submit" className="btn-primary">Search</button>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ width: 220 }}>
            <label>Source</label>
            <select name="source" defaultValue={sourceFilter}>
              <option value="">(any)</option>
              {srcs.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 220 }}>
            <label>Category</label>
            <select name="category" defaultValue={categoryFilter}>
              <option value="">(any)</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 100 }}>
            <label>Limit</label>
            <input name="limit" type="number" defaultValue={limit} />
          </div>
          <div className="spacer" />
          <p className="muted" style={{ alignSelf: "flex-end", margin: 0 }}>
            {q ? `${result.hits.length} hit${result.hits.length === 1 ? "" : "s"} · ${result.took_ms}ms` : "—"}
          </p>
        </div>
      </form>

      {!q ? (
        <div className="card empty">Enter a query to search across all sources.</div>
      ) : result.hits.length === 0 ? (
        <div className="card empty">No matches for <code>{q}</code>.</div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {result.hits.map((h) => (
            <div key={`${h.storage_table}:${h.id}`} className="card col" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <Link
                  href={`/entities/${h.storage_table}/${h.id}`}
                  style={{ fontWeight: 600, fontSize: "1rem" }}
                >
                  {h.title || h.external_id}
                </Link>
                <span className="dim" style={{ fontSize: "0.78rem" }}>
                  score {h.score.toFixed(3)}
                </span>
              </div>
              {h.snippet && (
                <div
                  style={{ fontSize: "0.9rem" }}
                  // ts_headline returns the snippet with <b>...</b> already escaped where needed.
                  dangerouslySetInnerHTML={{ __html: h.snippet }}
                />
              )}
              <div className="row dim" style={{ gap: 12, fontSize: "0.78rem" }}>
                <span><code>{h.source}</code></span>
                {h.category && <span>· {h.category}</span>}
                <span>· id {h.id}</span>
                <span>· ext <code>{h.external_id}</code></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
