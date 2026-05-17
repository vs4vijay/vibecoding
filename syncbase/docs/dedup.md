# Duplicate detection — phases D1 & D2

Notes for `docs/PLAN.md`'s D1 (intra-source) and D2 (cross-source) phases. Each phase ships independently; D2 builds on D1's per-source dedup-key plumbing.

## Why dedup matters here

Auction inventory is republished across portals. The same physical property can appear:
- On the **originating bank's** SARFAESI notice page.
- On `ibapi.in` (RBI's central listing).
- On `bankeauctions.com` (C1 India's marketplace).
- On `baanknet.com` (PSB Alliance).
- On aggregators (`eauctiondekho`, `auctionbazaar`, `foreclosureindia`).

Without clustering, the search-results page shows 6 cards for one property. With clustering, one card with the per-source detail nested — exactly what an end-user wants.

## Identity signals

Strong signals (high precision):
1. **Reserve price** — banks copy the figure across portals down to the rupee. Round to nearest ₹1,000 to absorb data-entry drift.
2. **Pincode** — 6-digit, normalized.
3. **Auction date** — exact match within a 7-day window (re-listings).
4. **Bank + branch** — exact bank match, fuzzy branch name.

Weak signals (need similarity scoring):
5. **Address string** — trigram similarity ≥ 0.7 after normalization (lowercase, strip punctuation, expand "St" → "Street").
6. **Title / property description** — trigram similarity ≥ 0.6.
7. **Property type** — exact match (residential/commercial/agricultural).

## D1 — intra-source duplicates

A source can republish the same lot if an auction fails and is re-listed. Each re-listing gets a new `external_id` but the same property attributes. D1 catches that.

### Dedup-key config (per source)

In `seeds/<name>.json`:
```jsonc
{
  "dedup": {
    "key_fields": [
      { "path": "$.address", "normalize": "address" },
      { "path": "$.reservePrice", "normalize": "round_1000" },
      { "path": "$.auctionDate", "normalize": "date_week" }
    ],
    "similarity_threshold": 0.85
  }
}
```

`normalize` modes (built into `lib/pipeline/dedup.ts`):
- `address` — lowercase, strip punctuation, collapse whitespace, expand common abbreviations.
- `round_1000` — round numeric to nearest 1,000.
- `date_week` — bucket to ISO week.
- `pincode` — `^\d{6}$` extraction.
- `bank` — strip "Ltd.", "Limited", normalize "SBI" ↔ "State Bank of India" via a small alias map.

### Job

Nightly cron (`bun bin/cli.ts dedup`):
1. For each enabled source with a `dedup` block, hash the normalized key fields → `dedup_key_hash`.
2. For each pair of entities sharing a `dedup_key_hash`, compute trigram similarity on the original `title` + `address`.
3. If similarity ≥ `similarity_threshold` → write to `entity_duplicates`.

### Schema

```sql
CREATE TABLE entity_duplicates (
  id               bigserial PRIMARY KEY,
  source           text NOT NULL,
  canonical_id     bigint NOT NULL,
  duplicate_id     bigint NOT NULL,
  similarity       double precision NOT NULL,
  dedup_key_hash   text NOT NULL,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'auto',  -- 'auto' | 'confirmed' | 'rejected'
  UNIQUE (source, canonical_id, duplicate_id)
);
CREATE INDEX ON entity_duplicates (duplicate_id);

CREATE TABLE entity_duplicate_overrides (
  source        text NOT NULL,
  entity_a_id   bigint NOT NULL,
  entity_b_id   bigint NOT NULL,
  decision      text NOT NULL,    -- 'same' | 'different'
  decided_by    text NOT NULL,
  decided_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, entity_a_id, entity_b_id)
);
```

The canonical is the lower-numbered id (oldest). Operator overrides win over the next auto-run.

### Acceptance

- **AC-D1.1** Two `bankeauctions_live` entries with the same pincode + reserve price (rounded) + auction-date-week → flagged with similarity ≥ 0.85.
- **AC-D1.2** Re-running the job is idempotent: existing `entity_duplicates` rows are upserted, not duplicated.
- **AC-D1.3** Operator clicks "not a duplicate" → an `entity_duplicate_overrides` row appears; next run does not re-flag the pair.

## D2 — cross-source clusters

Goal: the same property listed on 3 sources collapses into one card in the UI.

### Approach

Builds on D1's normalization, but with a relaxed similarity threshold and a blocking key that spans sources.

**Blocking key** (kept small to bound the candidate set):
```
(normalized_pincode, reserve_price_rounded_to_10k)
```

This puts the candidate-pair count for ~50k entities in the low thousands, not millions.

**Similarity** (weighted sum):
```
score =
    0.30 * exact(pincode)
  + 0.25 * trgm(address)
  + 0.20 * trgm(title)
  + 0.15 * exact_or_alias(bank)
  + 0.10 * date_within_90_days(auction_date)
```
- score ≥ 0.7 → auto-cluster.
- 0.5 ≤ score < 0.7 → suggested-cluster (operator confirms in UI).

### Schema

```sql
CREATE TABLE entity_clusters (
  cluster_id        bigserial PRIMARY KEY,
  cluster_key       text NOT NULL UNIQUE,        -- canonical hash of the blocking key
  member_count      int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entity_cluster_members (
  cluster_id        bigint NOT NULL REFERENCES entity_clusters(cluster_id) ON DELETE CASCADE,
  source            text NOT NULL,
  entity_id         bigint NOT NULL,
  role              text NOT NULL DEFAULT 'member',  -- 'canonical' | 'member' | 'suggested'
  score             double precision,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, source, entity_id)
);
CREATE INDEX ON entity_cluster_members (source, entity_id);
```

### Search rollup

`/api/search` (from phase G1) gets a `?cluster_rollup=true` flag (default on). When on, the SQL groups hits by `cluster_id` and emits one row per cluster with the per-source members folded in:

```jsonc
{
  "hits": [
    {
      "cluster_id": 1024,
      "title": "...", "snippet": "<b>...</b>",
      "members": [
        { "source": "ibapi_auction_properties", "id": 8123 },
        { "source": "bankeauctions_live",        "id": 2934 },
        { "source": "baanknet_listing",          "id": 421  }
      ],
      "score": 0.91
    }
  ]
}
```

### Acceptance

- **AC-D2.1** Seed two entities — one from `ibapi_auction_properties` and one from `bankeauctions_live` — with the same pincode, reserve price (within ₹10k), and matching bank. Run `bun bin/cli.ts dedup --cross-source`. Both rows join one cluster.
- **AC-D2.2** A third entity from `baanknet_listing` with similar address but different bank → score 0.55 → enters as `'suggested'`, not `'member'`.
- **AC-D2.3** Operator confirms the suggestion via UI → role flips to `'member'`, `member_count` increments.
- **AC-D2.4** A search for the property title returns **one** hit with three members (when `cluster_rollup=true`) and **three** hits when off.

## What NOT to build (yet)

- **LLM-based dedup.** Tempting for matching "Plot No. 14, 3rd Cross, …" against "Premises bearing no. 14 in Cross Road III, …", but it's expensive and non-deterministic. We start with trigram + blocking and revisit if precision/recall don't satisfy operators.
- **Image-based dedup.** Several aggregators show photos; image-hash dedup is a separate phase with its own infra cost.
- **Auto-merge of fields.** Members in a cluster keep their original data. The cluster is metadata, not a write-through join.
