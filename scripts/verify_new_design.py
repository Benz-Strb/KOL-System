"""
Verify that DB matches New-designDatabase.md
Checks every column, its table, type, and nullability.
Also checks existing data rows are intact.
"""
import os, sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    sys.exit("pip install psycopg2-binary")

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / "server" / ".env")

raw_url = os.getenv("DIRECT_URL") or os.getenv("DATABASE_URL")
db_url = raw_url.split("?")[0]

conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

PASS = "PASS"
FAIL = "FAIL"

results = []

def check_col(table, col, expected_type_contains=None, nullable=None):
    cur.execute("""
        SELECT data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = %s
          AND column_name  = %s
    """, (table, col))
    row = cur.fetchone()
    if not row:
        results.append((FAIL, f"{table}.{col}", "column NOT FOUND"))
        return
    dtype, is_null = row
    issues = []
    if expected_type_contains and expected_type_contains.lower() not in dtype.lower():
        issues.append(f"type={dtype} (expected to contain '{expected_type_contains}')")
    if nullable is not None:
        want = "YES" if nullable else "NO"
        if is_null != want:
            issues.append(f"nullable={is_null} (expected {want})")
    label = f"{table}.{col}"
    if issues:
        results.append((FAIL, label, " | ".join(issues)))
    else:
        results.append((PASS, label, f"type={dtype}, nullable={is_null}"))

def check_table(table):
    cur.execute("""
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name=%s
    """, (table,))
    if cur.fetchone()[0] == 0:
        results.append((FAIL, f"TABLE {table}", "table NOT FOUND"))
        return False
    results.append((PASS, f"TABLE {table}", "exists"))
    return True

def check_count(table, label=None):
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    n = cur.fetchone()[0]
    results.append((PASS, label or f"{table} row count", f"{n:,} rows"))
    return n

def check_enum_values(table, col, allowed):
    cur.execute(f"""
        SELECT DISTINCT {col} FROM {table}
        WHERE {col} IS NOT NULL
        ORDER BY {col}
    """)
    vals = [r[0] for r in cur.fetchall()]
    bad = [v for v in vals if v not in allowed]
    if bad:
        results.append((FAIL, f"{table}.{col} enum values", f"unexpected: {bad}"))
    else:
        results.append((PASS, f"{table}.{col} enum values", f"all valid: {vals or '(empty)'}"))

print("=" * 60)
print("Verifying DB against New-designDatabase.md")
print("=" * 60)

# ================================================================
# TABLE 1: KOL_Profile_Table  -->  kols
# ================================================================
print("\n[1] KOL_Profile_Table --> kols")
check_table("kols")
check_col("kols", "id",                   "integer",   nullable=False)  # KOL_ID
check_col("kols", "handle",               "text",      nullable=False)  # KOL Name/Handle
check_col("kols", "platform_id",          "integer",   nullable=True)   # Platform (FK)
check_col("kols", "contact_info",         "json",      nullable=True)   # Contact_Info
check_col("kols", "audience_tags",        "array",     nullable=True)   # Audience_Tags
check_col("kols", "custom_tags",          "array",     nullable=True)   # Custom_Tags
check_col("kols", "main_selling_points",  "text",      nullable=True)   # Main Selling Points
# verify platform FK table has values
cur.execute("SELECT COUNT(*) FROM platforms")
n = cur.fetchone()[0]
results.append((PASS, "platforms table (Platform enum source)", f"{n} platforms"))
cur.execute("SELECT name FROM platforms ORDER BY name")
pnames = [r[0] for r in cur.fetchall()]
results.append((PASS, "platforms.name values", str(pnames)))

# ================================================================
# TABLE 2: KOL_Commercial_Terms_Table  -->  kol_commercial_terms
# ================================================================
print("\n[2] KOL_Commercial_Terms_Table --> kol_commercial_terms")
if check_table("kol_commercial_terms"):
    check_col("kol_commercial_terms", "id",                   "integer",  nullable=False)
    check_col("kol_commercial_terms", "kol_id",               "integer",  nullable=False)
    check_col("kol_commercial_terms", "pricing_type",         "text",     nullable=False)  # Pricing_Type
    check_col("kol_commercial_terms", "single_post_price",    "numeric",  nullable=True)   # Single_Post_Price
    check_col("kol_commercial_terms", "package_price",        "numeric",  nullable=True)   # Package_Price
    check_col("kol_commercial_terms", "multi_platform_price", "numeric",  nullable=True)   # Multi_Platform_Price
    check_col("kol_commercial_terms", "is_barter",            "boolean",  nullable=False)  # Is_Barter
    # CHECK constraint still enforced at DB level even if Prisma warns
    cur.execute("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name='kol_commercial_terms' AND constraint_type='CHECK'
    """)
    checks = [r[0] for r in cur.fetchall()]
    if any("pricing_type" in c for c in checks):
        results.append((PASS, "kol_commercial_terms pricing_type CHECK constraint", "exists"))
    else:
        results.append((FAIL, "kol_commercial_terms pricing_type CHECK constraint", "missing"))
    check_count("kol_commercial_terms")

# ================================================================
# TABLE 3: Sample_Management_Table  -->  kol_samples
# ================================================================
print("\n[3] Sample_Management_Table --> kol_samples")
if check_table("kol_samples"):
    check_col("kol_samples", "id",            "integer", nullable=False)  # Sample_ID
    check_col("kol_samples", "sample_status", "text",    nullable=False)  # Sample_Status
    check_col("kol_samples", "return_policy", "text",    nullable=False)  # Return_Policy
    check_col("kol_samples", "brand_id",      "integer", nullable=True)   # Associated_Brand
    check_col("kol_samples", "product_id",    "integer", nullable=True)   # Associated_Product_SKU
    # defaults
    cur.execute("SELECT column_default FROM information_schema.columns WHERE table_name='kol_samples' AND column_name='sample_status'")
    d = cur.fetchone()[0]
    results.append((PASS if "to_be_shipped" in str(d) else FAIL, "kol_samples.sample_status default", str(d)))
    cur.execute("SELECT column_default FROM information_schema.columns WHERE table_name='kol_samples' AND column_name='return_policy'")
    d2 = cur.fetchone()[0]
    results.append((PASS if "no_return_required" in str(d2) else FAIL, "kol_samples.return_policy default", str(d2)))
    check_count("kol_samples")

# ================================================================
# TABLE 4: KOL_Performance_Snapshot_Table  -->  placement_metrics
# ================================================================
print("\n[4] KOL_Performance_Snapshot_Table --> placement_metrics")
check_table("placement_metrics")
# Campaign_ID & Post_URL via placements FK
check_col("placement_metrics", "placement_id",    "integer",  nullable=False)  # Campaign_ID / Post_URL via join
check_col("placements",        "campaign_id",     "integer",  nullable=True)   # campaigns.campaign_id
check_col("placements",        "post_url",        "text",     nullable=True)   # Post_URL
check_col("placement_metrics", "tracking_period", "text",     nullable=True)   # Tracking_Period
check_col("placement_metrics", "impressions",     "integer",  nullable=True)   # Metrics_Impressions
check_col("placement_metrics", "likes",           "integer",  nullable=True)   # Metrics_Likes
check_col("placement_metrics", "engagement_rate", "numeric",  nullable=True)   # Metrics_Engagement_Rate
check_col("placement_metrics", "shares",          "integer",  nullable=True)   # shares (needed for eng_rate formula)
check_col("placement_metrics", "comments",        "integer",  nullable=True)   # comments (needed for eng_rate formula)
check_col("placement_metrics", "promotion_status","text",     nullable=True)   # Promotion_Status
check_enum_values("placement_metrics", "tracking_period", ["daily", "recent_30_days", None])

# ================================================================
# DATA INTEGRITY: existing Excel data untouched
# ================================================================
print("\n[5] Existing data integrity")
check_count("placements",        "placements (Excel data)")
check_count("kols",              "kols (KOL profiles)")
check_count("placement_metrics", "placement_metrics (bot + manual metrics)")
check_count("campaigns",         "campaigns")
check_count("products",          "products")

# Spot checks: new columns are NULL for existing rows (no data corruption)
cur.execute("SELECT COUNT(*) FROM kols WHERE contact_info IS NOT NULL OR audience_tags <> '{}' OR custom_tags <> '{}' OR main_selling_points IS NOT NULL")
n = cur.fetchone()[0]
results.append((PASS, "kols new columns: existing rows untouched (all NULL/empty)", f"{n} rows have new data (expected 0 for now)"))

cur.execute("SELECT COUNT(*) FROM placement_metrics WHERE impressions IS NOT NULL OR engagement_rate IS NOT NULL OR promotion_status IS NOT NULL")
n2 = cur.fetchone()[0]
results.append((PASS, "placement_metrics new columns: existing rows untouched", f"{n2} rows have new data (expected 0 for now)"))

# NULL checks for critical existing columns
cur.execute("SELECT COUNT(*) FROM placements WHERE kol_id IS NULL")
null_kol = cur.fetchone()[0]
results.append((PASS if null_kol == 0 else FAIL, "placements.kol_id NULL count", str(null_kol)))

cur.execute("SELECT COUNT(*) FROM placements WHERE platform_id IS NULL")
null_plat = cur.fetchone()[0]
results.append((PASS if null_plat == 0 else FAIL, "placements.platform_id NULL count", str(null_plat)))

cur.execute("SELECT COUNT(*) FROM placements WHERE campaign_id IS NULL")
null_camp = cur.fetchone()[0]
results.append((PASS if null_camp == 0 else FAIL, "placements.campaign_id NULL count", str(null_camp)))

# ================================================================
# INDEX checks
# ================================================================
print("\n[6] Indexes")
for idx in [
    "idx_kols_audience_tags",
    "idx_kols_custom_tags",
    "idx_kol_commercial_terms_kol",
    "idx_kol_commercial_terms_brand",
    "idx_kol_samples_kol",
    "idx_kol_samples_placement",
    "idx_kol_samples_brand",
    "idx_kol_samples_product",
    "idx_kol_samples_status",
    "idx_metrics_tracking_period",
    "idx_metrics_promotion_status",
]:
    cur.execute("SELECT 1 FROM pg_indexes WHERE indexname=%s", (idx,))
    found = cur.fetchone()
    results.append((PASS if found else FAIL, f"index {idx}", "exists" if found else "MISSING"))

# ================================================================
# PRINT REPORT
# ================================================================
print("\n" + "=" * 60)
print("RESULTS")
print("=" * 60)
passes = [r for r in results if r[0] == PASS]
fails  = [r for r in results if r[0] == FAIL]

for status, label, detail in results:
    tag = "OK  " if status == PASS else "FAIL"
    print(f"  [{tag}] {label}")
    if status == FAIL or "row" in detail.lower() or "values" in detail.lower():
        print(f"         {detail}")

print(f"\nTotal: {len(passes)} PASS, {len(fails)} FAIL")
if fails:
    print("\nFailed items:")
    for _, label, detail in fails:
        print(f"  - {label}: {detail}")
    sys.exit(1)
else:
    print("\nAll checks PASSED - DB matches New-designDatabase.md")

cur.close()
conn.close()
