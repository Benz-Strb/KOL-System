# แผน: ปรับปรุง UX ปฏิทิน KOL (3 จุดที่ยังไม่สุด)

> **สำหรับ agentic worker:** REQUIRED SUB-SKILL — ใช้ superpowers:subagent-driven-development (แนะนำ) หรือ superpowers:executing-plans เพื่อทำทีละ task ทุก step ใช้ checkbox (`- [ ]`) สำหรับ track

**Goal:** ปิดช่องโหว่ UX 3 จุดของหน้า `/calendar` ที่ตรวจพบ — (A) ปุ่ม banner "ไม่มีวันที่" ให้กรองจริง, (B) ปุ่ม "ดูใน placement" ใน modal ให้ไปหน้า detail ของ placement นั้นจริง, (C) เลือก KOL แล้วปฏิทินกระโดดไปเดือนที่ KOL คนนั้นมีงาน

**Architecture:** เพิ่ม 3 backend endpoint/param เล็กๆ ใน Hono (`placements.ts` + `calendar.ts`) แล้วต่อกับ frontend — สร้างหน้า detail ใหม่ `PlacementDetailPage` (route `/placements/:id`), ให้ `PlacementsPage` อ่าน URL param เพื่อรองรับ deep-link no-date, และเพิ่ม jump-to-month ใน `CalendarPage`

**Tech Stack:** Hono + Prisma 6 (server) / Vite + React + react-router-dom v6 + react-i18next (client)

## Global Constraints

- **ห้ามใช้ test runner** — โปรเจกต์นี้ไม่มี jest/vitest (test files ทั้งหมดอยู่ใน `node_modules`) ทุก "verify" ใช้ `npx tsc -b` (client) / `npx tsc --noEmit` (server) + เปิดแอปจริงดูพฤติกรรม
- **type-check client ต้องใช้ `npx tsc -b`** — ห้าม `tsc --noEmit` เปล่าใน `client/` (เช็ค 0 ไฟล์เสมอ)
- **ห้ามใส่ `Co-Authored-By: Claude` ใน commit ใดๆ**
- **i18n: เพิ่ม key ใน `th.ts` ก่อนเสมอ** แล้วเติม `en.ts`/`zh.ts` ให้ครบ (`satisfies Translations` จะ error ถ้าขาด) — คำ domain (KOL/Placement/Campaign/Online/Offline/Planned/Posted/Cancelled) คงเป็นอังกฤษทุกภาษา
- **SQL ใน calendar.ts ใช้ `$queryRawUnsafe`** — input ทุกตัวต้อง validate/allowlist/เป็น integer ก่อน interpolate (ดู pattern เดิมในไฟล์: `DATE_RE`, `VALID_STATUS`, `VALID_TYPE`, `Number()`)
- **brand isolation:** manager/marketing เห็นเฉพาะ `user.brandIds`; admin เห็นทุก brand — ทุก endpoint ใหม่ต้องเช็คเหมือน endpoint เดิม
- **ภาษาในการสื่อสาร: ไทย**

---

## File Structure

**แก้:**
- `server/src/routes/placements.ts` — เพิ่ม param `no_date` ใน `GET /` + เพิ่ม `GET /:id` (single placement)
- `server/src/routes/calendar.ts` — เพิ่ม `GET /kol-latest`
- `client/src/api/index.ts` — เพิ่ม `no_date` ใน `getPlacements`, เพิ่ม `getPlacement()`, `getCalendarKolLatest()`
- `client/src/pages/PlacementsPage.tsx` — อ่าน URL param (`no_date`/`status`/`brand_id`/`q`) ตอน mount + filter chip "ไม่มีวันที่"
- `client/src/pages/CalendarPage.tsx` — banner deep-link, modal button → `/placements/:id`, KOL select → jump month
- `client/src/App.tsx` — เพิ่ม route `/placements/:id`
- `client/src/i18n/locales/{th,en,zh}.ts` — key ใหม่ namespace `placementDetail` + `placements.noDateChip`

**ใหม่:**
- `client/src/pages/PlacementDetailPage.tsx` — หน้า detail ของ placement เดี่ยว

**ไม่แตะ:** DB schema (ใช้คอลัมน์เดิม), dashboard, samples, kols

---

## ลำดับ Concern (อิสระต่อกัน ทำทีละชุดได้)

- **A** = ปุ่ม banner no-date กรองจริง (Task A1 → A2)
- **B** = modal button → หน้า detail (Task B1 → B2)
- **C** = เลือก KOL → กระโดดเดือน (Task C1 → C2)

---

## Task A1: Backend — param `no_date` ใน `GET /api/placements`

**Files:**
- Modify: `server/src/routes/placements.ts:116-137` (destructure query + where clause ใน `GET /`)

**Interfaces:**
- Produces: `GET /api/placements?no_date=1` → คืน placement ที่ `target_pub_date IS NULL AND publication_date IS NULL` (ภายใต้ brand/status/type/q filter เดิม), response shape เดิมไม่เปลี่ยน

- [ ] **Step 1: เพิ่ม `no_date` ใน destructure ของ query**

ที่ `placements.ts` บรรทัด ~117 (ใน `app.get('/', ...)`) แก้บรรทัด destructure:

```ts
// เดิม
const { status, placement_type, q: search, product_id, campaign_id, payment_type, price_min, price_max, person_in_charge_id, brand_id, page = '1', limit = '20' } = q;
// ใหม่ — เพิ่ม no_date ต่อท้าย
const { status, placement_type, q: search, product_id, campaign_id, payment_type, price_min, price_max, person_in_charge_id, brand_id, no_date, page = '1', limit = '20' } = q;
```

- [ ] **Step 2: เพิ่มเงื่อนไข no-date ใน where object**

ที่ `placements.ts:122-137` ใน object `where = { ... }` เพิ่มบรรทัดสุดท้ายก่อนปิด `}`:

```ts
      ...(person_in_charge_id ? { person_in_charge_id: Number(person_in_charge_id) } : {}),
      ...(no_date === '1' ? { AND: [{ target_pub_date: null }, { publication_date: null }] } : {}),
    };
```

- [ ] **Step 3: Verify type-check server**

Run: `cd server && npx tsc --noEmit`
Expected: ไม่มี error (exit 0, ไม่มี output)

- [ ] **Step 4: Verify พฤติกรรมจริง (manual)**

รัน server local (`cd server && npm run dev`) แล้วยิง request ด้วย mint session admin (pattern ใน CLAUDE.md §9):
- `GET /api/placements?no_date=1&limit=5` → ทุกแถวที่คืนมาต้องมี `target_pub_date === null && publication_date === null`
- `GET /api/placements?no_date=1` → `total` ควรตรงกับจำนวนงานไม่มีวันที่ (เทียบกับ `meta.no_date_count` ที่ `GET /api/calendar` คืนตอน filter เดียวกัน)
Expected: เฉพาะแถวไม่มีวันที่, brand isolation ยังทำงาน (manager เห็นเฉพาะ brand ตัวเอง)

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/placements.ts
git commit -m "Add no_date filter param to GET /api/placements"
```

---

## Task A2: Frontend — PlacementsPage อ่าน URL param + filter chip + banner deep-link

**Files:**
- Modify: `client/src/api/index.ts:135-154` (`getPlacements` params)
- Modify: `client/src/pages/PlacementsPage.tsx` (เพิ่ม `noDate` state + อ่าน URL param + chip)
- Modify: `client/src/pages/CalendarPage.tsx:499-503` (banner Link)
- Modify: `client/src/i18n/locales/{th,en,zh}.ts` (key `placements.noDateChip`)

**Interfaces:**
- Consumes: `GET /api/placements?no_date=1` (Task A1)
- Produces: deep-link `/placements?no_date=1&brand_id=&status=&q=` ทำงาน + chip ลบได้

- [ ] **Step 1: เพิ่ม `no_date` ใน `getPlacements`**

`client/src/api/index.ts` — ใน params type ของ `getPlacements` (บรรทัด ~135-140) เพิ่ม `no_date?: string;` และในตัวฟังก์ชันเพิ่ม set:

```ts
export const getPlacements = (params: {
  status?: string; placement_type?: string; q?: string;
  product_id?: string; campaign_id?: string; payment_type?: string;
  price_min?: string; price_max?: string; person_in_charge_id?: string;
  brand_id?: string; no_date?: string; page?: number;
}) => {
  const p = new URLSearchParams();
  if (params.status) p.set('status', params.status);
  if (params.placement_type) p.set('placement_type', params.placement_type);
  if (params.q) p.set('q', params.q);
  if (params.product_id) p.set('product_id', params.product_id);
  if (params.campaign_id) p.set('campaign_id', params.campaign_id);
  if (params.payment_type && params.payment_type !== 'all') p.set('payment_type', params.payment_type);
  if (params.price_min) p.set('price_min', params.price_min);
  if (params.price_max) p.set('price_max', params.price_max);
  if (params.person_in_charge_id) p.set('person_in_charge_id', params.person_in_charge_id);
  if (params.brand_id) p.set('brand_id', params.brand_id);
  if (params.no_date) p.set('no_date', params.no_date);
  if (params.page) p.set('page', String(params.page));
  return api<PlacementsResponse>(`/api/placements?${p}`);
};
```

- [ ] **Step 2: เพิ่ม i18n key `placements.noDateChip`**

`th.ts` (ใน namespace `placements`, ต่อท้ายก่อน `paginationLabel`):
```ts
    noDateChip: 'ไม่มีวันที่',
```
`en.ts`:
```ts
    noDateChip: 'No date',
```
`zh.ts`:
```ts
    noDateChip: '无日期',
```

- [ ] **Step 3: PlacementsPage — import `useSearchParams` + เพิ่ม `noDate` state**

ที่ `client/src/pages/PlacementsPage.tsx` แก้ import react-router (ถ้ายังไม่มี เพิ่มบรรทัดใหม่ใต้ import บนสุด):
```ts
import { useSearchParams } from 'react-router-dom';
```
ใน component (ใกล้ state อื่น ~บรรทัด 130) เพิ่ม:
```ts
  const [searchParams, setSearchParams] = useSearchParams();
  const [noDate, setNoDate] = useState(false);
```

- [ ] **Step 4: อ่าน URL param ตอน mount (ครั้งเดียว)**

เพิ่ม effect ใหม่ใต้ effect โหลด dropdowns (~บรรทัด 149) — sync URL → filter state ครั้งเดียว:
```ts
  // Deep-link support — อ่าน query param ตอน mount (มาจาก banner ปฏิทิน ฯลฯ)
  // แล้วล้าง URL ทิ้งเพื่อไม่ให้ค้างเวลา user เคลียร์ filter เอง
  useEffect(() => {
    const nd = searchParams.get('no_date');
    const st = searchParams.get('status');
    const br = searchParams.get('brand_id');
    const query = searchParams.get('q');
    if (nd === '1') setNoDate(true);
    if (st) setStatus(st);
    if (br) setBrandId(br);
    if (query) setQ(query);
    if (nd || st || br || query) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: ส่ง `no_date` เข้า `load()` params**

ที่ `load` (~บรรทัด 173) และ `loadGmv` ถ้าต้องการ — แก้ params ของ `load`:
```ts
    const params = {
      status, placement_type: type, q: debouncedQ,
      product_id: productId, campaign_id: campaignId,
      payment_type: paymentType,
      price_min: debouncedPriceMin, price_max: debouncedPriceMax,
      person_in_charge_id: picId, brand_id: brandId,
      no_date: noDate ? '1' : undefined, page,
    };
```
และเพิ่ม `noDate` ใน dependency array ของ `useCallback(load, [...])`:
```ts
  }, [status, type, debouncedQ, productId, campaignId, paymentType, debouncedPriceMin, debouncedPriceMax, picId, brandId, noDate, page]);
```

- [ ] **Step 6: แสดง chip "ไม่มีวันที่" ที่ลบได้ + รวมใน hasActiveFilters/clearAll**

ใน `clearAll()` (~บรรทัด 248) เพิ่ม `setNoDate(false);`
แก้ `hasActiveFilters` (~บรรทัด 246) ให้รวม noDate:
```ts
  const hasActiveFilters = status !== 'all' || !!campaignId || !!q || secondaryActiveCount > 0 || noDate;
```
ใน filter bar main row (หลัง campaign Select ~บรรทัด 318) เพิ่ม chip — แสดงเฉพาะตอน noDate=true:
```tsx
          {noDate && (
            <button
              onClick={() => { setNoDate(false); setPage(1); }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 hover:opacity-80 transition-opacity"
            >
              {t('placements.noDateChip')}
              <X size={11} />
            </button>
          )}
```

- [ ] **Step 7: CalendarPage banner — deep-link พร้อม filter ปัจจุบัน**

ที่ `client/src/pages/CalendarPage.tsx:499-503` แก้ Link ใน no-date banner ให้ส่ง param ตาม filter ที่ active บนปฏิทิน (banner count คำนวณจาก brand/status/type/kol เดียวกัน — ส่งไปให้ตรง; kol ส่งเป็น handle ผ่าน `q` เพราะ PlacementsPage ค้นด้วย handle ไม่ใช่ kol_id):
```tsx
          <Link
            to={`/placements?${new URLSearchParams({
              no_date: '1',
              ...(brandId ? { brand_id: brandId } : {}),
              ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
              ...(kolId ? { q: kolLabel } : {}),
            }).toString()}`}
            className="ml-auto font-medium underline underline-offset-2 hover:opacity-80 transition-opacity shrink-0"
          >
            {t('calendar.clickToViewPlacements')}
          </Link>
```
> หมายเหตุ: ปฏิทิน filter `placement_type` (online/offline_shop) ได้ด้วย แต่ banner ตั้งใจไม่ส่ง type ไปเพื่อให้ตัวเลขที่ user เห็นในหน้า list ครอบคลุมงานไม่มีวันที่ทั้งหมดในชุด brand/status/kol นั้น (ถ้าต้องการให้ตรงเป๊ะรวม type ด้วย เพิ่ม `...(typeFilter !== 'all' ? { placement_type: typeFilter } : {})` และเพิ่มอ่าน `placement_type` ใน Step 4)

- [ ] **Step 8: Verify type-check client**

Run: `cd client && npx tsc -b`
Expected: ไม่มี error (exit 0)

- [ ] **Step 9: Verify พฤติกรรมจริง (manual)**

เปิดแอป → `/calendar` เดือนที่มี banner "มี N งานที่ยังไม่ระบุวันที่" → คลิก "ดูใน placements":
- ต้องเด้งไป `/placements` แล้วโชว์ **เฉพาะงานไม่มีวันที่** + มี chip "ไม่มีวันที่"
- จำนวนแถวควรใกล้เคียง N (เท่ากันถ้าไม่กรอง type)
- กด X ที่ chip → กลับมาเห็นทุกงานตามปกติ
- ลอง URL bar เปล่าๆ `/placements` → ไม่มี chip, เห็นทุกงาน (param ไม่ค้าง)

- [ ] **Step 10: Commit**

```bash
git add client/src/api/index.ts client/src/pages/PlacementsPage.tsx client/src/pages/CalendarPage.tsx client/src/i18n/locales/th.ts client/src/i18n/locales/en.ts client/src/i18n/locales/zh.ts
git commit -m "Wire calendar no-date banner to filtered Placements via deep-link"
```

---

## Task B1: Backend — `GET /api/placements/:id` (single placement)

**Files:**
- Modify: `server/src/routes/placements.ts` (เพิ่ม handler ใหม่ ใกล้ `GET /:id/metrics` บรรทัด 89)

**Interfaces:**
- Produces: `GET /api/placements/:id` → คืน placement เดี่ยว shape เดียวกับ 1 แถวใน `GET /` (flatten primary platform เข้า `kols`), 404 ถ้าไม่เจอ, 403 ถ้า non-admin ไม่มีสิทธิ์ brand

- [ ] **Step 1: เพิ่ม handler `GET /:id`**

ที่ `server/src/routes/placements.ts` แทรก handler นี้ **หลัง** `app.get('/:id/metrics', ...)` (ปิด `});` บรรทัด ~110) และ **ก่อน** `app.get('/', ...)` — ใช้ include + flatten ชุดเดียวกับ list:

```ts
app.get('/:id', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);

    const raw = await prisma.placements.findUnique({
      where: { id },
      include: {
        kols: {
          select: {
            id: true, gen_name: true, content_categories: { select: { name: true } },
            kol_platforms: { where: { is_primary: true }, select: { handle: true, profile_url: true, follower_count: true, avatar_url: true } },
          },
        },
        platforms: { select: { name: true } },
        products: { select: { model_code: true } },
        stores: { select: { name: true, branch: true } },
        campaigns: { select: { code: true, label: true } },
        brands: { select: { id: true, name: true, logo_url: true } },
        users_placements_person_in_charge_idTousers: { select: { full_name: true } },
      },
    });

    if (!raw) return c.json({ error: 'Placement not found' }, 404);
    if (user.role !== 'admin' && !user.brandIds.includes(raw.brand_id)) {
      return c.json({ error: 'No access to this placement' }, 403);
    }

    const primary = raw.kols?.kol_platforms[0];
    const row = {
      ...raw,
      kols: raw.kols ? {
        id: raw.kols.id,
        handle: primary?.handle ?? '',
        gen_name: raw.kols.gen_name,
        profile_url: primary?.profile_url ?? null,
        follower_count: primary?.follower_count ?? null,
        avatar_url: primary?.avatar_url ?? null,
        content_categories: raw.kols.content_categories,
      } : null,
    };
    return c.json(row);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load placement' }, 500);
  }
});
```

> **⚠️ Route order:** ต้องวาง `GET /:id` **หลัง** `/kol-gmv` และ `/:id/metrics` เพื่อกันชน — Hono RegExpRouter จัด static segment (`/kol-gmv`, `/:id/metrics`) ก่อน param (`/:id`) อยู่แล้ว แต่วางตามลำดับนี้ให้ชัด

- [ ] **Step 2: Verify type-check server**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0 ไม่มี output

- [ ] **Step 3: Verify พฤติกรรมจริง (manual)**

ยิง request ด้วย mint session:
- admin: `GET /api/placements/1` → คืน object เดี่ยว มี `kols.handle`, `brands`, `status`, `target_pub_date`, `publication_date`
- `GET /api/placements/99999999` → 404
- manager ของ brand อื่น: `GET /api/placements/<id ของ brand ที่ไม่มีสิทธิ์>` → 403
Expected: ตามด้านบน

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/placements.ts
git commit -m "Add GET /api/placements/:id for single placement detail"
```

---

## Task B2: Frontend — PlacementDetailPage + route + modal button link

**Files:**
- Modify: `client/src/api/index.ts` (เพิ่ม `getPlacement(id)`)
- Create: `client/src/pages/PlacementDetailPage.tsx`
- Modify: `client/src/App.tsx` (lazy import + route `/placements/:id`)
- Modify: `client/src/pages/CalendarPage.tsx:128-135` (modal button → `/placements/:id`)
- Modify: `client/src/i18n/locales/{th,en,zh}.ts` (namespace `placementDetail`)

**Interfaces:**
- Consumes: `GET /api/placements/:id` (Task B1), `getPlacementMetrics(id)` + `getReposts(id)` (มีอยู่แล้ว)
- Produces: route `/placements/:id` แสดง detail; modal button ใน CalendarPage ไป route นี้

- [ ] **Step 1: เพิ่ม `getPlacement` ใน api**

`client/src/api/index.ts` — ใต้ `createPlacement` (~บรรทัด 157) เพิ่ม:
```ts
export const getPlacement = (id: number) => api<PlacementRow>(`/api/placements/${id}`);
```

- [ ] **Step 2: เพิ่ม i18n namespace `placementDetail`**

`th.ts` — เพิ่ม namespace ใหม่ (วางหลัง namespace `placements`):
```ts
  placementDetail: {
    back: 'กลับ',
    notFound: 'ไม่พบ Placement นี้',
    loadError: 'โหลดข้อมูลไม่สำเร็จ',
    sectionInfo: 'ข้อมูล Placement',
    campaign: 'Campaign',
    product: 'Model',
    store: 'Store / สาขา',
    type: 'ประเภท',
    plannedDate: 'วันที่วางแผนโพสต์',
    actualDate: 'วันที่โพสต์จริง',
    payment: 'การจ่ายเงิน',
    price: 'ราคา',
    pic: 'ผู้รับผิดชอบ',
    notes: 'หมายเหตุ',
    postUrl: 'ลิงก์โพสต์',
    metrics: 'ผลงาน (Metrics)',
    noMetrics: 'ยังไม่มีข้อมูลผลงาน',
    reposts: 'Repost Rounds',
    noReposts: 'ยังไม่มีรอบ Repost',
    none: '—',
  },
```
`en.ts`:
```ts
  placementDetail: {
    back: 'Back',
    notFound: 'Placement not found',
    loadError: 'Failed to load',
    sectionInfo: 'Placement info',
    campaign: 'Campaign',
    product: 'Model',
    store: 'Store / Branch',
    type: 'Type',
    plannedDate: 'Planned post date',
    actualDate: 'Actual post date',
    payment: 'Payment',
    price: 'Price',
    pic: 'Person in charge',
    notes: 'Notes',
    postUrl: 'Post URL',
    metrics: 'Performance (Metrics)',
    noMetrics: 'No performance data yet',
    reposts: 'Repost Rounds',
    noReposts: 'No repost rounds yet',
    none: '—',
  },
```
`zh.ts`:
```ts
  placementDetail: {
    back: '返回',
    notFound: '未找到此 Placement',
    loadError: '加载失败',
    sectionInfo: 'Placement 信息',
    campaign: 'Campaign',
    product: 'Model',
    store: 'Store / 分店',
    type: '类型',
    plannedDate: '计划发布日期',
    actualDate: '实际发布日期',
    payment: '付款方式',
    price: '价格',
    pic: '负责人',
    notes: '备注',
    postUrl: '帖子链接',
    metrics: '业绩 (Metrics)',
    noMetrics: '暂无业绩数据',
    reposts: 'Repost Rounds',
    noReposts: '暂无 Repost 轮次',
    none: '—',
  },
```

- [ ] **Step 3: สร้าง `PlacementDetailPage.tsx`**

Create: `client/src/pages/PlacementDetailPage.tsx` — ดึง placement + metrics + reposts, แสดง detail แบบ minimal (รีใช้ KolAvatar/PlatformLogo/BrandLogo, style token เดิม: `bg-surface`, `border-hairline`, `rounded-xl`, `text-ink/muted`):

```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import {
  getPlacement, getPlacementMetrics, getReposts,
  type PlacementRow, type PlacementMetric, type PlacementRepost,
} from '../api/index.js';
import KolAvatar from '../components/KolAvatar.js';
import PlatformLogo from '../components/PlatformLogo.js';
import BrandLogo from '../components/BrandLogo.js';
import { numberLocale } from '../i18n/locale.js';

const STATUS_STYLE: Record<string, string> = {
  planned: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25',
  posted:  'bg-green-100 text-green-800 ring-1 ring-green-200 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/25',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-[#86868b]',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-hairline last:border-0">
      <span className="text-xs text-muted w-32 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-ink font-medium min-w-0">{children}</span>
    </div>
  );
}

export default function PlacementDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [placement, setPlacement] = useState<PlacementRow | null>(null);
  const [metrics, setMetrics] = useState<PlacementMetric[]>([]);
  const [reposts, setReposts] = useState<PlacementRepost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const pid = Number(id);
    if (!Number.isInteger(pid)) { setError(true); setLoading(false); return; }
    setLoading(true);
    Promise.all([getPlacement(pid), getPlacementMetrics(pid), getReposts(pid)])
      .then(([p, m, r]) => { setPlacement(p); setMetrics(m); setReposts(r); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !placement) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-screen-md mx-auto">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4">
          <ArrowLeft size={15} /> {t('placementDetail.back')}
        </button>
        <p className="text-sm text-muted">{t('placementDetail.notFound')}</p>
      </div>
    );
  }

  const handle = placement.kols?.handle ?? '';
  const modelOrStore = placement.placement_type === 'online'
    ? placement.products?.model_code ?? null
    : placement.stores ? `${placement.stores.name}${placement.stores.branch ? ` · ${placement.stores.branch}` : ''}` : null;
  const fmtPrice = (p: string | null) => p ? Number(p).toLocaleString(numberLocale()) + ' ฿' : t('placementDetail.none');

  return (
    <div className="px-4 sm:px-6 py-6 max-w-screen-md mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-4 transition-colors">
        <ArrowLeft size={15} /> {t('placementDetail.back')}
      </button>

      {/* KOL header */}
      <div className="bg-surface border border-hairline rounded-xl p-5 mb-4">
        <div className="flex items-center gap-3">
          {handle && <KolAvatar handle={handle} avatarUrl={placement.kols?.avatar_url} size="md" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {placement.kols?.profile_url ? (
                <a href={placement.kols.profile_url} target="_blank" rel="noopener noreferrer"
                  className="font-semibold text-ink hover:text-accent inline-flex items-center gap-1">
                  {handle} <ExternalLink size={12} className="text-muted" />
                </a>
              ) : (
                <span className="font-semibold text-ink">{handle || '—'}</span>
              )}
              {placement.brands && <BrandLogo name={placement.brands.name} logoUrl={placement.brands.logo_url} size={18} />}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
              {placement.platforms?.name && <PlatformLogo name={placement.platforms.name} size={14} />}
              <span>{placement.placement_type === 'online' ? 'Online' : 'Offline'}</span>
              {placement.kols?.content_categories?.name && <span>· {placement.kols.content_categories.name}</span>}
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_STYLE[placement.status] ?? STATUS_STYLE.planned}`}>
            {placement.status}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="bg-surface border border-hairline rounded-xl p-5 mb-4">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t('placementDetail.sectionInfo')}</h2>
        {placement.campaigns?.code && <DetailRow label={t('placementDetail.campaign')}>{placement.campaigns.code}{placement.campaigns.label ? ` · ${placement.campaigns.label}` : ''}</DetailRow>}
        {modelOrStore && <DetailRow label={placement.placement_type === 'online' ? t('placementDetail.product') : t('placementDetail.store')}>{modelOrStore}</DetailRow>}
        <DetailRow label={t('placementDetail.plannedDate')}>{placement.target_pub_date ?? t('placementDetail.none')}</DetailRow>
        <DetailRow label={t('placementDetail.actualDate')}>{placement.publication_date ?? t('placementDetail.none')}</DetailRow>
        <DetailRow label={t('placementDetail.payment')}>{placement.payment_type}</DetailRow>
        <DetailRow label={t('placementDetail.price')}>{fmtPrice(placement.final_price)}</DetailRow>
        {placement.users_placements_person_in_charge_idTousers?.full_name && (
          <DetailRow label={t('placementDetail.pic')}>{placement.users_placements_person_in_charge_idTousers.full_name}</DetailRow>
        )}
        {placement.notes && <DetailRow label={t('placementDetail.notes')}>{placement.notes}</DetailRow>}
        {placement.post_url && (
          <DetailRow label={t('placementDetail.postUrl')}>
            <a href={placement.post_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              <ExternalLink size={12} /> {placement.post_url}
            </a>
          </DetailRow>
        )}
      </div>

      {/* Metrics */}
      <div className="bg-surface border border-hairline rounded-xl p-5 mb-4">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t('placementDetail.metrics')}</h2>
        {metrics.length === 0 ? (
          <p className="text-sm text-muted">{t('placementDetail.noMetrics')}</p>
        ) : (
          <div className="space-y-1.5">
            {metrics.map(m => (
              <div key={m.id} className="flex items-center justify-between text-sm py-1.5 border-b border-hairline last:border-0">
                <span className="font-medium text-ink capitalize">{m.channel}</span>
                <span className="text-muted tabular-nums font-mono text-xs">
                  GMV {m.gmv ? Number(m.gmv).toLocaleString(numberLocale()) : '—'} · Orders {m.orders ?? '—'} · Visits {m.visits ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reposts */}
      {reposts.length > 0 && (
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{t('placementDetail.reposts')}</h2>
          <div className="space-y-1.5">
            {reposts.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b border-hairline last:border-0">
                <span className="font-medium text-ink">Round {r.round_number} · {r.posted_by}</span>
                {r.post_url && <a href={r.post_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-xs inline-flex items-center gap-1"><ExternalLink size={11} /> link</a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: เพิ่ม lazy import + route ใน App.tsx**

`client/src/App.tsx` — ใต้ lazy import อื่น (~บรรทัด 23) เพิ่ม:
```ts
const PlacementDetailPage = lazy(() => import('./pages/PlacementDetailPage.js'));
```
ใน `<Routes>` เพิ่ม route **ก่อน** `/placements` (เพื่อความชัด แม้ react-router v6 จะ match exact อยู่แล้ว) — วางใกล้ route placements อื่น:
```tsx
          <Route path="/placements/:id" element={
            <ProtectedRoute>
              <Layout><PlacementDetailPage /></Layout>
            </ProtectedRoute>
          } />
```
> **⚠️ อย่าวางทับ** `/placements/new` กับ `/placements/import` — react-router v6 ให้ static segment (`new`/`import`) ชนะ dynamic (`:id`) อัตโนมัติ ไม่ต้องกังวลลำดับ แต่ต้องมั่นใจว่า route ทั้งสามมีครบ

- [ ] **Step 5: CalendarPage modal button → `/placements/:id`**

ที่ `client/src/pages/CalendarPage.tsx:128-135` แก้ `to`:
```tsx
          <Link
            to={`/placements/${event.id}`}
            onClick={requestClose}
            className="flex items-center justify-center gap-2 w-full py-2 bg-canvas hover:bg-hairline rounded-xl text-sm font-medium text-ink transition-colors"
          >
            <CalendarDays size={14} />
            {t('calendar.clickToViewPlacements')}
          </Link>
```

- [ ] **Step 6: Verify type-check client**

Run: `cd client && npx tsc -b`
Expected: exit 0

- [ ] **Step 7: Verify พฤติกรรมจริง (manual)**

เปิดแอป → `/calendar` → คลิก chip งานสักอัน → modal เปิด (ยังเหมือนเดิม) → คลิกปุ่ม "ดูใน Placements":
- ต้องไปหน้า `/placements/<id>` แสดง detail ของ placement นั้น (KOL, campaign, วันที่, payment, metrics, repost ถ้ามี)
- ปุ่ม "กลับ" → กลับมาปฏิทิน
- ลองเปิด `/placements/99999999` ตรงๆ → แสดง "ไม่พบ Placement นี้"
- manager: เปิด id ของ brand ที่ไม่มีสิทธิ์ → แสดง not found (จาก 403)

- [ ] **Step 8: Commit**

```bash
git add client/src/api/index.ts client/src/pages/PlacementDetailPage.tsx client/src/App.tsx client/src/pages/CalendarPage.tsx client/src/i18n/locales/th.ts client/src/i18n/locales/en.ts client/src/i18n/locales/zh.ts
git commit -m "Add PlacementDetailPage and link calendar modal to it"
```

---

## Task C1: Backend — `GET /api/calendar/kol-latest`

**Files:**
- Modify: `server/src/routes/calendar.ts` (เพิ่ม handler `GET /kol-latest` ก่อน `export default app`)

**Interfaces:**
- Produces: `GET /api/calendar/kol-latest?kol_id=X&brand_id=Y` → `{ date: 'YYYY-MM-DD' | null }` = วันงานที่ "ใกล้ที่สุด" ของ KOL (เลือกงานในอนาคตที่ใกล้สุดก่อน ถ้าไม่มีใช้งานอดีตที่ใกล้สุด), respect brand access

- [ ] **Step 1: เพิ่ม handler**

ที่ `server/src/routes/calendar.ts` แทรกก่อน `export default app;`:

```ts
app.get('/kol-latest', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const q = c.req.query();
    const kolId = q.kol_id ? Number(q.kol_id) : null;
    const bid = q.brand_id ? Number(q.brand_id) : null;
    if (!kolId || !Number.isInteger(kolId)) return c.json({ error: 'kol_id required' }, 400);

    const isAdmin = user.role === 'admin';
    let allowedBrandIds: number[] | null = null;
    if (!isAdmin) {
      allowedBrandIds = bid && user.brandIds.includes(bid) ? [bid] : user.brandIds;
    } else if (bid) {
      allowedBrandIds = [bid];
    }

    const conds: string[] = [
      `p.kol_id = ${kolId}`,
      `COALESCE(p.target_pub_date, p.publication_date) IS NOT NULL`,
    ];
    if (allowedBrandIds) conds.push(`p.brand_id IN (${allowedBrandIds.join(',')})`);

    // จัดลำดับ: งานอนาคต (>= วันนี้) ใกล้สุดก่อน แล้วค่อยงานอดีตที่ใกล้สุด
    const rows = await prisma.$queryRawUnsafe<{ d: string | null }[]>(`
      SELECT TO_CHAR(d, 'YYYY-MM-DD') AS d FROM (
        SELECT COALESCE(p.target_pub_date, p.publication_date) AS d
        FROM placements p
        WHERE ${conds.join(' AND ')}
      ) t
      ORDER BY (CASE WHEN d >= CURRENT_DATE THEN 0 ELSE 1 END), ABS(d - CURRENT_DATE)
      LIMIT 1
    `);

    return c.json({ date: rows[0]?.d ?? null });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to load kol latest date' }, 500);
  }
});
```

> หมายเหตุ: `allowedBrandIds` ที่เป็น array ว่าง (`[]`) จะได้ `p.brand_id IN ()` ซึ่ง SQL error — แต่เคสนี้ไม่เกิดเพราะ user ที่ login ต้องมี brandIds อย่างน้อย 1 (ตาม design ระบบ); ถ้ากังวลให้เพิ่ม guard `if (allowedBrandIds && allowedBrandIds.length === 0) return c.json({ date: null });` ก่อนสร้าง SQL

- [ ] **Step 2: Verify type-check server**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Verify พฤติกรรมจริง (manual)**

ยิง request mint session:
- `GET /api/calendar/kol-latest?kol_id=<kol ที่มี placement>` → `{ date: 'YYYY-MM-DD' }`
- `GET /api/calendar/kol-latest?kol_id=<kol ที่ไม่มี placement มีวันที่>` → `{ date: null }`
- ไม่ส่ง kol_id → 400
Expected: ตามด้านบน

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/calendar.ts
git commit -m "Add GET /api/calendar/kol-latest for jump-to-month"
```

---

## Task C2: Frontend — เลือก KOL แล้วกระโดดไปเดือนที่มีงาน

**Files:**
- Modify: `client/src/api/index.ts` (เพิ่ม `getCalendarKolLatest`)
- Modify: `client/src/pages/CalendarPage.tsx` (onSelect ของ KolSearchInput → jump เดือน + race guard)

**Interfaces:**
- Consumes: `GET /api/calendar/kol-latest` (Task C1)
- Produces: เลือก KOL → ปฏิทินเปลี่ยน `year`/`month` ไปเดือนของวันงานที่ใกล้สุดของ KOL นั้น (ถ้ามี)

- [ ] **Step 1: เพิ่ม `getCalendarKolLatest` ใน api**

`client/src/api/index.ts` — ใต้ `getCalendar` (ที่เพิ่มไว้รอบก่อน) เพิ่ม:
```ts
export const getCalendarKolLatest = (params: { kol_id: string; brand_id?: string }) => {
  const p = new URLSearchParams({ kol_id: params.kol_id });
  if (params.brand_id) p.set('brand_id', params.brand_id);
  return api<{ date: string | null }>(`/api/calendar/kol-latest?${p}`);
};
```

- [ ] **Step 2: import + race guard ref ใน CalendarPage**

`client/src/pages/CalendarPage.tsx` — แก้ import api ให้รวม `getCalendarKolLatest`:
```ts
import { getCalendar, getCalendarKolLatest, getDropdowns, searchKols, type CalendarEvent, type Brand, type KolResult } from '../api/index.js';
```
ใน component (ใกล้ `seqRef` เดิม) เพิ่ม ref สำหรับ jump:
```ts
  const jumpSeqRef = useRef(0);
```

- [ ] **Step 3: แก้ onSelect ของ KolSearchInput ให้กระโดดเดือน**

ที่ `client/src/pages/CalendarPage.tsx:456-463` แก้ `onSelect`:
```tsx
          <KolSearchInput
            value={kolId}
            label={kolLabel}
            onSelect={async kol => {
              const primary = kol.platforms.find(p => p.is_primary) ?? kol.platforms[0];
              setKolId(String(kol.id));
              setKolLabel(primary?.handle ?? kol.handle);
              // กระโดดไปเดือนที่ KOL คนนี้มีงานใกล้สุด (race guard กันเลือกรัวๆ)
              const mySeq = ++jumpSeqRef.current;
              try {
                const { date } = await getCalendarKolLatest({ kol_id: String(kol.id), brand_id: brandId || undefined });
                if (jumpSeqRef.current !== mySeq) return;
                if (date) {
                  const d = new Date(date + 'T00:00:00');
                  setYear(d.getFullYear());
                  setMonth(d.getMonth());
                }
              } catch { /* เงียบไว้ — ถ้าหาเดือนไม่ได้ก็อยู่เดือนเดิม */ }
            }}
            onClear={() => { setKolId(''); setKolLabel(''); }}
          />
```
> `getCalendarKolLatest` รับ `brand_id?: string` แต่ส่ง `brandId || undefined` — ปรับ signature ให้รับ `string | undefined` ได้ (TS ยอม เพราะ optional) หรือแก้เป็น `brand_id: brandId || ''` แล้วใน fn เช็ค `if (params.brand_id)` (ค่าว่างถูกข้าม) — ใช้แบบหลังถ้า TS บ่น

- [ ] **Step 4: Verify type-check client**

Run: `cd client && npx tsc -b`
Expected: exit 0
> ถ้า error เรื่อง `brand_id: string | undefined` ให้แก้ call เป็น `{ kol_id: String(kol.id), brand_id: brandId || '' }`

- [ ] **Step 5: Verify พฤติกรรมจริง (manual)**

เปิดแอป → `/calendar` ไปเดือนที่ว่างๆ (ไม่มีงาน) → ค้นหาเลือก KOL ที่มีงาน:
- ปฏิทินต้อง **กระโดดไปเดือน** ที่ KOL คนนั้นมีงานใกล้สุด แล้วโชว์ chip ของเขา
- เลือก KOL คนที่ไม่มีงานมีวันที่เลย → อยู่เดือนเดิม (ไม่ error)
- เลือก KOL รัวๆ หลายคนเร็วๆ → เดือนสุดท้ายที่เลือกชนะ (ไม่มีเดือนเก่ากระโดดทับ)
- กด X ล้าง KOL → กลับมาเห็นทุกงานในเดือนนั้น

- [ ] **Step 6: Commit**

```bash
git add client/src/api/index.ts client/src/pages/CalendarPage.tsx
git commit -m "Jump calendar to KOL's nearest placement month on select"
```

---

## Self-Review (ผู้เขียนแผนตรวจแล้ว)

**Spec coverage:** ครบทั้ง 3 concern จาก verification —
- A (banner กรอง) → Task A1 (backend param) + A2 (frontend deep-link + chip) ✅
- B (modal → detail page) → Task B1 (GET /:id) + B2 (PlacementDetailPage + route + link) ✅
- C (jump เดือน) → Task C1 (kol-latest) + C2 (frontend jump) ✅

**Type consistency:** `getPlacement` คืน `PlacementRow` (shape ตรงกับ backend flatten ใน B1); `getCalendarKolLatest` คืน `{ date: string | null }` ตรงกับ C1; `no_date` เป็น `string` (`'1'`) ทั้ง api/backend

**ข้อควรระวังที่ระบุไว้ในแผน:**
- Route order Hono (`/:id` หลัง `/kol-gmv`, `/:id/metrics`) — ระบุใน B1
- `brand_id IN ()` ว่าง — ระบุ guard ใน C1
- URL param ไม่ค้าง (`setSearchParams({}, { replace: true })`) — ระบุใน A2
- PlacementsPage ค้นด้วย handle (`q`) ไม่ใช่ kol_id — banner ส่ง `q=kolLabel` ระบุใน A2 Step 7
- TS narrowing `brand_id` — ระบุ fallback ใน C2 Step 3/4

**No placeholder:** ทุก step มีโค้ดจริง path จริง คำสั่ง verify จริง ✅

---

## หมายเหตุการ verify (สำคัญ)

โปรเจกต์นี้**ไม่มี automated test** — ทุก task ปิดท้ายด้วย `tsc` + เปิดแอปจริงสังเกตพฤติกรรม (ไม่ใช่รัน test suite) ถ้าจะ verify backend ต้องใช้ mint session pattern (CLAUDE.md §9) เพราะทุก endpoint ผ่าน `requireAuth` — ห้ามสร้าง/แก้ข้อมูลจริงใน DB ระหว่าง verify (อ่านอย่างเดียว)
```
