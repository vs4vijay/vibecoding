-- D2: cross-source duplicate clusters.
-- A cluster groups N entities (each from any source) that represent the same property.
-- members.role: 'canonical' (lowest entity id in the cluster), 'member', or 'suggested'
-- (passed the 0.5 threshold but not the 0.7 auto-join threshold — operator confirms).
--
-- cluster_key is the deterministic hash of (normalized_pincode, price_bucket) — recomputing
-- the dedup pass therefore lands the same entities in the same cluster_id slot.

CREATE TABLE IF NOT EXISTS entity_clusters (
  cluster_id    BIGSERIAL PRIMARY KEY,
  cluster_key   TEXT NOT NULL UNIQUE,
  member_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_cluster_members (
  cluster_id  BIGINT NOT NULL REFERENCES entity_clusters(cluster_id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  entity_id   BIGINT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  score       DOUBLE PRECISION,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, source, entity_id)
);
CREATE INDEX IF NOT EXISTS entity_cluster_members_src_ent_idx
  ON entity_cluster_members(source, entity_id);

-- Per-source mapping of the "common shape": how to extract each cross-dedup signal
-- from this source's payload. Shape:
--   { pincode: "$.attributes.pincode", price: "$.attributes.reservePrice",
--     bank: "$.attributes.bankName", title: "$.attributes.title",
--     address: "$.attributes.propertyAddress", date: "$.attributes.auctionDate" }
ALTER TABLE sources ADD COLUMN IF NOT EXISTS cross_dedup JSONB;
