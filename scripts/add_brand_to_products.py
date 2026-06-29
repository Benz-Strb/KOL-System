"""
Migration: add brand_id to products table, backfill from placements
"""
import os, sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    sys.exit("Install psycopg2 first: pip install psycopg2-binary")

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / "server" / ".env"
load_dotenv(env_path)

raw_url = os.getenv("DIRECT_URL") or os.getenv("DATABASE_URL")
if not raw_url:
    sys.exit("DIRECT_URL or DATABASE_URL not found in server/.env")

db_url = raw_url.split("?")[0]

print("Connecting to DB ...")
conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

# 1. Check if brand_id already exists
cur.execute("""
    SELECT column_name FROM information_schema.columns
    WHERE table_name='products' AND column_name='brand_id'
""")
if cur.fetchone():
    print("brand_id already exists in products - skipping ALTER")
else:
    print("Adding brand_id column ...")
    cur.execute("ALTER TABLE products ADD COLUMN brand_id integer REFERENCES brands(id)")
    print("OK: ALTER TABLE done")

# 2. Backfill from placements (brand with most placements per product)
print("Backfilling brand_id from placements ...")
cur.execute("""
    UPDATE products p SET brand_id = sub.brand_id
    FROM (
        SELECT product_id, brand_id
        FROM (
            SELECT product_id, brand_id, COUNT(*) AS n,
                   ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY COUNT(*) DESC) AS rn
            FROM placements
            WHERE product_id IS NOT NULL
            GROUP BY product_id, brand_id
        ) ranked
        WHERE rn = 1
    ) sub
    WHERE p.id = sub.product_id
""")
print("OK: Backfill done")

# 3. Verify
cur.execute("SELECT COUNT(*) FROM products WHERE brand_id IS NOT NULL")
filled = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM products")
total = cur.fetchone()[0]
print(f"\nVerify: {filled}/{total} products have brand_id set")

cur.execute("""
    SELECT p.model_code, b.name AS brand_name
    FROM products p JOIN brands b ON b.id = p.brand_id
    ORDER BY p.model_code
    LIMIT 10
""")
rows = cur.fetchall()
print("\nSample (first 10 rows):")
for r in rows:
    print(f"  {r[0]} -> {r[1]}")

cur.close()
conn.close()
print("\nDone OK")
