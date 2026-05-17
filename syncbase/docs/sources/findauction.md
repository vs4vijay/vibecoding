# `findauction.in`

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🔴 HTML-only confirmed — no JSON listing endpoint |
| Category | bank-auction (aggregator) |
| Scope | All-India, indexed by city slug |
| Last recon | 2026-05-17 |

## Behavior

PHP/jQuery server-rendered site. The front-end JS (`/static/js/custom.js`) talks to a single endpoint, `/ajax.php`, switched on a `type=` query param. Every public `type` value is a **helper** (dropdown loader, bookmark toggler, contact form submit, email/phone reveal) — none returns property inventory. Listings are rendered into the page server-side as `<div class="property-listing">` blocks.

## URLs

- Front-end (city): `https://findauction.in/bank-property/{city}`
- Front-end (search): `https://findauction.in/search`
- AJAX helper hub: `https://findauction.in/ajax.php?type=<verb>`

## Attempts log

| Attempt | Result |
|---|---|
| Static analysis of `custom.js` for any non-helper data fetch | All 22 `ajax.php` calls are helper endpoints (see below). |
| `GET /ajax.php?type=bankDatalist` | Banks dropdown. |
| `GET /ajax.php?type=regionDatalist` | Regions dropdown. |
| `GET /ajax.php?type=searchcitydatalist` | City autocomplete. |
| `GET /ajax.php?type=fslt`, `fcdd`, `fcpd` | Various form-state helpers. |
| `POST /ajax.php?type=bookmark&eventid=…`, `salesbookmark`, `notifyfor`, `subscribe` | User-state mutations (require login). |
| `POST /ajax.php?type=contact`, `feedback_report`, `sendenq`, `cp_call`, `cp_email` | Outbound contact submissions. |
| `POST /ajax.php?type=postauction` | Authoring endpoint (sellers post auctions; requires auth). |
| `POST /ajax.php?type=downloadnotice` | PDF retrieval for a single auction (requires the auction id from the rendered HTML). |
| `GET /ajax.php?type=upllid_dd` | Upload-lid dropdown helper. |
| Search the rendered listing page HTML for any JSON island or hidden `<script>` data block | None. The HTML is fully static-server-rendered. |

## Recommended verdict

**HTML scraping is the only path.** When syncbase grows a Cheerio/JSONPath-on-DOM storage mode (planned as S7-unblock), this becomes a candidate. Until then, do not onboard.

Sample card structure (for the future HTML adapter):

```html
<div class="property-listing">
  <h3><a href="/property/123456">Plot in Civil Lines, Ajmer</a></h3>
  <span class="price">₹12,00,000</span>
  <span class="auction-date">22 May 2026</span>
  <span class="bank">Punjab National Bank</span>
  <span class="branch">Ajmer Civil Lines Branch</span>
  …
</div>
```

## Known limitations

- The site has a login-walled "post your auction" flow (`type=postauction`) but the listings shown publicly are a subset of what's submitted — no clean way to enumerate without browsing pages.
- No sitemap exposed at `/sitemap.xml` (returns the home page).
