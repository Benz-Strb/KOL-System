"""
Migration: create import_files table (Phase 0 of Import Excel upgrade)
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

# 1. Check if import_files already exists
cur.execute("""
    SELECT table_name FROM information_schema.tables
    WHERE table_name='import_files'
""")
if cur.fetchone():
    print("import_files table already exists - skipping CREATE TABLE")
else:
    print("Creating import_files table ...")
    cur.execute("""
        CREATE TABLE import_files (
          id                SERIAL PRIMARY KEY,
          user_id           INT  NOT NULL REFERENCES users(id),
          kind              TEXT NOT NULL,                     -- 'online' | 'offline'
          file_type         TEXT NOT NULL DEFAULT 'plan',      -- 'plan' = ไฟล์ผลลัพธ์ commit · (เผื่ออนาคต 'performance')
          storage_path      TEXT NOT NULL,                     -- เช่น <userId>/<uuid>.xlsx (ภายใน bucket import-files)
          original_filename TEXT,                              -- ชื่อไฟล์ที่ user อัป (ไว้โชว์)
          placement_count   INT  NOT NULL DEFAULT 0,
          brand_summary     TEXT,                              -- ชื่อแบรนด์ที่อยู่ในไฟล์ (comma-joined) เผื่อ 1 ไฟล์หลายแบรนด์
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    print("OK: CREATE TABLE done")

# 2. Check if index already exists
cur.execute("""
    SELECT indexname FROM pg_indexes
    WHERE tablename='import_files' AND indexname='idx_import_files_user'
""")
if cur.fetchone():
    print("idx_import_files_user already exists - skipping CREATE INDEX")
else:
    print("Creating idx_import_files_user ...")
    cur.execute("CREATE INDEX idx_import_files_user ON import_files(user_id)")
    print("OK: CREATE INDEX done")

# 3. Verify
cur.execute("""
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name='import_files'
    ORDER BY ordinal_position
""")
rows = cur.fetchall()
print("\nVerify - import_files columns:")
for r in rows:
    print(f"  {r[0]:<20} {r[1]:<25} nullable={r[2]:<5} default={r[3]}")

cur.execute("""
    SELECT indexname FROM pg_indexes WHERE tablename='import_files'
""")
idx_rows = cur.fetchall()
print("\nVerify - import_files indexes:")
for r in idx_rows:
    print(f"  {r[0]}")

cur.close()
conn.close()
print("\nDone OK")
