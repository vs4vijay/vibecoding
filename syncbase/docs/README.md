# syncbase docs

Plans + per-source recon. Implementation lives in code; this directory is the **why** and the **what we observed**.

| File | What's in it |
|---|---|
| [PLAN.md](./PLAN.md) | Vertical phases — F1 location config, F2 search extensions, S0-S7 sources, G1-G2 global search, D1-D2 dedup. Each phase has acceptance criteria. |
| [sources/](./sources/) | One markdown per source. Tech stack, URL, request/response, F1 location block, proposed seed, known risks. |
| [sources/README.md](./sources/README.md) | Index of source docs with onboarding status. |
| [search-extensions.md](./search-extensions.md) | PGLite ↔ Postgres extension parity, the bootstrap SQL script for prod, the GIN/tsvector/trigram schema, the `/api/search` query plan. |
| [dedup.md](./dedup.md) | D1 intra-source + D2 cross-source duplicate detection — schemas, similarity formulas, acceptance criteria. |

## Reading order

1. `PLAN.md` — top-down view of what's getting built and in what order.
2. `sources/README.md` — current status of each requested data source.
3. `search-extensions.md` — why F2 lands before G1, and what to run on prod Postgres.
4. `dedup.md` — only after sources from S1-S4 are live; D1 needs real data to validate.

## Status as of 2026-05-16

- **Onboarded** (have seeds, working): `ibapi_auction_properties`, `bankeauctions_live`.
- **Recon complete, JSON API confirmed**: `eauction.gov.in`. Ready to seed.
- **Recon complete, spike pending**: `baanknet.com`, `eauctiondekho.com`, `auctionbazaar.com`.
- **Recon complete, server-rendered, spike pending**: `mstcindia.co.in/Forthcoming…`, `foreclosureindia.com`.
- **Deferred to S7 (no JSON API)**: see `sources/_html-only.md` — 12 sources parked until an HTML-parser storage mode is added.
- **F1 (location), F2 (search extensions), G1/G2 (search), D1/D2 (dedup)** — not started.

Implementation has not begun. This is the planning artifact; the per-phase work picks up from `PLAN.md`.
