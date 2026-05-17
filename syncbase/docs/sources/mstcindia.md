# `mstcindia.co.in` — Forthcoming e-Auctions for All regions

| | |
|---|---|
| Phase | S5 |
| Status | 🟢 JSON API confirmed (per-region) |
| Category | govt-eauction (MSTC: scrap, customs disposal, vehicles, agri, mineral) |
| Scope | All-India, sharded by 20 MSTC regional offices |
| Last recon | 2026-05-17 |

## Behavior

The page `Forthcoming_e_Auctions_for_All_regions.aspx` is an ASP.NET WebForms shell that uses **Vue.js + axios** for the data layer. On mount, it loops over a fixed list of 20 MSTC office codes and issues 20 parallel GET calls to a WCF web service. Each call returns the office's "scroll message" plus its active auctions in a single JSON document.

There is no consolidated all-regions endpoint. To get the full picture you call all 20 — totalling ~30-50 kB.

## URL

- Front-end: `https://www.mstcindia.co.in/content/Forthcoming_e_Auctions_for_All_regions.aspx`
- API endpoint (per region):
  ```
  GET https://www.mstcindia.co.in/mstcwebservice/Service.svc/getScrollMsg/{REGION}
  ```

## Office codes (the 20 regions)

Discovered in the page's inline Vue init:
```js
offices: ['HO','BBR','BPL','BLR','CDG','ERO','GHY','HYD','JPR','LKO','NRO','RNC','RPR','SRO','TVC','VAD','BZA','VZG','WRO','PTN']
```

Mapping (per `OFFICE` field on responses): HO = Head office, BLR = Branch Office (Bangalore), JPR = Jaipur, HYD = Hyderabad, RPR = Raipur, BZA = Vijayawada, VZG = Visakhapatnam, ERO = Eastern Regional Office, NRO = Northern Regional Office, SRO = Southern Regional Office, WRO = Western Regional Office, BBR = Bhubaneswar, BPL = Bhopal, CDG = Chandigarh, GHY = Guwahati, LKO = Lucknow, PTN = Patna, RNC = Ranchi, TVC = Trivandrum, VAD = Vadodara.

## Response shape

```jsonc
[
  {
    "MSG":    "eAuction nos … notice text …",
    "OFFICE": "Branch Office(Bangalore)",
    "REGION": "BLR",
    "auction": [
      {
        "id":            "578862",
        "text":          "MSTC/BLR/Office of the DCP West Division/1/Bengaluru/26-27/8862",
        "region":        "BLR",
        "opening":       "18-05-2026::11:00:00",
        "Closing":       "18-05-2026::15:00:00",
        "GeneralLots":   "Yes",
        "HazardousWaste":"No",
        "RVSFLots":      "No",
        "OFF_NAME":      "Branch Office(Bangalore)"
      },
      …
    ]
  }
]
```

Sample sizes (2026-05-17): BLR → 23 KB ~50 lots; HO → 4 KB ~5 lots.

## Pagination

None per region. Total payload size is bounded by the number of forthcoming lots per office (rarely > 100). The "shard key" is the office code, not a numeric page.

## Attempts log

| Attempt | Result |
|---|---|
| `GET /mstcwebservice/service.svc` | 200 — WCF endpoint listing page (HTML) confirms it's a WCF service. |
| `GET /mstcwebservice/service.svc?wsdl` / `?singleWsdl` / `?disco` | All returned the WCF help HTML (`<HTML><HEAD>…disco</HEAD>`) — no WSDL or service contract was emitted, so we can't enumerate operations from metadata. |
| Guessed paths `getForthcomingAuctions`, `getAllRegions`, `getAuctions` | 404. The only operation name we can discover from the front-end's axios calls is `getScrollMsg`. |
| Read the rendered HTML for `axios.*` calls | Found `axios.get("/mstcwebservice/Service.svc/getScrollMsg/" + this.offices[i])` inside the inline Vue init. ✅ |
| `GET getScrollMsg/BLR` | 200, JSON, 23 KB, `auction[]` populated. ✅ |
| `GET getScrollMsg/HO` | 200, JSON, 4 KB, `auction[]` populated. ✅ |

## Onboarding plan

The pipeline's `pagination` doesn't currently iterate string values. Two viable approaches:

**Option A — one seed per region** (simpler; 20 seed files):
- Each seed hard-codes its region (`HO`, `BLR`, `JPR`, …).
- 20 cron entries that fire on staggered schedules.
- Operator can disable a region individually.

**Option B — extend `pagination` with a `values` style** (preferred for the longer run):
```jsonc
{
  "style": "values",
  "values": ["HO","BBR","BPL","BLR", … "PTN"],
  "value_param": "__path:1",        // template-substitute into http.url at path position 1
  "stop_when": "empty_records"
}
```
Single seed, one cron, 20 internal requests. About a day of pipeline work.

Either way, `records_path: "$[0].auction"` and `external_id_path: "$.id"` cover extraction. Each record carries `region` so we can stamp state-from-region downstream.

## Proposed seed shape (single-region, Option A)

```jsonc
{
  "name": "mstc_blr",
  "enabled": true,
  "category": "govt-eauction",
  "http": {
    "method": "GET",
    "url": "https://www.mstcindia.co.in/mstcwebservice/Service.svc/getScrollMsg/BLR",
    "headers": {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
      "Referer": "https://www.mstcindia.co.in/content/Forthcoming_e_Auctions_for_All_regions.aspx"
    }
  },
  "pagination": { "style": "none" },
  "records_path": "$[0].auction",
  "external_id_path": "$.id",
  "hash_fields": ["text", "opening", "Closing", "GeneralLots", "HazardousWaste"],
  "location": { "mode": "none", "supports_all": true },
  "display_columns": [
    { "label": "Auction ref", "jsonpath": "$.text", "primary": true },
    { "label": "Opening", "jsonpath": "$.opening" },
    { "label": "Closing", "jsonpath": "$.Closing" },
    { "label": "Region", "jsonpath": "$.region" }
  ]
}
```

## Known risks

- The service requires no auth or cookies right now. WCF endpoints can flip to require an `Authorization` header without notice — keep an eye on response status.
- The `text` field is the only human-readable description; richer details (lot count, item categories, reserve price) require following the per-auction PDF report at `https://www.mstcecommerce.com/auctionhome/mstc/auction_detailed_report_pdf.jsp` with `auc=<id>`.
- 20 regions × ~30 s cron each = 40 req/min if all run continuously. Not a concern but worth noting.
