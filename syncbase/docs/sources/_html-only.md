# HTML-only sources (deferred to S7)

These auction sources expose **no public JSON API** as of 2026-05-16. They render inventory directly in server-side HTML (or behind WordPress page templates linking to PDFs). syncbase's current pipeline ingests JSON only, so each of these is parked until syncbase grows a first-class HTML-parsing storage mode (Cheerio + JSONPath-on-DOM, or a Playwright-backed parser).

For each source we record what was found, so the future HTML-parser phase has a head start.

---

## `findauction.in/bank-property/{city}` and `/search`

| | |
|---|---|
| Tech | PHP/jQuery server-rendered |
| Auctions | Bank-foreclosure properties, per city |
| Location | URL segment (`/bank-property/ajmer`, `/bank-property/bangalore`) |
| JSON endpoints | `/ajax.php?type=*` returns reference data only (banks, cities) — not inventory |
| Recon date | 2026-05-14 (re-confirmed 2026-05-16: still HTML-only) |

Sample listing card sits inside `<div class="property-listing">…</div>`. The card holds title, address, reserve price, auction date, and a link to a detail page.

---

## `eauctionsindia.com/city/{city}`

| | |
|---|---|
| Tech | Laravel server-rendered |
| Auctions | Bank-foreclosure |
| Location | URL segment |
| JSON endpoints | `/api/` namespace exists but every listing path returns 404 |
| Other | A 2.4 MB `live-sitemap.xml` lists all property URLs + `<lastmod>` — useful for change-detection without HTML parsing |
| Recon date | 2026-05-14 |

The sitemap-driven approach is interesting: if we treat `<lastmod>` as the hash key and the URL as `external_id`, syncbase could ingest the sitemap as a JSON-after-XML-to-JSON transform. That's a viable smaller phase — but still needs an "XML mode" in the pipeline.

---

## `chennaicustoms.gov.in/auctions/`

| | |
|---|---|
| Tech | WordPress |
| Auctions | Customs disposal notices, mostly PDFs |
| Location | Fixed (Chennai region) |
| JSON endpoints | `wp-json/wp/v2/pages` returns page metadata, not auction lots |
| Recon date | 2026-05-16 |

The page is mostly a list of PDF notices (`/wp-content/uploads/YYYY/MM/…pdf`). Useful ingest path: poll WP REST `wp-json/wp/v2/media?search=auction` for new PDFs, store the PDF URL as the entity. Doesn't give per-lot detail without OCR.

---

## `bangalorecustoms.gov.in/bengaluru-city-customs/`

| | |
|---|---|
| Tech | WordPress |
| Auctions | Customs orders / notices (PDFs) |
| Location | Fixed (Bengaluru region) |
| Recon date | 2026-05-16 |

Same shape as chennaicustoms. Many of the PDFs are administrative orders, not auction lots — content filter required.

---

## `mstcecommerce.com/auctionhome/customs/{welcome,index}.jsp`

| | |
|---|---|
| Tech | JSP info pages |
| Auctions | None on these URLs — they're landing pages for the MSTC customs auction product |
| Recon date | 2026-05-16 |

The actual customs lot listings live behind the MSTC bidder login. Not publicly polleable.

---

## `mumbaiport.gov.in/show_content.php?lang=1&level=2&ls_id=1352&lid=1074`

| | |
|---|---|
| Tech | PHP CMS |
| Auctions | Disposal/auction notices linked as PDFs |
| Location | Fixed (Mumbai Port) |
| Recon date | 2026-05-16 |

Single PDF link visible in the recon snapshot. Same OCR caveat as chennaicustoms.

---

## `karnatakabank.bank.in/auction-notice`

| | |
|---|---|
| Tech | Drupal (`dhira-status-url`) |
| Auctions | SARFAESI notices |
| Location | Bank's own branches — all over Karnataka |
| Recon date | 2026-05-16 |

452 kB page — likely a Drupal view with embedded auction rows. Worth a deeper look during the S7 phase: Drupal Views often have a `/views/ajax` endpoint that returns JSON for pagination.

---

## `karnatakagb.bank.in/sarfaesi/e-auction`

| | |
|---|---|
| Tech | Static-ish HTML |
| Auctions | Linked as PDFs under `/public/auctions/*.pdf` |
| Location | Karnataka (Gramin Bank branches) |
| Recon date | 2026-05-16 |

Only PDF links. OCR-only ingest.

---

## `udhonline.rajasthan.gov.in/Portal/AuctionListNew` (UDH)
## `lsgeauction.rajasthan.gov.in/Portal/AuctionList` (LSG)
## `riicoerp.industries.rajasthan.gov.in/eauction` (RIICO)

| | |
|---|---|
| Tech | ASP.NET MVC + SignalR |
| Auctions | Government property (UDH = urban development; LSG = local self-government; RIICO = industrial) |
| Location | Rajasthan-only; in-page filters for division / district |
| JSON endpoints | None publicly visible; SignalR is for live-bid push, not list seeding |
| Recon date | 2026-05-16 |

Listings render inline as `<table class="table … export_table">`. The `/EIS/Index/JqueryUrlEncrption` and `/Utility/JqueryUrlEncrption` URLs encountered in scripts are URL-encryption helpers for navigation, not data endpoints. Pure HTML parsing.

---

## `aubank.in/bank-auction`

| | |
|---|---|
| Tech | Next.js behind Cloudflare Turnstile |
| Auctions | AU Small Finance Bank SARFAESI |
| Recon date | 2026-05-14 (re-confirmed 2026-05-16: still blocked + still "No auctions available") |

Non-browser requests get 403; even past the challenge the page literally renders "No auctions available". Listed on `bankeauctions.com` as `bank_id=223` with zero rows. Revisit when AU activates auctions.

---

## `eauctionsindia.com/blog-details/bengaluru-customs-electronics-auction-mstc`

⏭ **Excluded by user instruction.** This is a blog post, not an inventory page.
