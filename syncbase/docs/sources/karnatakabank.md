# `karnatakabank.bank.in`

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🔴 Drupal with REST disabled + anti-bot JS challenge on feed endpoints |
| Category | bank-auction (SARFAESI) |
| Scope | All-Karnataka — branches across the state |
| Last recon | 2026-05-17 |

## Behavior

Drupal 11 site. The `/auction-notice` page uses a Views block (`view-id-auction_notices_view`, `display-id-block_1`) that renders auction rows server-side. The links go to PDF SARFAESI notices on CloudFront (`d3sdkw7nvdnqts.cloudfront.net`).

Drupal would normally expose `/jsonapi/node/auction_notice` and `/views/ajax` — but on this site, **every API/feed endpoint returns either 403 or a SHA1-based JavaScript challenge** that has to be solved client-side. The initial `/auction-notice` page works because of edge caching; repeated targeted requests get bot-walled.

## URLs

- Front-end: `https://www.karnatakabank.bank.in/auction-notice`
- Cloud-front PDFs: `https://d3sdkw7nvdnqts.cloudfront.net/s3fs-public/{YYYY-MM}/{borrower}.pdf`

## Attempts log

| Attempt | Result |
|---|---|
| `GET /auction-notice?_format=json` | 403 (Drupal REST endpoint not exposed). |
| `GET /jsonapi/node/auction_notice` | 403. |
| `GET /jsonapi/node/auction` | 403. |
| `GET /views/ajax` (POST equivalent for Views) | 403. |
| `GET /feed`, `/feed.xml`, `/rss/auctions`, `/auctions.xml`, `/auction-notice/feed` | 403. |
| `GET /rss.xml` | 200 (19 KB) — site-wide RSS. Mixes RFPs, debit-card offers, SARFAESI items. Auction items are present but co-mingled. No category filter parameter. |
| `GET /sitemap.xml` | 200 (4.3 KB) but body is a SHA1 JS challenge — not a real sitemap. |
| `GET /auction-notice-feed` | 200 (4.5 KB) but body is the same JS challenge. |
| Static analysis of the page for Views AJAX | Standard Drupal Views infinite-scroll DOM markers found (`data-drupal-views-infinite-scroll-content-wrapper`-shaped), but the actual `/views/ajax` POST is 403-walled. |

## Why the JS challenge is fatal

The 4.5 KB feed response is a small HTML page that ships an inline SHA1 implementation, computes a hash of the request, and reloads with the hash in a cookie. Curl gets the bot-test page; a real browser solves it and gets the data. We'd need a headless browser (Playwright) — explicitly out of scope.

## Possible workarounds (none clean)

1. **Use the site-wide `/rss.xml` + filter by node-id range.** Auction items have a stable URL pattern (`/node/{nodeid}`) and their titles look like borrower names in ALL CAPS (`POWER R TRADERS`, `CHAUDHARY BAJAJ`). A whitelist regex on `<title>` could pull them out, but it's brittle.
2. **Wait for a CDN cache invalidation window**, fetch raw, accept the staleness. The page is reachable but inventory rotates faster than the cache.
3. **Add a Playwright-driven storage mode**. Out of scope.

## Recommended verdict

**Skip.** Karnataka Bank's auction inventory is fully visible on the **aggregator** sources we've already onboarded (every SARFAESI listing this bank publishes will also appear on `baanknet.com` if the bank is a PSB Alliance member, and on `eauctiondekho.com` regardless). The marginal coverage gain isn't worth the engineering cost of a Playwright pipeline.

## Known limitations

- Each PDF is a separate file per borrower; no aggregated structured listing.
- The Drupal node IDs appear unstable across redirects (we saw `node/996` for the `auction-notice` page itself).
