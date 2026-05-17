# `eauctiondekho.com`

| | |
|---|---|
| Phase | S3 |
| Status | 🟡 Next.js + dedicated API host; endpoint shapes need a spike |
| Category | bank-auction (aggregator) |
| Scope | Per-location, per-bank slugs |
| Last recon | 2026-05-16 |

## Behavior

Next.js (App Router) front-end. The home page is statically/SSR rendered and most data calls go to a dedicated subdomain `api.eauctiondekho.com`. The URL scheme encodes the city and bank as path segments:

```
https://www.eauctiondekho.com/locations/{city-slug}/banks/{bank-slug}
```

Example: `/locations/bengaluru/banks/state-bank-of-india`.

The page chunk imports React Query (`useQuery`) with query keys like `SAVED_SEARCH`, so the data fetch is client-side. The page HTML preconnects to `https://api.eauctiondekho.com/` confirming the API base.

The API responds with JSON; the root path (`/`) returns gzipped HTML, and the bare `/auctions` returns a Strapi-style `{ "error": { "status": 404, "name": "NotFoundError" } }`. That structure tells us it's a **Strapi 4** backend (common conventions: `/api/<collection>?filters[…]=…&pagination[page]=N&pagination[pageSize]=M`).

## URLs to explore (spike)

- `GET https://api.eauctiondekho.com/api/auctions?pagination[page]=1&pagination[pageSize]=20`
- `GET https://api.eauctiondekho.com/api/properties?…`
- `GET https://api.eauctiondekho.com/api/locations`
- `GET https://api.eauctiondekho.com/api/banks`

Strapi auto-exposes `find` endpoints on `/api/<collection>` — most public Strapi sites don't require auth for these. Confirm exact collection name in the spike by inspecting one network call from a real browser session on `/locations/bengaluru/banks/state-bank-of-india`.

## Search / location filter

**Path-based.** F1 config:
```jsonc
"location": {
  "mode": "path",
  "templated": "https://www.eauctiondekho.com/locations/{{ location.city|slug }}/banks/all",
  "city_values": { "bangalore": "bengaluru", "ajmer": "ajmer" },
  "supports_all": false
}
```

If we instead use the Strapi API directly, switch to:
```jsonc
"location": {
  "mode": "query",
  "field": "filters[city][slug][$eq]",
  "supports_all": true   // omit filter to get all
}
```

## Proposed seed (`seeds/eauctiondekho.json`) — pending spike

```jsonc
{
  "name": "eauctiondekho",
  "enabled": true,
  "category": "bank-auction",
  "http": {
    "method": "GET",
    "url": "https://api.eauctiondekho.com/api/auctions",
    "params": {
      "pagination[page]": "{{ pagination.page }}",
      "pagination[pageSize]": "50",
      "populate": "*"
    },
    "headers": { "User-Agent": "Mozilla/5.0", "Origin": "https://www.eauctiondekho.com" }
  },
  "pagination": {
    "style": "page",
    "page_param": "pagination[page]",
    "size_param": "pagination[pageSize]",
    "size": 50,
    "start_page": 1,
    "stop_when": "empty_records",
    "max_pages": 500
  },
  "records_path": "$.data",
  "external_id_path": "$.id",
  "hash_fields": null,
  "location": { "mode": "query", "field": "filters[city][slug][$eq]", "supports_all": true }
}
```

## Known risks

- Strapi gates collections with token-only access on some installs. If `/api/auctions` returns 401, fall back to scraping the rendered Next.js page (`/locations/{city}/banks/{bank}` returns SSR HTML with the data inlined as a streaming JSON island in `self.__next_f.push(…)`). That moves this source into S7.
- If `populate=*` returns enormous payloads, switch to a narrower `populate=city,bank,thumbnail` once the schema is known.
