# `mumbaiport.gov.in`

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🔴 Static PHP CMS — PDF notices only |
| Category | govt-port (port-trust surplus / disposal) |
| Scope | Mumbai Port Authority only |
| Last recon | 2026-05-17 |

## Behavior

PHP CMS where every page is `show_content.php?lang=1&level=2&ls_id={menu-id}&lid={leaf-id}`. The `ls_id=1352` page (auction notices) is a static HTML page with a single PDF link (`/WriteReadData/RTF1984/{ts}.pdf`). No data API, no JSON, no even a listing — one PDF per cycle.

## URL

- Page: `https://mumbaiport.gov.in/show_content.php?lang=1&level=2&ls_id=1352&lid=1074`

## Attempts log

| Attempt | Result |
|---|---|
| `GET ?format=json` (appended to the existing URL) | 200, but body is the same HTML — the param is ignored. |
| Static scan for `getJSON`, `fetch`, `$.ajax`, etc. | Only marquee/slick-carousel JS. No data fetcher. |
| Look for an admin / data API at common paths (`/api`, `/data`, `/json`) | Did not exhaustively probe; the inline scripts show no such URL exists. |
| Cross-reference the visible PDF link | One PDF (`/WriteReadData/RTF1984/1738769975.pdf`) — that's the only auction artifact on the page. |

## Recommended verdict

**Skip.** A single PDF link per page isn't a listing — we'd be tracking "was this PDF replaced?" with no per-lot detail. PDF text extraction would be required to surface anything meaningful, and even then the cadence is too low to be operationally interesting.

## Known limitations

- The PHP CMS exposes no machine-readable structure.
- The PDF filename appears to be a Unix timestamp; new notices would show up as new files, but we have no way to enumerate them without a directory listing (which isn't exposed).
