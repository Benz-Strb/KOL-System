-- Migration: split kols into person-level (kols) + per-platform-account (kol_platforms)
-- Run 2026-06-23. Backup taken first: scripts/kol_platforms_migration_backup_*.json
-- Rationale: see CLAUDE.md §7 (Finding D, 2026-06-19) and the "1 KOL ↔ หลาย platform" plan.

CREATE TABLE kol_platforms (
  id SERIAL PRIMARY KEY,
  kol_id INT NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  platform_id INT REFERENCES platforms(id),
  handle TEXT NOT NULL,
  handle_normalized TEXT NOT NULL UNIQUE,
  follower_count INT,
  avatar_url TEXT,
  profile_url TEXT,
  kol_tier_id INT REFERENCES kol_tiers(id),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kol_platforms_kol_id ON kol_platforms(kol_id);
CREATE INDEX idx_kol_platforms_platform_id ON kol_platforms(platform_id);
CREATE INDEX idx_kol_platforms_tier ON kol_platforms(kol_tier_id);
-- at most one primary platform row per person
CREATE UNIQUE INDEX idx_kol_platforms_primary_per_kol ON kol_platforms(kol_id) WHERE is_primary;

-- 1:1 copy — every existing kols row becomes its own person + its own (primary) platform account
INSERT INTO kol_platforms (kol_id, platform_id, handle, handle_normalized, follower_count, avatar_url, profile_url, kol_tier_id, is_primary, created_at)
SELECT id, platform_id, handle, handle_normalized, follower_count, avatar_url, profile_url, kol_tier_id, true, created_at
FROM kols;

-- move the tier-assignment trigger from kols to kol_platforms (set_kol_tier()/tier_id_for() reused as-is, both generic)
CREATE TRIGGER trg_kol_platforms_set_tier
  BEFORE INSERT OR UPDATE OF follower_count ON kol_platforms
  FOR EACH ROW EXECUTE FUNCTION set_kol_tier();

DROP TRIGGER IF EXISTS trg_kols_set_tier ON kols;

-- kols becomes person-only — these columns now live on kol_platforms instead
ALTER TABLE kols
  DROP COLUMN platform_id,
  DROP COLUMN handle,
  DROP COLUMN handle_normalized,
  DROP COLUMN follower_count,
  DROP COLUMN avatar_url,
  DROP COLUMN profile_url,
  DROP COLUMN kol_tier_id;
