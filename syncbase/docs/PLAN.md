# syncbase onboarding plan — auction sources, global search, dedup

Vertical phases. Each phase is independently mergeable, demoable, and adds **at most one** new capability or one new source. The order respects dependencies: foundational schema changes (location field) land before the sources that use them; sources land before global search; global search lands before dedup (which queries the search index).

This document is **plan-only**. Implementation is gated on the per-phase ✅ checkpoints under each phase.

---

## Phase index

| # | Phase | Adds | Depends on |
|---|---|---|---|
| **F1** | `location` field in source config | `SourceCreateSchema.location`, request-template substitution | — |
| **F2** | Search-extension bootstrap (PGLite + prod-PG) | `scripts/enable-extensions.sql`, migration that loads `pg_trgm` / `unaccent` / FTS GIN, dev-mode fallbacks | — |
| **S0** | Re-confirm + tag existing sources | mark `ibapi_auction_properties`, `bankeauctions_live` as `category=auction`, plug them into `location` | F1 |
| **S1** | `eauction.gov.in` (Govt eAuction India) | new seed `eauction_gov_in_upcoming` | F1 |
| **S2** | `baanknet.com` (PSB Alliance / IBA) | new seed `baanknet_listing` | F1 |
| **S3** | `eauctiondekho.com` | new seed `eauctiondekho` | F1 |
| **S4** | `auctionbazaar.com` | new seed `auctionbazaar` | F1 |
| **S5** | `mstcindia.co.in` Forthcoming e-Auctions | new seed `mstcindia_forthcoming` (after spike) | F1, spike, **F3** |
| **S6** | `foreclosureindia.com` bank-auctions | parked — no JSON path, see [`docs/sources/foreclosureindia.md`](./sources/foreclosureindia.md) | — |
| **S7** | HTML-only sources — parked | per-source docs under `docs/sources/`; each documents *why* it's parked | — |
| **G1** | Global Search API + UI | `/api/search`, `/search` page, FTS + trigram ranking | F2, ≥3 sources from S1-S4 |
| **G2** | Source/category filters on Search | search facets on `source`, `location`, `category`, `price_range`, `auction_date` | G1 |
| **D1** | Duplicate detection (intra-source) | blocking + similarity inside one source; mark `duplicate_of` in `entities` | G1 |
| **D2** | Cross-source duplicate clusters | cluster across sources; new `entity_clusters` table; UI shows clustered card | D1 |
| **F3** | `pagination.style: "values"` | iterate a fixed list of string values into a URL template; needed for `mstcindia.co.in` (20 region codes) and any future "sharded by code" source | — |
| **S8** | `chennaicustoms.gov.in` (WP REST media) | new seed `chennaicustoms_media` | F1 |
| **S9** | `bangalorecustoms.gov.in` (WP REST media) | new seed `bangalorecustoms_media` | F1 |

Skip cycles: each phase has a **rollback** entry — if the seed fails Test-fetch or the recon documented in `docs/sources/<slug>.md` turns out wrong, that phase parks and the next one starts. We do not gate the global-search phase on every source being live.

---

## F1 — `location` field in source config

**Goal:** any source seed can declare *how it accepts a location filter* and at runtime the operator picks `state` / `city` / leaves it blank. If blank → the source fetches its full inventory (current behavior).

**Schema (additive, non-breaking):**

```jsonc
// SourceCreateSchema.location
{
  "location": {
    "mode": "none" | "query" | "form" | "body" | "path",
    "field": "city",              // the parameter name on the upstream (e.g. "city_id", "state_abbr")
    "city_values": { "ajmer": "16", "bangalore": "23" },   // optional value-map
    "state_values": { "RJ": "..." },                       // optional value-map
    "templated": "{{ location.city }}"                     // when mode=path/body, expression substituted into http.url / http.body
  }
}
```

Behavior:
- `mode: "none"` → no location filter (default; preserves today's behavior).
- `mode: "query" | "form" | "body"` → the resolved value is injected into `http.params` / `http.form` / `http.body` under `field`.
- `mode: "path"` → the templated expression is rendered into `http.url`.
- If the runtime location input is empty AND the source's `mode != "none"` AND the source does **not** support an "all-locations" sentinel → the source error-stops with `LOCATION_REQUIRED` rather than silently fetching wrong data. Sources that *can* fetch all (e.g. `eauction.gov.in` landing endpoint) flag `supports_all: true`.

**API surface:**
- `POST /api/sources/:id/run` accepts `{ location: { state?, city? } }`. The pipeline merges it into the source's http config per the `location` block before issuing the request.
- The `/sources/new` UI gains a "Location filter" section.

**Tests:**
- AC-L1: seed with `mode:"query"`, run with `{city:"ajmer"}` → upstream URL contains `?city_id=16`.
- AC-L2: same seed, run with no location → upstream URL has no `city_id`, fetch returns full inventory.
- AC-L3: seed with `mode:"path"` rendered into URL, run with `{city:"bangalore"}` → URL contains `/locations/bangalore/`.
- AC-L4: source with `supports_all: false` and `mode:"path"` errors with `LOCATION_REQUIRED` on empty location.

---

## F2 — Search-extension bootstrap

**Goal:** the same `migrations/` set that runs on PGLite (dev) and Postgres (prod) provisions full-text + fuzzy search, with a clean fallback when PGLite cannot load an extension.

**What PGLite supports (verified at the PGLite extensions index):**
- ✅ `pg_trgm` — trigram similarity, `%` operator, `similarity()`. Published as a PGLite contrib extension; loadable via `extensions: { pg_trgm }` in the PGLite client.
- ✅ `fuzzystrmatch` — `levenshtein()`, `soundex()`, `metaphone()`. PGLite contrib.
- ✅ `tsvector` / `to_tsvector` / `tsquery` / GIN — these are **core** Postgres features, available in PGLite without any extension.
- ⚠ `unaccent` — listed as a PGLite contrib extension but the dictionary file is finicky; we will load it only when present, otherwise fall back to a `simple` config + lowercase.

**What real Postgres needs:**
A bootstrap script run once per deployment:

```sql
-- scripts/enable-extensions.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Optional: pg_jieba / zhparser for non-Latin scripts. Not needed for ASCII/English/Hindi-transliterated content.
```

The migration runner (`lib/db/migrate.ts`) calls `enableExtensions()` before applying the search-index migration. On PGLite, the driver loads `pg_trgm` + `fuzzystrmatch` at `PGlite.create({ extensions: { pg_trgm, fuzzystrmatch } })`. On Postgres, the script is `psql -f scripts/enable-extensions.sql`.

**Search index migration (added to `migrations/`):**

```sql
-- 020_search_index.sql
ALTER TABLE entities ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(payload->>'title','')), 'A') ||
    setweight(to_tsvector('simple', coalesce(payload->>'address','')), 'B') ||
    setweight(to_tsvector('simple', coalesce(payload->>'city','')), 'B') ||
    setweight(to_tsvector('simple', coalesce(payload->>'bank','')), 'C') ||
    setweight(to_tsvector('simple', coalesce(payload::text, '')), 'D')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_entities_tsv ON entities USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_entities_title_trgm
  ON entities USING GIN ((payload->>'title') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_addr_trgm
  ON entities USING GIN ((payload->>'address') gin_trgm_ops);
```

Dedicated-mode tables get a copy of the same DDL via `lib/ddl/generate.ts` — both `entities` and `entities_<slug>` are searchable.

**Tests:**
- AC-X1: PGLite — fresh init → `CREATE EXTENSION pg_trgm` succeeds, `similarity('Bengaluru', 'Bangalore')` ≥ 0.4.
- AC-X2: PGLite — `to_tsvector('simple','foo bar')` returns a non-empty tsvector.
- AC-X3: Postgres — `bun bin/cli.ts init` runs `enable-extensions.sql` exactly once and is idempotent.

---

## S0 — Tag existing sources

No code change. `seeds/ibapi_auction_properties.json` and `seeds/bankeauctions_live.json` gain:
```jsonc
{
  "category": "bank-auction",
  "location": { "mode": "body", "field": "key_val", "supports_all": true }
}
```
and the `bankeauctions_live` seed adds `location.mode: "form"` for its `bank_id` / `state` form fields (recon TBD — see `docs/sources/bankeauctions.md`).

---

## S1 — `eauction.gov.in`

See `docs/sources/eauction-gov-in.md`. New seed `seeds/eauction_gov_in_upcoming.json`. Pagination: `none` (single 4.7 kB JSON response). No location filter on the landing call; geographic spread is by `refNo` prefix (`2026_MH_…`, `2026_WB_…`, etc.).

---

## S2 — `baanknet.com`

See `docs/sources/baanknet.md`. Requires the source config to issue a `GET /eauction-psb/api/get-session` pre-flight and capture the `XSRF-TOKEN` cookie. This is the **first** source that needs an auth-cookie pre-flight, so this phase also adds a tiny `pre_request` capability to the http config:

```jsonc
{
  "http": {
    "pre_request": {
      "url": "https://baanknet.com/eauction-psb/api/get-session",
      "method": "GET",
      "captures": [
        { "from": "cookie", "name": "XSRF-TOKEN", "to": "headers.X-XSRF-TOKEN" },
        { "from": "cookie", "name": "JSESSIONID", "to": "cookies.JSESSIONID" }
      ]
    }
  }
}
```

`pre_request` is generic — it unblocks future sources that also gate on session bootstrap.

---

## S3 — `eauctiondekho.com`

See `docs/sources/eauctiondekho.md`. Location is **path-based** (`/locations/{city}/banks/{bank}`). Confirms F1's `mode: "path"` end-to-end.

---

## S4 — `auctionbazaar.com`

See `docs/sources/auctionbazaar.md`. Next.js front; needs Next data extraction (`__NEXT_DATA__` JSON island) or the underlying API call.

---

## S5 — `mstcindia.co.in` Forthcoming e-Auctions

See `docs/sources/mstcindia.md`. ASP.NET WebForms with `__VIEWSTATE`. A recon spike is required before seeding — these endpoints require either a `__VIEWSTATE` POST or a server-side rendered table parse. The seed schema may need a new `parser: "html_table"` if no JSON endpoint exists.

---

## S6 — `foreclosureindia.com`

See `docs/sources/foreclosureindia.md`. Server-rendered list with `/{city}/{page}` URL pattern. Recon spike needed for an internal API; if none, parked behind the HTML-parser extension (see S7).

---

## S7 — HTML-only sources (deferred bucket)

See `docs/sources/_html-only.md`. Captures the sources that have no JSON API:
- `findauction.in/{bank-property,search}`
- `eauctionsindia.com/city/*`
- `chennaicustoms.gov.in/auctions/`
- `bangalorecustoms.gov.in/bengaluru-city-customs/`
- `mstcecommerce.com/auctionhome/customs/*`
- `mumbaiport.gov.in/show_content.php?ls_id=1352`
- `karnatakabank.bank.in/auction-notice`
- `karnatakagb.bank.in/sarfaesi/e-auction`
- `udhonline.rajasthan.gov.in/Portal/AuctionListNew`
- `lsgeauction.rajasthan.gov.in/Portal/AuctionList`
- `riicoerp.industries.rajasthan.gov.in/eauction`
- `aubank.in/bank-auction`

These remain documented but unscheduled until syncbase grows an HTML-parsing storage mode (Cheerio + JSONPath-on-DOM). That is **not in this plan** — a separate proposal.

---

## G1 — Global Search

**Goal:** one endpoint, one page; full-text + fuzzy across **all** entities, all sources.

**API:**
```
GET /api/search?q=<phrase>&limit=50&offset=0&min_score=0.05&fuzzy=true
```
Response:
```jsonc
{
  "hits": [
    { "source": "ibapi_auction_properties", "id": 1234, "external_id": "12345",
      "title": "...", "snippet": "<b>highlight</b>...", "score": 0.82,
      "location": { "city": "Ajmer", "state": "RJ" } }
  ],
  "total": 1287, "took_ms": 18
}
```

**Query strategy:**
1. Parse `q` into a `websearch_to_tsquery('simple', q)`.
2. Primary rank: `ts_rank_cd(search_tsv, query)` against the GIN tsvector index.
3. If `fuzzy=true` and primary rank `<` 0.05 floor → re-rank with `similarity(payload->>'title', q)` (uses `pg_trgm` GIN).
4. Union across `entities` and every `entities_<slug>` table — discovered via `information_schema.tables` filtered by syncbase's DDL log (the `ddl_log` table already records which tables it created).

**UI:** new `/search` page with a single input box, source/category facets, top 50 cards. Click → entity detail page.

**Tests:**
- AC-S1: search `q=ajmer` returns ≥ 1 hit from a source whose city is Ajmer.
- AC-S2: search `q=bengaluru` matches entities tagged Bangalore (trigram bridges the misspelling).
- AC-S3: empty `q` returns 400.
- AC-S4: cross-source query — search index spans both `entities` and `entities_<slug>` tables.

---

## G2 — Search facets

Adds facet filters on top of G1. No new endpoint — `/api/search` gains `&source=`, `&category=`, `&city=`, `&min_price=`, `&max_price=`, `&date_from=`, `&date_to=`. UI surfaces these as filter chips on `/search`.

---

## D1 — Intra-source duplicate detection

**Goal:** inside one source's table, identify near-duplicate records (e.g., the same property reposted with a different `external_id` after a re-listing).

**Approach:**
1. For each source, define a `dedup_key` config: a small set of fields to normalize and hash (e.g. `[normalize_address, reserve_price, auction_date, bank_branch]`).
2. A nightly job walks recent entities, computes the dedup_key, and groups by `(source, dedup_key_hash)`.
3. Within each group, run pairwise trigram similarity on the `title` + `address` fields. Pairs with similarity ≥ 0.85 become candidates.
4. Write to a new `entity_duplicates` table: `{ canonical_id, duplicate_id, source, similarity, dedup_key_hash, detected_at }`. The lower-numbered id is the canonical.
5. The entity detail page surfaces "N duplicates found" → linked list.

**Tests:**
- AC-D1: Two entities in `bankeauctions_live` with the same address + reserve price but different `auction_id` → flagged as duplicates with similarity ≥ 0.85.
- AC-D2: Marking one as `not a duplicate` writes a `entity_duplicate_overrides` row; next run respects the override.

---

## D2 — Cross-source duplicate clusters

**Goal:** the same physical property listed on `ibapi.in` and `bankeauctions.com` and `baanknet.com` becomes **one** card in the UI.

**Approach (extends D1):**
1. New table `entity_clusters { cluster_id, member_source, member_id, role: 'canonical'|'member', joined_at }`.
2. Blocking key: `(normalized_pincode, rounded_reserve_price)` — keeps the candidate set small.
3. Similarity: weighted sum of trigram(title), trigram(address), exact(pincode), exact(bank), within-90-days(auction_date).
4. Threshold 0.7 → join cluster. 0.5-0.7 → suggested cluster (operator confirms in UI).
5. `/api/search` and the UI roll clusters up — one hit per cluster, with the per-source detail nested.

**Tests:**
- AC-D3: an ibapi.in entity and a bankeauctions.com entity with identical pincode + reserve_price within ₹10k → joined into one cluster, surfaced as one search hit.
- AC-D4: operator splits a cluster → the split persists across the next dedup run.

---

---

## F3 — `pagination.style: "values"`

**Goal:** ingest a source whose data is sharded by a fixed list of opaque codes — `mstcindia.co.in` exposes `getScrollMsg/{REGION}` and there are 20 region codes. Without this mode, we'd need 20 separate source rows (each with its own cron, its own runs row, its own dedup config).

**Schema (additive):**

```jsonc
{
  "pagination": {
    "style": "values",
    "values": ["HO","BBR","BPL","BLR","CDG","ERO","GHY","HYD","JPR","LKO",
               "NRO","RNC","RPR","SRO","TVC","VAD","BZA","VZG","WRO","PTN"]
  },
  "http": {
    "method": "GET",
    "url": "https://www.mstcindia.co.in/mstcwebservice/Service.svc/getScrollMsg/{{value}}"
  }
}
```

**Behavior:**
- `paginate()` iterates `values` in order. For each value, render `{{value}}` into `http.url` (and optionally into `http.body`/`http.params` later if a source needs it) and fetch.
- `extractRecords(response, recordsPath)` runs per fetch; results are concatenated. A single run sees N pages where N = `values.length`.
- An empty page does **not** abort the loop (each shard is independent); `stop_when` is ignored.
- `max_pages` still caps the iteration as a safety net.

**Tests:**
- AC-V1: a seed with 3 `values` and a `{{value}}` URL template issues exactly 3 GETs to the rendered URLs in order.
- AC-V2: records across the 3 shards land in `entities` with their distinct external IDs; AC-2 (idle re-run skips) still holds.
- AC-V3: invalid template (missing `{{value}}` in URL) → run errors with `VALUES_TEMPLATE_REQUIRED`.

---

## S5 — `mstcindia.co.in`

See [`docs/sources/mstcindia.md`](./sources/mstcindia.md). Single seed using F3's `values` pagination. 20 region codes, ~200-500 lots in flight at any time. `category: govt-eauction` (timber, scrap, vehicles, customs disposal — different category from bank-auctions, so it won't enter the bank-auction cross-dedup pool).

**Hash strategy:** whole-record hash (`hash_fields: null`) — the record fields (`id`, `text`, `opening`, `Closing`, `GeneralLots`, `HazardousWaste`, `RVSFLots`, `OFF_NAME`) are small and stable.

**Dedup:** none (single source, distinct category). No cross-dedup either.

**Location:** `mode: "none"` (the region shard is already in the URL; per-run location filtering would mean selecting a subset of values).

**Cron:** `*/30 * * * *` (30 lots/region rotate slower than the bank-auction sources).

---

## S8 — `chennaicustoms.gov.in`

See [`docs/sources/chennaicustoms.md`](./sources/chennaicustoms.md). Standard `pagination.style: "page"` against WP REST. Records are PDF media items: each carries a stable Strapi-style `id`, a `source_url` pointing at the actual auction PDF, a `title.rendered`, and a `modified` timestamp.

**Hash strategy:** whole-record hash (small payloads; `_links` is stable; safer than picking nested paths since `hash_fields` is flat-only today).

**Dedup:** none for now — same source, no per-lot detail until a PDF-parse adapter exists.

**Cron:** `*/30 * * * *`.

---

## S9 — `bangalorecustoms.gov.in`

See [`docs/sources/bangalorecustoms.md`](./sources/bangalorecustoms.md). Mirror of S8 against the Bengaluru zone's WP REST.

---

## Out of scope (this plan)

- HTML / Cheerio parsing as a first-class storage mode (would unblock S7).
- Cloudflare/Turnstile bypass — out of project rules.
- Cross-language search (Hindi devanagari / Kannada / Tamil) — current plan is `simple` config + transliteration in `payload->>'title'`.
- LLM-based dedup — D1/D2 use deterministic similarity only.
