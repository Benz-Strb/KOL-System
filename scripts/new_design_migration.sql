-- ================================================================
-- New-designDatabase.md Migration
-- ================================================================
-- Table 1 : KOL_Profile_Table      → extend kols
-- Table 2 : KOL_Commercial_Terms   → new table kol_commercial_terms
-- Table 3 : Sample_Management      → new table kol_samples
-- Table 4 : Performance_Snapshot   → extend placement_metrics
-- ================================================================
-- Run via psycopg2 (conn.autocommit = True), then:
--   cd server && npx prisma db pull && npx prisma generate
-- ================================================================


-- ================================================================
-- 1. KOL_Profile_Table  →  ต่อเติม kols
-- ================================================================
-- contact_info  : JSONB เพื่อเก็บ email / WhatsApp / Line ฯลฯ
--                 ควร encrypt ก่อน insert ที่ application layer
-- audience_tags : array ที่ system ติดให้อัตโนมัติ (จาก bot/analysis)
-- custom_tags   : array ที่ user กรอกเอง (free-form)
-- main_selling_points : คำอธิบาย จุดเด่นของ KOL (สาย beauty / tech ฯลฯ)

ALTER TABLE kols
  ADD COLUMN IF NOT EXISTS contact_info        JSONB,
  ADD COLUMN IF NOT EXISTS audience_tags       TEXT[],
  ADD COLUMN IF NOT EXISTS custom_tags         TEXT[],
  ADD COLUMN IF NOT EXISTS main_selling_points TEXT;

COMMENT ON COLUMN kols.contact_info        IS 'Encrypted contact info {email, whatsapp, line, ...} — encrypt at app layer';
COMMENT ON COLUMN kols.audience_tags       IS 'Auto-generated audience tags by system/bot';
COMMENT ON COLUMN kols.custom_tags         IS 'User-defined custom tags (free-form)';
COMMENT ON COLUMN kols.main_selling_points IS 'Product categories/styles the KOL excels at promoting';

-- GIN index ให้ query ด้วย && หรือ @> ได้เร็ว
CREATE INDEX IF NOT EXISTS idx_kols_audience_tags ON kols USING GIN (audience_tags);
CREATE INDEX IF NOT EXISTS idx_kols_custom_tags   ON kols USING GIN (custom_tags);


-- ================================================================
-- 2. KOL_Commercial_Terms_Table  →  ตารางใหม่ kol_commercial_terms
-- ================================================================
-- ต่อ KOL 1 คนอาจมีได้หลาย term (แยกต่อ brand หรือต่อปีได้)
-- pricing_type enum :
--   single_cooperation  = ทำครั้งเดียว
--   contracted_package  = แพ็คเกจสัญญา
--   pure_exchange       = แลกสินค้าล้วน (= barter)
--   commission          = ค่าคอมมิชชั่น
-- is_barter ซ้อน pricing_type เพื่อ filter ง่าย (Boolean shortcut)

CREATE TABLE IF NOT EXISTS kol_commercial_terms (
  id                   SERIAL       PRIMARY KEY,
  kol_id               INT          NOT NULL REFERENCES kols(id)    ON DELETE CASCADE,
  brand_id             INT                   REFERENCES brands(id)   ON DELETE SET NULL,
  pricing_type         TEXT         NOT NULL
                         CHECK (pricing_type IN (
                           'single_cooperation',
                           'contracted_package',
                           'pure_exchange',
                           'commission'
                         )),
  single_post_price    DECIMAL(14,2),
  package_price        DECIMAL(14,2),
  multi_platform_price DECIMAL(14,2),
  is_barter            BOOLEAN      NOT NULL DEFAULT false,
  notes                TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kol_commercial_terms_kol   ON kol_commercial_terms(kol_id);
CREATE INDEX IF NOT EXISTS idx_kol_commercial_terms_brand ON kol_commercial_terms(brand_id);

DROP TRIGGER IF EXISTS trg_kol_commercial_terms_updated_at ON kol_commercial_terms;
CREATE TRIGGER trg_kol_commercial_terms_updated_at
  BEFORE UPDATE ON kol_commercial_terms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  kol_commercial_terms IS 'KOL_Commercial_Terms_Table — ราคาและรูปแบบความร่วมมือต่อ KOL';
COMMENT ON COLUMN kol_commercial_terms.pricing_type         IS 'single_cooperation | contracted_package | pure_exchange | commission';
COMMENT ON COLUMN kol_commercial_terms.single_post_price    IS 'ราคาต่อโพสต์เดี่ยว';
COMMENT ON COLUMN kol_commercial_terms.package_price        IS 'ราคาแพ็คเกจสัญญา';
COMMENT ON COLUMN kol_commercial_terms.multi_platform_price IS 'ราคาแพ็คเกจหลายแพลตฟอร์ม';
COMMENT ON COLUMN kol_commercial_terms.is_barter            IS 'TRUE = ร่วมงานแบบแลกสินค้า (shortcut filter)';


-- ================================================================
-- 3. Sample_Management_Table  →  ตารางใหม่ kol_samples
-- ================================================================
-- 1 placement → 1+ samples (KOL บางคนรีวิวหลายชิ้น)
-- sample_status enum :
--   to_be_shipped = รอส่ง
--   shipped       = ส่งแล้ว
--   signed_for    = ลงนามรับแล้ว
-- return_policy enum :
--   return_required    = ต้องคืนสินค้า
--   no_return_required = ไม่ต้องคืน

CREATE TABLE IF NOT EXISTS kol_samples (
  id             SERIAL       PRIMARY KEY,
  kol_id         INT          NOT NULL REFERENCES kols(id)       ON DELETE CASCADE,
  placement_id   INT                   REFERENCES placements(id) ON DELETE SET NULL,
  brand_id       INT                   REFERENCES brands(id)     ON DELETE SET NULL,
  product_id     INT                   REFERENCES products(id)   ON DELETE SET NULL,
  sample_status  TEXT         NOT NULL DEFAULT 'to_be_shipped'
                   CHECK (sample_status IN ('to_be_shipped', 'shipped', 'signed_for')),
  return_policy  TEXT         NOT NULL DEFAULT 'no_return_required'
                   CHECK (return_policy IN ('return_required', 'no_return_required')),
  shipped_at     DATE,
  signed_at      DATE,
  notes          TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kol_samples_kol       ON kol_samples(kol_id);
CREATE INDEX IF NOT EXISTS idx_kol_samples_placement ON kol_samples(placement_id);
CREATE INDEX IF NOT EXISTS idx_kol_samples_brand     ON kol_samples(brand_id);
CREATE INDEX IF NOT EXISTS idx_kol_samples_product   ON kol_samples(product_id);
CREATE INDEX IF NOT EXISTS idx_kol_samples_status    ON kol_samples(sample_status);

DROP TRIGGER IF EXISTS trg_kol_samples_updated_at ON kol_samples;
CREATE TRIGGER trg_kol_samples_updated_at
  BEFORE UPDATE ON kol_samples
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  kol_samples IS 'Sample_Management_Table — ติดตามการส่ง/คืนสินค้าตัวอย่างต่อ KOL';
COMMENT ON COLUMN kol_samples.sample_status IS 'to_be_shipped | shipped | signed_for';
COMMENT ON COLUMN kol_samples.return_policy IS 'return_required | no_return_required';
COMMENT ON COLUMN kol_samples.product_id    IS 'Associated_Product_SKU — FK → products';
COMMENT ON COLUMN kol_samples.brand_id      IS 'Associated_Brand — FK → brands';
COMMENT ON COLUMN kol_samples.shipped_at    IS 'วันที่ส่งสินค้า';
COMMENT ON COLUMN kol_samples.signed_at     IS 'วันที่ KOL ลงนามรับของ';


-- ================================================================
-- 4. KOL_Performance_Snapshot_Table  →  ต่อเติม placement_metrics
-- ================================================================
-- Campaign_ID   → ดึงผ่าน placements.campaign_id (already linked via placement_id FK)
-- Post_URL      → ดึงผ่าน placements.post_url    (already linked)
-- Metrics_Likes → likes column ที่มีอยู่แล้ว ✓
--
-- เพิ่มใหม่ :
--   impressions      : จำนวน impression/reach ในช่วงนั้น
--   shares           : จำนวน share (ต้องใช้คำนวณ engagement_rate)
--   engagement_rate  : (likes+comments+shares) / (impressions หรือ follower_count)
--                      เก็บเป็น DECIMAL แทนคำนวณ live เพื่อ query ได้เร็ว
--   tracking_period  : 'daily' = snapshot รายวัน | 'recent_30_days' = aggregate 30 วัน
--                      (ซ้อนทับ period_days INT ที่มีอยู่เพื่อ backward compat)
--   promotion_status : สถานะโพสต์ปัจจุบันบนแพลตฟอร์ม — 'online'|'offline'|'hidden'

ALTER TABLE placement_metrics
  ADD COLUMN IF NOT EXISTS impressions      INT,
  ADD COLUMN IF NOT EXISTS shares           INT,
  ADD COLUMN IF NOT EXISTS engagement_rate  DECIMAL(10,6),
  ADD COLUMN IF NOT EXISTS tracking_period  TEXT DEFAULT 'recent_30_days'
                             CHECK (tracking_period IN ('daily', 'recent_30_days')),
  ADD COLUMN IF NOT EXISTS promotion_status TEXT
                             CHECK (promotion_status IN ('online', 'offline', 'hidden'));

CREATE INDEX IF NOT EXISTS idx_metrics_tracking_period  ON placement_metrics(tracking_period);
CREATE INDEX IF NOT EXISTS idx_metrics_promotion_status ON placement_metrics(promotion_status);

COMMENT ON COLUMN placement_metrics.impressions      IS 'Total impressions/reach for this tracking period';
COMMENT ON COLUMN placement_metrics.shares           IS 'Number of shares (used in engagement_rate numerator)';
COMMENT ON COLUMN placement_metrics.engagement_rate  IS '(likes+comments+shares)/(impressions or follower_count) — stored for fast query';
COMMENT ON COLUMN placement_metrics.tracking_period  IS 'daily = รายวัน | recent_30_days = aggregate 30 วัน';
COMMENT ON COLUMN placement_metrics.promotion_status IS 'สถานะโพสต์บนแพลตฟอร์มปัจจุบัน: online | offline | hidden';
