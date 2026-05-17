# `foreclosureindia.com`

| | |
|---|---|
| Phase | S6 (after spike) |
| Status | 🟠 Server-rendered; recon spike required |
| Category | bank-auction (aggregator) |
| Scope | Per-city, paginated by URL segment |
| Last recon | 2026-05-16 |

## Behavior

Server-rendered (PHP/Laravel-style) listing pages with a clean URL pattern:

```
https://foreclosureindia.com/bank-auctions/{city-slug}/{page-number}
```

Example: `https://foreclosureindia.com/bank-auctions/bengaluru/1` — initial fetch returned 28.9 kB HTML with paginator links to `/bengaluru/2`, `/bengaluru/3`, … `/bengaluru/N`. No JSON API endpoint is visible in the HTML head; no `/api/*` preconnect.

## URL

- Listing: `https://foreclosureindia.com/bank-auctions/{city}/{page}`
- Card detail: `https://foreclosureindia.com/auction-detail/{id}` (speculative — spike should confirm).

## Spike — what to confirm

1. Open `https://foreclosureindia.com/bank-auctions/bengaluru/1` in a real browser, inspect the Network tab for XHR/fetch calls. If the page makes secondary calls (e.g. an internal `/ajax/properties?…`), that becomes the seed endpoint.
2. If everything is rendered inline, this source defers to S7 (HTML parsing).
3. Confirm the city slug list (`bengaluru` vs `bangalore`?) by fetching `/bank-auctions/` (no city) and reading the city dropdown.

## Search / location filter

**Path-based.** F1 config:
```jsonc
"location": {
  "mode": "path",
  "templated": "https://foreclosureindia.com/bank-auctions/{{ location.city|slug }}/{{ pagination.page }}",
  "city_values": { "bangalore": "bengaluru", "ajmer": "ajmer" },
  "supports_all": false
}
```

If a city-less endpoint exists (e.g. `/bank-auctions/all/{page}`), set `supports_all: true`.

## Proposed seed (placeholder — pending spike)

Not authored yet. Two paths:
- (a) Internal JSON API discovered → standard seed.
- (b) HTML-only → defer to S7.

## Known risks

- The pagination is in the URL path, not a query parameter. The pipeline's current `pagination.style: "page"` uses `page_param` to set a query string; this source needs the new path-templated pagination introduced in F1.
- The list page may include both live and archived auctions; the seed must filter by status to avoid hash churn.
