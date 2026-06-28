"""
sync_offplatform_traffic.py
----------------------------
ดึงข้อมูล off-platform traffic จาก BigQuery →  Supabase (PostgreSQL)
กลยุทธ์: replace-by-date-window (DELETE ช่วงวันที่ก่อน → INSERT ใหม่ใน transaction เดียว)

การใช้งาน:
  python scripts/sync_offplatform_traffic.py              # rolling 45 วัน
  python scripts/sync_offplatform_traffic.py --days 7    # rolling 7 วัน
  python scripts/sync_offplatform_traffic.py --start 2026-06-15 --end 2026-06-25
  python scripts/sync_offplatform_traffic.py --dry-run   # ไม่เขียน DB จริง
"""

import sys
import io
import os
import argparse
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse, unquote

# Fix encoding สำหรับ Windows terminal
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# ─── Config ──────────────────────────────────────────────────────────────────

BQ_PROJECT = "elated-channel-468406-t4"
BQ_TABLE   = f"{BQ_PROJECT}.KOLs_Marketing.kol_offplatform_traffic_daily"

COLS = [
    "platform", "brand_id", "brand_name", "report_date", "channel",
    "campaign_name", "ad_content", "visits", "unique_visitors",
    "add_to_cart_units", "revenue_local", "revenue_usd", "orders",
    "units_sold", "buyers", "new_buyers", "conversion_rate",
]

# ─── Load .env ───────────────────────────────────────────────────────────────

def load_env():
    env_path = Path(__file__).parent.parent / "server" / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip().rstrip('\r')
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, _, v = line.partition('=')
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k not in os.environ:
            os.environ[k] = v

def get_pg_dsn() -> str:
    """ดึง DIRECT_URL จาก .env — session pooler port 5432 (รองรับ prepared statements)."""
    url = os.environ.get("DIRECT_URL") or os.environ.get(
        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"
    )
    if not url:
        raise RuntimeError(
            "ไม่พบ DIRECT_URL ใน server/.env "
            "— กรุณาตรวจสอบ connection string ของ Supabase session pooler (port 5432)"
        )
    # URL-decode password (%21 → !)
    return unquote(url)

# ─── BigQuery fetch ───────────────────────────────────────────────────────────

def fetch_from_bq(start: date, end: date, verbose: bool = True) -> list[tuple]:
    try:
        from google.cloud import bigquery
    except ImportError:
        print("❌ ไม่พบ google-cloud-bigquery — รัน: pip install google-cloud-bigquery db-dtypes", file=sys.stderr)
        sys.exit(1)

    client = bigquery.Client(project=BQ_PROJECT)

    sql = f"""
    SELECT {', '.join(COLS)}
    FROM `{BQ_TABLE}`
    WHERE report_date BETWEEN @start AND @end
    ORDER BY report_date, brand_id
    """
    cfg = bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("start", "DATE", start),
        bigquery.ScalarQueryParameter("end",   "DATE", end),
    ])

    if verbose:
        print(f"📡 Query BigQuery: {BQ_TABLE}")
        print(f"   report_date BETWEEN {start} AND {end}")

    job = client.query(sql, job_config=cfg)
    rows = [(
        r["platform"],
        r["brand_id"],
        r["brand_name"],
        r["report_date"],      # date object
        r["channel"],
        r["campaign_name"],
        r["ad_content"],
        r["visits"],
        r["unique_visitors"],
        r["add_to_cart_units"],
        float(r["revenue_local"]) if r["revenue_local"] is not None else None,
        float(r["revenue_usd"])   if r["revenue_usd"]   is not None else None,
        r["orders"],
        r["units_sold"],
        r["buyers"],
        r["new_buyers"],
        float(r["conversion_rate"]) if r["conversion_rate"] is not None else None,
    ) for r in job.result()]

    if verbose:
        brands = sorted({r[1] for r in rows})
        dates  = sorted({r[3] for r in rows})
        print(f"   → ได้ {len(rows):,} แถว | {len(brands)} แบรนด์ | {len(dates)} วันที่")
        if brands:
            print(f"   · แบรนด์: {', '.join(brands)}")
        if dates:
            print(f"   · วันที่: {dates[0]} ถึง {dates[-1]}")

    return rows

# ─── PostgreSQL sync ──────────────────────────────────────────────────────────

def sync_to_pg(rows: list[tuple], start: date, end: date, dry_run: bool = False) -> dict:
    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError:
        print("❌ ไม่พบ psycopg2 — รัน: pip install psycopg2-binary", file=sys.stderr)
        sys.exit(1)

    dsn = get_pg_dsn()

    if dry_run:
        print(f"\n🔍 [DRY RUN] จะลบช่วง {start} → {end} platform='shopee'")
        print(f"🔍 [DRY RUN] จะ INSERT {len(rows):,} แถว")
        print("🔍 [DRY RUN] ไม่ได้เขียน DB จริง")
        return {"deleted": "?", "inserted": len(rows), "dry_run": True}

    conn = psycopg2.connect(dsn)
    try:
        with conn:
            with conn.cursor() as cur:
                # 1) ลบช่วงวันที่นี้ (platform='shopee') ก่อน
                cur.execute(
                    "DELETE FROM offplatform_traffic_daily "
                    "WHERE platform = 'shopee' AND report_date BETWEEN %s AND %s",
                    (start, end)
                )
                deleted = cur.rowcount

                # 2) INSERT ชุดใหม่ (+ synced_at auto DEFAULT now())
                if rows:
                    execute_values(
                        cur,
                        f"INSERT INTO offplatform_traffic_daily ({', '.join(COLS)}) VALUES %s",
                        rows,
                        page_size=500,
                    )

        return {"deleted": deleted, "inserted": len(rows), "dry_run": False}
    finally:
        conn.close()

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    load_env()

    parser = argparse.ArgumentParser(description="Sync off-platform traffic: BigQuery → Supabase")
    parser.add_argument("--days",    type=int,  default=45,
                        help="Rolling window size in days (default: 45)")
    parser.add_argument("--start",   type=str,  default=None,
                        help="Start date YYYY-MM-DD (overrides --days)")
    parser.add_argument("--end",     type=str,  default=None,
                        help="End date YYYY-MM-DD (default: today)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview only — do not write to DB")
    args = parser.parse_args()

    today = date.today()
    end   = date.fromisoformat(args.end)   if args.end   else today
    start = date.fromisoformat(args.start) if args.start else end - timedelta(days=args.days - 1)

    print("=" * 60)
    print("  sync_offplatform_traffic.py")
    print("=" * 60)
    print(f"  ช่วง     : {start} → {end} ({(end - start).days + 1} วัน)")
    print(f"  dry-run  : {'ใช่' if args.dry_run else 'ไม่'}")
    print()

    rows = fetch_from_bq(start, end, verbose=True)
    result = sync_to_pg(rows, start, end, dry_run=args.dry_run)

    print()
    if result["dry_run"]:
        print(f"✅ DRY RUN เสร็จ — จะ insert {result['inserted']:,} แถว")
    else:
        print(f"✅ Sync สำเร็จ")
        print(f"   · ลบแถวเก่าออก : {result['deleted']:,} แถว")
        print(f"   · Insert ใหม่   : {result['inserted']:,} แถว")

if __name__ == "__main__":
    main()
