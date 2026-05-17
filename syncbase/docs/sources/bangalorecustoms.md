# `bangalorecustoms.gov.in` — Bengaluru City Customs notices

| | |
|---|---|
| Phase | new (was in S7 deferred bucket; promoted after recon) |
| Status | 🟢 WordPress REST API — JSON confirmed |
| Category | govt-customs |
| Scope | Bengaluru customs zone — order notices, auction PDFs |
| Last recon | 2026-05-17 |

## Behavior

Same architecture as `chennaicustoms.gov.in` — WordPress with the default REST API enabled. The `/bengaluru-city-customs/` page renders a list of orders/notices, most linking to PDFs under `/wp-content/uploads/`. The REST API exposes those same media and posts.

The signal/noise ratio is lower than chennaicustoms — most posts are routine PNs (public notices) and EOs (establishment orders), not auctions. A category filter is essential.

## URL

- Front-end: `https://bangalorecustoms.gov.in/bengaluru-city-customs/`
- API base: `https://bangalorecustoms.gov.in/wp-json/wp/v2/`

## Verified endpoints (2026-05-17)

| Endpoint | Result |
|---|---|
| `GET /wp-json/wp/v2/pages?search=auction` | 200, ~770 kB — every page containing "auction" anywhere. Wide net. |
| `GET /wp-json/wp/v2/media?search=auction&per_page=3` | 200, PDFs matching "auction" (some are unrelated, e.g. RTI replies). |
| `GET /wp-json/wp/v2/posts?per_page=2` | 200, the announcement posts (sample showed `public-notice-no-02-2025-bcc-…`). |

## Sample record (media)

```jsonc
{
  "id": 8000,
  "date": "2026-05-13T17:06:06",
  "modified": "2026-05-13T17:06:06",
  "slug": "sb005_bcc",
  "title": { "rendered": "SB005 BCC" },
  "source_url": "https://bangalorecustoms.gov.in/wp-content/uploads/2026/05/SB005_bcc.pdf",
  "mime_type": "application/pdf",
  …
}
```

## Attempts log

| Attempt | Result |
|---|---|
| Visual inspection of `/bengaluru-city-customs/` HTML | WordPress (TwentyTwenty theme). Hundreds of PDF links under `/wp-content/uploads/`. |
| `GET /wp-json/wp/v2/pages?search=auction` | 200 (770 kB) — too broad. ✅ but noisy. |
| `GET /wp-json/wp/v2/media?search=auction` | 200, useful but mixes auction PDFs with unrelated docs. |

## Proposed seed

Same shape as `chennaicustoms_media`. The seed should expose a tighter title-regex post-filter (or category=auction once we know the category id) before counting an item as a new auction notice.

```jsonc
{
  "name": "bangalorecustoms_media",
  "enabled": true,
  "category": "govt-customs",
  "http": {
    "method": "GET",
    "url": "https://bangalorecustoms.gov.in/wp-json/wp/v2/media",
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
  "hash_fields": ["modified", "title.rendered", "source_url"]
}
```

## Known limitations

- **CDN strips query-string parameters beyond a base set.** Both `page` and `offset` are ignored — every page request returns the same first 10 records. We've capped `max_pages: 1` and accept that we only see the latest 10 auction notices. Tracking new arrivals still works (the latest-10 window slides as new PDFs land).
- The site is fronted by an SSL chain that Node's default trust store doesn't accept on Windows / some CI images. The seed sets `http.insecure_tls: true` so this single source's calls bypass TLS verification — the rest of the process keeps strict verification.
- Same as chennaicustoms — PDF body data isn't directly available; per-lot details (lot count, reserve price, branch contact) require PDF parsing.
- "Auction"-keyword filtering pulls in administrative items too (e.g., RTI replies). A category filter would tighten this once the category id is identified.
