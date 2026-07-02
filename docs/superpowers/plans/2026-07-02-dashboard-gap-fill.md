# Dashboard Gap-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เติมเมตริก Cost/Visit เข้ากราฟ dashboard ที่มีอยู่แล้ว, ลบ backend query ที่ซ้ำซ้อน/ตาย, สร้าง ranking badge ใหม่ (ribbon ทอง/เงิน/ทองแดง) ใช้ร่วมกันทั้ง KOL Ranking และ Product Ranking, อัปเกรด Product Ranking ให้สลับเกณฑ์เรียงได้ 4 แบบในการ์ดเดียว

**Architecture:** งานส่วนใหญ่คือ "ขยาย SQL query ที่มีอยู่แล้วให้ SELECT เพิ่มอีก 1-2 คอลัมน์" (ไม่สร้าง endpoint ใหม่) แล้วขยาย TypeScript type ทั้งฝั่ง server/client ให้ตรงกัน จากนั้นแก้ widget component ให้โชว์คอลัมน์ที่เพิ่มมา งานฝั่ง UI ใหม่จริงมีแค่ `RankBadge` component เล็กๆ 1 ตัว

**Tech Stack:** Hono + Prisma 6 (`$queryRaw` สำหรับ query ซับซ้อน) ฝั่ง server, React + TypeScript + Tailwind + recharts ฝั่ง client, ทั้งคู่อยู่ใน `server/src/routes/dashboard.ts` และ `client/src/pages/DashboardPage.tsx`

## Global Constraints

- นิยาม **"Cost"** ทุกจุดในแผนนี้ = `COALESCE(pay_amount, final_price, 0)` (KOL spend) + `COALESCE(ads_cost, 0)` (Ads Cost) รวมกัน — ห้ามใช้แค่ตัวใดตัวหนึ่ง
- **ห้ามเขียน schema.prisma มือ** — งานนี้ไม่แตะ schema เลย (ใช้ column ที่มีอยู่แล้วทั้งหมด: `ads_cost`, `visits`, `pay_amount`, `final_price`)
- **ห้ามสร้าง endpoint ใหม่** — ทุก field ใหม่ต้องเพิ่มเข้า query ที่มีอยู่แล้วในไฟล์ `server/src/routes/dashboard.ts`
- **i18n**: เพิ่ม key ใหม่ใน `client/src/i18n/locales/th.ts` ก่อนเสมอ → TypeScript จะ error ถ้า `en.ts`/`zh.ts` ไม่มี key เดียวกัน (`satisfies Translations`) — ต้องเติมให้ครบทั้ง 3 ไฟล์ทุกครั้งที่เพิ่ม key
- **ไม่มี unit test framework ในโปรเจกต์นี้** (เช็คแล้ว: ไม่มี jest/vitest, ไม่มีไฟล์ `.test.ts`/`.spec.ts` เลย) — งานนี้ใช้วิธี verify แบบที่โปรเจกต์นี้ใช้จริงเสมอ: รัน dev server จริง (`npx wrangler dev` ที่ `server/`, `npx vite` ที่ `client/`) แล้วยิง `fetch`/`curl` ไปที่ endpoint เทียบผลกับ SQL query ตรงจาก DB จริง (ผ่าน `node -e "..."` ใช้ `pg` client อ่าน `server/.env` เอา `DATABASE_URL`) แทนขั้นตอน "write failing test" แบบเดิม ทุก task ที่แก้ backend จะมี "Manual verify" step แทน unit test step
- `npx tsc -b` (ห้าม `tsc --noEmit` เปล่าๆ ที่ client — เช็ค 0 ไฟล์เสมอ) ต้องผ่านทั้ง `server/` และ `client/` ก่อน commit ทุก task
- Session ก่อนหน้ามี dev server รันอยู่แล้วที่ port `8787` (server, wrangler) และ `5173` (client, vite) — **ห้ามฆ่า process เหล่านี้โดยไม่เช็คก่อนว่าเป็นของ user เอง** ถ้าต้อง restart server เพื่อให้ code เปลี่ยนมีผล ให้เช็ค `netstat -ano | grep LISTENING` ก่อน

---

## File Structure

**Backend — `server/src/routes/dashboard.ts`** (ไฟล์เดียว, แก้ 3 ฟังก์ชัน):
- `buildDashboardOverview()` — เพิ่ม visits ใน campaignTrend, cost ใน platformBreakdown, cost+visits ใน categoryBreakdown, kol_count ใน summary
- `buildProductDashboard()` — เพิ่ม ads_cost+visits ใน ranking query
- `buildMarketingDashboard()` — ลบ byPlatform/byContentCategory, เพิ่ม cost(+visits ใน category) ใน byProductCategory/byProductSku

**Frontend types — `client/src/api/index.ts`**: ขยาย type ให้ตรงกับ backend ใหม่ (ไม่มี query/endpoint ใหม่ แค่ field เพิ่ม)

**Frontend UI — `client/src/pages/DashboardPage.tsx`**: แก้ widget ที่มีอยู่แล้วทั้งหมด (ไม่สร้าง component ใหม่ยกเว้น RankBadge)

**Component ใหม่ 1 ตัว — `client/src/components/RankBadge.tsx`**: รับ `rank: number` render ribbon ทอง/เงิน/ทองแดง (1-3) หรือป้ายเทา (4+) — ใช้แทน `<span>{rank}</span>` เดิมทั้งใน `KolRankRow` (KOL Ranking) และแถว Product Ranking โดยตรง (ไม่ผ่าน wrapper component ใหญ่ เพราะทั้งสอง widget มี layout/interaction ต่างกันมาก — ดูเหตุผลใน Task 8/10)

**i18n — `client/src/i18n/locales/{th,en,zh}.ts`**: เพิ่ม key ใหม่ในทุก task ที่มี label ใหม่

---

### Task 1: Backend — `buildDashboardOverview()`: visits ใน campaign, cost ใน platform, cost+visits ใน category, kol_count ใน summary

**Files:**
- Modify: `server/src/routes/dashboard.ts:17-45` (EMPTY_RESPONSE), `:90-106` (MonthlyTrendRow/CategoryRow types), `:217-241` (matched query + summary loop), `:395-434` (platformAgg query), `:502-513` (campaignTrend query), `:562-588` (categoryBreakdown query)

**Interfaces:**
- Produces: `campaignTrend[].visits: number`, `platformBreakdown[].total_ads_cost: number` + `total_cost: number`, `categoryBreakdown[].total_ads_cost: number` + `total_cost: number` + `visits: number`, `summary.total_kol_count: number` — ทุกตัวถูกใช้โดย Task 4 (widen client types) และ Task 5/6 (UI)

- [ ] **Step 1: เพิ่ม `kol_id` เข้า `matched` query เพื่อใช้นับ Total KOL**

เปิด `server/src/routes/dashboard.ts` หา (บรรทัด ~220):

```ts
    const matched = await prisma.placements.findMany({
      where,
      select: { id: true, final_price: true, pay_amount: true, ads_cost: true, status: true },
    });
```

แก้เป็น:

```ts
    const matched = await prisma.placements.findMany({
      where,
      select: { id: true, final_price: true, pay_amount: true, ads_cost: true, status: true, kol_id: true },
    });
```

- [ ] **Step 2: เพิ่มการนับ `total_kol_count` ใน summary loop**

หา (บรรทัด ~232-240):

```ts
    let totalSpend = 0;
    let totalAdsCost = 0;
    let postedCount = 0;
    let plannedCount = 0;
    let cancelledCount = 0;
    for (const p of matched) {
      totalSpend += Number(p.pay_amount ?? p.final_price ?? 0);
      totalAdsCost += Number(p.ads_cost ?? 0);
      if (p.status === 'posted') postedCount++;
      else if (p.status === 'planned') plannedCount++;
      else if (p.status === 'cancelled') cancelledCount++;
    }
```

แก้เป็น (เพิ่ม `kolIds` set + เก็บ count):

```ts
    let totalSpend = 0;
    let totalAdsCost = 0;
    let postedCount = 0;
    let plannedCount = 0;
    let cancelledCount = 0;
    const kolIds = new Set<number>();
    for (const p of matched) {
      totalSpend += Number(p.pay_amount ?? p.final_price ?? 0);
      totalAdsCost += Number(p.ads_cost ?? 0);
      if (p.status === 'posted') postedCount++;
      else if (p.status === 'planned') plannedCount++;
      else if (p.status === 'cancelled') cancelledCount++;
      if (p.kol_id != null) kolIds.add(p.kol_id);
    }
    const totalKolCount = kolIds.size;
```

- [ ] **Step 3: หา return statement ของ summary แล้วเพิ่ม `total_kol_count`**

ท้ายฟังก์ชัน `buildDashboardOverview` จะมี `return { summary: { total_placements: matched.length, ... }, ... }` — หาบรรทัดที่ประกาศ `total_placements: matched.length,` (ใกล้ท้ายฟังก์ชัน) แล้วเพิ่ม `total_kol_count: totalKolCount,` ต่อท้ายบรรทัดนั้นในอ็อบเจกต์เดียวกัน

- [ ] **Step 4: เพิ่ม `total_kol_count: 0` ใน `EMPTY_RESPONSE.summary`**

หา (บรรทัด ~18-29):

```ts
const EMPTY_RESPONSE = {
  summary: {
    total_placements: 0,
    posted_count: 0,
    planned_count: 0,
    cancelled_count: 0,
    total_spend: 0,
    total_ads_cost: 0,
    total_gmv: 0,
    total_orders: 0,
    total_visits: 0,
    total_atc: 0,
    roi: null as number | null,
  },
```

แก้เป็น (เพิ่ม `total_kol_count: 0,` หลัง `total_placements: 0,`):

```ts
const EMPTY_RESPONSE = {
  summary: {
    total_placements: 0,
    total_kol_count: 0,
    posted_count: 0,
    planned_count: 0,
    cancelled_count: 0,
    total_spend: 0,
    total_ads_cost: 0,
    total_gmv: 0,
    total_orders: 0,
    total_visits: 0,
    total_atc: 0,
    roi: null as number | null,
  },
```

- [ ] **Step 5: เพิ่ม `visits` เข้า `campaignTrend` query**

หา (บรรทัด ~502-513):

```ts
    const campaignTrend = await prisma.$queryRaw<{
      campaign_id: number | null;
      code: string | null;
      label: string | null;
      start_date: string | null;
      placement_count: number;
      gmv: number;
      spend: number;
      orders: number;
    }[]>`
      SELECT
        c.id                                                       AS campaign_id,
        c.code,
        c.label,
        c.start_date,
        COUNT(DISTINCT p.id)::int                                  AS placement_count,
        COALESCE(SUM(pm.gmv::numeric), 0)::float                   AS gmv,
        COALESCE(SUM(COALESCE(p.pay_amount, p.final_price, 0)), 0)::float AS spend,
        COALESCE(SUM(pm.orders), 0)::int                           AS orders
      FROM placements p
      LEFT JOIN campaigns c ON p.campaign_id = c.id
      LEFT JOIN (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      ) pm ON pm.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY c.id, c.code, c.label, c.start_date
```

แก้เป็น (เพิ่ม `visits` ใน type, subquery, และ SELECT):

```ts
    const campaignTrend = await prisma.$queryRaw<{
      campaign_id: number | null;
      code: string | null;
      label: string | null;
      start_date: string | null;
      placement_count: number;
      gmv: number;
      spend: number;
      orders: number;
      visits: number;
    }[]>`
      SELECT
        c.id                                                       AS campaign_id,
        c.code,
        c.label,
        c.start_date,
        COUNT(DISTINCT p.id)::int                                  AS placement_count,
        COALESCE(SUM(pm.gmv::numeric), 0)::float                   AS gmv,
        COALESCE(SUM(COALESCE(p.pay_amount, p.final_price, 0)), 0)::float AS spend,
        COALESCE(SUM(pm.orders), 0)::int                           AS orders,
        COALESCE(SUM(pm.visits), 0)::int                           AS visits
      FROM placements p
      LEFT JOIN campaigns c ON p.campaign_id = c.id
      LEFT JOIN (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders, SUM(visits) AS visits
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      ) pm ON pm.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY c.id, c.code, c.label, c.start_date
```

(บรรทัดหลังจากนี้ `ORDER BY` เดิมไม่ต้องแก้)

ในไฟล์เดียวกัน หา `EMPTY_RESPONSE.campaignTrend` ที่ประกาศ type array ว่าง (บรรทัด ~40-49) เพิ่ม `visits: number;` เข้า inline type นั้นด้วยแบบเดียวกัน

- [ ] **Step 6: เพิ่ม ads_cost/total_cost เข้า `platformAgg` query**

หา (บรรทัด ~395-434, CTE `placement_spend` กับ SELECT ของ platformAgg):

```ts
      WITH placement_spend AS (
        SELECT id, COALESCE(pay_amount, final_price, 0)::numeric AS spend
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        pt.id::int                                  AS platform_id,
        pt.name                                     AS platform_name,
        COUNT(DISTINCT p.id)::int                   AS placement_count,
        COUNT(DISTINCT p.kol_id)::int               AS kol_count,
        COALESCE(SUM(ma.gmv), 0)::float             AS total_gmv,
        COALESCE(SUM(ma.orders), 0)::int            AS total_orders,
        COALESCE(SUM(ps.spend), 0)::float           AS total_spend
      FROM placements p
      JOIN platforms pt ON pt.id = p.platform_id
      LEFT JOIN placement_spend ps ON ps.id = p.id
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY pt.id, pt.name
      ORDER BY placement_count DESC
    `;
    const platformBreakdown: PlatformRow[] = platformAgg;
```

**หมายเหตุ**: ตรง `WITH placement_spend AS (...)` ตัวนี้เป็น local CTE เฉพาะ query นี้ (คนละตัวกับ query อื่นที่ชื่อซ้ำกัน — Postgres/Prisma แต่ละ query แยก scope กันเอง ไม่ชนกัน) แก้เป็น:

```ts
      WITH placement_spend AS (
        SELECT id,
               COALESCE(pay_amount, final_price, 0)::numeric AS spend,
               COALESCE(ads_cost, 0)::numeric                AS ads_cost
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        pt.id::int                                  AS platform_id,
        pt.name                                     AS platform_name,
        COUNT(DISTINCT p.id)::int                   AS placement_count,
        COUNT(DISTINCT p.kol_id)::int               AS kol_count,
        COALESCE(SUM(ma.gmv), 0)::float             AS total_gmv,
        COALESCE(SUM(ma.orders), 0)::int            AS total_orders,
        COALESCE(SUM(ps.spend), 0)::float           AS total_spend,
        COALESCE(SUM(ps.ads_cost), 0)::float        AS total_ads_cost
      FROM placements p
      JOIN platforms pt ON pt.id = p.platform_id
      LEFT JOIN placement_spend ps ON ps.id = p.id
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY pt.id, pt.name
      ORDER BY placement_count DESC
    `;
    const platformBreakdown: PlatformRow[] = platformAgg;
```

หา type `PlatformRow` ที่ประกาศไว้ (ค้นด้วย `type PlatformRow`) เพิ่ม `total_ads_cost: number;` เข้า type นั้น และเพิ่ม field `total_spend: number` ที่ query ประกาศไว้แล้วต้องตรวจว่า type มีครบ (ควรมีอยู่แล้วจากของเดิม)

- [ ] **Step 7: เพิ่ม ads_cost/visits เข้า `categoryBreakdown` query**

หา (บรรทัด ~562-588):

```ts
    const categoryBreakdown = await prisma.$queryRaw<CategoryRow[]>`
      WITH placement_spend AS (
        SELECT id, COALESCE(pay_amount, final_price, 0)::numeric AS spend
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        cc.id::int                              AS category_id,
        cc.name                                 AS category_name,
        COUNT(DISTINCT p.kol_id)::int           AS kol_count,
        COUNT(DISTINCT p.id)::int               AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float         AS gmv,
        COALESCE(SUM(ma.orders), 0)::int        AS orders,
        COALESCE(SUM(ps.spend), 0)::float       AS spend
      FROM placements p
      JOIN kols k ON k.id = p.kol_id
      JOIN content_categories cc ON cc.id = k.content_category_id
      LEFT JOIN placement_spend ps ON ps.id = p.id
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY cc.id, cc.name
      ORDER BY gmv DESC
    `;
```

แก้เป็น:

```ts
    const categoryBreakdown = await prisma.$queryRaw<CategoryRow[]>`
      WITH placement_spend AS (
        SELECT id,
               COALESCE(pay_amount, final_price, 0)::numeric AS spend,
               COALESCE(ads_cost, 0)::numeric                AS ads_cost
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders, SUM(visits) AS visits
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        cc.id::int                              AS category_id,
        cc.name                                 AS category_name,
        COUNT(DISTINCT p.kol_id)::int           AS kol_count,
        COUNT(DISTINCT p.id)::int               AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float         AS gmv,
        COALESCE(SUM(ma.orders), 0)::int        AS orders,
        COALESCE(SUM(ps.spend), 0)::float       AS spend,
        COALESCE(SUM(ps.ads_cost), 0)::float    AS ads_cost,
        COALESCE(SUM(ma.visits), 0)::int        AS visits
      FROM placements p
      JOIN kols k ON k.id = p.kol_id
      JOIN content_categories cc ON cc.id = k.content_category_id
      LEFT JOIN placement_spend ps ON ps.id = p.id
      LEFT JOIN metric_agg ma ON ma.placement_id = p.id
      WHERE p.id IN (${Prisma.join(ids)})
      GROUP BY cc.id, cc.name
      ORDER BY gmv DESC
    `;
```

หา `type CategoryRow = {` (บรรทัด ~98-106) แก้เป็น:

```ts
type CategoryRow = {
  category_id: number;
  category_name: string;
  kol_count: number;
  placement_count: number;
  gmv: number;
  orders: number;
  spend: number;
  ads_cost: number;
  visits: number;
};
```

- [ ] **Step 8: `npx tsc -b` ที่ `server/` ต้องผ่านสะอาด**

```bash
cd server && npx tsc -b
```
คาดหวัง: ไม่มี error ออกมาเลย (exit code 0, ไม่มี output)

- [ ] **Step 9: Manual verify — เทียบผลจาก endpoint กับ SQL ตรง**

เช็คว่า dev server รันอยู่ที่ port 8787 หรือยัง (`netstat -ano | grep ":8787.*LISTENING"`) ถ้ายังไม่รัน ให้ `cd server && npx wrangler dev` (background) รอ 10 วินาทีให้ boot

Mint session token แบบเดิม (ดู pattern ใน CLAUDE.md §9 "Playwright mint session") แล้วยิง:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8787/api/dashboard" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const j = JSON.parse(d);
    console.log('total_kol_count:', j.summary.total_kol_count);
    console.log('campaignTrend[0]:', j.campaignTrend[0]);
    console.log('platformBreakdown[0]:', j.platformBreakdown[0]);
    console.log('categoryBreakdown[0]:', j.categoryBreakdown[0]);
  })"
```

เทียบ `total_kol_count` กับ `SELECT COUNT(DISTINCT kol_id) FROM placements` ตรงจาก DB (ผ่าน `node -e` ใช้ `pg` client อ่าน `DATABASE_URL` จาก `server/.env` — pattern เดียวกับที่ใช้ตรวจ pagination ก่อนหน้านี้) ตัวเลขต้องตรงกัน (หรือถ้ามี brand filter default ต้องตรงกับ scope เดียวกัน)

- [ ] **Step 10: Commit**

```bash
cd .. && git add server/src/routes/dashboard.ts
git commit -m "feat: dashboard — เพิ่ม visits ใน campaign, cost ใน platform/category, total_kol_count ใน summary"
```

---

### Task 2: Backend — `buildProductDashboard()`: เพิ่ม ads_cost + visits ใน Product Ranking query

**Files:**
- Modify: `server/src/routes/dashboard.ts:177-186` (`ProductRankRow` type), `:1357-1391` (ranking query + summary reduce)

**Interfaces:**
- Consumes: ไม่ขึ้นกับ Task 1
- Produces: `ranking[].total_ads_cost: number`, `ranking[].total_visits: number` — ใช้โดย Task 4 (client type) และ Task 10 (4-way sort toggle)

- [ ] **Step 1: แก้ type `ProductRankRow`**

หา (บรรทัด ~177-186):

```ts
type ProductRankRow = {
  canonical_id: number;
  model_code: string;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
  placement_count: number;
  total_gmv: number;
  total_orders: number;
  total_spend: number;
};
```

แก้เป็น:

```ts
type ProductRankRow = {
  canonical_id: number;
  model_code: string;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
  placement_count: number;
  total_gmv: number;
  total_orders: number;
  total_spend: number;
  total_ads_cost: number;
  total_visits: number;
};
```

- [ ] **Step 2: แก้ ranking query ใน `buildProductDashboard()`**

หา (บรรทัด ~1357-1391):

```ts
    const ranking = await prisma.$queryRaw<ProductRankRow[]>`
      WITH resolved AS (
        SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
        FROM placements pl
        JOIN products pr ON pr.id = pl.product_id
        WHERE pl.id IN (${Prisma.join(ids)})
      ),
      placement_spend AS (
        SELECT id, COALESCE(pay_amount, final_price, 0)::numeric AS spend
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        c.id::int                           AS canonical_id,
        c.model_code,
        c.product_category_id               AS category_id,
        pc.name                              AS category_name,
        c.image_url,
        COUNT(DISTINCT r.placement_id)::int AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float     AS total_gmv,
        COALESCE(SUM(ma.orders), 0)::int    AS total_orders,
        COALESCE(SUM(ps.spend), 0)::float   AS total_spend
      FROM resolved r
      JOIN products c ON c.id = r.canonical_id
      LEFT JOIN product_categories pc ON pc.id = c.product_category_id
      LEFT JOIN placement_spend ps ON ps.id = r.placement_id
      LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
      WHERE ${categoryFilter}::int IS NULL OR c.product_category_id = ${categoryFilter}::int
      GROUP BY c.id, c.model_code, c.product_category_id, pc.name, c.image_url
      ORDER BY total_gmv DESC
    `;
```

แก้เป็น:

```ts
    const ranking = await prisma.$queryRaw<ProductRankRow[]>`
      WITH resolved AS (
        SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
        FROM placements pl
        JOIN products pr ON pr.id = pl.product_id
        WHERE pl.id IN (${Prisma.join(ids)})
      ),
      placement_spend AS (
        SELECT id,
               COALESCE(pay_amount, final_price, 0)::numeric AS spend,
               COALESCE(ads_cost, 0)::numeric                AS ads_cost
        FROM placements WHERE id IN (${Prisma.join(ids)})
      ),
      metric_agg AS (
        SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(orders) AS orders, SUM(visits) AS visits
        FROM placement_metrics
        WHERE placement_id IN (${Prisma.join(ids)})
        GROUP BY placement_id
      )
      SELECT
        c.id::int                           AS canonical_id,
        c.model_code,
        c.product_category_id               AS category_id,
        pc.name                              AS category_name,
        c.image_url,
        COUNT(DISTINCT r.placement_id)::int AS placement_count,
        COALESCE(SUM(ma.gmv), 0)::float     AS total_gmv,
        COALESCE(SUM(ma.orders), 0)::int    AS total_orders,
        COALESCE(SUM(ps.spend), 0)::float   AS total_spend,
        COALESCE(SUM(ps.ads_cost), 0)::float AS total_ads_cost,
        COALESCE(SUM(ma.visits), 0)::int    AS total_visits
      FROM resolved r
      JOIN products c ON c.id = r.canonical_id
      LEFT JOIN product_categories pc ON pc.id = c.product_category_id
      LEFT JOIN placement_spend ps ON ps.id = r.placement_id
      LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
      WHERE ${categoryFilter}::int IS NULL OR c.product_category_id = ${categoryFilter}::int
      GROUP BY c.id, c.model_code, c.product_category_id, pc.name, c.image_url
      ORDER BY total_gmv DESC
    `;
```

- [ ] **Step 3: แก้ `summary` reduce ให้รวม ads_cost/visits ด้วย (optional aggregate, ไว้เผื่อใช้ต่อ)**

หา (บรรทัด ~1391-1400):

```ts
    const summary = ranking.reduce(
      (acc, r) => ({
        total_gmv: acc.total_gmv + r.total_gmv,
        total_orders: acc.total_orders + r.total_orders,
        total_placements: acc.total_placements + r.placement_count,
        product_count: acc.product_count + 1,
        total_spend: acc.total_spend + r.total_spend,
      }),
      { total_gmv: 0, total_orders: 0, total_placements: 0, product_count: 0, total_spend: 0 },
    );
```

แก้เป็น:

```ts
    const summary = ranking.reduce(
      (acc, r) => ({
        total_gmv: acc.total_gmv + r.total_gmv,
        total_orders: acc.total_orders + r.total_orders,
        total_placements: acc.total_placements + r.placement_count,
        product_count: acc.product_count + 1,
        total_spend: acc.total_spend + r.total_spend,
        total_ads_cost: acc.total_ads_cost + r.total_ads_cost,
        total_visits: acc.total_visits + r.total_visits,
      }),
      { total_gmv: 0, total_orders: 0, total_placements: 0, product_count: 0, total_spend: 0, total_ads_cost: 0, total_visits: 0 },
    );
```

หา return ว่างของฟังก์ชันตอน `matched.length === 0` (บรรทัด ~1343-1348) เพิ่ม `total_ads_cost: 0, total_visits: 0` เข้า summary object ว่างนั้นด้วย ให้ shape ตรงกัน

- [ ] **Step 4: `npx tsc -b` ที่ `server/` ต้องผ่านสะอาด**

```bash
cd server && npx tsc -b
```

- [ ] **Step 5: Manual verify**

```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8787/api/dashboard/products" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const j = JSON.parse(d);
    console.log(j.ranking.slice(0,3).map(r=>({model:r.model_code, gmv:r.total_gmv, ads:r.total_ads_cost, visits:r.total_visits})));
  })"
```

เทียบตัวเลข `total_ads_cost`/`total_visits` ของสินค้าตัวแรกกับ SQL ตรง (`SELECT SUM(ads_cost) FROM placements WHERE product_id IN (...)` ที่ resolve canonical แล้ว — หรือเช็คคร่าวๆ ว่าตัวเลขไม่ใช่ 0 ทั้งหมดและสมเหตุสมผล)

- [ ] **Step 6: Commit**

```bash
cd .. && git add server/src/routes/dashboard.ts
git commit -m "feat: dashboard — เพิ่ม ads_cost + visits ต่อสินค้าใน Product Ranking query"
```

---

### Task 3: Backend — `buildMarketingDashboard()`: ลบ byPlatform/byContentCategory ที่ตาย, เพิ่ม cost(+visits)

**Files:**
- Modify: `server/src/routes/dashboard.ts:136-153` (types + EMPTY_MARKETING), `:1810-1893` (buildMarketingDashboard body)

**Interfaces:**
- Consumes: ไม่ขึ้นกับ Task 1/2
- Produces: `byProductCategory[].total_cost: number` + `visits: number`, `byProductSku[].total_cost: number` — ใช้โดย Task 4/9

- [ ] **Step 1: ลบ `byPlatform`/`byContentCategory` ออกจาก `EMPTY_MARKETING`**

หา (บรรทัด ~145-153):

```ts
const EMPTY_MARKETING = {
  summary: { total_gmv: 0, kol_cost: 0, ads_cost: 0, total_cost: 0, visits_shopee: 0, visits_lazada: 0, total_visits: 0 },
  byPlatform: [] as { platform_id: number; platform_name: string; gmv: number }[],
  byProductCategory: [] as { category_id: number | null; category_name: string | null; gmv: number }[],
  byProductSku: [] as { canonical_id: number; model_code: string | null; gmv: number }[],
  byContentCategory: [] as { category_id: number; category_name: string; gmv: number }[],
};
```

แก้เป็น:

```ts
const EMPTY_MARKETING = {
  summary: { total_gmv: 0, kol_cost: 0, ads_cost: 0, total_cost: 0, visits_shopee: 0, visits_lazada: 0, total_visits: 0 },
  byProductCategory: [] as { category_id: number | null; category_name: string | null; gmv: number; total_cost: number; visits: number }[],
  byProductSku: [] as { canonical_id: number; model_code: string | null; gmv: number; total_cost: number }[],
};
```

- [ ] **Step 2: ลบ query `byPlatform` และ `byContentCategory` ทั้งบล็อกออกจาก `buildMarketingDashboard()`**

หา (บรรทัด ~1806-1839, ทั้งสองบล็อกติดกัน — ลบทั้งหมดตั้งแต่ comment `// GMV by KOL posting platform` ถึงก่อน comment `// GMV by product category`):

```ts
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

```

**ลบทั้งบล็อกนี้ทิ้ง** (เหตุผล: ซ้ำกับ `platformBreakdown`/`categoryBreakdown` ใน `buildDashboardOverview()` ที่มีข้อมูลครบกว่าและถูก render จริง — ดู design spec ข้อ 0)

- [ ] **Step 2: เพิ่ม cost+visits เข้า `byProductCategory` query**

หา (บรรทัด ~1841-1858):

```ts
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
```

แก้เป็น:

```ts
  // GMV by product category (canonical resolve — see buildProductDashboard)
  const byProductCategory = await prisma.$queryRaw<{ category_id: number | null; category_name: string | null; gmv: number; total_cost: number; visits: number }[]>`
    WITH resolved AS (
      SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
      FROM placements pl JOIN products pr ON pr.id = pl.product_id
      WHERE pl.id IN (${Prisma.join(ids)})
    ),
    placement_spend AS (
      SELECT id,
             (COALESCE(pay_amount, final_price, 0) + COALESCE(ads_cost, 0))::numeric AS total_cost
      FROM placements WHERE id IN (${Prisma.join(ids)})
    ),
    metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv, SUM(visits) AS visits FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT pc.id::int AS category_id, pc.name AS category_name,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv,
           COALESCE(SUM(ps.total_cost), 0)::float AS total_cost,
           COALESCE(SUM(ma.visits), 0)::int AS visits
    FROM resolved r
    JOIN products c ON c.id = r.canonical_id
    LEFT JOIN product_categories pc ON pc.id = c.product_category_id
    LEFT JOIN placement_spend ps ON ps.id = r.placement_id
    LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
    GROUP BY pc.id, pc.name
    ORDER BY gmv DESC
  `;
```

- [ ] **Step 3: เพิ่ม cost เข้า `byProductSku` query**

หา (บรรทัด ~1862-1879):

```ts
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
```

แก้เป็น:

```ts
  // GMV by product SKU (canonical), top 8 + others
  const skuRows = await prisma.$queryRaw<{ canonical_id: number; model_code: string; gmv: number; total_cost: number }[]>`
    WITH resolved AS (
      SELECT pl.id AS placement_id, COALESCE(pr.canonical_product_id, pr.id) AS canonical_id
      FROM placements pl JOIN products pr ON pr.id = pl.product_id
      WHERE pl.id IN (${Prisma.join(ids)})
    ),
    placement_spend AS (
      SELECT id,
             (COALESCE(pay_amount, final_price, 0) + COALESCE(ads_cost, 0))::numeric AS total_cost
      FROM placements WHERE id IN (${Prisma.join(ids)})
    ),
    metric_agg AS (
      SELECT placement_id, SUM(gmv::numeric) AS gmv FROM placement_metrics
      WHERE placement_id IN (${Prisma.join(ids)}) GROUP BY placement_id
    )
    SELECT c.id::int AS canonical_id, c.model_code,
           COALESCE(SUM(ma.gmv), 0)::float AS gmv,
           COALESCE(SUM(ps.total_cost), 0)::float AS total_cost
    FROM resolved r
    JOIN products c ON c.id = r.canonical_id
    LEFT JOIN placement_spend ps ON ps.id = r.placement_id
    LEFT JOIN metric_agg ma ON ma.placement_id = r.placement_id
    GROUP BY c.id, c.model_code
    ORDER BY gmv DESC
  `;
  const top = skuRows.slice(0, SKU_TOP_N).map(r => ({ canonical_id: r.canonical_id, model_code: r.model_code, gmv: r.gmv, total_cost: r.total_cost }));
  const restGmv = skuRows.slice(SKU_TOP_N).reduce((s, r) => s + r.gmv, 0);
  const restCost = skuRows.slice(SKU_TOP_N).reduce((s, r) => s + r.total_cost, 0);
  const byProductSku = restGmv > 0
    ? [...top, { canonical_id: -1, model_code: null as string | null, gmv: restGmv, total_cost: restCost }]
    : top;
```

- [ ] **Step 4: แก้ return statement ท้ายฟังก์ชัน — ลบ `byPlatform, byContentCategory`**

หา (บรรทัด ~1889-1893):

```ts
  return {
    summary: {
      total_gmv: totalGmv, kol_cost: kolCost, ads_cost: adsCost, total_cost: kolCost + adsCost,
      visits_shopee: visitsShopee, visits_lazada: visitsLazada, total_visits: totalVisits,
    },
    byPlatform, byProductCategory, byProductSku, byContentCategory,
  };
```

แก้เป็น:

```ts
  return {
    summary: {
      total_gmv: totalGmv, kol_cost: kolCost, ads_cost: adsCost, total_cost: kolCost + adsCost,
      visits_shopee: visitsShopee, visits_lazada: visitsLazada, total_visits: totalVisits,
    },
    byProductCategory, byProductSku,
  };
```

- [ ] **Step 5: `npx tsc -b` ที่ `server/` ต้องผ่านสะอาด**

```bash
cd server && npx tsc -b
```
ถ้ามี error ว่า `byPlatform`/`byContentCategory` ไม่ถูกใช้ (unused) หรือ type ไม่ตรง แปลว่ามีจุดอื่นอ้างอิงอยู่ — ต้องหาแล้วลบให้ครบ (คาดว่าจะไม่มี เพราะ grep ยืนยันแล้วตอนออกแบบว่าไม่มีใครใช้)

- [ ] **Step 6: Manual verify**

```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8787/api/dashboard/marketing" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const j = JSON.parse(d);
    console.log('has byPlatform?', 'byPlatform' in j, '| has byContentCategory?', 'byContentCategory' in j);
    console.log(j.byProductCategory.slice(0,2));
    console.log(j.byProductSku.slice(0,2));
  })"
```
คาดหวัง: `has byPlatform? false | has byContentCategory? false`, และ `byProductCategory`/`byProductSku` มี field `total_cost` ไม่เป็น 0 ทั้งหมด

- [ ] **Step 7: Commit**

```bash
cd .. && git add server/src/routes/dashboard.ts
git commit -m "refactor: dashboard — ลบ byPlatform/byContentCategory ที่ไม่มีใครใช้ (ซ้ำกับ platformBreakdown/categoryBreakdown), เพิ่ม cost/visits ใน byProductCategory/byProductSku"
```

---

### Task 4: Frontend types — ขยาย `client/src/api/index.ts` ให้ตรงกับ backend ใหม่ทั้งหมด

**Files:**
- Modify: `client/src/api/index.ts:495-578` (ทุก type ในหมวด Dashboard/Marketing)

**Interfaces:**
- Consumes: field ทั้งหมดจาก Task 1/2/3
- Produces: type ที่ Task 5/6/9/10 (UI) จะ import ไปใช้

- [ ] **Step 1: แก้ `DashboardCampaignTrendRow`**

หา (บรรทัด ~531-539):

```ts
export type DashboardCampaignTrendRow = {
  campaign_id: number | null;
  code: string | null;
  label: string | null;
  start_date: string | null;
  placement_count: number;
  gmv: number;
  spend: number;
};
```

แก้เป็น (เพิ่ม `visits: number;`):

```ts
export type DashboardCampaignTrendRow = {
  campaign_id: number | null;
  code: string | null;
  label: string | null;
  start_date: string | null;
  placement_count: number;
  gmv: number;
  spend: number;
  visits: number;
};
```

- [ ] **Step 2: แก้ `DashboardPlatformRow`**

หา (บรรทัด ~542):

```ts
export type DashboardPlatformRow = { platform_id: number; platform_name: string; placement_count: number; kol_count: number; total_gmv: number };
```

แก้เป็น:

```ts
export type DashboardPlatformRow = { platform_id: number; platform_name: string; placement_count: number; kol_count: number; total_gmv: number; total_spend: number; total_ads_cost: number };
```

- [ ] **Step 3: แก้ `DashboardCategoryRow`**

หา (บรรทัด ~512):

```ts
export type DashboardCategoryRow = { category_id: number; category_name: string; kol_count: number; placement_count: number; gmv: number; orders: number };
```

แก้เป็น:

```ts
export type DashboardCategoryRow = { category_id: number; category_name: string; kol_count: number; placement_count: number; gmv: number; orders: number; spend: number; ads_cost: number; visits: number };
```

- [ ] **Step 4: แก้ `DashboardSummary`**

หา (บรรทัด ~496-508):

```ts
export type DashboardSummary = {
  total_placements: number;
  posted_count: number;
  planned_count: number;
  cancelled_count: number;
  total_spend: number;
  total_ads_cost: number;
  total_gmv: number;
  total_orders: number;
  total_visits: number;
  total_atc: number;
  roi: number | null;
};
```

แก้เป็น (เพิ่ม `total_kol_count: number;`):

```ts
export type DashboardSummary = {
  total_placements: number;
  total_kol_count: number;
  posted_count: number;
  planned_count: number;
  cancelled_count: number;
  total_spend: number;
  total_ads_cost: number;
  total_gmv: number;
  total_orders: number;
  total_visits: number;
  total_atc: number;
  roi: number | null;
};
```

- [ ] **Step 5: แก้ `ProductRankRow`/`ProductDashboardOverview`**

หา (บรรทัด ~658-670):

```ts
export type ProductRankRow = {
  canonical_id: number;
  model_code: string;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
  placement_count: number;
  total_gmv: number;
  total_orders: number;
};
export type ProductDashboardOverview = {
  summary: { total_gmv: number; total_orders: number; total_placements: number; product_count: number };
  ranking: ProductRankRow[];
};
```

แก้เป็น:

```ts
export type ProductRankRow = {
  canonical_id: number;
  model_code: string;
  category_id: number | null;
  category_name: string | null;
  image_url: string | null;
  placement_count: number;
  total_gmv: number;
  total_orders: number;
  total_spend: number;
  total_ads_cost: number;
  total_visits: number;
};
export type ProductDashboardOverview = {
  summary: { total_gmv: number; total_orders: number; total_placements: number; product_count: number; total_spend: number; total_ads_cost: number; total_visits: number };
  ranking: ProductRankRow[];
};
```

- [ ] **Step 6: แก้ `MarketingDashboard`**

หา (บรรทัด ~572-578):

```ts
export type MarketingDashboard = {
  summary: MarketingSummary;
  byPlatform: { platform_id: number; platform_name: string; gmv: number }[];
  byProductCategory: { category_id: number | null; category_name: string | null; gmv: number }[];
  byProductSku: { canonical_id: number; model_code: string | null; gmv: number }[];
  byContentCategory: { category_id: number; category_name: string; gmv: number }[];
};
```

แก้เป็น:

```ts
export type MarketingDashboard = {
  summary: MarketingSummary;
  byProductCategory: { category_id: number | null; category_name: string | null; gmv: number; total_cost: number; visits: number }[];
  byProductSku: { canonical_id: number; model_code: string | null; gmv: number; total_cost: number }[];
};
```

- [ ] **Step 7: `npx tsc -b` ที่ `client/` — คาดว่าจะพัง (ตั้งใจ)**

```bash
cd client && npx tsc -b
```
คาดหวัง: **error หลายจุดใน `DashboardPage.tsx`** เพราะ component ยังใช้ type/field เดิมอยู่ (`byPlatform`, `byContentCategory` ไม่มีแล้ว) — นี่คือสัญญาณที่ถูกต้องว่า type เปลี่ยนแล้วจริง ให้ปล่อย error พวกนี้ไว้ (จะแก้ใน Task 5/6/9/10 ที่ตามมา) **ห้าม commit Task นี้จนกว่าจะเช็คว่า error ที่เห็นตรงกับที่คาดไว้เท่านั้น** (ไม่ใช่ typo ใน type ที่เพิ่งแก้)

- [ ] **Step 8: Commit**

```bash
cd .. && git add client/src/api/index.ts
git commit -m "feat: dashboard types — ขยาย type ให้ตรงกับ backend ใหม่ (cost/visits/kol_count), ลบ byPlatform/byContentCategory"
```

(commit นี้จะทำให้ client build พังชั่วคราวจนกว่า Task 5/6/9/10 จะแก้ UI ให้ตรง type ใหม่ — เป็นเรื่องปกติในแผนนี้ที่แบ่ง type-change ออกจาก UI-change)

---

### Task 5: Frontend — Overview tab: 3 KPI การ์ดใหม่ + Visit ในกราฟ Campaign

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx:1227-1392` (KPI slab + campaign chart)
- Modify: `client/src/i18n/locales/th.ts`, `en.ts`, `zh.ts` (namespace `dashboard`)

**Interfaces:**
- Consumes: `data.summary.total_kol_count` (Task 1), `data.campaignTrend[].visits` (Task 1)
- Produces: ไม่มี (leaf UI)

- [ ] **Step 1: เพิ่ม i18n key ใน `th.ts` namespace `dashboard`**

เปิด `client/src/i18n/locales/th.ts` หา `visitsLazada: 'Visits Lazada',` (บรรทัด ~148 ใน namespace `dashboard`) เพิ่มต่อท้ายก่อนปิด `othersLabel`:

```ts
    visitsLazada: 'Visits Lazada',
    totalExpenses: 'ค่าใช้จ่ายรวม',
    totalVisit: 'Visit รวม',
    totalKol: 'KOL ทั้งหมด',
    othersLabel: 'อื่นๆ',
```

- [ ] **Step 2: เพิ่ม key เดียวกันใน `en.ts`**

หาตำแหน่งเดียวกัน (`visitsLazada: 'Visits Lazada',` ใน namespace `dashboard`) เพิ่ม:

```ts
    visitsLazada: 'Visits Lazada',
    totalExpenses: 'Total Expenses',
    totalVisit: 'Total Visit',
    totalKol: 'Total KOL',
    othersLabel: 'Others',
```

- [ ] **Step 3: เพิ่ม key เดียวกันใน `zh.ts`**

```ts
    visitsLazada: 'Visits Lazada',
    totalExpenses: '总支出',
    totalVisit: '总访问量',
    totalKol: 'KOL 总数',
    othersLabel: '其他',
```

- [ ] **Step 4: `npx tsc -b` ที่ `client/` เช็คว่า i18n key ครบ 3 ภาษา**

```bash
cd client && npx tsc -b
```
ถ้า key ขาดไฟล์ไหนจะ error ที่บรรทัด `satisfies Translations` ใน `en.ts`/`zh.ts` — error นี้ต้องหายไปก่อนไปขั้นตอนถัดไป (error อื่นจาก Task 4 ยังคงอยู่ได้)

- [ ] **Step 5: เพิ่ม 3 การ์ด KPI ใหม่ในแถวที่ 1**

เปิด `client/src/pages/DashboardPage.tsx` หา (บรรทัด ~1229-1243):

```tsx
              <div className="overflow-x-auto">
                <div className="grid grid-cols-7 min-w-[700px]">
                  <SlabCell icon={<TrendingUp size={12} />} label={t('dashboard.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
                  <SlabCell icon={<Wallet size={12} />} label={t('dashboard.kolSpend')} value={formatMoney(data.summary.total_spend)} />
                  <SlabCell icon={<ShoppingCart size={12} />} label={t('dashboard.totalOrders')} value={data.summary.total_orders.toLocaleString(numberLocale())} />
                  <SlabCell
                    icon={<ListChecks size={12} />}
                    label={t('dashboard.totalPlacements')}
                    value={data.summary.total_placements.toLocaleString(numberLocale())}
                    sub={t('dashboard.placementsSub', { posted: data.summary.posted_count, planned: data.summary.planned_count, cancelled: data.summary.cancelled_count })}
                  />
                  <SlabCell icon={<Megaphone size={12} />} label="Ads Cost" value={formatMoney(data.summary.total_ads_cost)} />
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.visitsShopee')} value={visitsShopee.toLocaleString(numberLocale())} />
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.visitsLazada')} value={visitsLazada.toLocaleString(numberLocale())} />
                </div>
              </div>
```

แก้เป็น (เพิ่ม 3 การ์ดท้ายแถว + ขยาย grid จาก 7 เป็น 10 คอลัมน์):

```tsx
              <div className="overflow-x-auto">
                <div className="grid grid-cols-10 min-w-[1000px]">
                  <SlabCell icon={<TrendingUp size={12} />} label={t('dashboard.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
                  <SlabCell icon={<Wallet size={12} />} label={t('dashboard.kolSpend')} value={formatMoney(data.summary.total_spend)} />
                  <SlabCell icon={<ShoppingCart size={12} />} label={t('dashboard.totalOrders')} value={data.summary.total_orders.toLocaleString(numberLocale())} />
                  <SlabCell
                    icon={<ListChecks size={12} />}
                    label={t('dashboard.totalPlacements')}
                    value={data.summary.total_placements.toLocaleString(numberLocale())}
                    sub={t('dashboard.placementsSub', { posted: data.summary.posted_count, planned: data.summary.planned_count, cancelled: data.summary.cancelled_count })}
                  />
                  <SlabCell icon={<Megaphone size={12} />} label="Ads Cost" value={formatMoney(data.summary.total_ads_cost)} />
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.visitsShopee')} value={visitsShopee.toLocaleString(numberLocale())} />
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.visitsLazada')} value={visitsLazada.toLocaleString(numberLocale())} />
                  <SlabCell icon={<Wallet size={12} />} label={t('dashboard.totalExpenses')} value={formatMoney(data.summary.total_spend + data.summary.total_ads_cost)} />
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.totalVisit')} value={data.summary.total_visits.toLocaleString(numberLocale())} />
                  <SlabCell icon={<ListChecks size={12} />} label={t('dashboard.totalKol')} value={data.summary.total_kol_count.toLocaleString(numberLocale())} />
                </div>
              </div>
```

- [ ] **Step 6: เพิ่ม Visit เข้ากราฟ "GMV vs Spend by Campaign"**

หา (บรรทัด ~1358-1391):

```tsx
              <ChartTableCard
                title={t('dashboard.gmvVsSpendByCampaign')}
                chart={
                  campaignTrendData.length === 0 ? (
                    <p className="text-sm text-muted">{t('dashboard.noData')}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={224}>
                      <BarChart data={campaignTrendData} margin={{ left: -16 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={50} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                          labelStyle={{ color: 'var(--ink)' }}
                          formatter={(v, n) => [formatMoney(Number(v ?? 0)), n === 'gmv' ? t('kolTrend.gmv') : t('kolTrend.spend')]}
                        />
                        <Legend formatter={(v: string) => (v === 'gmv' ? t('kolTrend.gmv') : t('kolTrend.spend'))} wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="gmv" fill="#0066cc" radius={[4, 4, 0, 0]} animationDuration={500} />
                        <Bar dataKey="spend" fill="#f59e0b" radius={[4, 4, 0, 0]} animationDuration={500} />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                }
                table={{
                  columns: [
                    { key: 'name', headerKey: 'dashboard.colCampaign' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'spend', headerKey: 'dashboard.colSpend', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                  ],
                  rows: campaignTrendData as unknown as Record<string, unknown>[],
                }}
                exportFilename={`gmv_vs_spend_campaign_${todayStr()}.xlsx`}
                emptyMessage={t('dashboard.noData')}
              />
```

แก้เป็น (เพิ่ม visits bar บนแกน Y ที่สอง เพราะ scale ต่างจาก GMV/Spend มาก + เพิ่มคอลัมน์ในตาราง export):

```tsx
              <ChartTableCard
                title={t('dashboard.gmvVsSpendByCampaign')}
                chart={
                  campaignTrendData.length === 0 ? (
                    <p className="text-sm text-muted">{t('dashboard.noData')}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={224}>
                      <BarChart data={campaignTrendData} margin={{ left: -16, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={50} />
                        <YAxis yAxisId="money" tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                        <YAxis yAxisId="visits" orientation="right" tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                          labelStyle={{ color: 'var(--ink)' }}
                          formatter={(v, n) => {
                            if (n === 'visits') return [Number(v ?? 0).toLocaleString(numberLocale()), t('dashboard.colVisits')];
                            return [formatMoney(Number(v ?? 0)), n === 'gmv' ? t('kolTrend.gmv') : t('kolTrend.spend')];
                          }}
                        />
                        <Legend formatter={(v: string) => (v === 'gmv' ? t('kolTrend.gmv') : v === 'spend' ? t('kolTrend.spend') : t('dashboard.colVisits'))} wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="money" dataKey="gmv" fill="#0066cc" radius={[4, 4, 0, 0]} animationDuration={500} />
                        <Bar yAxisId="money" dataKey="spend" fill="#f59e0b" radius={[4, 4, 0, 0]} animationDuration={500} />
                        <Bar yAxisId="visits" dataKey="visits" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={500} />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                }
                table={{
                  columns: [
                    { key: 'name', headerKey: 'dashboard.colCampaign' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'spend', headerKey: 'dashboard.colSpend', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'visits', headerKey: 'dashboard.colVisits', align: 'right' as const },
                  ],
                  rows: campaignTrendData as unknown as Record<string, unknown>[],
                }}
                exportFilename={`gmv_vs_spend_campaign_${todayStr()}.xlsx`}
                emptyMessage={t('dashboard.noData')}
              />
```

- [ ] **Step 7: `npx tsc -b` ที่ `client/` — เช็คว่า error ของ Overview tab หายไปแล้ว**

```bash
cd client && npx tsc -b
```
คาดหวัง: error ที่เกี่ยวกับ `DashboardPage.tsx` ในส่วน Overview tab (บรรทัด ~1227-1392) ต้องหายไป — error ในส่วนอื่น (KOL/Products tab จาก Task 4) ยังเหลืออยู่ได้ ยังไม่ต้องแก้จนกว่าจะถึง Task ของมัน

- [ ] **Step 8: Manual verify — เปิดหน้าเว็บจริงเช็คด้วยตา**

รัน dev server (`server/` + `client/` ถ้ายังไม่รัน) เปิด `http://localhost:5173/dashboard` (mint session ใส่ localStorage ตาม pattern CLAUDE.md) เช็ค:
- แถว KPI แถวแรกมี 10 การ์ด ไม่ล้น/ไม่บี้กัน (มี horizontal scroll ถ้าจอแคบ)
- การ์ด "ค่าใช้จ่ายรวม" = ผลรวม KOL Spend + Ads Cost ที่โชว์อยู่ก่อนหน้าจริง
- กราฟ Campaign มีแท่งสีเขียว (Visit) เพิ่มมา และแกน Y ขวามือโชว์ scale ของ visit แยกจาก GMV/Spend

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/DashboardPage.tsx client/src/i18n/locales/th.ts client/src/i18n/locales/en.ts client/src/i18n/locales/zh.ts
git commit -m "feat: dashboard Overview — เพิ่ม KPI การ์ด Total Expenses/Visit/KOL + แท่ง Visit ในกราฟ Campaign"
```

---

### Task 6: Frontend — KOL tab: Cost ใน Platform Breakdown, Cost+Visit ใน Content Category Breakdown

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx:1-15` (imports), `:269-318` (`PlatformBreakdownCard`), `:567-599` (`CategoryBreakdownCard`)
- Modify: `client/src/i18n/locales/th.ts`, `en.ts`, `zh.ts`

**Interfaces:**
- Consumes: `DashboardPlatformRow.total_spend`/`total_ads_cost` (Task 1+4), `DashboardCategoryRow.spend`/`ads_cost`/`visits` (Task 1+4)

- [ ] **Step 1: เพิ่ม i18n key `colCost` (ใช้ร่วมหลายที่ในแผนนี้)**

หา `colSpend: 'KOL Spend',` ใน `th.ts` namespace `dashboard` (บรรทัด ~73) เพิ่มต่อท้าย:

```ts
    colSpend: 'KOL Spend',
    colCost: 'Cost',
```

ทำแบบเดียวกันใน `en.ts` (`colCost: 'Cost',`) และ `zh.ts` (`colCost: '费用',`)

- [ ] **Step 2: import `DashboardPlatformRow`/`DashboardCategoryRow` เข้า `DashboardPage.tsx`**

หา (บรรทัด ~9-14):

```tsx
import {
  getDashboardOverview, getDropdowns, searchKols, exportDashboard, getOffplatformTraffic,
  getProductDashboard, getMarketingDashboard,
  type DashboardOverview, type DashboardKolRow, type DashboardChannelRow, type Campaign, type Brand, type ContentCategory, type KolResult,
  type OffplatformTraffic, type ProductDashboardOverview, type MarketingDashboard,
} from '../api/index.js';
```

แก้เป็น (เพิ่ม 2 type):

```tsx
import {
  getDashboardOverview, getDropdowns, searchKols, exportDashboard, getOffplatformTraffic,
  getProductDashboard, getMarketingDashboard,
  type DashboardOverview, type DashboardKolRow, type DashboardChannelRow, type Campaign, type Brand, type ContentCategory, type KolResult,
  type OffplatformTraffic, type ProductDashboardOverview, type MarketingDashboard,
  type DashboardPlatformRow, type DashboardCategoryRow,
} from '../api/index.js';
```

- [ ] **Step 3: แก้ `PlatformBreakdownCard` — ใช้ type ที่ import แทน inline type + โชว์ Cost**

หา (บรรทัด ~269-318):

```tsx
function PlatformBreakdownCard({
  rows,
}: {
  rows: { platform_id: number; platform_name: string; placement_count: number; kol_count: number; total_gmv: number }[];
}) {
  const { t } = useTranslation();
  const total = rows.reduce((s, r) => s + r.placement_count, 0);
  const maxCount = Math.max(...rows.map(r => r.placement_count), 1);
  return (
    <ChartTableCard
      title={t('dashboard.platformBreakdownTitle')}
      description={t('dashboard.platformBreakdownDesc')}
      chart={
        rows.length === 0 ? (
          <p className="text-sm text-muted">{t('dashboard.noData')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map(r => {
              const pct = total > 0 ? (r.placement_count / total) * 100 : 0;
              return (
                <div key={r.platform_id} className="flex items-center gap-2.5">
                  <PlatformLogo name={r.platform_name} size={18} />
                  <span className="text-sm font-medium text-ink w-24 shrink-0 truncate">{r.platform_name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(r.placement_count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-ink tabular-nums font-mono w-24 text-right shrink-0">
                    {formatMoney(r.total_gmv)}
                  </span>
                  <span className="text-[11px] text-muted tabular-nums w-9 text-right shrink-0">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        )
      }
      table={{
        columns: [
          { key: 'platform_name', headerKey: 'dashboard.colPlatform' },
          { key: 'placement_count', headerKey: 'dashboard.colPlacements', align: 'right' as const },
          { key: 'kol_count', headerKey: 'dashboard.colKolCount', align: 'right' as const },
          { key: 'total_gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
        ],
        rows: rows as unknown as Record<string, unknown>[],
      }}
      exportFilename={`platform_breakdown_${todayStr()}.xlsx`}
      emptyMessage={t('dashboard.noData')}
    />
  );
}
```

แก้เป็น:

```tsx
function PlatformBreakdownCard({
  rows,
}: {
  rows: DashboardPlatformRow[];
}) {
  const { t } = useTranslation();
  const total = rows.reduce((s, r) => s + r.placement_count, 0);
  const maxCount = Math.max(...rows.map(r => r.placement_count), 1);
  return (
    <ChartTableCard
      title={t('dashboard.platformBreakdownTitle')}
      description={t('dashboard.platformBreakdownDesc')}
      chart={
        rows.length === 0 ? (
          <p className="text-sm text-muted">{t('dashboard.noData')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map(r => {
              const pct = total > 0 ? (r.placement_count / total) * 100 : 0;
              return (
                <div key={r.platform_id} className="flex items-center gap-2.5">
                  <PlatformLogo name={r.platform_name} size={18} />
                  <span className="text-sm font-medium text-ink w-24 shrink-0 truncate">{r.platform_name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(r.placement_count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-ink tabular-nums font-mono w-24 text-right shrink-0">
                    {formatMoney(r.total_gmv)}
                  </span>
                  <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">
                    {formatMoney(r.total_spend + r.total_ads_cost)}
                  </span>
                  <span className="text-[11px] text-muted tabular-nums w-9 text-right shrink-0">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        )
      }
      table={{
        columns: [
          { key: 'platform_name', headerKey: 'dashboard.colPlatform' },
          { key: 'placement_count', headerKey: 'dashboard.colPlacements', align: 'right' as const },
          { key: 'kol_count', headerKey: 'dashboard.colKolCount', align: 'right' as const },
          { key: 'total_gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
          { key: 'total_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
        ],
        rows: rows.map(r => ({ ...r, total_cost: r.total_spend + r.total_ads_cost })) as unknown as Record<string, unknown>[],
      }}
      exportFilename={`platform_breakdown_${todayStr()}.xlsx`}
      emptyMessage={t('dashboard.noData')}
    />
  );
}
```

- [ ] **Step 4: แก้ `CategoryBreakdownCard` — ใช้ type ที่ import แทน inline type + โชว์ Cost/Visit**

หา (บรรทัด ~567-599):

```tsx
function CategoryBreakdownCard({
  rows,
}: {
  rows: { category_id: number; category_name: string; kol_count: number; placement_count: number; gmv: number; orders: number }[];
}) {
  const { t } = useTranslation();
  const maxGmv = Math.max(...rows.map(r => r.gmv), 1);
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-sm font-semibold text-ink">{t('dashboard.categoryTitle')}</h2>
        <p className="text-[11px] text-muted">{t('dashboard.categoryDesc')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.category_id} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
              <span className="text-sm font-medium text-ink w-24 shrink-0 truncate">{r.category_name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.gmv / maxGmv) * 100}%`, background: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
              </div>
              <span className="text-[11px] text-muted tabular-nums w-14 text-right shrink-0">{t('dashboard.kolCountLabel', { count: r.kol_count })}</span>
              <span className="text-sm font-semibold text-ink tabular-nums font-mono w-24 text-right shrink-0">{formatMoney(r.gmv)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

แก้เป็น:

```tsx
function CategoryBreakdownCard({
  rows,
}: {
  rows: DashboardCategoryRow[];
}) {
  const { t } = useTranslation();
  const maxGmv = Math.max(...rows.map(r => r.gmv), 1);
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-sm font-semibold text-ink">{t('dashboard.categoryTitle')}</h2>
        <p className="text-[11px] text-muted">{t('dashboard.categoryDesc')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.category_id} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
              <span className="text-sm font-medium text-ink w-24 shrink-0 truncate">{r.category_name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.gmv / maxGmv) * 100}%`, background: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
              </div>
              <span className="text-[11px] text-muted tabular-nums w-14 text-right shrink-0">{t('dashboard.kolCountLabel', { count: r.kol_count })}</span>
              <span className="text-sm font-semibold text-ink tabular-nums font-mono w-24 text-right shrink-0">{formatMoney(r.gmv)}</span>
              <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">{formatMoney(r.spend + r.ads_cost)}</span>
              <span className="text-xs text-muted tabular-nums font-mono w-16 text-right shrink-0">{r.visits.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `npx tsc -b` ที่ `client/`**

```bash
cd client && npx tsc -b
```

- [ ] **Step 6: Manual verify — เปิดหน้า `/dashboard` แท็บ KOL เช็คด้วยตา**

Platform Breakdown มีคอลัมน์ตัวเลข Cost ต่อจาก GMV, Content Category Breakdown มีตัวเลข Cost + Visit ต่อท้ายแถว

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/DashboardPage.tsx client/src/i18n/locales/th.ts client/src/i18n/locales/en.ts client/src/i18n/locales/zh.ts
git commit -m "feat: dashboard KOL tab — เพิ่ม Cost ใน Platform Breakdown, Cost+Visit ใน Content Category Breakdown"
```

---

### Task 7: Frontend — Component ใหม่ `RankBadge.tsx`

**Files:**
- Create: `client/src/components/RankBadge.tsx`

**Interfaces:**
- Produces: `export default function RankBadge({ rank }: { rank: number }): JSX.Element` — ribbon ทอง (rank===1) / เงิน (rank===2) / ทองแดง (rank===3) / ป้ายเทา (rank>=4) ใช้โดย Task 8 (KOL Ranking) และ Task 10 (Product Ranking)

**หมายเหตุการออกแบบ**: สเปคเดิมพูดถึง "component เดียวกันทั้ง KOL Ranking และ Product Ranking" — ตอนไล่โค้ดจริงพบว่า `KolRankRow` (KOL Ranking) มี logic ซับซ้อนกว่ามาก (hover-to-expand, avatar, channel-scoped value, byChannel breakdown) ต่างจาก Product Ranking ที่เป็น list เรียบๆ การบังคับทำ component ใหญ่ตัวเดียวครอบทั้งคู่จะทำให้ prop เยอะเกินจำเป็นและเสี่ยง regression กับ interaction ที่ซับซ้อนของ KOL Ranking — เลยแยกเฉพาะส่วน "ป้ายอันดับ" (ribbon) ออกมาเป็น component เล็กแทน ใช้ร่วมกันได้จริงและตรงเป้าหมาย "ดีไซน์ไปทางเดียวกัน" ที่ user ขอ

- [ ] **Step 1: สร้างไฟล์ `client/src/components/RankBadge.tsx`**

```tsx
const TIER_COLOR: Record<number, string> = {
  1: '#c9a227', // ทอง
  2: '#9098a3', // เงิน
  3: '#b9743a', // ทองแดง
};

export default function RankBadge({ rank }: { rank: number }) {
  const tierColor = TIER_COLOR[rank];

  if (tierColor) {
    return (
      <div
        className="w-7 h-8 flex items-center justify-center text-white text-xs font-extrabold shrink-0"
        style={{
          background: tierColor,
          clipPath: 'polygon(0 0, 100% 0, 100% 72%, 50% 100%, 0 72%)',
        }}
      >
        {rank}
      </div>
    );
  }

  return (
    <div className="w-[26px] h-[26px] rounded-lg bg-canvas text-muted text-[11px] font-semibold flex items-center justify-center shrink-0">
      {rank}
    </div>
  );
}
```

(สี/รูปทรงตรงกับ mockup "K + เส้นคั่นแบบ I" ที่ยืนยันผ่าน visual companion แล้วในเซสชันออกแบบ — ribbon ใช้ `clip-path` เดียวกับที่ mockup ทดสอบไว้)

- [ ] **Step 2: `npx tsc -b` ที่ `client/` — ไฟล์นี้ยังไม่ถูกใช้ที่ไหน ต้องไม่มี error ใหม่**

```bash
cd client && npx tsc -b
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/RankBadge.tsx
git commit -m "feat: เพิ่ม RankBadge component — ribbon ทอง/เงิน/ทองแดง ใช้ร่วมกันทุก ranking widget"
```

---

### Task 8: Frontend — KOL Ranking: ใช้ `RankBadge` + เพิ่มเส้นคั่นระหว่างแถว

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx:1-16` (import), `:649-717` (`KolRankRow`), `:1572-1578` (list container)

**Interfaces:**
- Consumes: `RankBadge` (Task 7)

- [ ] **Step 1: import `RankBadge`**

หา (บรรทัด ~15, หลัง `import PlatformLogo`) เพิ่ม:

```tsx
import RankBadge from '../components/RankBadge.js';
```

- [ ] **Step 2: แก้ `KolRankRow` — เปลี่ยนเลขอันดับธรรมดาเป็น `RankBadge`**

หา (บรรทัด ~684-685):

```tsx
      <div className="flex items-center gap-3 py-2 px-2">
        <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{rank}</span>
        <RankAvatar handle={k.handle} avatarUrl={k.avatar_url} />
```

แก้เป็น:

```tsx
      <div className="flex items-center gap-3 py-2 px-2">
        <RankBadge rank={rank} />
        <RankAvatar handle={k.handle} avatarUrl={k.avatar_url} />
```

- [ ] **Step 3: เพิ่มเส้นคั่นระหว่างแถวที่ container ของ list**

หา (บรรทัด ~1574-1577):

```tsx
              <div className="flex flex-col gap-1">
                {rankedKols.map((k, i) => <KolRankRow key={k.kol_id} k={k} rank={i + 1} mode={rankMode} channel={rankChannel} onSelect={setTrendKolId} />)}
              </div>
```

แก้เป็น (ลบ `gap-1` เปลี่ยนเป็นเส้นคั่น `divide-y divide-hairline` แทน — ให้ตรงกับดีไซน์ที่ยืนยันไว้ "เส้นคั่นระหว่างทุกแถว"):

```tsx
              <div className="flex flex-col divide-y divide-hairline">
                {rankedKols.map((k, i) => <KolRankRow key={k.kol_id} k={k} rank={i + 1} mode={rankMode} channel={rankChannel} onSelect={setTrendKolId} />)}
              </div>
```

- [ ] **Step 4: `npx tsc -b` ที่ `client/`**

```bash
cd client && npx tsc -b
```

- [ ] **Step 5: Manual verify — เปิดหน้า `/dashboard` แท็บ KOL เช็คด้วยตา**

อันดับ 1-3 ต้องเห็นป้าย ribbon สีทอง/เงิน/ทองแดง อันดับ 4+ เป็นป้ายเทาสี่เหลี่ยมมน มีเส้นคั่นบางๆ ระหว่างทุกแถว คลิกแถวแล้ว hover-expand ยังทำงานปกติ (ไม่ regression)

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "style: KOL Ranking — เปลี่ยนเลขอันดับเป็น RankBadge ribbon + เส้นคั่นระหว่างแถว"
```

---

### Task 9: Frontend — Products tab: Cost/Visit เพิ่มในลิสต์ GMV by Category/SKU

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx:1644-1725` (donut legend list ทั้งสอง + export table columns)
- Modify: `client/src/i18n/locales/th.ts`, `en.ts`, `zh.ts`

**Interfaces:**
- Consumes: `marketingData.byProductCategory[].total_cost/visits`, `byProductSku[].total_cost` (Task 3+4)

- [ ] **Step 1: แก้ legend list ของ "GMV by product category"**

หา (บรรทัด ~1665-1674):

```tsx
                      <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
                        {catRows.map((r, i) => (
                          <div key={r.category_id ?? i} className="flex items-center gap-2.5 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length] }} />
                            <span className="font-medium text-ink truncate flex-1 min-w-0">{r.category_name ?? '—'}</span>
                            <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                            <span className="w-12 text-right text-muted tabular-nums shrink-0">{catTotal > 0 ? ((r.gmv / catTotal) * 100).toFixed(1) : '0.0'}%</span>
                          </div>
                        ))}
                      </div>
```

แก้เป็น (เพิ่ม Cost + Visit เป็น span เพิ่ม):

```tsx
                      <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
                        {catRows.map((r, i) => (
                          <div key={r.category_id ?? i} className="flex items-center gap-2.5 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length] }} />
                            <span className="font-medium text-ink truncate flex-1 min-w-0">{r.category_name ?? '—'}</span>
                            <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                            <span className="text-xs text-muted tabular-nums font-mono shrink-0">{formatMoney(r.total_cost)}</span>
                            <span className="text-xs text-muted tabular-nums font-mono shrink-0">{r.visits.toLocaleString()}</span>
                            <span className="w-12 text-right text-muted tabular-nums shrink-0">{catTotal > 0 ? ((r.gmv / catTotal) * 100).toFixed(1) : '0.0'}%</span>
                          </div>
                        ))}
                      </div>
```

- [ ] **Step 2: แก้ `table.columns` ของ "GMV by product category" export**

หา (บรรทัด ~1678-1689):

```tsx
                table={{
                  columns: [
                    { key: 'category_name', headerKey: 'dashboard.colCategory' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'pct', header: '%', align: 'right' as const },
                  ],
                  rows: (() => {
                    const rows = marketingData.byProductCategory.filter(r => r.gmv > 0);
                    const total = rows.reduce((s, r) => s + r.gmv, 0);
                    return rows.map(r => ({ ...r, category_name: r.category_name ?? '—', pct: total > 0 ? `${((r.gmv / total) * 100).toFixed(1)}%` : '0.0%' } as Record<string, unknown>));
                  })(),
                }}
```

แก้เป็น:

```tsx
                table={{
                  columns: [
                    { key: 'category_name', headerKey: 'dashboard.colCategory' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'total_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'visits', headerKey: 'dashboard.colVisits', align: 'right' as const },
                    { key: 'pct', header: '%', align: 'right' as const },
                  ],
                  rows: (() => {
                    const rows = marketingData.byProductCategory.filter(r => r.gmv > 0);
                    const total = rows.reduce((s, r) => s + r.gmv, 0);
                    return rows.map(r => ({ ...r, category_name: r.category_name ?? '—', pct: total > 0 ? `${((r.gmv / total) * 100).toFixed(1)}%` : '0.0%' } as Record<string, unknown>));
                  })(),
                }}
```

- [ ] **Step 3: แก้ legend list ของ "GMV by product SKU"**

หา (บรรทัด ~1712-1721):

```tsx
                      <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
                        {skuRows.slice(0, 8).map((r, i) => (
                          <div key={r.canonical_id} className="flex items-center gap-2.5 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length] }} />
                            <span className="font-medium text-ink truncate flex-1 min-w-0">{r.model_code ?? '—'}</span>
                            <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                            <span className="w-12 text-right text-muted tabular-nums shrink-0">{skuTotal > 0 ? ((r.gmv / skuTotal) * 100).toFixed(1) : '0.0'}%</span>
                          </div>
                        ))}
                        {skuRows.length > 8 && <p className="text-[11px] text-muted">+{skuRows.length - 8} {t('dashboard.othersLabel')}</p>}
                      </div>
```

แก้เป็น:

```tsx
                      <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
                        {skuRows.slice(0, 8).map((r, i) => (
                          <div key={r.canonical_id} className="flex items-center gap-2.5 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length] }} />
                            <span className="font-medium text-ink truncate flex-1 min-w-0">{r.model_code ?? '—'}</span>
                            <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                            <span className="text-xs text-muted tabular-nums font-mono shrink-0">{formatMoney(r.total_cost)}</span>
                            <span className="w-12 text-right text-muted tabular-nums shrink-0">{skuTotal > 0 ? ((r.gmv / skuTotal) * 100).toFixed(1) : '0.0'}%</span>
                          </div>
                        ))}
                        {skuRows.length > 8 && <p className="text-[11px] text-muted">+{skuRows.length - 8} {t('dashboard.othersLabel')}</p>}
                      </div>
```

- [ ] **Step 4: แก้ `table.columns` ของ "GMV by product SKU" export**

หา (อยู่ต่อจากบล็อกที่แก้ใน Step 3):

```tsx
                table={{
                  columns: [
                    { key: 'model_code', headerKey: 'dashboard.colSku' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'pct', header: '%', align: 'right' as const },
                  ],
                  rows: (() => {
                    const rows = marketingData.byProductSku.filter(r => r.gmv > 0);
                    const total = rows.reduce((s, r) => s + r.gmv, 0);
                    return rows.map(r => ({ ...r, model_code: r.model_code ?? '—', pct: total > 0 ? `${((r.gmv / total) * 100).toFixed(1)}%` : '0.0%' } as Record<string, unknown>));
                  })(),
                }}
                exportFilename={`gmv_by_sku_${todayStr()}.xlsx`}
```

แก้เป็น (เพิ่มคอลัมน์ `total_cost`):

```tsx
                table={{
                  columns: [
                    { key: 'model_code', headerKey: 'dashboard.colSku' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'total_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'pct', header: '%', align: 'right' as const },
                  ],
                  rows: (() => {
                    const rows = marketingData.byProductSku.filter(r => r.gmv > 0);
                    const total = rows.reduce((s, r) => s + r.gmv, 0);
                    return rows.map(r => ({ ...r, model_code: r.model_code ?? '—', pct: total > 0 ? `${((r.gmv / total) * 100).toFixed(1)}%` : '0.0%' } as Record<string, unknown>));
                  })(),
                }}
                exportFilename={`gmv_by_sku_${todayStr()}.xlsx`}
```

- [ ] **Step 5: `npx tsc -b` ที่ `client/` — error ของ Products tab ต้องหายไปเกือบหมด (เหลือแค่ Product Ranking ที่จะแก้ Task 10)**

```bash
cd client && npx tsc -b
```

- [ ] **Step 6: Manual verify**

เปิดหน้า `/dashboard` แท็บ Products เช็คว่า donut ทั้งสองมีตัวเลข Cost (และ Visit สำหรับ category) ต่อท้าย GMV ในลิสต์ข้างๆ

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat: dashboard Products tab — เพิ่ม Cost ใน GMV by SKU, Cost+Visit ใน GMV by Category"
```

---

### Task 10: Frontend — Product Ranking: ใช้ `RankBadge` + ปุ่มสลับเกณฑ์เรียง 4 แบบ

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx` (state ใกล้บรรทัด ~900-905, Product Ranking block บรรทัด ~1600-1642)
- Modify: `client/src/i18n/locales/th.ts`, `en.ts`, `zh.ts`

**Interfaces:**
- Consumes: `RankBadge` (Task 7), `ProductRankRow.total_spend/total_ads_cost/total_visits/total_orders` (Task 2+4)

- [ ] **Step 1: เพิ่ม i18n key สำหรับปุ่มสลับเกณฑ์**

หา `byOrders: 'ตาม Orders',` ใน `th.ts` namespace `productDashboard` (บรรทัด ~165 — **key นี้มีอยู่แล้วแต่ไม่เคยถูกใช้ที่ไหนเลย ให้ reuse ตัวนี้**) เพิ่ม key ใหม่ที่ยังไม่มี ต่อท้ายในบล็อกเดียวกัน:

```ts
    byOrders: 'ตาม Orders',
    byAdsSpent: 'ตาม Ads Spent',
    byVisit: 'ตาม Visit',
```

ทำแบบเดียวกันใน `en.ts` (`byAdsSpent: 'By Ads Spent', byVisit: 'By Visit',`) และ `zh.ts` (`byAdsSpent: '按广告花费', byVisit: '按访问量',`)

- [ ] **Step 2: เพิ่ม state สำหรับโหมดเรียง Product Ranking**

หา state ของ KOL Ranking ที่มีอยู่แล้ว (ค้นหา `rankMode` — บรรทัด ~901) เพิ่ม state ใหม่ต่อท้ายในกลุ่มเดียวกัน:

```ts
  const [productRankMode, setProductRankMode] = useState<'gmv' | 'ads_cost' | 'visits' | 'orders'>('gmv');
```

- [ ] **Step 3: import `RankBadge` (ถ้ายังไม่ได้ import จาก Task 8 — ไฟล์เดียวกัน import ครั้งเดียวพอ ข้าม step นี้ถ้า Task 8 ทำไปแล้ว)**

- [ ] **Step 4: เพิ่มตัวแปร sorted ranking ตาม `productRankMode` ก่อนส่วน render (วางใกล้ๆ กับที่ประกาศ `campaignTrendData` เดิม บรรทัด ~1050)**

```ts
  const sortedProductRanking = useMemo(() => {
    if (!productData) return [];
    const key = productRankMode === 'gmv' ? 'total_gmv' : productRankMode === 'ads_cost' ? 'total_ads_cost' : productRankMode === 'visits' ? 'total_visits' : 'total_orders';
    return [...productData.ranking].sort((a, b) => b[key] - a[key]);
  }, [productData, productRankMode]);

  function productRankValue(p: ProductRankRow): string {
    if (productRankMode === 'gmv') return formatMoney(p.total_gmv);
    if (productRankMode === 'ads_cost') return formatMoney(p.total_ads_cost);
    if (productRankMode === 'visits') return p.total_visits.toLocaleString(numberLocale());
    return p.total_orders.toLocaleString(numberLocale());
  }
```

(ต้อง import `type ProductRankRow` เข้า `DashboardPage.tsx` ถ้ายังไม่มี — เช็ค import block บรรทัด ~9-14 เพิ่ม `type ProductRankRow` เข้า list ถ้าจำเป็น)

- [ ] **Step 5: แก้ Product Ranking block — เพิ่มปุ่มสลับเกณฑ์ + ใช้ `RankBadge` + เส้นคั่น + ใช้ `sortedProductRanking`**

หา (บรรทัด ~1600-1642):

```tsx
          {productData && (
            <ChartTableCard
              title={t('productDashboard.rankingTitle')}
              chart={
                productData.ranking.length === 0 ? (
                  <p className="text-sm text-muted">{t('dashboard.noData')}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {productData.ranking.map((p, i) => (
                      <button
                        key={p.canonical_id}
                        onClick={() => setTrendProductId(p.canonical_id)}
                        className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-canvas transition-colors text-left w-full"
                      >
                        <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{i + 1}</span>
                        <ProductImage url={p.image_url} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink truncate">{p.model_code}</div>
                          {p.category_name && <div className="text-[11px] text-muted truncate">{p.category_name}</div>}
                        </div>
                        <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">{p.placement_count} {t('dashboard.colPlacements')}</span>
                        <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">{p.total_orders} {t('dashboard.colOrders')}</span>
                        <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{formatMoney(p.total_gmv)}</span>
                      </button>
                    ))}
                  </div>
                )
              }
              table={{
                columns: [
                  { key: 'rank', headerKey: 'dashboard.colRank', align: 'center' as const, width: '40px' },
                  { key: 'model_code', headerKey: 'dashboard.colProduct' },
                  { key: 'category_name', headerKey: 'dashboard.colCategory' },
                  { key: 'placement_count', headerKey: 'dashboard.colPlacements', align: 'right' as const },
                  { key: 'total_orders', headerKey: 'dashboard.colOrders', align: 'right' as const },
                  { key: 'total_gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                ],
                rows: productData.ranking.map((p, i) => ({ ...p, rank: i + 1, category_name: p.category_name ?? '—' } as Record<string, unknown>)),
              }}
              exportFilename={`product_ranking_${todayStr()}.xlsx`}
              emptyMessage={t('dashboard.noData')}
            />
          )}
```

แก้เป็น:

```tsx
          {productData && (
            <ChartTableCard
              title={t('productDashboard.rankingTitle')}
              headerRight={
                <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
                  <button onClick={() => setProductRankMode('gmv')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'gmv' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>GMV</button>
                  <button onClick={() => setProductRankMode('ads_cost')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'ads_cost' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('productDashboard.byAdsSpent')}</button>
                  <button onClick={() => setProductRankMode('visits')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'visits' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('productDashboard.byVisit')}</button>
                  <button onClick={() => setProductRankMode('orders')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'orders' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('productDashboard.byOrders')}</button>
                </div>
              }
              chart={
                sortedProductRanking.length === 0 ? (
                  <p className="text-sm text-muted">{t('dashboard.noData')}</p>
                ) : (
                  <div className="flex flex-col divide-y divide-hairline">
                    {sortedProductRanking.map((p, i) => (
                      <button
                        key={p.canonical_id}
                        onClick={() => setTrendProductId(p.canonical_id)}
                        className="flex items-center gap-3 py-2 px-2 hover:bg-canvas transition-colors text-left w-full"
                      >
                        <RankBadge rank={i + 1} />
                        <ProductImage url={p.image_url} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink truncate">{p.model_code}</div>
                          {p.category_name && <div className="text-[11px] text-muted truncate">{p.category_name}</div>}
                        </div>
                        <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">{p.placement_count} {t('dashboard.colPlacements')}</span>
                        <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{productRankValue(p)}</span>
                      </button>
                    ))}
                  </div>
                )
              }
              table={{
                columns: [
                  { key: 'rank', headerKey: 'dashboard.colRank', align: 'center' as const, width: '40px' },
                  { key: 'model_code', headerKey: 'dashboard.colProduct' },
                  { key: 'category_name', headerKey: 'dashboard.colCategory' },
                  { key: 'placement_count', headerKey: 'dashboard.colPlacements', align: 'right' as const },
                  { key: 'total_orders', headerKey: 'dashboard.colOrders', align: 'right' as const },
                  { key: 'total_gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                  { key: 'total_ads_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                  { key: 'total_visits', headerKey: 'dashboard.colVisits', align: 'right' as const },
                ],
                rows: sortedProductRanking.map((p, i) => ({ ...p, rank: i + 1, category_name: p.category_name ?? '—' } as Record<string, unknown>)),
              }}
              exportFilename={`product_ranking_${todayStr()}.xlsx`}
              emptyMessage={t('dashboard.noData')}
            />
          )}
```

**หมายเหตุ**: prop `headerRight` มีอยู่แล้วใน `ChartTableCard` (`client/src/components/ChartTableCard.tsx:25` — `headerRight?: React.ReactNode;` render ไว้ในแถว header ก่อนปุ่ม chart/table toggle และ export อยู่แล้ว) ไม่ต้องแก้ component นี้เลย ใช้ prop ที่มีอยู่ได้ตรงๆ

- [ ] **Step 6: `npx tsc -b` ที่ `client/` — ต้องผ่านสะอาดหมดทั้งไฟล์ (error ทั้งหมดจาก Task 4 ควรหายไปแล้ว ณ จุดนี้)**

```bash
cd client && npx tsc -b
```
คาดหวัง: **ไม่มี error เลย** — นี่คือจุดที่ type change ทั้งหมดจาก Task 4 ถูกใช้งานครบแล้ว

- [ ] **Step 7: `npx eslint .` ทั้ง server/ และ client/ — ไม่มี error ใหม่**

```bash
cd server && npx eslint . 2>&1 | tail -20
cd ../client && npx eslint . 2>&1 | tail -20
```
เทียบกับ error ที่มีอยู่ก่อนแก้ (ถ้ามี error เดิมอยู่แล้วในไฟล์ที่ไม่ได้แตะ ปล่อยผ่านได้ — เฉพาะ error ใหม่ที่เกิดจากโค้ดที่เพิ่งแก้เท่านั้นที่ต้องแก้)

- [ ] **Step 8: Manual verify — เปิดหน้า `/dashboard` แท็บ Products เช็คด้วยตา**

Product Ranking มีปุ่มสลับ GMV/Ads Spent/Visit/Orders 4 ปุ่ม, คลิกแล้วลิสต์เรียงใหม่ทันที, ป้ายอันดับเป็น ribbon ทอง/เงิน/ทองแดง + เส้นคั่นเหมือน KOL Ranking

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/DashboardPage.tsx client/src/i18n/locales/th.ts client/src/i18n/locales/en.ts client/src/i18n/locales/zh.ts
git commit -m "feat: dashboard Product Ranking — RankBadge + ปุ่มสลับเกณฑ์เรียง GMV/Ads Spent/Visit/Orders ในการ์ดเดียว"
```

---

### Task 11: Docs — บันทึก CPM/Impressions เป็น backlog ใน CLAUDE.md

**Files:**
- Modify: `D:\internship\KOL_management\kol-system\CLAUDE.md`

**Interfaces:** ไม่มี (docs only)

- [ ] **Step 1: หาหัวข้อ TODO/Backlog ที่มีอยู่แล้ว**

เปิด `CLAUDE.md` หาหัวข้อ `## 10. TODO` → ส่วน `### Backlog` (มีบรรทัดที่พูดถึง engagement columns ว่างอยู่แล้ว เช่น `⚠️ Engagement/on-time/repost/sample dashboard **ทำไม่ได้** — คอลัมน์ว่างหมด...`)

- [ ] **Step 2: เพิ่มบรรทัดใหม่ต่อท้ายในย่อหน้าเดียวกัน**

หาประโยคที่ลงท้ายด้วย `(likes/comments/saves/views, \`target_pub_date\`, \`placement_reposts\`, \`kol_samples\` = 0)` แล้วเพิ่มต่อท้ายในประโยคเดียวกัน (ไม่ขึ้นบรรทัดใหม่ ให้ต่อความ):

```
 — เช่นเดียวกับ CPM/Total Impression (งาน dashboard gap-fill 2026-07-02: `placement_metrics.impressions` ว่าง 100% ยืนยันด้วย query ตรง, 0/1,562 แถว)
```

- [ ] **Step 3: เพิ่ม entry ใหม่ในรายการงานที่เสร็จแล้ว (หัวข้อ 7)**

หาเลขงานล่าสุดในหัวข้อ `## 7. ลำดับงานที่เสร็จแล้ว (สรุปสั้น)` (ปัจจุบันล่าสุดคืองาน 56 Phase F) เพิ่มบรรทัดใหม่ต่อท้ายด้วยเลขถัดไป:

```
57. Dashboard gap-fill (เทียบ 5 รูปอ้างอิงจาก user) — เติม Cost ใน Platform/Category/SKU breakdown, Visit ใน Campaign/Category breakdown, KPI ใหม่ (Total Expenses/Visit/KOL), ลบ byPlatform/byContentCategory ที่ซ้ำ/ตาย, RankBadge component (ribbon ทอง/เงิน/ทองแดง) ใช้ร่วม KOL Ranking + Product Ranking, Product Ranking สลับเกณฑ์เรียงได้ 4 แบบในการ์ดเดียว — CPM/Impression ยังทำไม่ได้ (ข้อมูลว่าง)
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: บันทึก CPM/Impressions เป็น backlog + สรุปงาน dashboard gap-fill ใน CLAUDE.md"
```

---

## Self-Review Notes (จากการเขียนแผนนี้)

- **Spec coverage**: ครบทุกข้อในสเปค (ข้อ 0-5) — Task 1-3 ครอบข้อ 2 (backend), Task 4-10 ครอบข้อ 3 (frontend + RankingList/RankBadge), Task 11 ครอบข้อ 4 (out of scope → backlog), แผนทดสอบข้อ 5 กระจายอยู่ใน "Manual verify" ของแต่ละ task
- **RankingList → RankBadge**: ปรับจากสเปคเดิม (component เดียวครอบทั้ง 2 widget) เป็น component เล็กเฉพาะ badge หลังไล่โค้ดจริงเจอว่า `KolRankRow` ซับซ้อนเกินจะ generic ได้โดยไม่เสีย behavior เดิม — บันทึกเหตุผลไว้ใน Task 7 แล้ว
- **Type consistency**: เช็คแล้วว่า field nameตรงกันทุกจุด (`total_ads_cost`/`total_visits` ใน ProductRankRow ทั้ง server/client, `total_cost` ใน byProductCategory/byProductSku ทั้ง 2 ฝั่ง, `ads_cost`/`visits` ใน CategoryRow ทั้ง 2 ฝั่ง)
- **Task 4 ทำให้ build พังชั่วคราว**: ตั้งใจ — แยก type change ออกจาก UI change เพื่อให้ diff แต่ละ commit เล็กและ review ง่าย ต้องรัน Task 5-10 ให้ครบก่อน build จะกลับมาเขียวปกติ (ระบุชัดใน Step 7 ของ Task 4 และ Step 7 ของ Task 10)
