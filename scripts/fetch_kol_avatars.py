#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_kol_avatars.py

  python fetch_kol_avatars.py              # ดึงทุก platform ยกเว้น Instagram/Facebook
  python fetch_kol_avatars.py --instagram  # รวม Instagram (script จะหยุดถาม sessionid)
  python fetch_kol_avatars.py --facebook   # รวม Facebook (script จะหยุดถาม cookies)
  python fetch_kol_avatars.py --force      # ดึงใหม่แม้มี avatar_url อยู่แล้ว
  python fetch_kol_avatars.py --dry-run    # ดูผลอย่างเดียว ไม่อัป DB
"""

import os, sys, time, re
from urllib.parse import unquote
import psycopg2
import requests
from bs4 import BeautifulSoup
from pathlib import Path

# force UTF-8 output (Windows console)
sys.stdout.reconfigure(encoding='utf-8')

# ── Load .env ──────────────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / 'server' / '.env'
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

DATABASE_URL = os.environ.get('DIRECT_URL') or os.environ.get('DATABASE_URL', '')
DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
DATABASE_URL = re.sub(r'\?.*$', '', DATABASE_URL)

if not DATABASE_URL:
    print('[ERROR] ไม่พบ DATABASE_URL / DIRECT_URL ใน server/.env')
    sys.exit(1)

# ── Flags ──────────────────────────────────────────────────────────────────────
DRY_RUN      = '--dry-run'   in sys.argv
FORCE        = '--force'     in sys.argv
DO_INSTAGRAM = '--instagram' in sys.argv
DO_FACEBOOK  = '--facebook'  in sys.argv

# --only=youtube  หรือ  --only=tiktok  ฯลฯ  (lowercase)
ONLY_PLATFORM = next((a.split('=',1)[1].lower() for a in sys.argv if a.startswith('--only=')), None)
LIMIT         = int(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--limit=')), 0))

# ── HTTP ───────────────────────────────────────────────────────────────────────
HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/125.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
}

MIGRATION_SQL = 'ALTER TABLE kols ADD COLUMN IF NOT EXISTS avatar_url TEXT;'

def fetch_og_image(url, cookies={}):
    try:
        r = requests.get(url, headers=HEADERS, cookies=cookies, timeout=15, allow_redirects=True)
        if r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, 'html.parser')
        tag = soup.find('meta', property='og:image')
        if tag and tag.get('content'):
            return str(tag['content'])
        tag = soup.find('meta', attrs={'name': 'twitter:image'})
        if tag and tag.get('content'):
            return str(tag['content'])
    except Exception:
        pass
    return None

def fetch_facebook_avatar(profile_url):
    """ใช้ Graph API — ไม่ต้อง login, redirect ไปรูปปัจจุบันเสมอ"""
    try:
        fb_id = None

        # ?id=123456 (profile.php?id=...)
        m = re.search(r'[?&]id=(\d+)', profile_url)
        if m:
            fb_id = m.group(1)

        # /p/PageName-123456789/ (new-style Page URL — numeric ID at end)
        if not fb_id:
            m = re.search(r'/p/[^/?#]+-(\d{8,})', profile_url)
            if m:
                fb_id = m.group(1)

        # /share/ short link — follow redirect then re-parse
        if not fb_id and '/share/' in profile_url:
            try:
                rr = requests.head(profile_url, headers=HEADERS, timeout=10, allow_redirects=True)
                resolved = rr.url
                m = re.search(r'[?&]id=(\d+)', resolved)
                if m:
                    fb_id = m.group(1)
                else:
                    m = re.search(r'facebook\.com/([^/?#]+)', resolved)
                    if m and m.group(1) not in ('profile.php', 'pages', 'groups', 'watch', 'share'):
                        fb_id = m.group(1)
            except Exception:
                pass

        # plain handle: facebook.com/handle
        if not fb_id:
            m = re.search(r'facebook\.com/([^/?#]+)', profile_url)
            if m and m.group(1) not in ('profile.php', 'pages', 'groups', 'watch', 'share', 'p'):
                fb_id = m.group(1)

        if not fb_id:
            return None

        graph_url = f'https://graph.facebook.com/{fb_id}/picture?type=large'
        r = requests.get(graph_url, timeout=10, allow_redirects=True)
        if r.status_code == 200 and 'image' in r.headers.get('Content-Type', ''):
            return graph_url   # เก็บ Graph URL ไว้ — redirect ไปรูปล่าสุดเสมอ
    except Exception:
        pass
    return None

def fetch_instagram_avatar(handle, profile_url, cookies):
    """ดึงรูปโปรไฟล์ผ่าน Instagram web API (web_profile_info)"""
    # หา username: จาก handle ก่อน ถ้า invalid ให้ดึงจาก profile_url
    clean = None
    if re.match(r'^@?[\w.]+$', handle or ''):
        clean = handle.lstrip('@').lstrip('.')
    elif profile_url:
        m = re.search(r'instagram\.com/([^/?#\s]+)', profile_url)
        if m and m.group(1) not in ('p', 'reel', 'stories', 'explore', 'share'):
            clean = m.group(1)

    if not clean:
        return '__NO_HANDLE__'

    try:
        r = requests.get(
            f'https://www.instagram.com/api/v1/users/web_profile_info/?username={clean}',
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0 Safari/537.36',
                'x-ig-app-id': '936619743392459',
                'Accept': 'application/json',
                'Referer': f'https://www.instagram.com/{clean}/',
            },
            cookies=cookies,
            timeout=15,
        )
        if r.status_code == 200:
            user = r.json().get('data', {}).get('user', {})
            return user.get('profile_pic_url_hd') or user.get('profile_pic_url')
        return f'__HTTP_{r.status_code}__'
    except Exception as e:
        return f'__ERR_{e}__'

def prompt_instagram():
    cli_sid = next((a.split('=',1)[1] for a in sys.argv if a.startswith('--sessionid=')), None)
    if cli_sid:
        return {'sessionid': cli_sid}
    print()
    print('-' * 60)
    print('ถึง Instagram แล้วครับ -- ต้องการ sessionid cookie')
    print()
    print('วิธีได้ sessionid:')
    print('  1. เปิด Chrome -> login instagram.com')
    print('  2. F12 -> Application -> Cookies -> https://www.instagram.com')
    print('  3. หา "sessionid" -> copy value')
    print()
    sid = input('Paste sessionid ที่นี่ (Enter เพื่อข้าม): ').strip()
    return {'sessionid': sid} if sid else {}

def prompt_facebook():
    cli = {a.split('=',1)[0].lstrip('-'): a.split('=',1)[1] for a in sys.argv if '=' in a and a.startswith('--')}
    if cli.get('c-user') and cli.get('xs'):
        return {
            'c_user': cli['c-user'],
            'xs':     cli['xs'],
            'datr':   cli.get('datr', ''),
            'fr':     cli.get('fr', ''),
        }
    # fallback: interactive
    print()
    print('-' * 60)
    print('ถึง Facebook แล้วครับ -- ต้องการ cookies')
    c_user = input('c_user: ').strip()
    xs     = input('xs: ').strip()
    datr   = input('datr: ').strip()
    fr     = input('fr: ').strip()
    return {'c_user': c_user, 'xs': xs, 'datr': datr, 'fr': fr} if c_user else {}

def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    print('[migration] เพิ่ม avatar_url column (ถ้ายังไม่มี)...')
    cur.execute(MIGRATION_SQL)
    print('[migration] OK\n')

    skip_cond = '' if FORCE else 'AND k.avatar_url IS NULL'
    cur.execute(f"""
        SELECT k.id, k.handle, k.profile_url,
               LOWER(COALESCE(p.name, '')) AS platform_key,
               COALESCE(p.name, 'Unknown')  AS platform_name
        FROM kols k
        LEFT JOIN platforms p ON k.platform_id = p.id
        WHERE k.profile_url IS NOT NULL
        {skip_cond}
        ORDER BY p.name NULLS LAST, k.handle
    """)
    kols = cur.fetchall()

    label = '(ทั้งหมด)' if FORCE else '(ยังไม่มีรูป)'
    print(f'พบ {len(kols)} KOL {label}')
    if DRY_RUN:
        print('[DRY RUN] จะไม่อัป DB')
    print()

    by_platform = {}
    for row in kols:
        by_platform.setdefault(row[3], []).append(row)

    results = {'ok': 0, 'fail': 0, 'skip': 0}

    for platform_key, group in by_platform.items():
        name = group[0][4]

        if ONLY_PLATFORM and platform_key != ONLY_PLATFORM:
            continue

        if platform_key == 'instagram':
            if not DO_INSTAGRAM:
                print(f'[SKIP] Instagram ({len(group)} KOL) -- รัน script อีกครั้งพร้อม --instagram เมื่อพร้อม')
                results['skip'] += len(group)
                continue
            ig_cookies = prompt_instagram()
            if not ig_cookies:
                results['skip'] += len(group)
                continue
            # decode %3A → : ให้ถูกต้อง
            ig_cookies = {k: unquote(v) for k, v in ig_cookies.items()}

        else:
            ig_cookies = {}

        subset = group[:LIMIT] if LIMIT else group
        print(f'[{name}] {len(subset)}/{len(group)} KOL')
        for kol_id, handle, profile_url, _, _ in subset:
            print(f'  {handle:<32}', end='', flush=True)

            if platform_key == 'facebook':
                img_url = fetch_facebook_avatar(profile_url)
                delay = 1.0
            elif platform_key == 'instagram':
                img_url = fetch_instagram_avatar(handle, profile_url, ig_cookies)
                delay = 3.0
            else:
                img_url = fetch_og_image(profile_url)

            if img_url and not str(img_url).startswith('__'):
                print('OK')
                if not DRY_RUN:
                    cur.execute('UPDATE kols SET avatar_url = %s WHERE id = %s', (img_url, kol_id))
                results['ok'] += 1
            else:
                reason = img_url or 'no url'
                print(f'FAIL ({reason})')
                results['fail'] += 1
                # หยุดทันทีถ้า rate limited — ไม่เปลืองโควตาที่เหลือ
                if img_url == '__HTTP_429__' and platform_key == 'instagram':
                    print('\n[STOP] Instagram rate limit (429) — รอ 15-30 นาทีแล้วรันใหม่')
                    break

            time.sleep(delay if platform_key in ('instagram', 'facebook') else 1.2)

        print()

    print('-' * 60)
    print(f"OK:   {results['ok']}")
    print(f"FAIL: {results['fail']}")
    print(f"SKIP: {results['skip']}")

    if not DRY_RUN and results['ok'] > 0:
        print()
        print('ขั้นต่อไป:')
        print('  1. หยุด server')
        print('  2. cd server && npx prisma db pull && npx prisma generate')
        print('  3. start server ใหม่')

    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
