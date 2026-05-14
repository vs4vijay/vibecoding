# Seed sources

Three live source configs verified via statesnapper's `test-dryrun` endpoint.

| file | site | type | record count (2026-05-14) | records_path | external_id_path |
|---|---|---|---|---|---|
| `ibapi_auction_properties.json` | [ibapi.in](https://ibapi.in/) — Indian Banks Auction Properties Information | Bank-foreclosure property listings (SARFAESI). **Not unlisted shares.** | 11,484 | `$.d` (auto-unwrapped from ASP.NET PageMethods `{"d":"<encoded JSON>"}`) | `$.ROWID` |
| `incredmoney_unlisted.json` | [incredmoney.com](https://incredmoney.com/) | Unlisted equities marketplace (InCred Money). | 90 | `$.data` | `$.ISIN` |
| `sharescart_unlisted.json` | [sharescart.com](https://www.sharescart.com/) | Unlisted shares marketplace. | 132 | `$.data` | `$.UL_STOCKS_FINCODE` |

All three are GET/POST endpoints that return a single payload — no pagination. Diff-on-content_hash via statesnapper's normal generic-mode pipeline; configure `hash_fields` to ignore noisy attributes (e.g. timestamps, presentation HTML).

## Register them

```bash
bun bin/cli.ts sources add --file seeds/incredmoney_unlisted.json
bun bin/cli.ts sources add --file seeds/sharescart_unlisted.json
bun bin/cli.ts sources add --file seeds/ibapi_auction_properties.json
```

Then either:
- visit `/sources/<id>` and click **Run now**, or
- run via CLI: `bun bin/cli.ts run --source incredmoney_unlisted`

## Notes on ibapi.in

The original prompt grouped ibapi.in with the two unlisted-share sites, but ibapi.in is the **Indian Banks Auction Properties Information** portal. It exposes bank-foreclosure property auctions under SARFAESI, not unlisted equities. The pipeline still works — same versioning, same change feed — but the records are properties (with `Bank Name`, `Property`, `Reserve Price`, `City`, `State`, etc.), not shares.

If you actually want unlisted Indian shares, candidate sites to research separately: `unlistedzone.com`, `planify.in`, `unlistedkart.com`.

## ASP.NET PageMethods caveat

`ibapi.in` wraps its response as `{"d": "<JSON-encoded string>"}`. `lib/pipeline/extract.ts:extractRecords` auto-detects this: when the JSONPath match is a single string, it tries `JSON.parse` and uses the result if it parses to an array. So `records_path: "$.d"` works transparently.

## Sharescart caveat

`sharescart.com` returns the JSON body under `Content-Type: text/html`. `lib/pipeline/fetch.ts` forces JSON parsing via ofetch's `parseResponse` callback, so the wrong content-type is handled transparently.
