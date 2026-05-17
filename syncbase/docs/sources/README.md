# Source docs

One markdown file per data source — covers tech stack, URL, request/response, attempts log (what worked, what didn't and why), proposed seed, and known risks. Companion to `seeds/<name>.json` (the operator config) — the doc is the **why** and the **what we observed**, the seed is the **what to run**.

## Index

### 🟢 Onboarded (have seeds in `seeds/`, ingesting on schedule)

| Source | Doc | Records (last sync) | API shape |
|---|---|---|---|
| `ibapi_auction_properties` | `seeds/README.md` notes | 11,484 | ASP.NET PageMethods, single POST, full dump |
| `bankeauctions_live` | `seeds/README.md` notes | 1,746 across 175 pages | DataTables offset pagination, positional rows |
| `eauction_gov_in_upcoming` | [eauction-gov-in.md](./eauction-gov-in.md) | 10 (rolling) | NIC web service, stringified-JSON unwrap |
| `eauctiondekho` | [eauctiondekho.md](./eauctiondekho.md) | 5,396 (sample of 126,002) | Strapi 4 REST |
| `auctionbazaar` | [auctionbazaar.md](./auctionbazaar.md) | 10,000 (sample of 10k+ active) | Typesense `multi_search` |
| `baanknet` | [baanknet.md](./baanknet.md) | 8,139 (all-live tab) | Angular SPA → Java backend, session+XSRF pre-flight |

### 🟢 JSON API confirmed by deeper recon — ready to seed when prioritized

| Source | Doc | API shape | Notes |
|---|---|---|---|
| `mstcindia.co.in` Forthcoming | [mstcindia.md](./mstcindia.md) | `GET /mstcwebservice/Service.svc/getScrollMsg/{REGION}` | 20 regions; either 20 seeds or new `pagination.style: "values"` |
| `chennaicustoms.gov.in` | [chennaicustoms.md](./chennaicustoms.md) | WP REST `/wp-json/wp/v2/media?search=auction` | Tracks PDF arrivals; per-lot detail requires PDF parse |
| `bangalorecustoms.gov.in` | [bangalorecustoms.md](./bangalorecustoms.md) | WP REST same shape | Wider net than chennai; needs tighter category filter |

### 🟡 Has structured non-JSON we could adapt

| Source | Doc | What's available | Effort |
|---|---|---|---|
| `eauctionsindia.com` | [eauctionsindia.md](./eauctionsindia.md) | `/live-sitemap.xml` (2.7 MB) with per-property `loc` + `lastmod` | Needs an XML-sitemap parse mode in the pipeline |

### 🔴 No JSON / no usable structured surface — HTML scrape only

These are documented but **not** onboarded. Each doc includes the full attempts log so the next pass doesn't redo recon.

| Source | Doc | Why skipped |
|---|---|---|
| `findauction.in` | [findauction.md](./findauction.md) | `ajax.php?type=*` only exposes helpers; listings are server-rendered HTML |
| `karnatakabank.bank.in` | [karnatakabank.md](./karnatakabank.md) | Drupal REST disabled; feeds return SHA1 JS-challenge anti-bot pages |
| `karnatakagb.bank.in` | [karnatakagb.md](./karnatakagb.md) | Static PDFs only; no listing structure of any kind |
| UDH / LSG / RIICO (Rajasthan) | [rajasthan-portals.md](./rajasthan-portals.md) | ASP.NET MVC + unobtrusive-AJAX returns HTML partials; URLs encrypted |
| `chennaicustoms.gov.in/auctions` (already covered) | — | (the WP REST path IS usable; see chennaicustoms.md) |
| `mstcecommerce.com/auctionhome/customs/{welcome,index}.jsp` | [mstcecommerce-customs.md](./mstcecommerce-customs.md) | Login portals — listings behind auth (mstcindia.co.in is the unauth mirror) |
| `mumbaiport.gov.in` | [mumbaiport.md](./mumbaiport.md) | PHP CMS, single PDF per page, no listing |
| `foreclosureindia.com` | [foreclosureindia.md](./foreclosureindia.md) | Pure server-rendered HTML; no API, no feed, no sitemap |
| `aubank.in/bank-auction` | [aubank.md](./aubank.md) | Cloudflare Turnstile + zero inventory anyway |

## Status summary

- **6 onboarded** + **3 new JSON-confirmed** sources discovered → **9 viable sources** with JSON. The earlier "12 HTML-only" estimate dropped to **9 truly unusable + 1 XML-sitemap candidate** after deeper recon.
- The 3 newly-discovered JSON sources (`mstcindia`, `chennaicustoms`, `bangalorecustoms`) can be onboarded with **only one small pipeline extension** (Option B for mstcindia — a `pagination.style: "values"` mode) and the existing pagination logic.
- HTML scraping for the remaining 9 sites is **not absolutely necessary** — each one is either redundant with onboarded coverage, fights anti-bot infrastructure, or has no structured inventory to begin with. The verdicts in each doc give the reasoning.

## How to write a new source doc

Copy the structure from `mstcindia.md` or `baanknet.md` (the most complete confirmed examples). At minimum:

1. **Header table** — phase, status, category, scope, last recon date.
2. **Behavior** — one paragraph: tech stack, where it lives, anything unusual (Cloudflare, session cookies, SignalR, etc.).
3. **URL** — front-end URL, API base, every endpoint identified.
4. **Verified endpoints** — copy-pasteable `curl` shape with verified HTTP status + response excerpt + timestamp.
5. **Response shape** — example JSON or the JSONPath that finds the records.
6. **Attempts log** — every endpoint we tried, with result. Future readers depend on this.
7. **Proposed seed** — JSON snippet matching `lib/validation.ts:SourceCreateSchema`.
8. **Known limitations / risks** — auth rotation, hash churn, rate limits, edge cases.

## Where the phase plan lives

[`docs/PLAN.md`](../PLAN.md) — vertical phases F1, F2, S0…S7, G1, G2, D1, D2.
