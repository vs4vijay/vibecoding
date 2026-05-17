# `foreclosureindia.com`

| | |
|---|---|
| Phase | S6 (re-evaluated) |
| Status | 🔴 HTML-only confirmed — no API, no feed, no sitemap |
| Category | bank-auction (aggregator) |
| Scope | All-India, paginated by city slug + page number |
| Last recon | 2026-05-17 |

## Behavior

PHP/Nginx server-rendered listing. URL pattern is `/bank-auctions/{city-slug}/{page}`. Each page is fully server-rendered HTML — no JSON, no XHR, no inline data island. The combined static JS bundle on the CDN (`cdn.foreclosureindia.com/combine/…js`, 452 KB) is third-party widgets (vimeo, GTM, jQuery plugins) — nothing app-specific that hits a data endpoint.

## URL

- Listing: `https://foreclosureindia.com/bank-auctions/{city}/{page}`
- Combined JS: `https://cdn.foreclosureindia.com/combine/4c676fb99738f01473c6390b922931a1-1771491802.js` (third-party widgets only)

## Attempts log

| Attempt | Result |
|---|---|
| Static analysis of `bank-auctions/bengaluru/1` HTML | Pagination links to `/bengaluru/{2..N}` — pure server-rendered. |
| `GET /sitemap.xml` | 301 → `/` (home page). |
| `GET /sitemap_index.xml`, `/rss`, `/rss.xml`, `/feed` | All 404 (return the 404 page, 30 KB). |
| `GET /api/properties`, `/api/auctions`, `/api/v1/properties`, `/properties.json` | All 404. |
| Static analysis of `cdn.foreclosureindia.com/combine/…js` (452 KB) | `tr ' '` + grep on `^/(api\|ajax\|json\|search\|bank\|properties)` paths → nothing. The bundle is GTM, jQuery, Vimeo embed helpers, modernizr, etc. No app-specific data endpoint. |
| Search for `fetch(`, `$.ajax`, `$.get`, `$.post` in the rendered HTML | None outside of GTM. |
| `GET /robots.txt` | 301 → `/`. Nothing useful. |

## Why no JSON exists

Foreclosureindia rebuilds the page server-side on every navigation. The pagination links are real anchor tags (not JS-controlled). The page bundle has no app-specific JS that calls any internal API. This isn't a Next.js / SPA hybrid — it's a classic PHP CMS.

## Recommended verdict

**Skip until HTML-parser storage mode lands.** The pages are clean (Bootstrap cards in a grid), the URL pattern is regular, and the data is high-quality — so once we have Cheerio-on-DOM, this is a strong candidate.

Sample card structure (for the future HTML adapter):
```html
<div class="property-card">
  <h4><a href="/auction/{slug-{id}}">{property title}</a></h4>
  <div class="city">{city}</div>
  <div class="price">{reserve price}</div>
  <div class="bank">{bank name}</div>
  <div class="auction-date">{date}</div>
</div>
```

## Known limitations

- City-slug ↔ city-name normalization needed (`bengaluru` vs `bangalore` etc.).
- No `lastmod` signal at the listing level; would need a content-hash to detect changes (which our pipeline already does for JSON — equally applicable to HTML once the adapter exists).
