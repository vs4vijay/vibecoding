# `baanknet.com` — BAANKNET eAuction Portal (PSB Alliance)

| | |
|---|---|
| Phase | S2 |
| Status | 🟡 JSON API located, body shape needs one more spike |
| Category | bank-auction (PSU bank consortium) |
| Scope | All-India, with state + city + locality filters |
| Last recon | 2026-05-16 |

## Behavior

Angular SPA (a single `index.html` shell + hashed Webpack bundles) served from `https://baanknet.com/`. All data is fetched via XHR against a Spring/Java backend at the `/eauction-psb` context path. The site has a separate Insolvency Board instance at `https://ibbi.baanknet.com/`.

Session-gated: even unauthenticated calls require a `JSESSIONID` cookie and an `XSRF-TOKEN` cookie echoed back as the `X-XSRF-TOKEN` request header.

Some endpoints fork on a runtime flag `elkSearchAuction` — when true, the SPA reroutes search to Elasticsearch-backed paths under `/common/eauction-search/…`. Default appears to be **off**; reconnaissance below uses the standard path.

## URLs

- Front-end: `https://baanknet.com/` (Angular SPA)
- API base: `https://baanknet.com/eauction-psb/api`
- Pre-flight: `GET /eauction-psb/api/get-session` — sets `JSESSIONID` + `XSRF-TOKEN`
- Property search: `POST /eauction-psb/api/auction-listing-data/?page={page}&size={size}`
- Helpers (not part of the ingest seed but useful for the location UI):
  - `GET /eauction-psb/api/get-state` — full state list
  - `POST /eauction-psb/api/get-states-list` (autosuggest)
  - `POST /eauction-psb/api/get-auto-suggestion-cities/{stateAbbr}` body: `{"abbr":"RJ"}`
  - `POST /eauction-psb/api/locality/{cityId}` body: search-criteria object

## Confirmed pre-flight (2026-05-16)

```
GET https://baanknet.com/eauction-psb/api/get-session
→ 200, body: "<base64-ish text>"
   Set-Cookie: JSESSIONID=<uuid>; Path=/eauction-psb; HttpOnly
   Set-Cookie: XSRF-TOKEN=<uuid>; Path=/
```

```
GET https://baanknet.com/eauction-psb/api/fetch-server-datetime
→ 200, {"datetime":"16-May-2026 23:01:08"}
```

## Listing call (needs follow-up spike)

```
POST https://baanknet.com/eauction-psb/api/auction-listing-data/?page=0&size=10
Headers:
  Content-Type: application/json
  X-XSRF-TOKEN: <token from cookie>
  Origin: https://baanknet.com
  Referer: https://baanknet.com/search-auction
Cookies: JSESSIONID=…; XSRF-TOKEN=…
Body: <full search criteria — see below>
```

Calls with `{"page":0,"pageSize":10}` returned **500** (with or without session). The Angular form (`getAuctionListing` in `main.<hash>.js`) sends the **entire reactive form** including a long list of empty/nullable fields. The spike for S2 is to capture one real browser POST body and reduce it to a minimal seed payload. Expected fields from the bundle (`initializeForm`):

- `auctionID` (numeric, regex `^\d+$`, max 10)
- `bankPropertyId` (alphanum + ` - /`, max 25)
- `propertyTypeId`
- `stateId`, `cityId`, `localityId`
- `propertySubTypeId`
- `assetCategoryId`, `bankId`, `branchId`
- `reservePriceMin`, `reservePriceMax`
- `auctionFromDate`, `auctionToDate`
- `page`, `pageSize`
- about a dozen others (status filters, EOI flags, possession status, etc.)

A minimal `Search All` body — confirmed during the spike — goes into the seed as `http.body`.

## Search / location filter

Location is **body-keyed**. F1 config:
```jsonc
"location": {
  "mode": "body",
  "field": "cityId",
  "city_values": { /* fetched lazily from /get-auto-suggestion-cities */ },
  "state_values": { /* fetched lazily from /get-state */ },
  "supports_all": true   // empty city + empty state → returns all-India
}
```

## Proposed seed (`seeds/baanknet_listing.json`) — pending spike

```jsonc
{
  "name": "baanknet_listing",
  "enabled": true,
  "category": "bank-auction",
  "http": {
    "method": "POST",
    "url": "https://baanknet.com/eauction-psb/api/auction-listing-data/?page={{ pagination.page }}&size={{ pagination.size }}",
    "headers": {
      "Content-Type": "application/json",
      "Origin": "https://baanknet.com",
      "Referer": "https://baanknet.com/search-auction"
    },
    "pre_request": {
      "url": "https://baanknet.com/eauction-psb/api/get-session",
      "method": "GET",
      "captures": [
        { "from": "cookie", "name": "XSRF-TOKEN", "to": "headers.X-XSRF-TOKEN" },
        { "from": "cookie", "name": "JSESSIONID", "to": "cookies.JSESSIONID" }
      ]
    },
    "body": { /* minimal search-all body — captured during spike */ }
  },
  "pagination": {
    "style": "page",
    "page_param": "page",
    "size_param": "size",
    "size": 50,
    "start_page": 0,
    "stop_when": "empty_records",
    "max_pages": 1000
  },
  "records_path": "$.data",
  "external_id_path": "$.auctionID",
  "hash_fields": null,
  "location": { "mode": "body", "field": "cityId", "supports_all": true }
}
```

## Known risks

- The `elkSearchAuction` ENV branch points at `/common/eauction-search/…`. If the portal flips that flag on, the seed above will start failing — keep the seed pinned and add a fallback seed for the ELK path during the spike.
- The pre-flight session lifetime is unknown; seed assumes one pre-flight per run. If the session expires mid-pagination, the pipeline must retry the pre-flight on 401 / 419.
- A future "feature flag" config field on the source might also expose the bank/state/category filters for richer UI faceting.
