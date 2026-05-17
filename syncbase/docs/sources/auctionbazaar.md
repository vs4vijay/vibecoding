# `auctionbazaar.com`

| | |
|---|---|
| Phase | S4 |
| Status | 🟡 Next.js, API host TBD |
| Category | bank-auction (aggregator) |
| Scope | Per-city listings via `/auction-properties-in-{city}-{state}` |
| Last recon | 2026-05-16 |

## Behavior

Next.js front-end (App Router; chunks under `/_next/static/chunks/`). URL pattern is location-templated:

```
https://www.auctionbazaar.com/auction-properties-in-{city}-{state}?start_from=location
```

The page returns server-rendered HTML with the dataset embedded as a streamed JSON island (`self.__next_f.push([…])` blocks) in the initial response. There is no obvious `api.auctionbazaar.com` preconnect — the data either comes from same-origin `/api/*` routes (Next API handlers) or is shipped entirely in the SSR payload.

## URLs to explore (spike)

- `GET https://www.auctionbazaar.com/auction-properties-in-bangalore-karnataka?start_from=location` — already returns 11 kB of SSR HTML; check for `__NEXT_DATA__` (legacy) vs `self.__next_f` (App Router).
- Look in `_next/static/chunks/app/auction-properties-in-*/page-*.js` for fetch calls. If they hit `/api/...` paths, those become the seed endpoint.
- Try `GET https://www.auctionbazaar.com/api/properties?city=bangalore&state=karnataka` — speculative.

## Search / location filter

**Path-based.** F1 config:
```jsonc
"location": {
  "mode": "path",
  "templated": "https://www.auctionbazaar.com/auction-properties-in-{{ location.city|slug }}-{{ location.state|slug }}?start_from=location",
  "supports_all": false
}
```

If a JSON `/api/properties?city=…&state=…` endpoint is discovered, switch to:
```jsonc
"location": {
  "mode": "query",
  "field": "city",
  "supports_all": true
}
```

## Proposed seed (placeholder — depends on spike outcome)

```jsonc
{
  "name": "auctionbazaar",
  "enabled": true,
  "category": "bank-auction",
  "http": {
    "method": "GET",
    "url": "https://www.auctionbazaar.com/auction-properties-in-{{ location.city|slug }}-{{ location.state|slug }}",
    "params": { "start_from": "location" },
    "parse_mode": "next_data"
  },
  "pagination": { "style": "none" },
  "records_path": "$.props.pageProps.listings",
  "external_id_path": "$.id",
  "location": { "mode": "path", "supports_all": false }
}
```

> `parse_mode: "next_data"` is a **new** parse mode this seed introduces. It tells the fetch step to scan the HTML for `<script id="__NEXT_DATA__" …>` or stitched `self.__next_f.push([1, "…"])` chunks, parse them, and hand the assembled JSON tree to `extractRecords`. If the spike shows a clean JSON API exists, drop `parse_mode` and use a standard GET.

## Known risks

- If no JSON API exists, this source must wait on S7 (HTML parsing) or `parse_mode: "next_data"` becoming a first-class capability.
- The `start_from=location` query parameter suggests there are non-location entry points; check whether removing it returns a richer dataset (e.g. an All-India listing).
