# Integration Spec — `kol_offplatform_traffic_daily` → ระบบ KOL

> เอกสารนี้ออกแบบให้ **วางลงใน Claude / Claude Code ได้ตรง ๆ** เพื่อให้ช่วยเขียนตัวเชื่อม (connector)
> ระหว่างตาราง BigQuery นี้กับระบบ KOL ของคุณ — มีครบทั้ง auth, schema, กลยุทธ์ sync, โค้ดตัวอย่าง, ข้อควรระวัง
>
> ผู้ใช้เอกสาร: น้องฝึกงาน (benz.natthawut@shd-technology.co.th) — สิทธิ์ **read-only** ตารางนี้ตารางเดียว

> เงื่อนไข ให้สิทธิ์อ่านตาราง BigQuery สำหรับดึงข้อมูล off-platform traffic เข้าระบบ KOL แล้วนะครับ
>  • ตาราง: elated-channel-468406-t4.KOLs_Marketing.kol_offplatform_traffic_daily
>  • สิทธิ์: อ่านอย่างเดียว (เฉพาะตารางนี้)
>  • Setup: gcloud auth application-default login (ใช้ account benz.natthawut@shd-technology.co.th)
>  • เวลา query ตั้ง project = elated-channel-468406-t4
>  • ⚠️  ทุก query ต้องมี WHERE report_date ... ไม่งั้น error

---

## 0. TL;DR (สรุปสำหรับ Claude)
- แหล่งข้อมูล: BigQuery table `elated-channel-468406-t4.KOLs_Marketing.kol_offplatform_traffic_daily`
- เป็นข้อมูล off-platform traffic (โฆษณานอกแพลตฟอร์มยิงเข้าร้าน) **รายวัน × แบรนด์ × ช่องทาง × โฆษณา**
- สิทธิ์: อ่านอย่างเดียว (ตารางนี้ตารางเดียว) + รัน query ได้
- **กฎเหล็ก:** ทุก query ต้องมี `WHERE report_date ...` (require_partition_filter) ไม่งั้น error
- **สำคัญต่อการ sync:** ตารางนี้ถูก **rebuild ทั้ง partition `platform='shopee'` ใหม่ทุกวัน** → ข้อมูลย้อนหลังเปลี่ยนได้ → อย่า sync แบบ append-only ให้ใช้ **replace-by-date-window** (ดู §5)
- งานของน้อง: ดึงข้อมูลเข้า **ระบบ KOL ของตัวเอง** (DB/โปรเจกต์แยก — เขียนกลับ BQ นี้ไม่ได้)

---

## 1. ภาพรวม
ตารางนี้เป็น **canonical table** ที่รวมข้อมูล traffic จากโฆษณานอกแพลตฟอร์ม (Off-Platform Ads เช่น Facebook Collaborative Ads, Google Ads) ที่ยิงเข้าร้านค้าออนไลน์ ให้อยู่ในโครงสร้างมาตรฐานเดียว

- ตอนนี้มีข้อมูล **Shopee** เท่านั้น (คอลัมน์ `platform='shopee'`) — โครงรองรับ Lazada/TikTok/Shopify ในอนาคต
- อัปเดตอัตโนมัติทุกวัน ~21:40 (เวลาไทย) จาก pipeline scraper

| | |
|---|---|
| Project | `elated-channel-468406-t4` |
| Dataset | `KOLs_Marketing` |
| Table | `kol_offplatform_traffic_daily` |
| Full path | `elated-channel-468406-t4.KOLs_Marketing.kol_offplatform_traffic_daily` |
| Partition | by `report_date` (DAY), **require_partition_filter = TRUE** |
| Cluster | `platform`, `brand_id` |
| Location | US |

---

## 2. Authentication (น้องตั้งครั้งเดียว)

น้องได้สิทธิ์แบบ **user account** (ไม่ใช่ service account) ดังนั้นใช้ **Application Default Credentials (ADC)**:

```bash
# 1) ติดตั้ง gcloud SDK (ถ้ายังไม่มี) — https://cloud.google.com/sdk/docs/install
# 2) login + สร้าง ADC ด้วย account ของน้อง
gcloud auth application-default login
# (เลือก benz.natthawut@shd-technology.co.th ตอน login)

# 3) ติดตั้ง client library
pip install google-cloud-bigquery db-dtypes
```

> ⚠️ ต้องตั้ง `project="elated-channel-468406-t4"` เวลาสร้าง client เสมอ (เพราะน้องมีสิทธิ์ `jobUser` ที่ project นี้ — query จะถูก bill ที่นี่)

ทดสอบว่าต่อได้:
```python
from google.cloud import bigquery
client = bigquery.Client(project="elated-channel-468406-t4")
sql = """
SELECT COUNT(*) AS n, MIN(report_date) AS min_d, MAX(report_date) AS max_d
FROM `elated-channel-468406-t4.KOLs_Marketing.kol_offplatform_traffic_daily`
WHERE report_date >= '2025-01-01'
"""
print(dict(list(client.query(sql).result())[0]))
```

---

## 3. Schema เต็ม (28 คอลัมน์)

### มิติ / คีย์
| คอลัมน์ | type | ความหมาย | Shopee |
|---|---|---|---|
| `platform` | STRING | แพลตฟอร์ม | `'shopee'` |
| `brand_id` | STRING | รหัสแบรนด์ (lowercase เช่น `levoit`,`anker`,`xiaomi_mg`) | ✅ |
| `brand_name` | STRING | ชื่อแบรนด์ | ✅ |
| `report_date` | DATE | **วันที่ของข้อมูล (ใช้กรองเสมอ)** | ✅ |
| `channel` | STRING | ช่องทางโฆษณา (เช่น `Facebook Collaborative Ads - Sales`, `Google Search`) | ✅ |
| `campaign_name` | STRING | ชื่อแคมเปญ | ✅ |
| `ad_content` | STRING | ad content / โฆษณา | ✅ |

### Metrics
| คอลัมน์ | type | ความหมาย | Shopee |
|---|---|---|---|
| `visits` | INT64 | จำนวนเข้าชม | ✅ |
| `unique_visitors` | INT64 | ผู้เข้าชมไม่ซ้ำ | ✅ |
| `add_to_cart_units` | INT64 | จำนวนเพิ่มลงตะกร้า | ✅ |
| `revenue_local` | FLOAT64 | ยอดขาย (บาท) | ✅ |
| `revenue_usd` | FLOAT64 | ยอดขาย (USD) | ✅ |
| `orders` | INT64 | ออเดอร์ | ✅ |
| `units_sold` | INT64 | จำนวนชิ้นที่ขาย | ✅ |
| `buyers` | INT64 | ผู้ซื้อ | ✅ |
| `new_buyers` | INT64 | ผู้ซื้อใหม่ | ✅ |
| `conversion_rate` | FLOAT64 | อัตราคอนเวอร์ชัน | ✅ |
| `ingested_at` | TIMESTAMP | เวลาที่อัปเข้าตาราง | ✅ |

### คอลัมน์ที่ยัง NULL สำหรับ Shopee (เป็นของแพลตฟอร์มอื่น/ยังไม่นิยาม)
`campaign_logic, channel_group, campaign_id, campaign_type, link_name, ad_name, product_pageviews, video_views, clicks, add_to_cart_pv`
→ **อย่าพึ่งคอลัมน์เหล่านี้สำหรับ Shopee** (จะได้ NULL) ถ้าจำเป็นต้องใช้ แจ้ง data team

---

## 4. Grain ของข้อมูล (1 แถว = อะไร)
1 แถว = **1 (วันที่ × แบรนด์ × ช่องทาง × แคมเปญ × ad_content)** ของ Shopee
- ไม่มี primary key ตายตัว และ **อาจมีหลายแถวที่คีย์มิติชนกันแต่ตัวเลขต่างกัน** (Shopee แตก ad เดียวเป็นหลาย row ได้) → **อย่า upsert ด้วย natural key** ให้ใช้กลยุทธ์ replace-by-date (ดูข้อ 5)
- วันที่ที่ครบทุกแบรนด์: ตั้งแต่ 2026-06-15. ปี 2025 มีแค่แบรนด์ `levoit`

---

## 5. ⭐ กลยุทธ์ Sync เข้าระบบ KOL (อ่านให้ดี)

**ข้อเท็จจริงที่ต้องเข้าใจ:** ทุกวัน pipeline จะ `DELETE` ข้อมูล `platform='shopee'` ทั้งหมด แล้ว `INSERT` ใหม่จากต้นทาง → หมายความว่า:
- `ingested_at` ของ **ทุกแถว** เปลี่ยนทุกวัน → **ใช้ตรวจ incremental ไม่ได้**
- ข้อมูล **ย้อนหลังเปลี่ยนได้** (เช่น ข้อมูลเมื่อวานของ Shopee พร้อมช้า, มี backfill)

**→ วิธีที่ถูกต้อง: "replace by date window"** (ห้าม append เฉย ๆ)
ทุกครั้งที่ sync:
1. กำหนดช่วง เช่น 30 วันล่าสุด (`@start`..`@end`)
2. ดึงข้อมูลช่วงนั้นจาก BQ
3. ในฝั่ง KOL: **ลบข้อมูลช่วง `@start`..`@end` ของ platform='shopee' ทิ้งก่อน** แล้ว insert ชุดใหม่
→ idempotent: รันซ้ำกี่ครั้งข้อมูลไม่ซ้ำ และจับการแก้ย้อนหลังได้

แนะนำ: ตั้ง sync **ทุกวันหลัง 22:00 (เวลาไทย)** (หลังตารางอัปเสร็จ ~21:40) ดึง rolling 30–45 วัน

---

## 5.5 Schema ฝั่ง KOL DB (แนะนำ — ปรับ type ตาม DB จริงของน้อง)

สร้างตารางปลายทางในระบบ KOL ที่ **มิเรอร์เฉพาะคอลัมน์ที่มีข้อมูล** (ไม่ต้องเอาคอลัมน์ NULL มา) + เพิ่ม `synced_at`
ออกแบบให้รองรับ **replace-by-date**

### ⭐ BigQuery (ระบบ KOL ของน้องใช้ตัวนี้ → ใช้อันนี้)
```sql
-- เปลี่ยน your-kol-project.your_dataset เป็นของน้อง
CREATE TABLE IF NOT EXISTS `your-kol-project.your_dataset.offplatform_traffic_daily` (
  platform          STRING  NOT NULL,
  brand_id          STRING  NOT NULL,
  brand_name        STRING,
  report_date       DATE    NOT NULL,
  channel           STRING,
  campaign_name     STRING,
  ad_content        STRING,
  visits            INT64,
  unique_visitors   INT64,
  add_to_cart_units INT64,
  revenue_local     FLOAT64,
  revenue_usd       FLOAT64,
  orders            INT64,
  units_sold        INT64,
  buyers            INT64,
  new_buyers        INT64,
  conversion_rate   FLOAT64,
  synced_at         TIMESTAMP
)
PARTITION BY report_date
CLUSTER BY platform, brand_id
OPTIONS (require_partition_filter = TRUE);   -- แนะนำให้เหมือนต้นทาง (กัน scan เต็ม/คุม cost)
```
> สิทธิ์ที่น้องต้องมีฝั่ง KOL: `dataEditor` บน dataset ปลายทางของตัวเอง (เพราะเป็นของน้อง) + `jobUser` (มีแล้ว) + `dataViewer` ต้นทาง (มีแล้ว)
> ต้นทาง+ปลายทางต้องอยู่ **location เดียวกัน (US)** ถึง query ข้ามได้

### PostgreSQL (ถ้าจะใช้ DB อื่น)
```sql
CREATE TABLE IF NOT EXISTS offplatform_traffic_daily (
    id                BIGSERIAL PRIMARY KEY,          -- surrogate key (ตารางต้นทางไม่มี unique key)
    platform          VARCHAR(20)  NOT NULL,          -- 'shopee' (รองรับ lazada/tiktok/shopify ภายหลัง)
    brand_id          VARCHAR(50)  NOT NULL,
    brand_name        VARCHAR(100),
    report_date       DATE         NOT NULL,
    channel           VARCHAR(150),
    campaign_name     VARCHAR(255),
    ad_content        VARCHAR(255),
    visits            BIGINT,
    unique_visitors   BIGINT,
    add_to_cart_units BIGINT,
    revenue_local     NUMERIC(18,2),
    revenue_usd       NUMERIC(18,2),
    orders            BIGINT,
    units_sold        BIGINT,
    buyers            BIGINT,
    new_buyers        BIGINT,
    conversion_rate   DOUBLE PRECISION,
    synced_at         TIMESTAMPTZ  NOT NULL DEFAULT now()  -- เวลาที่ดึงเข้า KOL
);
-- index สำหรับ replace-by-date + query รายแบรนด์
CREATE INDEX IF NOT EXISTS idx_optd_platform_date ON offplatform_traffic_daily (platform, report_date);
CREATE INDEX IF NOT EXISTS idx_optd_brand_date    ON offplatform_traffic_daily (brand_id, report_date);
```

### MySQL (ถ้าใช้ MySQL)
```sql
CREATE TABLE IF NOT EXISTS offplatform_traffic_daily (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    platform          VARCHAR(20)  NOT NULL,
    brand_id          VARCHAR(50)  NOT NULL,
    brand_name        VARCHAR(100),
    report_date       DATE         NOT NULL,
    channel           VARCHAR(150),
    campaign_name     VARCHAR(255),
    ad_content        VARCHAR(255),
    visits            BIGINT,
    unique_visitors   BIGINT,
    add_to_cart_units BIGINT,
    revenue_local     DECIMAL(18,2),
    revenue_usd       DECIMAL(18,2),
    orders            BIGINT,
    units_sold        BIGINT,
    buyers            BIGINT,
    new_buyers        BIGINT,
    conversion_rate   DOUBLE,
    synced_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_optd_platform_date (platform, report_date),
    INDEX idx_optd_brand_date (brand_id, report_date)
);
```

### Mapping ต้นทาง (BQ) → ปลายทาง (KOL DB)
ชื่อคอลัมน์ **เหมือนกันทุกตัว** (ตั้งใจให้ map ตรง 1:1) — แค่เลือกเฉพาะ 17 คอลัมน์ที่มีข้อมูล:
`platform, brand_id, brand_name, report_date, channel, campaign_name, ad_content, visits, unique_visitors, add_to_cart_units, revenue_local, revenue_usd, orders, units_sold, buyers, new_buyers, conversion_rate`
(+ `synced_at` เซ็ตฝั่ง KOL เอง; `id` auto)

### ⭐ Sync แบบ BigQuery-native (cross-project, ไม่ต้องเขียน Python)
เพราะทั้งต้นทางและปลายทางเป็น BigQuery → sync ได้ด้วย **SQL ตัวเดียว** (อ่านต้นทาง → เขียนตารางน้องตรง ๆ):
```sql
-- รันเป็น multi-statement script (atomic ด้วย transaction)
-- ตั้ง @start, @end เป็นช่วง rolling เช่น 45 วันล่าสุด
BEGIN TRANSACTION;

DELETE FROM `your-kol-project.your_dataset.offplatform_traffic_daily`
WHERE platform = 'shopee' AND report_date BETWEEN @start AND @end;

INSERT INTO `your-kol-project.your_dataset.offplatform_traffic_daily`
  (platform, brand_id, brand_name, report_date, channel, campaign_name, ad_content,
   visits, unique_visitors, add_to_cart_units, revenue_local, revenue_usd, orders,
   units_sold, buyers, new_buyers, conversion_rate, synced_at)
SELECT
   platform, brand_id, brand_name, report_date, channel, campaign_name, ad_content,
   visits, unique_visitors, add_to_cart_units, revenue_local, revenue_usd, orders,
   units_sold, buyers, new_buyers, conversion_rate, CURRENT_TIMESTAMP()
FROM `elated-channel-468406-t4.KOLs_Marketing.kol_offplatform_traffic_daily`
WHERE platform = 'shopee' AND report_date BETWEEN @start AND @end;   -- ⚠️ source filter จำเป็น

COMMIT TRANSACTION;
```
> ตั้งให้รันอัตโนมัติด้วย **BigQuery Scheduled Query** (ทุกวันหลัง 22:00 ICT) ก็จบ ไม่ต้องมี server/Python
> (Scheduled Query รันด้วย service account หรือ creds ของน้อง — ต้องมีสิทธิ์ทั้ง source read + target write)

---

## 6. โค้ดตัวอย่างเต็ม (pull → load เข้า KOL)

ตัวอย่างนี้: ดึงจาก BigQuery → โหลดเข้า **PostgreSQL** (schema §5.5) แบบ replace-by-date
```python
"""Sync kol_offplatform_traffic_daily (BigQuery) → KOL DB (PostgreSQL), replace-by-date."""
from datetime import date, timedelta
from google.cloud import bigquery
import psycopg2
from psycopg2.extras import execute_values

BQ_PROJECT = "elated-channel-468406-t4"
TABLE = f"{BQ_PROJECT}.KOLs_Marketing.kol_offplatform_traffic_daily"

COLS = ["platform","brand_id","brand_name","report_date","channel","campaign_name",
        "ad_content","visits","unique_visitors","add_to_cart_units","revenue_local",
        "revenue_usd","orders","units_sold","buyers","new_buyers","conversion_rate"]

def fetch(start: date, end: date):
    client = bigquery.Client(project=BQ_PROJECT)
    sql = f"""
    SELECT {', '.join(COLS)}
    FROM `{TABLE}`
    WHERE report_date BETWEEN @start AND @end     -- ⚠️ ต้องมีเสมอ (require_partition_filter)
    ORDER BY report_date, brand_id
    """
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("start", "DATE", start),
        bigquery.ScalarQueryParameter("end",   "DATE", end),
    ])
    return [tuple(r[c] for c in COLS) for r in client.query(sql, job_config=cfg).result()]

def sync(window_days: int = 45):
    end = date.today()
    start = end - timedelta(days=window_days)
    rows = fetch(start, end)
    print(f"ดึงจาก BQ ได้ {len(rows)} แถว ({start} → {end})")

    conn = psycopg2.connect(host="...", dbname="kol", user="...", password="...")  # KOL DB
    try:
        with conn, conn.cursor() as cur:                      # transaction เดียว = atomic
            # 1) ลบช่วงเดิม (platform='shopee') กันซ้ำ + จับการอัปย้อนหลัง
            cur.execute(
                "DELETE FROM offplatform_traffic_daily "
                "WHERE platform='shopee' AND report_date BETWEEN %s AND %s", (start, end))
            # 2) insert ชุดใหม่
            execute_values(cur,
                f"INSERT INTO offplatform_traffic_daily ({', '.join(COLS)}) VALUES %s", rows)
        print(f"โหลดเข้า KOL DB สำเร็จ: {len(rows)} แถว")
    finally:
        conn.close()

if __name__ == "__main__":
    sync()
```
> ปรับ `psycopg2` เป็น connector ของ DB ที่น้องใช้ (MySQL → `mysql-connector-python`/`PyMySQL`, ฯลฯ) แต่ logic เหมือนกัน: **DELETE ช่วงวัน → INSERT ใหม่ ใน transaction เดียว**

> 💡 ถ้าระบบ KOL เป็น Google Sheets / Looker Studio: ต่อ BigQuery โดยตรงได้ (Connected Sheets / BQ data source) ไม่ต้องเขียนโค้ด แต่ก็ยังต้องใส่ filter `report_date`

---

## 7. ตัวอย่าง query วิเคราะห์
```sql
-- ยอดต่อแบรนด์ (7 วันล่าสุด)
SELECT brand_id, brand_name,
       SUM(visits) visits, SUM(revenue_local) revenue_local,
       SUM(orders) orders, SUM(units_sold) units_sold
FROM `elated-channel-468406-t4.KOLs_Marketing.kol_offplatform_traffic_daily`
WHERE report_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND CURRENT_DATE()
GROUP BY brand_id, brand_name
ORDER BY revenue_local DESC;

-- ช่องทางไหนทำยอดดี
SELECT channel, SUM(revenue_local) revenue_local, SUM(orders) orders
FROM `elated-channel-468406-t4.KOLs_Marketing.kol_offplatform_traffic_daily`
WHERE report_date BETWEEN '2026-06-15' AND '2026-06-21'
GROUP BY channel ORDER BY revenue_local DESC;
```

---

## 8. ข้อจำกัด / Gotchas (สำคัญ)
| เรื่อง | รายละเอียด |
|---|---|
| **ต้องกรอง report_date** | ทุก query ไม่งั้น `Cannot query over table ... without a filter over column(s) 'report_date'` |
| **ตารางไม่โผล่ใน explorer tree** | สิทธิ์ระดับตาราง → query ด้วย full path / กด ⭐ ปักหมุด |
| **เขียนกลับ BQ ไม่ได้** | read-only — โหลดเข้า DB/ระบบของน้องเองเท่านั้น |
| **เห็นแค่ตารางนี้** | ตารางอื่นใน KOLs_Marketing มองไม่เห็น |
| **ข้อมูลย้อนหลังเปลี่ยนได้** | ใช้ replace-by-date (§5) อย่า append |
| **NULL columns** | คอลัมน์ใน §3 ที่ระบุ NULL อย่าพึ่งสำหรับ shopee |
| **cost** | partition+cluster ช่วยอยู่แล้ว แต่ filter `report_date` แคบ ๆ + เลือกเฉพาะคอลัมน์ที่ใช้ ยิ่งถูก |

---

## 9. Troubleshooting
- `403 Access Denied` ตอน query → ยังไม่ได้ตั้ง ADC ด้วย account benz หรือไม่ได้ตั้ง `project="elated-channel-468406-t4"`
- `Cannot query without a filter over report_date` → ลืมใส่ `WHERE report_date ...`
- ข้อมูลไม่อัปหลายวัน → แจ้ง data team (pipeline อาจล่ม)
- ตัวเลขวันล่าสุดดูน้อย/ไม่ครบแบรนด์ → ปกติ (ข้อมูลเมื่อวานของ Shopee พร้อมช้า จะเติมในรอบถัดไป)

## 10. ติดต่อ
- ตารางอัปจาก Shopee scraper (GCP VM) ทุกวัน 21:00–21:40 ICT
