# Source docs

One markdown file per data source. Each documents the recon results: tech stack, URL, request shape, response shape, location-filter handling, and known risks. Companion to `seeds/<name>.json` (the actual operator config) — the doc is the **why** + **what we observed**, the seed is the **what to run**.

## Index

### 🟢 Already onboarded (have a seed in `seeds/`)

- `ibapi.in` → `seeds/ibapi_auction_properties.json` — see existing notes in `seeds/README.md`.
- `bankeauctions.com` → `seeds/bankeauctions_live.json` — see existing notes in `seeds/README.md`.

### 🟡 New, JSON-API confirmed — ready for seeding

| Source | Phase | Doc | Spike still needed? |
|---|---|---|---|
| `eauction.gov.in` | S1 | [eauction-gov-in.md](./eauction-gov-in.md) | No |
| `baanknet.com` | S2 | [baanknet.md](./baanknet.md) | Yes — capture browser POST body |
| `eauctiondekho.com` | S3 | [eauctiondekho.md](./eauctiondekho.md) | Yes — verify Strapi `/api/auctions` |
| `auctionbazaar.com` | S4 | [auctionbazaar.md](./auctionbazaar.md) | Yes — find API or use `__NEXT_DATA__` |

### 🟠 Server-rendered — needs a recon spike before seeding

| Source | Phase | Doc |
|---|---|---|
| `mstcindia.co.in/...Forthcoming_e_Auctions_for_All_regions.aspx` | S5 | [mstcindia.md](./mstcindia.md) |
| `foreclosureindia.com/bank-auctions/{city}/{page}` | S6 | [foreclosureindia.md](./foreclosureindia.md) |

### 🔴 HTML-only — deferred to S7 (HTML-parser phase)

Documented as a single file: [\_html-only.md](./_html-only.md). Covers `findauction.in`, `eauctionsindia.com/city/*`, `chennaicustoms.gov.in`, `bangalorecustoms.gov.in`, `mstcecommerce.com/auctionhome/customs/*`, `mumbaiport.gov.in`, `karnatakabank.bank.in`, `karnatakagb.bank.in`, the three Rajasthan portals (`udhonline`, `lsgeauction`, `riicoerp`), and `aubank.in`.

## How to write a new source doc

Copy the structure from `eauction-gov-in.md` (the most complete confirmed example). At minimum:

1. **Header table** — phase, status, category, scope, last recon date.
2. **Behavior** — one paragraph: tech stack, where it lives, anything unusual (Cloudflare, session cookies, SignalR, etc.).
3. **URL** — front-end URL, API base, every endpoint identified.
4. **Confirmed endpoint** — copy/pasteable `curl` shape with verified HTTP status + response excerpt + timestamp.
5. **Response shape** — example JSON or the JSONPath that finds the records.
6. **Search / location filter** — the F1 `location` block this source needs.
7. **Proposed seed** — a JSON snippet matching `lib/validation.ts:SourceCreateSchema`.
8. **Known risks** — auth rotation, hash churn, rate limits, edge cases.

## Where the phase plan lives

[`docs/PLAN.md`](../PLAN.md) — vertical phases F1, F2, S0…S7, G1, G2, D1, D2.
