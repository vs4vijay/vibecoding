# `chennaicustoms.gov.in` — Chennai Customs auction notices

| | |
|---|---|
| Phase | new (was in S7 deferred bucket; promoted after recon) |
| Status | 🟢 WordPress REST API — JSON confirmed |
| Category | govt-customs |
| Scope | Chennai customs zone — disposal/auction notices, PDF-anchored |
| Last recon | 2026-05-17 |

## Behavior

The `/auctions/` page is a WordPress 6.x page. The auction notices are published as **`media`** items (the PDFs themselves) and **`posts`** in the announcement category, both of which the default WP REST API exposes as JSON.

We don't get structured auction-line data (auction id, reserve price, location, lot count) — those are inside the PDFs. What we DO get reliably is: a stable item id, the PDF URL, the title (which usually contains the auction date and goods type), and the publish/modified timestamps. That's enough to track "is there a new notice today?" and to surface the PDF as a clickable artifact.

## URL

- Front-end: `https://chennaicustoms.gov.in/auctions/`
- API base: `https://chennaicustoms.gov.in/wp-json/wp/v2/`

## Verified endpoints (2026-05-17)

| Endpoint | Result |
|---|---|
| `GET /wp-json/wp/v2/media?search=auction&per_page=3` | 200, `[{ id, date, slug, source_url, title.rendered, … }]`. The auction PDFs land here. |
| `GET /wp-json/wp/v2/posts?search=auction&per_page=2` | 200, posts like *"List of Goods for Auction Fixed on…"*. |
| `GET /wp-json/wp/v2/pages?search=auction` | 200 — the umbrella `/auctions/` page (`id: 8108`). |
| `GET /wp-json/wp/v2/categories` | 200 — categories list. Auction-related rows sit under category `ccfc` (id 1, 28 posts). |

## Sample record (media)

```jsonc
{
  "id": 8455,
  "date": "2026-05-08T09:25:04",
  "date_gmt": "2026-05-08T03:55:04",
  "guid": { "rendered": "https://chennaicustoms.gov.in/wp-content/uploads/2026/05/Letter-to-MSTC-for-auction-on-14.05.2026.pdf" },
  "modified": "2026-05-08T09:25:04",
  "slug": "letter-to-mstc-for-auction-on-14-05-2026",
  "title": { "rendered": "Letter to MSTC for auction on 14.05.2026" },
  "source_url": "https://chennaicustoms.gov.in/wp-content/uploads/2026/05/Letter-to-MSTC-for-auction-on-14.05.2026.pdf",
  "mime_type": "application/pdf",
  …
}
```

## Pagination

WP REST supports `?page=N&per_page=M` and exposes total counts via `X-WP-Total` / `X-WP-TotalPages` response headers. Default `per_page` is 10, max is 100.

## Attempts log

| Attempt | Result |
|---|---|
| Visual inspection of `/auctions/` HTML | WordPress (`scheme_original` class). Lists PDFs inline — could parse the rendered HTML, but the WP REST API is much cleaner. |
| `GET /wp-json/wp/v2/pages?search=auction` | 200, returns the `auctions` page metadata. ✅ |
| `GET /wp-json/wp/v2/media?search=auction` | 200, returns auction-related PDFs. ✅ |
| `GET /wp-json/wp/v2/posts?search=auction` | 200, returns announcement posts. ✅ |

## Proposed seed

```jsonc
{
  "name": "chennaicustoms_media",
  "enabled": true,
  "category": "govt-customs",
  "http": {
    "method": "GET",
    "url": "https://chennaicustoms.gov.in/wp-json/wp/v2/media",
    "params": { "search": "auction", "orderby": "date", "order": "desc" },
    "headers": { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
  },
  "pagination": {
    "style": "page",
    "page_param": "page",
    "size_param": "per_page",
    "size": 100,
    "start_page": 1,
    "stop_when": "empty_records",
    "max_pages": 10
  },
  "records_path": "$",
  "external_id_path": "$.id",
  "hash_fields": ["modified", "title.rendered", "source_url"],
  "location": { "mode": "none", "supports_all": true },
  "display_columns": [
    { "label": "Title", "jsonpath": "$.title.rendered", "primary": true },
    { "label": "Date", "jsonpath": "$.date" },
    { "label": "PDF", "jsonpath": "$.source_url" }
  ]
}
```

## Known limitations

- "Auction"-keyword filtering pulls in administrative items too (e.g., bid-document templates). The seed's `search=auction` is the WP-REST text search; downstream we can layer a category filter (`?categories=1`) for CCFC-only.
- Per-lot details (reserve price, goods description, branch contact) are inside the PDF body. To make this feed comparable to bank-auction sources, we'd need a PDF text-extraction adapter — separate phase.
