// fetch_avatars_browser.mjs
//
// Some platforms block the simple-HTTP scraping approach fetch_kol_avatars.py
// uses (raw `requests` calls, no JS execution) but allow a REAL browser
// navigating normally to the profile page — confirmed for both:
//   - Instagram: the `web_profile_info` API is blocked at Meta's edge/proxy
//     layer (429, empty body, even with no cookie at all) — needs a valid
//     `sessionid` cookie + real navigation to render `og:image`.
//   - TikTok: previously found "100% bot detection" with the old API-style
//     approach, but a plain browser navigation (no cookie needed at all)
//     renders `og:image` fine.
// This script handles both via Playwright (already a root devDependency).
//
// ⚠️ The image URL captured this way is always a SIGNED CDN URL with a
// baked-in expiry — Instagram ~4 days (`oe=` query param), TikTok ~2 days
// (`x-expires=` query param) — unlike the Facebook Graph API method
// elsewhere in this project (stable redirect URL, never expires). Re-run
// this script periodically per platform; it is not a one-time fix the way
// Facebook avatars are. (Plan: re-host on Cloudflare R2 for a true permanent
// URL — not done yet, pending R2 being enabled on the Cloudflare account.)
//
// Usage:
//   node scripts/fetch_avatars_browser.mjs --platform=tiktok [--dry-run] [--force] [--limit=N]
//   node scripts/fetch_avatars_browser.mjs --platform=instagram --sessionid=<sid> [--dry-run] [--force] [--limit=N]

import { chromium } from 'playwright';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const env = {};
for (const rawLine of readFileSync(path.join(__dirname, '..', 'server', '.env'), 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '');
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const platformArg = (args.find(a => a.startsWith('--platform=')) ?? '').split('=')[1];
const sessionidArg = args.find(a => a.startsWith('--sessionid='));
const LIMIT = Number((args.find(a => a.startsWith('--limit=')) ?? '').split('=')[1]) || 0;

const PLATFORM_NAMES = {
  tiktok: 'TikTok', instagram: 'Instagram', lemon8: 'Lemon8',
  facebook: 'Facebook', facebookgroups: 'Facebook Groups',
};
if (!platformArg || !PLATFORM_NAMES[platformArg]) {
  console.error('ต้องใส่ --platform=tiktok|instagram|lemon8|facebook|facebookgroups');
  process.exit(1);
}
const platformName = PLATFORM_NAMES[platformArg];

let cookie = null;
if (platformArg === 'instagram') {
  if (!sessionidArg) {
    console.error('Instagram ต้องใส่ --sessionid=<sid> ด้วย (F12 -> Application -> Cookies -> https://www.instagram.com -> sessionid)');
    process.exit(1);
  }
  cookie = { name: 'sessionid', value: decodeURIComponent(sessionidArg.split('=')[1]), domain: '.instagram.com', path: '/' };
}

const client = new pg.Client({ connectionString: env.DIRECT_URL });
await client.connect();

const skipCond = FORCE ? '' : 'AND kp.avatar_url IS NULL';
const { rows } = await client.query(`
  SELECT kp.id, kp.handle, kp.profile_url
  FROM kol_platforms kp JOIN platforms p ON p.id = kp.platform_id
  WHERE p.name = $1 AND kp.profile_url IS NOT NULL ${skipCond}
  ORDER BY kp.handle
`, [platformName]);
const subset = LIMIT ? rows.slice(0, LIMIT) : rows;
console.log(`พบ ${rows.length} ${platformName} ${FORCE ? '(ทั้งหมด)' : '(ยังไม่มีรูป)'} — จะลอง ${subset.length} รายการ`);
if (DRY_RUN) console.log('[DRY RUN] จะไม่อัป DB');
console.log();

const browser = await chromium.launch();
let ok = 0, fail = 0;

for (const row of subset) {
  const page = await browser.newPage();
  if (cookie) await page.context().addCookies([cookie]);
  process.stdout.write(`  ${row.handle.padEnd(32)}`);
  try {
    await page.goto(row.profile_url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => null);
    if (ogImage) {
      console.log('OK');
      if (!DRY_RUN) await client.query('UPDATE kol_platforms SET avatar_url = $1 WHERE id = $2', [ogImage, row.id]);
      ok++;
    } else {
      console.log('FAIL (no og:image -- private/deleted/login-walled?)');
      fail++;
    }
  } catch (e) {
    console.log(`FAIL (${String(e.message).split('\n')[0]})`);
    fail++;
  }
  await page.close();
  await new Promise(r => setTimeout(r, 2000));
}

await browser.close();
console.log();
console.log('-'.repeat(60));
console.log(`OK:   ${ok}`);
console.log(`FAIL: ${fail}`);

await client.end();
