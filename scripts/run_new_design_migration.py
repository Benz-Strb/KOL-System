"""
รัน new_design_migration.sql ผ่าน psycopg2
ต้องมี .env ที่ server/.env (DIRECT_URL หรือ DATABASE_URL)
"""
import os, sys, re
from pathlib import Path

try:
    import psycopg2
    from psycopg2 import sql
except ImportError:
    sys.exit("ติดตั้ง psycopg2 ก่อน: pip install psycopg2-binary")

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / "server" / ".env"
load_dotenv(env_path)

raw_url = os.getenv("DIRECT_URL") or os.getenv("DATABASE_URL")
if not raw_url:
    sys.exit("ไม่พบ DIRECT_URL หรือ DATABASE_URL ใน server/.env")

# ตัด query string ออกก่อนต่อ psycopg2
db_url = raw_url.split("?")[0]

sql_file = Path(__file__).parent / "new_design_migration.sql"
migration_sql = sql_file.read_text(encoding="utf-8")

print(f"Connecting to DB …")
conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

print("Running migration …")
cur.execute(migration_sql)

print("\nVerifying new columns …")
checks = {
    "kols.contact_info":                  "SELECT column_name FROM information_schema.columns WHERE table_name='kols' AND column_name='contact_info'",
    "kols.custom_tags":                   "SELECT column_name FROM information_schema.columns WHERE table_name='kols' AND column_name='custom_tags'",
    "kols.main_selling_points":           "SELECT column_name FROM information_schema.columns WHERE table_name='kols' AND column_name='main_selling_points'",
    "kol_commercial_terms (table)":       "SELECT table_name FROM information_schema.tables WHERE table_name='kol_commercial_terms'",
    "kol_samples (table)":                "SELECT table_name FROM information_schema.tables WHERE table_name='kol_samples'",
    "placement_metrics.impressions":      "SELECT column_name FROM information_schema.columns WHERE table_name='placement_metrics' AND column_name='impressions'",
    "placement_metrics.engagement_rate":  "SELECT column_name FROM information_schema.columns WHERE table_name='placement_metrics' AND column_name='engagement_rate'",
    "placement_metrics.promotion_status": "SELECT column_name FROM information_schema.columns WHERE table_name='placement_metrics' AND column_name='promotion_status'",
}
all_ok = True
for label, q in checks.items():
    cur.execute(q)
    found = cur.fetchone()
    status = "OK" if found else "MISSING"
    if not found:
        all_ok = False
    print(f"  {status}  {label}")

cur.close()
conn.close()

if all_ok:
    print("\nMigration OK - all columns verified")
    print("\nขั้นตอนต่อไป:")
    print("  cd server")
    print("  npx prisma db pull")
    print("  npx prisma generate")
else:
    print("\nบาง column ยังหายไป — ตรวจสอบ error ข้างบน")
    sys.exit(1)
