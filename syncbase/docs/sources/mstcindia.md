# `mstcindia.co.in` — Forthcoming e-Auctions for All regions

| | |
|---|---|
| Phase | S5 (after spike) |
| Status | 🟠 Server-rendered ASP.NET WebForms; recon spike required |
| Category | govt-eauction (MSTC: scrap, metals, customs, vehicles, agri) |
| Scope | All-India; per-region filter in-page |
| Last recon | 2026-05-16 |

## Behavior

ASP.NET WebForms (`.aspx`) — the listing page comes back as 47 kB of HTML with state hidden in `__VIEWSTATE`. Filtering by region is a `__doPostBack` interaction that re-POSTs the whole form. There is no public JSON endpoint exposed at this URL.

Related MSTC family pages (also WebForms / JSP):
- `https://www.mstcecommerce.com/auctionhome/customs/index.jsp`
- `https://www.mstcecommerce.com/auctionhome/customs/welcome.jsp`
- `https://www.mstcindia.co.in/auctionhome/…`

## URL

`https://www.mstcindia.co.in/content/Forthcoming_e_Auctions_for_All_regions.aspx`

## Spike — what to confirm before seeding

1. Inspect a real browser session: does any sub-resource return JSON (e.g. an `*.asmx` web service or an `ajaxpro` call)?  MSTC has historically exposed `WebService.asmx` for autocomplete-style lookups.
2. If no JSON endpoint exists, the only ingest path is HTML table parsing — which puts this source in S7 until syncbase grows an HTML-parser storage mode.
3. If a postback returns a partial-render (UpdatePanel), capture the `__VIEWSTATE` + `__EVENTVALIDATION` + `__EVENTTARGET` triple for one full request/response cycle. The seed will need to:
   - Initial GET to capture `__VIEWSTATE` / `__VIEWSTATEGENERATOR` / `__EVENTVALIDATION`.
   - POST with those values + `__EVENTTARGET=ctl00$…$ddlRegion` to switch region.

## Search / location filter

WebForms dropdown — likely `ddlRegion` or `ddlState`. F1 config (once spike confirms):
```jsonc
"location": {
  "mode": "form",
  "field": "ctl00$ContentPlaceHolder1$ddlRegion",
  "state_values": { "RJ": "Rajasthan", "KA": "Karnataka", … },
  "supports_all": true   // "All regions" is the default
}
```

## Proposed seed (placeholder — pending spike)

Not authored yet. The spike will produce either:
- (a) A JSON endpoint → write a standard seed.
- (b) Confirmation of WebForms-only → defer to S7 (HTML parsing). Document the postback contract here.

## Known risks

- VIEWSTATE rotation. Some MSTC pages bump VIEWSTATE on every visit; the seed needs `pre_request` (see baanknet.md) to capture the freshly minted fields.
- The "All regions" view may cap result count; per-region paging may be required.
- The two `mstcecommerce.com/auctionhome/customs/*.jsp` URLs in the request list appear to be info pages, not listings. The actual customs auction listings are hosted **inside the post-login MSTC bidder portal** and aren't publicly reachable.
