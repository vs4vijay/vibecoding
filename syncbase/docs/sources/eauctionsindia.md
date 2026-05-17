# `eauctionsindia.com`

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🟡 No JSON listing API — but `/live-sitemap.xml` is a viable change-stream (XML, 2.7 MB) |
| Category | bank-auction (aggregator) |
| Scope | All-India, indexed by property id |
| Last recon | 2026-05-17 |

## Behavior

Laravel front-end with **HTML-rendered** listings. The site does have an `/api/` namespace but every guess returns 404 except `/api/properties/{id}` which returns `{"error":"Token missing"}` — the detail endpoint exists but is behind an auth token we don't possess.

What it *does* expose: a 2.7 MB **`live-sitemap.xml`** at the root, listing **every live property URL** with a `<lastmod>` timestamp at the day level. That's a viable ingest path: poll the sitemap, treat each `<loc>` as the external_id, use `<lastmod>` as the change-detection field. Detail pages stay HTML-only (out of scope for now).

## URLs

- Front-end (city): `https://www.eauctionsindia.com/city/{city-slug}`
- Front-end (single property): `https://www.eauctionsindia.com/properties/{id}`
- Sitemap (used for ingest): `https://www.eauctionsindia.com/live-sitemap.xml`
- `/api/properties/{id}`: returns `{"error":"Token missing"}` — auth-walled.

## Attempts log

| Attempt | Result |
|---|---|
| `GET /api/properties` and 6 other guesses (`auctions`, `cities`, `states`, `banks`, `list`, `property`) | All 404. |
| `GET /api/properties/761807` | 401, `{"error":"Token missing"}`. Endpoint exists but requires a token. |
| Same with `X-CSRF-TOKEN` from the page's `<meta>` | Still 401. CSRF isn't the auth — there's a separate Bearer/API token we don't have. |
| `GET /properties/761807?format=json` | 200 but HTML (the query param is ignored). |
| `GET /properties/761807.json` | 404. |
| `GET /citiesbystate?state=…` (from `js/citiesbystate.min.js`) | Returns JSON, but only the cities-dropdown for the state — not listings. |
| `GET /add-favourite/{id}` POST (from `js/add-fav.min.js`) | Helper endpoint for the favourites widget; not a listing source. |
| `GET /sitemap.xml` | 200 (924 bytes) — sitemap *index* pointing at `/live-sitemap.xml` and friends. |
| `GET /live-sitemap.xml` | 200 (2.7 MB) — XML urlset of every live property URL + `<priority>` + `<lastmod>`. ✅ |
| `GET /api/cities`, `/api/banks`, `/api/states` | All 404. The "API" surface is just `/api/properties/{id}` (auth-walled) plus a handful of widget helpers. |
| Inspection of `/city/ajmer` rendered HTML | Property cards rendered server-side as `<a href="/properties/{id}">…</a>`. No inline JSON. |

## Onboarding plan

The viable shape is the sitemap. It's XML so we'd need a thin XML→JSON adapter on the pipeline (or just text-find the `<url>` blocks and extract `loc` + `lastmod` via regex — Bun's `DOMParser` polyfill or `fast-xml-parser` handles this in 10 lines).

Proposed minimal schema (one row per live property):

```jsonc
{
  "id": 761807,
  "url": "https://www.eauctionsindia.com/properties/761807",
  "lastmod": "2026-05-17",
  "priority": 0.9,
  "changefreq": "hourly"
}
```

That's enough for change-detection at scale: 60-80k live URLs, ingested in one fetch. No per-lot data without HTML scraping the detail pages (which is itself behind a Laravel session/cookie wall in places).

## Recommended verdict

**Skip for now** unless we add an XML ingest mode. The trade-off:
- ✅ Cheap to poll (one fetch per cycle, only the changed URLs need follow-up)
- ❌ Surface info is poor (we know an auction *exists* but nothing about its city, price, bank, etc.)
- ❌ Per-property detail requires HTML scraping the detail pages, and those are styled inconsistently across property types

Better candidates exist (`mstcindia.co.in`, the customs WP sites). Park this until `parse_mode: "xml_sitemap"` is added or a JSON listing endpoint emerges.

## Known limitations

- The `/api/properties/{id}` token gate suggests an internal app exists. If someone reverse-engineers the token issuance (the page presumably gets a JWT/bearer at load time), the full per-lot JSON would unlock — but that's a bigger spike.
