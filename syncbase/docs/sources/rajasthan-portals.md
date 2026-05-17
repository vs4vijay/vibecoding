# Rajasthan government e-auction portals (UDH, LSG, RIICO)

| | |
|---|---|
| Phase | re-evaluated from S7 |
| Status | 🔴 ASP.NET MVC with unobtrusive-AJAX HTML partials — no JSON listing |
| Category | govt-eauction (state government property) |
| Scope | Rajasthan only |
| Last recon | 2026-05-17 |

Three sibling sites built on the same ASP.NET MVC + jQuery + SignalR codebase. Same architecture, same limitation.

## URLs

| Code | Body | Front-end |
|---|---|---|
| UDH | Urban Development & Housing — surplus property | `https://udhonline.rajasthan.gov.in/Portal/AuctionListNew` |
| LSG | Local Self Government — municipal property | `https://lsgeauction.rajasthan.gov.in/Portal/AuctionList` |
| RIICO | Rajasthan State Industrial Development & Investment Corp — industrial land | `https://riicoerp.industries.rajasthan.gov.in/eauction` |

## Behavior

The listing renders as an `<table class="table … export_table">` inline in the initial GET response. Pagination links carry `data-ajax="true" data-ajax-mode="replace" data-ajax-update="#PartialListing" data-ajax-method="post"` — Microsoft's `jquery.unobtrusive-ajax.js` translates that into a POST to the same URL, and the response is a **rendered HTML fragment** that replaces `#PartialListing`. Not JSON. The "URL encryption" endpoint visible in inline scripts (`/EIS/Index/JqueryUrlEncrption` for UDH, `/Utility/JqueryUrlEncrption` for RIICO) is just a helper that scrambles auction-detail URLs — not a data feed.

The pages also bootstrap a SignalR `notificationHub` for live bid updates. That hub doesn't expose any data-listing methods (the methods visible are `addNewMessageToPage`, `updateAuctionBidtoPage`, `addBroadcastMessageToPage`, `addPersonalMessageToPage` — all push channels for the auction-detail screen, not the list).

## Attempts log

| Attempt | Result |
|---|---|
| `grep -E "url:\s*\"[^\"]+\"" page.html` | Only `/EIS/Index/JqueryUrlEncrption` (UDH) and `/Utility/JqueryUrlEncrption` (RIICO). Both are URL-encryption helpers, not data feeds. |
| Search inline scripts for `getJSON`, `axios`, `fetch` | None. |
| Inspect `data-ajax-*` attributes on pagination | All point at the same MVC controller, response is HTML partial. |
| Visual: look for `<table data-source="…">` or other declarative data attributes | None. |
| Check SignalR hub methods (the `notificationHub` proxy) | All are push-to-client methods — no `getAuctionList` style server method exposed. |

## Why the postback is fatal

Even if we mimic the POST to retrieve the HTML fragment, we still have to parse HTML rows. That's the same engineering cost as scraping the initial GET response. The "AJAX" path provides no JSON advantage here.

The sample row we did see (UDH):
```html
<tr>
  <td>1.</td>
  <td>Ajmer Development Authority</td>
  <td><a href="/Portal/LiveAuctionDetailReport?q=…encrypted…">164</a></td>
  …
</tr>
```
Even the per-auction-detail link is URL-encrypted (`q=…`), so we can't even derive a stable per-auction ID without first decrypting via the server's encryption helper.

## Recommended verdict

**Skip.** Rajasthan state auction inventory is small relative to bank-auction aggregator coverage, and the engineering cost (HTML parsing PLUS URL-decryption flow PLUS per-item detail fetch) is high. Revisit only if a specific Rajasthan use case demands it — and even then, the RERA-Rajasthan data (already onboarded as `ibapi_auction_properties` covers RBI-style listings) is a better starting point.

## Known limitations

- The encrypted `?q=` URL prevents stable external_id assignment.
- The site uses keypress/right-click blockers (`event.keyCode == 123` etc.) which is just visual obfuscation.
