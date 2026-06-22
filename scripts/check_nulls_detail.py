import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import psycopg2

DB_URL = "postgresql://postgres.hdrweioqqqpslsjizkci:Shd2025%21ffofo@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

print("=== platform_id IS NULL ===")
cur.execute("""
    SELECT p.id, k.handle, c.code, p.person_in_charge, p.person_in_charge_id, p.placement_type
    FROM placements p
    JOIN kols k ON k.id = p.kol_id
    LEFT JOIN campaigns c ON c.id = p.campaign_id
    WHERE p.platform_id IS NULL ORDER BY p.id
""")
for r in cur.fetchall():
    print(f"  id={r[0]:4d}  handle={r[1]:<30} campaign={r[2]}  pic={r[3]}  pic_id={r[4]}  type={r[5]}")

print("\n=== person_in_charge_id IS NULL ===")
cur.execute("""
    SELECT p.id, k.handle, plt.name, c.code, p.person_in_charge
    FROM placements p
    JOIN kols k ON k.id = p.kol_id
    LEFT JOIN platforms plt ON plt.id = p.platform_id
    LEFT JOIN campaigns c ON c.id = p.campaign_id
    WHERE p.person_in_charge_id IS NULL ORDER BY p.id
""")
for r in cur.fetchall():
    print(f"  id={r[0]:4d}  handle={r[1]:<30} platform={r[2]}  campaign={r[3]}  pic_text={r[4]}")

print("\n=== post_url NULL — sample 20 rows ===")
cur.execute("""
    SELECT p.id, k.handle, plt.name, c.code, p.post_url, p.status
    FROM placements p
    JOIN kols k ON k.id = p.kol_id
    LEFT JOIN platforms plt ON plt.id = p.platform_id
    LEFT JOIN campaigns c ON c.id = p.campaign_id
    WHERE p.post_url IS NULL ORDER BY p.id LIMIT 20
""")
for r in cur.fetchall():
    print(f"  id={r[0]:4d}  handle={r[1]:<25} platform={r[2]:<12} campaign={r[3]}  status={r[5]}")

print("\n=== post_url NULL — count by status ===")
cur.execute("""
    SELECT p.status, COUNT(*) FROM placements p WHERE p.post_url IS NULL GROUP BY p.status
""")
for r in cur.fetchall():
    print(f"  status={r[0]}: {r[1]} rows")

cur.close()
conn.close()
