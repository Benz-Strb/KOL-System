# Marketing Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มหน้า Marketing Dashboard (`/marketing`) ที่ฝ่าย marketing เข้าได้ โชว์ KPI (GMV/Cost/Ads/Visit) + GMV-contribution donuts โดยไม่เห็นข้อมูล KOL รายคน และเติม Visits Shopee/Lazada KPI ให้หน้า manager dashboard

**Architecture:** หน้าใหม่แยก (approach A) + endpoint ใหม่ `GET /api/dashboard/marketing` (allow admin/manager/marketing, brand-scoped) ที่ reuse query pattern จาก `buildDashboardOverview`/`buildProductDashboard`. Frontend เป็น page ใหม่ reuse `KpiCard` + donut pattern เดิม

**Tech Stack:** Hono + Prisma 6 (server, Cloudflare Workers) · Vite + React + TS + recharts + react-i18next (client)

## Global Constraints

- ห้ามแก้ Prisma schema ด้วยมือ (DB เป็น source of truth) — งานนี้ไม่ต้องแตะ schema
- Prisma 6 เท่านั้น
- i18n: เพิ่ม key ใน `th.ts` ก่อน → `en.ts`/`zh.ts` ต้องมี key เดียวกัน (`satisfies Translations`); domain terms (GMV, Visits, Shopee, Lazada, SKU, Platform, ROI) คงเป็น English ทุกภาษา
- **ไม่มี unit test framework** — verify ด้วย: client `npx tsc -b` (ห้ามใช้ `tsc --noEmit` เปล่าใน client), server `npx tsc --noEmit`, `npx eslint`, และ Playwright mint-session screenshot (รายละเอียด §Verification ด้านล่าง)
- ห้ามใส่ `Co-Authored-By: Claude` ใน commit
- ห้ามสร้างข้อมูลจริงใน DB ตอน verify; script verify ขึ้นต้น `_verify_` ลบทิ้งหลังจบ
- race condition guard: ทุก debounced/async load ใน frontend ใส่ `seq` ref pattern

---

## Verification helper (ใช้ซ้ำในหลาย task)

มี dev server รันด้วย `npm run dev` (client :5173 proxy `/api` → server :8787). Mint session ด้วย Supabase admin generate_link → verify (ดู CLAUDE.md §9). โครง script:

```js
// _verify_*.mjs — รันจาก project root: node _verify_x.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const env = readFileSync('D:/internship/KOL_management/kol-system/server/.env','utf8');
const get = k => (env.match(new RegExp(`^${k}="?([^"\\n]+)"?`,'m'))||[])[1];
const supabaseUrl = get('SUPABASE_URL'), srk = get('SUPABASE_SERVICE_ROLE_KEY'), ref='hdrweioqqqpslsjizkci';
async function mint(email){
  const h = (await (await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`,{method:'POST',
    headers:{'Content-Type':'application/json',apikey:srk,Authorization:`Bearer ${srk}`},
    body:JSON.stringify({type:'magiclink',email})})).json()).hashed_token;
  const s = await (await fetch(`${supabaseUrl}/auth/v1/verify`,{method:'POST',
    headers:{'Content-Type':'application/json',apikey:srk},
    body:JSON.stringify({type:'magiclink',token_hash:h})})).json();
  return JSON.stringify({access_token:s.access_token,token_type:s.token_type,expires_in:s.expires_in,
    expires_at:s.expires_at,refresh_token:s.refresh_token,user:s.user});
}
async function loginAs(page, email){
  await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
  await page.evaluate(([k,v])=>localStorage.setItem(k,v),[`sb-${ref}-auth-token`, await mint(email)]);
}
// admin email สำหรับ mint: benz.natthawut@shd-technology.co.th
```

---

## Task 1: Backend — marketing endpoint + per-route auth

**Files:**
- Modify: `server/src/routes/dashboard.ts` (line 8 middleware; เพิ่ม `requireRole` ราย route; เพิ่ม `buildMarketingDashboard()` + `app.get('/marketing')`)

**Interfaces:**
- Consumes: `buildDashboardBrandFilter(role, brandIds, brand_id)`, `requireAuth`, `requireRole(...roles)` (มีอยู่แล้วในไฟล์/middleware)
- Produces: `GET /api/dashboard/marketing` → JSON shape:
  ```ts
  type MarketingDashboard = {
    summary: { total_gmv: number; kol_cost: number; ads_cost: number; total_cost: number;
               visits_shopee: number; visits_lazada: number; total_visits: number };
    byPlatform: { platform_id: number; platform_name: string; gmv: number }[];
    byProductCategory: { category_id: number | null; category_name: string | null; gmv: number }[];
    byProductSku: { canonical_id: number; model_code: string | null; gmv: number }[];   // top 8 + {canonical_id:-1, model_code:null}
    byContentCategory: { category_id: number; category_name: string; gmv: number }[];
  };
  ```

- [ ] **Step 1: เปลี่ยน global middleware เป็น requireAuth อย่างเดียว**

แก้ `server/src/routes/dashboard.ts` บรรทัด 8:
```ts
// เดิม
app.use('*', requireAuth, requireRole('admin', 'manager'));
// ใหม่
app.use('*', requireAuth);
```

- [ ] **Step 2: ใส่ requireRole ราย route เดิมทุกตัว (กัน regression)**

เพิ่ม `requireRole('admin', 'manager')` เป็น middleware ตัวแรกในทุก route เดิม:
```ts
app.get('/',                requireRole('admin', 'manager'), async c => { /* ...เดิม... */ });
app.get('/export',          requireRole('admin', 'manager'), async c => { /* ...เดิม... */ });
app.get('/kol/:id',         requireRole('admin', 'manager'), async c => { /* ...เดิม... */ });
app.get('/products',        requireRole('admin', 'manager'), async c => { /* ...เดิม... */ });
app.get('/products/export', requireRole('admin', 'manager'), async c => { /* ...เดิม... */ });
app.get('/products/:id',    requireRole('admin', 'manager'), async c => { /* ...เดิม... */ });
app.get('/offplatform',     requireRole('admin', 'manager'), async c => { /* ...เดิม... */ });
```
(แก้เฉพาะบรรทัด `app.get(...)` — ตัว handler body ไม่เปลี่ยน)

- [ ] **Step 3: เพิ่ม types + EMPTY constant** (วางใกล้ types อื่น เช่นใต้ `type CategoryRow`)

```ts
type MarketingSummary = {
  total_gmv: number; kol_cost: number; ads_cost: number; total_cost: number;
  visits_shopee: number; visits_lazada: number; total_visits: number;
};
type GmvSlice = { platform_id?: number; category_id?: number | null; canonical_id?: number;
  platform_name?: string; category_name?: string | null; model_code?: string | null; gmv: number };

const EMPTY_MARKETING = {
  summary: { total_gmv: 0, kol_cost: 0, ads_cost: 0, total_cost: 0, visits_shopee: 0, visits_lazada: 0, total_visits: 0 },
  byPlatform: [] as { platform_id: number; platform_name: string; gmv: number }[],
  byProductCategory: [] as { category_id: number | null; category_name: string | null; gmv: number }[],
  byProductSku: [] as { canonical_id: number; model_code: string | null; gmv: number }[],
  byContentCategory: [] as { category_id: number; category_name: string; gmv: number }[],
};
```

- [ ] **Step 4: เพิ่ม `buildMarketingDashboard()`** (วางก่อน `app.get('/marketing')` เช่นถัดจาก `buildDashboardOverview`)

```ts
const SKU_TOP_N = 8;

async function buildMarketingDashboard(prisma: PrismaClient, user: AuthUser, query: {
  brand_id?: string; date_from?: string; date_to?: string;
}) {
  const { brand_id, date_from, date_to } = query;
  const brandFilter = buildDashboardBrandFilter(user.role, user.brandIds, brand_id);
  const where = {
    ...brandFilter,
    ...(date_from || date_to ? {
      publication_date: {
        ...(date_from ? { gte: new Date(date_from) } : {}),
        ...(date_to ? { lte: new Date(date_to) } : {}),
      },
    } : {}),
  };

  const matched = await prisma.placements.findMany({
    where, select: { id: true, pay_amount: true, final_price: true, ads_cost: true },
  });
  if (matched.length === 0) return EMPTY_MARKETING;

  const ids = matched.map(p => p.id);
  let kolCost = 0, adsCost = 0;
  for (const p of matched) {
    kolCost += Number(p.pay_amount ?? p.final_price ?? 0);
    adsCost += Number(p.ads_cost ?? 0);
  }

  // GMV total + visits per sales channel
  const channelRows = await prisma.$queryRaw<{ channel: string; gmv: number; visits: number }[]>`
    SELECT channel,
           COALESCE(SUM(gmv::numeric), 0)::float AS gmv,
           COALESCE(SUM(visits), 0)::int          AS visits
    FROM placement_metrics
    WHERE placement_id IN (${Prisma.join(ids)})
    GROUP BY channel
  `;
  let totalGmv = 0, totalVisits = 0, visitsShopee = 0, visitsLazada = 0;
  for (const r of channelRows) {
    totalGmv += r.gmv; totalVisits += r.visits;
    if (r.channel === 'shopee') visitsShopee = r.visits;
    if (r.channel === 'lazada') visitsLazada = r.visits;
  }

  // GMV by KOL posting platform
  const byPlatform = await prisma.$queryRaw<{ platform_id: number; platform_name: string; gmv: number }[]>`
    WITH metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT pt.id::int AS platform_id, pt.name AS platform_name,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv
    FROM placements p
    JOIN platforms pt ON pt.id = p.platform_id
    LEFT JOIN metric_agg ma ON ma.placement_id = p.id
    WHERE p.id IN (${Prisma.join(ids)})
    GROUP BY pt.id, pt.name
    ORDER BY gmv DESC
  `;

  // GMV by KOL content category
  const byContentCategory = await prisma.$queryRaw<{ category_id: number; category_name: string; gmv: number }[]>`
    WITH metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT cc.id::int AS category_id, cc.name AS category_name,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv
    FROM placements p
    JOIN kols k ON k.id = p.kol_id
    JOIN content_categories cc ON cc.id = k.content_category_id
    LEFT JOIN metric_agg ma ON ma.placement_id = p.id
    WHERE p.id IN (${Prisma.join(ids)})
    GROUP BY cc.id, cc.name
    ORDER BY gmv DESC
  `;

  // GMV by product category (canonical resolve — see buildProductDashboard)
  const byProductCategory = await prisma.$queryRaw<{ category_id: number | null; category_name: string | null; gmv: number }[]>`
    WITH resolved AS (
      SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
      FROM placements pl JOIN products pr ON pr.id = pl.product_id
      WHERE pl.id IN (${Prisma.join(ids)})
    ),
    metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT pc.id::int AS category_id, pc.name AS category_name,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv
    FROM resolved r
    JOIN products c ON c.id = r.canonical_id
    LEFT JOIN product_categories pc ON pc.id = c.product_category_id
    LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
    GROUP BY pc.id, pc.name
    ORDER BY gmv DESC
  `;

  // GMV by product SKU (canonical), top 8 + others
  const skuRows = await prisma.$queryRaw<{ canonical_id: number; model_code: string; gmv: number }[]>`
    WITH resolved AS (
      SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
      FROM placements pl JOIN products pr ON pr.id = pl.product_id
      WHERE pl.id IN (${Prisma.join(ids)})
    ),
    metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT c.id::int AS canonical_id, c.model_code,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv
    FROM resolved r
    JOIN products c ON c.id = r.canonical_id
    LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
    GROUP BY c.id, c.model_code
    ORDER BY gmv DESC
  `;
  const top = skuRows.slice(0, SKU_TOP_N).map(r => ({ canonical_id: r.canonical_id, model_code: r.model_code, gmv: r.gmv }));
  const restGmv = skuRows.slice(SKU_TOP_N).reduce((s, r) => s + r.gmv, 0);
  const byProductSku = restGmv > 0
    ? [...top, { canonical_id: -1, model_code: null as string | null, gmv: restGmv }]
    : top;

  return {
    summary: {
      total_gmv: totalGmv, kol_cost: kolCost, ads_cost: adsCost, total_cost: kolCost + adsCost,
      visits_shopee: visitsShopee, visits_lazada: visitsLazada, total_visits: totalVisits,
    },
    byPlatform, byProductCategory, byProductSku, byContentCategory,
  };
}
```

- [ ] **Step 5: เพิ่ม route `GET /marketing`** (allow marketing ด้วย)

```ts
app.get('/marketing', requireRole('admin', 'manager', 'marketing'), async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const result = await buildMarketingDashboard(prisma, user, {
      brand_id: c.req.query('brand_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    });
    return c.json(result);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load marketing dashboard' }, 500);
  }
});
```

- [ ] **Step 6: Type-check server**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0, ไม่มี error

- [ ] **Step 7: Verify auth + shape ด้วย Playwright** (dev server ต้องรันอยู่: `npm run dev`)

สร้าง `_verify_mktg_api.mjs` (project root) — ใช้ helper §Verification + logic: mint admin → `GET /api/admin/users` หา user role `marketing` → mint marketing → assert.
```js
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
/* ...helper mint()/loginAs() จาก §Verification... */
const browser = await chromium.launch(); const page = await browser.newPage();
await loginAs(page, 'benz.natthawut@shd-technology.co.th');
// admin: marketing endpoint ใช้ได้
const adminTok = JSON.parse(await page.evaluate(()=>localStorage.getItem(`sb-${'hdrweioqqqpslsjizkci'}-auth-token`))).access_token;
const r1 = await page.request.get('http://localhost:8787/api/dashboard/marketing', { headers:{ Authorization:`Bearer ${adminTok}` }});
console.log('admin /marketing:', r1.status()); // 200
console.log('shape keys:', Object.keys(await r1.json()));
// หา marketing user
const users = await (await page.request.get('http://localhost:8787/api/admin/users',{headers:{Authorization:`Bearer ${adminTok}`}})).json();
const mk = (Array.isArray(users)?users:users.users||[]).find(u=>u.role==='marketing');
console.log('marketing user:', mk?.email ?? 'NONE');
if (mk?.email){
  await loginAs(page, mk.email);
  const mkTok = JSON.parse(await page.evaluate(()=>localStorage.getItem(`sb-${'hdrweioqqqpslsjizkci'}-auth-token`))).access_token;
  const a = await page.request.get('http://localhost:8787/api/dashboard/marketing',{headers:{Authorization:`Bearer ${mkTok}`}});
  const b = await page.request.get('http://localhost:8787/api/dashboard',{headers:{Authorization:`Bearer ${mkTok}`}});
  console.log('marketing /marketing:', a.status(), '(expect 200)');
  console.log('marketing /dashboard:', b.status(), '(expect 403)');
}
await browser.close();
```
Run: `node _verify_mktg_api.mjs`
Expected: `admin /marketing: 200` · shape keys = `[summary, byPlatform, byProductCategory, byProductSku, byContentCategory]` · `marketing /marketing: 200` · `marketing /dashboard: 403`
ลบไฟล์: `rm -f _verify_mktg_api.mjs`

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/dashboard.ts
git commit -m "Add GET /api/dashboard/marketing endpoint with per-route role auth"
```

---

## Task 2: API client — type + fetcher

**Files:**
- Modify: `client/src/api/index.ts` (เพิ่มท้ายกลุ่ม dashboard types/fetchers)

**Interfaces:**
- Consumes: helper `api<T>(url)` เดิม
- Produces: `MarketingDashboard` type, `getMarketingDashboard(params)` → `Promise<MarketingDashboard>`

- [ ] **Step 1: เพิ่ม type + fetcher**

```ts
export type MarketingSummary = {
  total_gmv: number; kol_cost: number; ads_cost: number; total_cost: number;
  visits_shopee: number; visits_lazada: number; total_visits: number;
};
export type MarketingDashboard = {
  summary: MarketingSummary;
  byPlatform: { platform_id: number; platform_name: string; gmv: number }[];
  byProductCategory: { category_id: number | null; category_name: string | null; gmv: number }[];
  byProductSku: { canonical_id: number; model_code: string | null; gmv: number }[];
  byContentCategory: { category_id: number; category_name: string; gmv: number }[];
};

export const getMarketingDashboard = (params: { brand_id?: string; date_from?: string; date_to?: string }) => {
  const p = new URLSearchParams();
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.date_from) p.set('date_from', params.date_from);
  if (params.date_to) p.set('date_to', params.date_to);
  return api<MarketingDashboard>(`/api/dashboard/marketing?${p}`);
};
```

- [ ] **Step 2: Type-check client**

Run: `cd client && npx tsc -b`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/api/index.ts
git commit -m "Add marketing dashboard API type and fetcher"
```

---

## Task 3: i18n keys (marketing namespace + dashboard visits + nav)

**Files:**
- Modify: `client/src/i18n/locales/th.ts`, `en.ts`, `zh.ts`

**Interfaces:**
- Produces keys: `marketing.*`, `dashboard.visitsShopee`, `dashboard.visitsLazada`, `dashboard.othersLabel`, `nav.marketingDashboard`

- [ ] **Step 1: เพิ่มใน th.ts** — ใน `dashboard` namespace เพิ่ม:
```ts
    visitsShopee: 'Visits Shopee',
    visitsLazada: 'Visits Lazada',
    othersLabel: 'อื่นๆ',
```
เพิ่ม namespace ใหม่ `marketing` (วางถัดจาก `dashboard` namespace):
```ts
  marketing: {
    title: 'Dashboard การตลาด',
    subtitle: 'ภาพรวมยอดขายและสัดส่วน GMV สำหรับฝ่ายการตลาด',
    totalCost: 'ค่าใช้จ่ายรวม',
    gmvByPlatform: 'สัดส่วน GMV ตาม Platform',
    gmvByProductCategory: 'สัดส่วน GMV ตามหมวดสินค้า',
    gmvByProductSku: 'สัดส่วน GMV ตามรุ่นสินค้า (SKU)',
    gmvByContentCategory: 'สัดส่วน GMV ตามหมวดคอนเทนต์',
  },
```
เพิ่มใน `nav` namespace: `marketingDashboard: 'Dashboard การตลาด',`

- [ ] **Step 2: เพิ่ม key เดียวกันใน en.ts**
```ts
// dashboard:
    visitsShopee: 'Visits Shopee',
    visitsLazada: 'Visits Lazada',
    othersLabel: 'Others',
// marketing namespace:
  marketing: {
    title: 'Marketing Dashboard',
    subtitle: 'Sales overview and GMV contribution for the marketing team',
    totalCost: 'Total Cost',
    gmvByPlatform: 'GMV Contribution by Platform',
    gmvByProductCategory: 'GMV Contribution by Product Category',
    gmvByProductSku: 'GMV Contribution by Product SKU',
    gmvByContentCategory: 'GMV Contribution by Content Category',
  },
// nav:
    marketingDashboard: 'Marketing Dashboard',
```

- [ ] **Step 3: เพิ่ม key เดียวกันใน zh.ts**
```ts
// dashboard:
    visitsShopee: 'Visits Shopee',
    visitsLazada: 'Visits Lazada',
    othersLabel: '其他',
// marketing namespace:
  marketing: {
    title: '营销仪表板',
    subtitle: '面向营销团队的销售概览与 GMV 占比',
    totalCost: '总成本',
    gmvByPlatform: '各 Platform 的 GMV 占比',
    gmvByProductCategory: '各产品类别的 GMV 占比',
    gmvByProductSku: '各产品 SKU 的 GMV 占比',
    gmvByContentCategory: '各内容分类的 GMV 占比',
  },
// nav:
    marketingDashboard: '营销仪表板',
```

- [ ] **Step 4: Type-check client** (`satisfies Translations` จับ key หาย/เกิน)

Run: `cd client && npx tsc -b`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n/locales/th.ts client/src/i18n/locales/en.ts client/src/i18n/locales/zh.ts
git commit -m "Add i18n keys for marketing dashboard and visits KPIs"
```

---

## Task 4: MarketingDashboardPage + route + nav + redirect

**Files:**
- Create: `client/src/pages/MarketingDashboardPage.tsx`
- Modify: `client/src/App.tsx` (route, nav link, `homePathFor`, imports)

**Interfaces:**
- Consumes: `getMarketingDashboard`, `MarketingDashboard` (Task 2); i18n keys (Task 3); `getDropdowns` (สำหรับ brand list)
- Produces: default export `MarketingDashboardPage`

- [ ] **Step 1: สร้าง `client/src/pages/MarketingDashboardPage.tsx`**

```tsx
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Wallet, Megaphone, Coins, MousePointerClick } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { getMarketingDashboard, getDropdowns, type MarketingDashboard, type Brand } from '../api/index.js';
import Select from '../components/Select.js';
import { getCached, setCached } from '../lib/swrCache.js';
import { numberLocale } from '../i18n/locale.js';

const DONUT_COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#111827', '#ef4444', '#10b981', '#eab308', '#ec4899', '#06b6d4'];

function formatMoney(n: number) { return '฿' + Math.round(n).toLocaleString(numberLocale()); }

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-hairline rounded-xl p-4 flex flex-col gap-2 hover:border-accent/30 transition-colors duration-200">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-accent/10 text-accent shrink-0">{icon}</span>
        <span className="text-[11px] font-medium text-muted leading-tight">{label}</span>
      </div>
      <div className="text-2xl font-bold text-ink tabular-nums font-mono leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function ContributionDonut({ title, rows }: { title: string; rows: { key: string; label: string; gmv: number }[] }) {
  const { t } = useTranslation();
  const data = rows.filter(r => r.gmv > 0);
  const total = data.reduce((s, r) => s + r.gmv, 0);
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <h2 className="text-sm font-semibold text-ink mb-4">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          <div className="w-40 h-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 160 }}>
              <PieChart>
                <Pie data={data} dataKey="gmv" nameKey="label" innerRadius="60%" outerRadius="95%" paddingAngle={2} stroke="none" animationDuration={500}>
                  {data.map((r, i) => <Cell key={r.key} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                  formatter={(v, n) => [formatMoney(Number(v ?? 0)), String(n)]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
            {data.map((r, i) => {
              const pct = total > 0 ? ((r.gmv / total) * 100).toFixed(1) : '0.0';
              return (
                <div key={r.key} className="flex items-center gap-2.5 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="font-medium text-ink truncate flex-1 min-w-0">{r.label}</span>
                  <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                  <span className="w-12 text-right text-muted tabular-nums shrink-0">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const selectCls = ['px-3 py-1.5 rounded-lg text-sm transition-colors', 'bg-input-bg border border-input-border text-ink',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/40'].join(' ');

export default function MarketingDashboardPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<MarketingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => { getDropdowns().then(d => setBrands(d.brands)); }, []);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = { brand_id: brandId, date_from: dateFrom, date_to: dateTo };
    const cacheKey = `marketing:${JSON.stringify(params)}`;
    const cached = getCached<MarketingDashboard>(cacheKey);
    if (cached) { setData(cached); setLoading(false); } else { setLoading(true); }
    try {
      const res = await getMarketingDashboard(params);
      if (loadSeq.current !== seq) return;
      setCached(cacheKey, res); setData(res);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [brandId, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const skuLabel = (canonical_id: number, model_code: string | null) =>
    canonical_id === -1 ? t('dashboard.othersLabel') : (model_code ?? '—');

  const platformRows = useMemo(() => (data?.byPlatform ?? []).map(r => ({ key: `p${r.platform_id}`, label: r.platform_name, gmv: r.gmv })), [data]);
  const productCatRows = useMemo(() => (data?.byProductCategory ?? []).map(r => ({ key: `pc${r.category_id ?? 'none'}`, label: r.category_name ?? t('dashboard.othersLabel'), gmv: r.gmv })), [data, t]);
  const skuRows = useMemo(() => (data?.byProductSku ?? []).map(r => ({ key: `s${r.canonical_id}`, label: skuLabel(r.canonical_id, r.model_code), gmv: r.gmv })), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const contentCatRows = useMemo(() => (data?.byContentCategory ?? []).map(r => ({ key: `cc${r.category_id}`, label: r.category_name, gmv: r.gmv })), [data]);

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-screen-xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink tracking-tight">{t('marketing.title')}</h1>
        <p className="text-sm text-muted mt-0.5">{t('marketing.subtitle')}</p>
      </div>

      {/* Filters */}
      <div className="bg-surface border border-hairline rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Brand</span>
          <Select size="sm" className="min-w-[140px]"
            options={[{ id: '', label: t('common.allBrands') }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
            value={brandId} onChange={setBrandId} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">{t('dashboard.dateRange')}</span>
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} className={selectCls} />
            <span className="text-xs text-muted">–</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} className={selectCls} />
          </div>
        </div>
      </div>

      {loading || !data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface border border-hairline rounded-xl p-4 h-[92px] animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-hairline rounded-xl p-5 h-56 animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard icon={<TrendingUp size={13} />} label={t('dashboard.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
            <KpiCard icon={<Coins size={13} />} label={t('marketing.totalCost')} value={formatMoney(data.summary.total_cost)} />
            <KpiCard icon={<Wallet size={13} />} label={t('dashboard.kolSpend')} value={formatMoney(data.summary.kol_cost)} />
            <KpiCard icon={<Megaphone size={13} />} label="Ads Cost" value={formatMoney(data.summary.ads_cost)} />
            <KpiCard icon={<MousePointerClick size={13} />} label={t('dashboard.visitsShopee')} value={data.summary.visits_shopee.toLocaleString(numberLocale())} />
            <KpiCard icon={<MousePointerClick size={13} />} label={t('dashboard.visitsLazada')} value={data.summary.visits_lazada.toLocaleString(numberLocale())} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ContributionDonut title={t('marketing.gmvByPlatform')} rows={platformRows} />
            <ContributionDonut title={t('marketing.gmvByProductCategory')} rows={productCatRows} />
            <ContributionDonut title={t('marketing.gmvByProductSku')} rows={skuRows} />
            <ContributionDonut title={t('marketing.gmvByContentCategory')} rows={contentCatRows} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: เพิ่ม import + route ใน `App.tsx`**

App.tsx ใช้ import ตรง (ไม่ lazy) และห่อ page ด้วย `<Layout>`. เพิ่ม import ใกล้ import page อื่น:
```ts
import MarketingDashboardPage from './pages/MarketingDashboardPage';
```
เพิ่ม route ถัดจาก `/dashboard/products` — **ไม่ใส่ role guard** (ทุก role login เข้าได้; endpoint คุมสิทธิ์ข้อมูล marketing/manager/admin อยู่แล้ว):
```tsx
<Route path="/marketing" element={
  <ProtectedRoute>
    <Layout><MarketingDashboardPage /></Layout>
  </ProtectedRoute>
} />
```
> เทียบกับ `/dashboard` ที่มี `<RequireManagerOrAdmin>` — route `/marketing` **ไม่ต้องมี** เพราะ marketing ต้องเข้าได้

- [ ] **Step 3: แก้ `homePathFor` ให้ marketing → /marketing**

ใน `App.tsx` (ฟังก์ชัน `homePathFor`):
```ts
function homePathFor(role: string) {
  if (role === 'admin' || role === 'manager') return '/dashboard';
  if (role === 'marketing') return '/marketing';
  return '/placements';
}
```

- [ ] **Step 4: เพิ่ม nav link "Marketing Dashboard" (เห็นได้ทุก role)**

ใน `<nav>` ของ App.tsx เพิ่ม NavLink top-level (เช่นถัดจาก section Dashboard เดิม / ก่อน admin users). เพิ่ม import icon `PieChart` จาก lucide-react:
```tsx
<NavLink to="/marketing" className={navLinkCls}>
  <PieChart size={15} />
  {t('nav.marketingDashboard')}
</NavLink>
```

- [ ] **Step 5: Type-check + lint**

Run: `cd client && npx tsc -b && npx eslint src/pages/MarketingDashboardPage.tsx src/App.tsx`
Expected: tsc exit 0; eslint ไม่มี error ใหม่ (warning `react-hooks/exhaustive-deps` ที่ suppress ไว้โอเค)

- [ ] **Step 6: Verify หน้า marketing ด้วย Playwright screenshot**

สร้าง `_verify_mktg_page.mjs` (ใช้ helper §Verification): login admin → ไป `/marketing` → screenshot fullPage → log console errors.
```js
/* ...helper... */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{ width:1440, height:1800 }});
const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
await loginAs(page,'benz.natthawut@shd-technology.co.th');
await page.goto('http://localhost:5173/marketing',{waitUntil:'networkidle'});
await page.waitForTimeout(3000);
for (const lbl of ['Visits Shopee','Visits Lazada','GMV Contribution by Platform'.length?'สัดส่วน GMV ตาม Platform':'']) {
  if(lbl) console.log(`"${lbl}":`, await page.locator(`text=${lbl}`).count()?'FOUND':'missing');
}
await page.screenshot({ path:'D:/internship/KOL_management/kol-system/_mktg.png', fullPage:true });
console.log(errors.length?'ERRORS:\n'+errors.slice(0,10).join('\n'):'no console errors');
await browser.close();
```
Run: `node _verify_mktg_page.mjs` → เปิด `_mktg.png` ดูจริง (KPI 6 ใบ + donut 4 ใบ render, ไม่มี console error)
ลบ: `rm -f _verify_mktg_page.mjs _mktg.png`

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/MarketingDashboardPage.tsx client/src/App.tsx
git commit -m "Add Marketing Dashboard page, route, nav link, and marketing login redirect"
```

---

## Task 5: Manager dashboard — Visits Shopee/Lazada KPIs

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx` (totals KPI grid + skeleton)

**Interfaces:**
- Consumes: `data.channelBreakdown` (มี `visits` ต่อ channel อยู่แล้ว — ไม่แก้ backend)

- [ ] **Step 1: คำนวณ visits ต่อ channel** — ใน `DashboardPage` หลังบรรทัดที่มี `data` พร้อมใช้ (เช่นใกล้ `kolMap` useMemo) เพิ่ม:
```ts
const visitsShopee = useMemo(() => data?.channelBreakdown.find(c => c.channel === 'shopee')?.visits ?? 0, [data]);
const visitsLazada = useMemo(() => data?.channelBreakdown.find(c => c.channel === 'lazada')?.visits ?? 0, [data]);
```

- [ ] **Step 2: เพิ่ม 2 KPI cards ในแถว Totals + ขยาย grid เป็น 7 คอลัมน์**

หา grid totals เดิม `<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">` แล้วเปลี่ยนเป็น `lg:grid-cols-7`, และเพิ่ม 2 card ต่อท้าย Ads Cost card:
```tsx
<KpiCard icon={<Megaphone size={13} />} label="Ads Cost" value={formatMoney(data.summary.total_ads_cost)} />
<KpiCard icon={<MousePointerClick size={13} />} label={t('dashboard.visitsShopee')} value={visitsShopee.toLocaleString(numberLocale())} />
<KpiCard icon={<MousePointerClick size={13} />} label={t('dashboard.visitsLazada')} value={visitsLazada.toLocaleString(numberLocale())} />
```
เพิ่ม import `MousePointerClick` ใน lucide-react import ของไฟล์นี้

- [ ] **Step 3: อัป skeleton totals (5 → 7)**

หา skeleton `<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">` (ใน loading branch) เปลี่ยนเป็น `lg:grid-cols-7` และ `Array.from({ length: 5 })` → `{ length: 7 }`

- [ ] **Step 4: Type-check + lint**

Run: `cd client && npx tsc -b && npx eslint src/pages/DashboardPage.tsx`
Expected: tsc exit 0; eslint ไม่มี error ใหม่

- [ ] **Step 5: Verify manager dashboard screenshot**

สร้าง `_verify_mgr.mjs`: login admin → `/dashboard` → รอ → screenshot clip KPI area → assert `Visits Shopee`/`Visits Lazada` FOUND, no console errors. ลบไฟล์หลังจบ.
Run: `node _verify_mgr.mjs` → ดู `_mgr.png` ว่ามี Visits Shopee/Lazada ในแถว KPI · `rm -f _verify_mgr.mjs _mgr.png`

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "Add Visits Shopee/Lazada KPIs to manager dashboard"
```

---

## Task 6: Final end-to-end verification

**Files:** ไม่มี (verify อย่างเดียว)

- [ ] **Step 1: Full type-check ทั้ง 2 ฝั่ง**

Run: `cd client && npx tsc -b && cd ../server && npx tsc --noEmit`
Expected: ทั้งคู่ exit 0

- [ ] **Step 2: Lint ทั้งโปรเจกต์ (เฉพาะไฟล์ที่แตะ)**

Run: `cd client && npx eslint src/pages/MarketingDashboardPage.tsx src/pages/DashboardPage.tsx src/App.tsx src/api/index.ts`
Expected: ไม่มี error (warning เดิมที่ไม่เกี่ยวยอมรับได้)

- [ ] **Step 3: E2E verify ด้วย marketing-role จริง** (ใช้ logic Task 1 Step 7 หา marketing user)

สร้าง `_verify_e2e.mjs`: mint marketing user → `/marketing` screenshot (เห็นหน้า), ลอง goto `/dashboard` ต้องถูก redirect ออก (ProtectedRoute/role) หรือ API 403 → ยืนยัน marketing เห็นเฉพาะหน้าตัวเอง. ลบไฟล์หลังจบ.
Expected: marketing เปิด `/marketing` ได้, ไม่เห็นข้อมูล KOL ranking, `/api/dashboard` คืน 403

- [ ] **Step 4: ยืนยัน git สะอาด ไม่มีไฟล์ _verify_ / *.png หลงเหลือ**

Run: `git status --short`
Expected: ไม่มีไฟล์ `_verify_*` หรือ `_*.png` ค้าง

---

## Self-Review notes (ผู้เขียน plan ตรวจแล้ว)

- **Spec coverage:** §3 endpoint → Task 1 · §4 page/nav/redirect → Task 4 · §4 API client → Task 2 · §5 manager visits → Task 5 · i18n → Task 3 · auth regression → Task 1 Step 7 + Task 6 ✓
- **by Type donut:** ข้ามตาม spec (ไม่มี task) ✓
- **Type consistency:** `MarketingDashboard` shape ตรงกันระหว่าง Task 1 (response) / Task 2 (client type) / Task 4 (ใช้งาน); `othersLabel` ใช้ key เดียวใน Task 3/4 ✓
- **No placeholders:** code ครบทุก step (ยกเว้นจุดที่ต้อง "ดู pattern เดิมใน App.tsx" สำหรับ route wrapper — เพราะ wrapper component ของ route ต้อง match ของจริง ระบุให้ทำตาม `/dashboard` route)
