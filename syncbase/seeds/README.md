# Seed sources

Live source configs validated through syncbase's `test-dryrun` + full-run pipeline.

## Working JSON-API sources

| file | site | type | record count | records_path | external_id_path | pagination |
|---|---|---|---|---|---|---|
| `ibapi_auction_properties.json` | [ibapi.in](https://ibapi.in/) — Indian Banks Auction Properties Information | Bank-foreclosure property listings (SARFAESI). | 11,484 | `$.d` (auto-unwrapped from ASP.NET `{"d":"<encoded JSON>"}`) | `$.ROWID` | none — single 5 MB POST |
| `incredmoney_unlisted.json` | [incredmoney.com](https://incredmoney.com/) | Unlisted equities marketplace. | 90 | `$.data` | `$.ISIN` | none |
| `sharescart_unlisted.json` | [sharescart.com](https://www.sharescart.com/) | Unlisted shares marketplace. | 132 (131 unique) | `$.data` | `$.UL_STOCKS_FINCODE` | none |
| `bankeauctions_live.json` | [bankeauctions.com](https://www.bankeauctions.com/) | Bank e-auctions (C1 India platform). | 1,746 | `$.aaData` (positional rows) | `$[1]` (column 1 = auction ID) | **offset** (`iDisplayStart`/`iDisplayLength=10`, server-capped at 10/page) |

## Sources investigated but with no public JSON API (skipped)

These were requested but expose only server-rendered HTML — they require scraping, which the user explicitly excluded:

- **`findauction.in/bank-property/ajmer`** — PHP/jQuery site. Listings are in HTML; the only JSON endpoints (`/ajax.php?type=*`) return reference data (banks, cities) not inventory.
- **`eauctionsindia.com/city/ajmer`** — Laravel server-rendered. `/api/` namespace exists but returns 404 for every listing path. Has a 2.4 MB `live-sitemap.xml` with all property URLs + lastmod, but that's XML scraping.
- **`aubank.in/bank-auction`** — Next.js page behind Cloudflare bot challenge (Turnstile). Non-browser requests get 403. As of 2026-05-14 the page literally renders "No auctions available", so there's nothing to poll anyway. Also listed on bankeauctions.com as `bank_id=223` but with zero rows. Revisit when AU activates auctions.

## Register them

```bash
bun bin/cli.ts sources add --file seeds/incredmoney_unlisted.json
bun bin/cli.ts sources add --file seeds/sharescart_unlisted.json
bun bin/cli.ts sources add --file seeds/ibapi_auction_properties.json
bun bin/cli.ts sources add --file seeds/bankeauctions_live.json
```

Then either visit `/sources/<id>` and click **Run now**, or run via CLI:

```bash
bun bin/cli.ts run --source incredmoney_unlisted
```

## Benchmarks (PGLite in-memory, batched upsert, BATCH_SIZE=250)

| source | records | first run | re-run (AC-2) |
|---|---|---|---|
| `incredmoney_unlisted` | 90 | ~1 s | <1 s, 90 skipped |
| `sharescart_unlisted` | 132 (131 unique) | <1 s | <1 s, 130 skipped + 2 real upstream changes |
| `ibapi_auction_properties` | 11,484 | ~10 s | ~3 s, 11,484 skipped |
| `bankeauctions_live` | 1,746 across 175 pages | several minutes (upstream RTT, not DB) | similar — bottleneck is HTTP, not the DB |

## Implementation notes

### ASP.NET PageMethods response unwrap (`ibapi.in`)

`extractRecords` in `lib/pipeline/extract.ts` auto-detects the `{"d":"<JSON>"}` shape: when a JSONPath match is a single string that parses as JSON, it returns the parsed result. So `records_path: "$.d"` works transparently.

### Forced JSON parsing (`sharescart.com`)

sharescart returns valid JSON under `Content-Type: text/html`. `lib/pipeline/fetch.ts` passes `parseResponse: JSON.parse` to ofetch so the wrong content-type is ignored.

### Positional-array records (`bankeauctions.com`)

DataTables-style endpoints return `aaData` as an array of arrays, not array of objects. Use bracket-index JSONPath like `$[1]` for `external_id_path` — `extractScalar` resolves that against each row. A future enhancement could let users map column indexes to typed columns (`Column 1 → auction_id INT`, `Column 4 → city TEXT`, etc.) via Phase 5's typed_columns feature.

### Offset pagination (`bankeauctions.com`)

The DataTables endpoint caps `iDisplayLength` at 10 server-side regardless of what you request. syncbase handles this via `pagination.style: "offset"` (added when this seed was wired up) — `iDisplayStart` increments by `size` each page until an empty response. ~175 pages for the current 1,746-record inventory.

### Cloudflare-fronted sites (`aubank.in`)

Cannot poll without browser-grade automation (Playwright). Out of scope per project rules. Re-check periodically.
