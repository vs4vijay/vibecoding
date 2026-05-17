# `eauction.gov.in` — NIC / GePNIC eAuction India

| | |
|---|---|
| Phase | S1 |
| Status | 🟢 JSON API confirmed |
| Category | govt-eauction (mixed: timber, surplus, customs, e-procurement) |
| Scope | All-India; per-state refNo prefixes (`2026_MH_…`, `2026_WB_…`, etc.) |
| Last recon | 2026-05-16 |

## Behavior

A Vue/Webpack SPA backed by a Java web service (`eauction_webservice` WAR). The landing page renders ~30 cards of **upcoming** auctions; the SPA also has live / closed tabs that hit additional endpoints. The web service is shared across many state procurement portals (the same SPA mentions `demoetenders.tn.nic.in` as the dev host) — the JSON shape is stable across them.

## URL

- Front-end (SPA): `https://eauction.gov.in/eauction/#/`
- Front-end (legacy advanced search): `https://eauction.gov.in/eAuction/app?page=FrontEndEauctionAdvancedSearch&service=page` — older Tapestry page, server-rendered HTML.
- **Web service base:** `https://eauction.gov.in/eauction_webservice/`

## Confirmed endpoint

```
GET https://eauction.gov.in/eauction_webservice/homePage/getLandingPageContents
```

- Auth: none.
- Headers: standard browser headers; `Accept: application/json` not required.
- Pagination: none — single 4.7 kB response.
- Verified response (2026-05-16): HTTP 200, `Content-Type: application/json;charset=UTF-8`.

### Response shape

```jsonc
{
  "upcomingAuctions": "[{ \"date\":\"18-May-2026 09:30 AM\",
                          \"refNo\":\"2026_MH_34290\",
                          \"title\":\"eAuction of the Timber at CD II Bhamragarh Depot…\" }, …]",
  // plus marquee fields, banner text, contact info
}
```

> ⚠ `upcomingAuctions` (and the live/closed siblings) is a **stringified JSON array**, not a nested array. Same trick as ibapi.in's ASP.NET `{"d":"<json>"}`. The pipeline's `extractRecords` already auto-parses single-string JSONPath matches, so `records_path: "$.upcomingAuctions"` should work transparently.

### Other endpoints in the SPA (not yet exercised)

- `GET /eauction_webservice/homePage/getAuctionDetails?refNo=<refNo>` — per-auction detail; returns 400 without a `refNo` query.
- `GET /eauction_webservice/ocq/...` — Online Catalog Query for the live-auctions tab. Exact path TBD.

## Search / location filter

No location filter on the landing call — it returns all upcoming auctions nationwide. Geographic spread is decodable from `refNo` (`YYYY_<state_abbr>_<seq>`):

- `2026_MH_34290` → Maharashtra
- `2026_WB_5530` → West Bengal
- `2026_RJ_…` → Rajasthan
- `2026_KA_…` → Karnataka

For F1's `location` config, set:
```jsonc
"location": { "mode": "none", "supports_all": true }
```
The post-fetch extractor can derive `state` from `refNo` and stamp it on each row.

## Proposed seed (`seeds/eauction_gov_in_upcoming.json`)

```jsonc
{
  "name": "eauction_gov_in_upcoming",
  "enabled": true,
  "category": "govt-eauction",
  "http": {
    "method": "GET",
    "url": "https://eauction.gov.in/eauction_webservice/homePage/getLandingPageContents",
    "headers": {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
      "Referer": "https://eauction.gov.in/eauction/"
    }
  },
  "pagination": { "style": "none" },
  "records_path": "$.upcomingAuctions",
  "external_id_path": "$.refNo",
  "hash_fields": ["date", "title", "refNo"],
  "location": { "mode": "none", "supports_all": true },
  "display_columns": [
    { "label": "Ref No",  "jsonpath": "$.refNo", "primary": true },
    { "label": "Date",    "jsonpath": "$.date" },
    { "label": "Title",   "jsonpath": "$.title" }
  ]
}
```

## Known risks

- `upcomingAuctions` rotates as auctions enter the "live" window; we'll see frequent INSERTs and not many UPDATEs. AC-2 (no-write on idle re-run) still holds because the dropped rows won't reappear.
- 4.7 kB is small now but the response includes live + closed via separate endpoints. Future expansion needs separate seeds (`eauction_gov_in_live`, `_closed`) — each is a 5-min cron at most.
- The `eAuction/app?page=FrontEndEauctionAdvancedSearch` path is server-rendered HTML. Documented here only to clarify why we don't use it.
