# Dashboard Merge + Model Add — Implementation Plan

> **สถานะ:** spec พร้อมให้ลง code (เขียนโดย Opus, ลงโดย Sonnet)
> **ภาษา:** คุยไทย / โค้ดอังกฤษ ตามเดิม
> **ไฟล์คู่กัน:** `DASHBOARD_MERGE_design.md` (รายละเอียด visual ทั้งหมด — สีปุ่ม/ตาราง/modal/spacing)
> **อ่าน `CLAUDE.md` ก่อนเสมอ** — โดยเฉพาะข้อห้ามข้อ 0, gotchas ข้อ 9 (DB migration order, tsc -b, race guard, i18n, useModalTransition)

---

## 0. สรุปงานทั้งหมด (4 ก้อน)

1. **รวม 3 dashboard เป็นหน้าเดียว 4 subtab** — `/dashboard`, `/dashboard/products`, `/marketing` → `/dashboard` หน้าเดียว ที่ทุก role เห็น (ปลดล็อก marketing ให้เห็นข้อมูลครบ) + เคลียร์ข้อมูลซ้ำ
2. **ทุก widget สลับ กราฟ ↔ ตาราง ได้ + ทุกตาราง export Excel ได้** (toggle ต่อ card, export ต่อตาราง, client-side)
3. **เครื่องมือเปรียบเทียบ Barter/Tier → ตารางแบ่งหน้า (pagination)** แทน list ยาว
4. **เพิ่ม model ได้ในหน้า new placement** (ทุก role ที่ login) — ต้องแก้ schema เพิ่ม `brand_id` ใน `products` (1 model = 1 brand, backfill จาก placements) — **แบรนด์ยังสร้างได้เฉพาะ admin เหมือนเดิม**

### การตัดสินใจที่ล็อกแล้ว (จาก user 2026-06-29)

| หัวข้อ | เลือก |
|---|---|
| โครงสร้าง tab | **4 tabs**: ภาพรวม / KOL / สินค้า / เปรียบเทียบ |
| กราฟ/ตาราง | **Toggle ต่อ card + ปุ่ม Export ต่อตาราง** (ดาวน์โหลดเฉพาะข้อมูลใน card นั้น) |
| เพิ่ม model | **ผูก brand** (เพิ่มคอลัมน์ `brand_id` ใน `products`) |
| model ↔ brand | **1 model = 1 brand** |
| rows products เดิม | **Backfill จาก placements** (product ไม่มี placement → NULL) |
| ใครเพิ่ม model ได้ | **ทุก role ที่ login** (หน้า new placement เปิดให้ทุก role อยู่แล้ว) |

---

## 1. สถานะปัจจุบัน (ก่อนแก้)

### 3 หน้า dashboard แยกกัน

| Route | ไฟล์ | ใครเห็น | เนื้อหา |
|---|---|---|---|
| `/dashboard` | `DashboardPage.tsx` (1507 บรรทัด) | admin/manager | 2 subtab: **ภาพรวม** (KPI slab 11 ตัว + Monthly trend + Channel donut + Campaign bar + Funnel + Content category + Platform breakdown + KOL ranking + Off-platform) / **เครื่องมือเปรียบเทียบ** (Price/Follower benchmark + Barter vs Paid + Tier compare) |
| `/dashboard/products` | `ProductDashboardPage.tsx` | admin/manager | KPI 4 ตัว + Product ranking (gmv/orders, click → ProductTrendModal) |
| `/marketing` | `MarketingDashboardPage.tsx` | **ทุก role** | KPI 6 ตัว + 4 donut (GMV by Platform / Product Category / Product SKU / Content Category) |

### Backend endpoints (`server/src/routes/dashboard.ts`)

| Endpoint | gating ปัจจุบัน | คืนอะไร |
|---|---|---|
| `GET /api/dashboard` | `requireRole('admin','manager')` | summary, channelBreakdown, monthlyTrend, categoryBreakdown, topKolsByGmv/Roi, kolValueList, campaignTrend, platformBreakdown, kolPaymentBreakdown |
| `GET /api/dashboard/export` | `requireRole('admin','manager')` | .xlsx multi-sheet (ExcelJS) |
| `GET /api/dashboard/kol/:id` | `requireRole('admin','manager')` | KOL trend modal data |
| `GET /api/dashboard/products` | `requireRole('admin','manager')` | summary + ranking (ProductRankRow) |
| `GET /api/dashboard/products/export` | `requireRole('admin','manager')` | .xlsx |
| `GET /api/dashboard/products/:id` | `requireRole('admin','manager')` | Product trend modal data |
| `GET /api/dashboard/offplatform` | `requireRole('admin','manager')` | summary, dailyTrend, channelBreakdown |
| `GET /api/dashboard/marketing` | `requireRole('admin','manager','marketing')` | summary, byPlatform, byProductCategory, byProductSku, byContentCategory |

> **brand filter:** `buildDashboardBrandFilter(role, brandIds, brand_id)` — admin เห็นทุก brand, อื่นๆ กรองด้วย `brandIds` ของตัวเอง อยู่แล้ว → marketing เปิดดูได้ปลอดภัย ไม่ข้าม brand

### `products` table (ปัจจุบัน)
```
id, product_category_id (FK nullable), model_code (UNIQUE), active,
canonical_product_id (FK self, สำหรับ SKU dedup), is_canonical, image_url
```
**ไม่มี brand_id** — route `GET /api/products` มีแค่ GET (ไม่มี POST สร้าง model), filter brand ผ่าน JOIN placements

---

## 2. ข้อมูลซ้ำ — แผน dedup

| ข้อมูล | อยู่ที่ไหนบ้าง | ตัดสิน |
|---|---|---|
| Total GMV (KPI) | ทั้ง 3 หน้า | รวมเป็น KPI slab เดียวใน tab ภาพรวม |
| Visits Shopee / Lazada (KPI) | KOL + Marketing | เก็บใน KPI slab เดียว |
| Total Cost / Ads Cost / KOL Spend (KPI) | Marketing (total_cost, ads_cost) + KOL (total_spend, total_ads_cost) | รวมเข้า KPI slab เดียว (มี Ads Cost + KOL Spend อยู่แล้ว, เพิ่ม Total Cost = kol+ads ถ้าต้องการ) |
| **GMV by Platform donut** (Marketing) | ซ้ำกับ **PlatformBreakdownCard** (KOL tab) ที่โชว์ทั้ง placement_count % + total_gmv อยู่แล้ว | **ตัด donut ทิ้ง** เก็บ PlatformBreakdownCard (ปรับให้มี table view โชว์ gmv+count) |
| **GMV by Content Category donut** (Marketing) | ซ้ำกับ **CategoryBreakdownCard** (KOL tab) | **ตัด donut ทิ้ง** เก็บ CategoryBreakdownCard |
| GMV by Product Category donut (Marketing) | ไม่ซ้ำ — ย้ายไป tab สินค้า | เก็บ |
| GMV by Product SKU donut (Marketing) | ไม่ซ้ำ — ย้ายไป tab สินค้า | เก็บ |

**สรุป:** MarketingDashboardPage ถูกดูดเข้าหน้ารวมทั้งหมด — KPI ที่ unique (total_cost) เข้า slab, donut 2 อันซ้ำตัดทิ้ง, donut 2 อัน (product category/SKU) ย้ายไป tab สินค้า → **ลบ `MarketingDashboardPage.tsx` ทิ้ง** หลังย้ายเสร็จ

---

## 3. โครงสร้างใหม่ — 4 subtabs

> หน้าเดียว: `DashboardPage.tsx` (rewrite). Filter panel + Export-ทั้งหมด อยู่ด้านบน (เหนือ tab bar) ใช้ร่วมทุก tab. tab bar = 4 ปุ่ม. โหลดข้อมูลแบบ lazy per-tab (cache ด้วย `swrCache`)

### Tab 1 — ภาพรวม (Overview)  `key='overview'`
ข้อมูลจาก `GET /api/dashboard` + `GET /api/dashboard/offplatform`
1. **KPI slab** (คงเดิม) — 7 ตัวบน (GMV, KOL Spend, Orders, Placements, Ads Cost, Visits Shopee, Visits Lazada) + 4 ตัวล่าง (ROI, Avg GMV/placement, Conversion rate, Posted rate). **ไม่มี toggle/export** (เป็น scalar cards)
2. **Monthly trend** (ComposedChart: GMV bar + Orders line) — toggle+export
3. **GMV by Channel** (donut) — toggle+export
4. **GMV vs Spend by Campaign** (bar) — toggle+export
5. **Funnel** (Visits→ATC→Orders, มี compare table ฝั่งหลังการ์ดอยู่แล้ว) — toggle+export (table = stage + conversion)
6. **Off-Platform Traffic** (KPI 3 + daily bar + channel donut, มีปุ่ม 7/30/90d) — toggle+export

### Tab 2 — KOL  `key='kol'`
ข้อมูลจาก `GET /api/dashboard`
1. **Top KOL Ranking** (top 10, toggle GMV/ROI, channel tabs, KOL search box, hover-expand) — toggle+export (table = อันดับเต็ม)
2. **Platform Breakdown** (placement count bars + gmv) — toggle+export
3. **Content Category Breakdown** (GMV bar ต่อ content category) — toggle+export

### Tab 3 — สินค้า (Products)  `key='products'`
ข้อมูลจาก `GET /api/dashboard/products` + `GET /api/dashboard/marketing`
1. **Product Ranking** (toggle GMV/Orders, click → ProductTrendModal) — toggle+export
2. **GMV by Product Category** (donut, ย้ายมาจาก Marketing) — toggle+export
3. **GMV by Product SKU** (donut, ย้ายมาจาก Marketing) — toggle+export
4. KPI สินค้า (Total Orders, Products with sales) — แสดงเป็นแถบเล็ก หรือยุบเข้า KPI ภาพรวม (เลือกแสดงซ้ำเฉพาะ Products-with-sales)

### Tab 4 — เปรียบเทียบ (Compare tools)  `key='tools'`
ข้อมูลจาก `GET /api/dashboard` (kolValueList, kolPaymentBreakdown)
1. **Price Benchmark** (พิมพ์ราคา → KOL ใกล้เคียง + GMV) — เป็นตารางอยู่แล้ว, เพิ่มปุ่ม export
2. **Follower Benchmark** (เหมือนกัน) — export
3. **Barter vs Paid** (group tabs paid/barter/free) — **เปลี่ยนเป็นตารางแบ่งหน้า** + export
4. **Tier Compare** (group tabs ตาม tier) — **เปลี่ยนเป็นตารางแบ่งหน้า** + export

---

## 4. Routing & Access changes

### `client/src/App.tsx`
- **ลบ route** `/dashboard/products` และ `/marketing` — ทำเป็น `<Navigate to="/dashboard" replace />` (redirect ของเก่า กัน bookmark/ลิงก์เก่าพัง)
- `/dashboard` เปลี่ยน guard จาก `RequireManagerOrAdmin` → **`ProtectedRoute` เฉยๆ** (ทุก role เห็น)
- `homePathFor()`: marketing เดิม return `/marketing` → เปลี่ยนเป็น `/dashboard` (ทุก role ที่ไม่ใช่ default ไป `/dashboard`); admin/manager `/dashboard` เหมือนเดิม
- **Sidebar nav** (`Layout`):
  - ลบ Dashboard dropdown (KOL / Products submenu) ทั้งบล็อก
  - ลบ NavLink `/marketing`
  - ใส่ **NavLink เดียว** `to="/dashboard"` ไอคอน `LayoutDashboard` label `Dashboard` — **แสดงทุก role** (เอาเงื่อนไข `role==='admin'||'manager'` ออก)

### `server/src/routes/dashboard.ts` — เปิด marketing
เปลี่ยน `requireRole('admin','manager')` → `requireRole('admin','manager','marketing')` ทั้ง 6 จุด:
`GET /`, `GET /export`, `GET /kol/:id`, `GET /products`, `GET /products/export`, `GET /offplatform`
(`/marketing` มี marketing อยู่แล้ว) — brand filter เดิมยังกรองตาม `brandIds` ทำให้ marketing เห็นเฉพาะ brand ตัวเอง (ปลอดภัย)

---

## 5. Feature: Graph ↔ Table toggle + per-table Export

> **หลักการ:** ทุก widget ที่มีข้อมูล tabular ห่อด้วย wrapper เดียวกัน ที่มี (1) ปุ่ม toggle [กราฟ|ตาราง] มุมขวาบน (2) ปุ่ม Export Excel — **export เห็นเฉพาะตอนอยู่ใน mode ตาราง** (หรือโชว์ตลอดก็ได้ ดู design doc) export เฉพาะข้อมูลใน card นั้น

### 5.1 Client-side Excel (ไม่ทำ server endpoint ใหม่)
ข้อมูลทุกตารางอยู่ใน client อยู่แล้ว (จาก JSON response) → **export ฝั่ง client** ด้วย lib เบาๆ
- **เพิ่ม dependency:** `xlsx` (SheetJS) ใน `client/package.json` — เล็ก, API ง่าย, ทำงานบน browser
- **lazy import** เสมอ (`const XLSX = await import('xlsx')`) ในฟังก์ชัน export เท่านั้น — กันไม่ให้เข้า initial bundle (ตาม pattern code-split ของเว็บ)
- สร้าง helper `client/src/lib/exportTable.ts`:
  ```ts
  // คอลัมน์ = {key, header}; rows = array ของ object; ดาวน์โหลด .xlsx 1 sheet
  export async function exportTableToExcel<T>(
    columns: { key: keyof T & string; header: string; format?: (v: unknown, row: T) => string | number }[],
    rows: T[],
    filename: string,
    sheetName = 'Sheet1',
  ): Promise<void>
  ```
  ภายใน: `import('xlsx')` → map rows เป็น aoa (array of arrays) ตาม columns → `XLSX.utils.aoa_to_sheet` → `book_append_sheet` → `writeFile(wb, filename)`
- **filename pattern:** `<widget>_<YYYY-MM-DD>.xlsx` เช่น `kol_ranking_2026-06-29.xlsx`, `gmv_by_channel_2026-06-29.xlsx`

> **ทำไม client-side:** ถ้าทำ server จะต้องเพิ่ม ~10 endpoint export ใหม่ + ส่ง query กรองครบทุกตัว ซ้ำซ้อนมาก. ข้อมูลอยู่ฝั่ง client แล้ว → helper ตัวเดียวจบ. ปุ่ม "Export ทั้งหมด" (multi-sheet) เดิมที่ server **คงไว้** อยู่บน header (ดู §5.3)

### 5.2 Component: `ChartTableCard` wrapper (`client/src/components/ChartTableCard.tsx`)
ห่อทุก widget. รับ props:
```ts
{
  title: string;
  description?: string;
  // ปุ่ม mode ถูกคุมโดย wrapper เอง (state ภายใน)
  chart: React.ReactNode;                 // โหนดกราฟ (เดิม)
  table: { columns: {...}[]; rows: any[] }; // นิยามตารางสำหรับ table view + export
  exportFilename: string;                  // ชื่อไฟล์ export
  headerRight?: React.ReactNode;           // ปุ่มเสริม เช่น GMV/ROI toggle, channel tabs, 7/30/90d
  defaultView?: 'chart' | 'table';
}
```
- state `view: 'chart' | 'table'` (เริ่ม `'chart'`)
- header: title + description ซ้าย, `headerRight` + ปุ่ม [กราฟ|ตาราง] + ปุ่ม Export ขวา
- body: `view==='chart' ? chart : <DataTable columns rows />`
- ปุ่ม Export เรียก `exportTableToExcel(columns, rows, exportFilename)`

### 5.3 Component: `DataTable` (`client/src/components/DataTable.tsx`)
ตารางมาตรฐาน reusable (ดูสไตล์เต็มใน design doc §4):
```ts
{ columns: { key; header; align?: 'left'|'right'; format?; width? }[]; rows: any[]; maxHeight?: number }
```
- header sticky, zebra rows, ตัวเลข `tabular-nums font-mono` ชิดขวา
- ถ้า rows เยอะ → scroll ภายใน (Barter/Tier ใช้ pagination แทน ดู §6)

### 5.4 ปุ่ม "Export ทั้งหมด" (header) — คงของเดิม
ปุ่มเขียว `Export Excel` บน header เรียก server multi-sheet เดิม (`exportDashboard` / `exportProductDashboard`) — แต่ละ tab เรียกตัวที่เกี่ยว. เก็บไว้เป็นทางเลือก "เอาทุก sheet ในไฟล์เดียว"

---

## 6. Feature: Barter / Tier → ตารางแบ่งหน้า

> เหตุผล: ข้อมูลจะโตมาก list ยาว scroll ไม่ไหว

### เปลี่ยน `KolsByGroupCard`
- เดิม: group tabs (paid/barter/free หรือ tier) → list `max-h-80 overflow-y-auto`
- ใหม่: group tabs เหมือนเดิม → **ตารางแบ่งหน้า**
  - คอลัมน์: อันดับ, KOL (avatar+handle+gen_name), จำนวน placement, KOL Spend, GMV
  - **page size = 10 แถว/หน้า** (ปรับได้ที่ค่าคงที่ `PAGE_SIZE`)
  - footer: `‹ ก่อนหน้า` ... `หน้า X / Y` ... `ถัดไป ›` + ข้อความ `แสดง a–b จาก N`
  - เปลี่ยน group → reset ไปหน้า 1
  - ปุ่ม Export = export **ทั้งกลุ่มที่เลือก** (ไม่ใช่แค่หน้าปัจจุบัน)
- ใช้ component `Paginator` ใหม่ (`client/src/components/Paginator.tsx`) ใช้ซ้ำได้กับ Product Ranking / KOL Ranking ถ้าต้องการแบ่งหน้าด้วย

---

## 7. Feature: เพิ่ม model ในหน้า new placement

### 7.1 DB migration (ทำตามลำดับ gotcha §9 ใน CLAUDE.md)
รัน SQL ผ่าน psycopg2 (`conn.autocommit = True`) — สร้าง script `scripts/_add_brand_to_products.py` (prefix `_` ลบทิ้งหลังจบ ถ้าเป็น verify; แต่อันนี้เป็น migration จริง ตั้งชื่อ `add_brand_to_products.py` เก็บไว้):
```sql
-- 1. เพิ่มคอลัมน์ nullable ก่อน
ALTER TABLE products ADD COLUMN brand_id integer REFERENCES brands(id);

-- 2. Backfill จาก placements (product → brand ที่ใช้จริง)
--    ปัจจุบันมีแค่ Dreame จึงไม่มี conflict; ถ้า product ถูกใช้หลาย brand ในอนาคต
--    ให้เลือก brand ที่มี placement มากสุด (MODE) — query นี้กันไว้ล่วงหน้า
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
WHERE p.id = sub.product_id;
-- product ที่ไม่มี placement → brand_id ยังเป็น NULL (legacy/global) — ยอมรับได้
```
- **ไม่ตั้ง NOT NULL** (rows เก่าที่ไม่มี placement = NULL ได้)
- หลังรัน: `cd server && prisma db pull` → kill node ที่ล็อก DLL → `prisma generate` → restart → verify

### 7.2 แก้ view `products_dropdown` ให้รองรับ brand ของ model ใหม่
ปัจจุบัน `GET /api/products?brand_id=X` JOIN placements (product ที่มี placement ของ brand นั้น) → **model ใหม่ที่ยังไม่มี placement จะไม่โผล่**
- แก้ query ใน `server/src/routes/products.ts` `GET /` ให้ union กับ product ที่ `brand_id = X` ตรงๆ ด้วย:
  ```sql
  SELECT DISTINCT pd.id, pd.model_code
  FROM products_dropdown pd
  JOIN products p ON p.id = pd.id
  WHERE p.brand_id = ${brandId}
     OR pd.id IN (SELECT product_id FROM placements WHERE brand_id = ${brandId})
  ORDER BY pd.model_code
  ```
  (เผื่อ legacy ที่ brand_id NULL แต่มี placement — เงื่อนไขที่สองครอบ)

### 7.3 Backend: POST สร้าง model
เพิ่มใน `server/src/routes/products.ts`:
```
POST /api/products
body: { model_code: string; brand_id: number; product_category_id?: number | null; image_url?: string | null }
```
- `requireAuth` (ทุก role) — **ไม่ต้อง requireRole** (ทุก role ที่ login เพิ่มได้ตามมติ)
- validate: `model_code` ไม่ว่าง, `brand_id` ต้องมีจริงใน brands, ถ้าไม่ใช่ admin ต้องเป็น brand ใน `req.user.brandIds`
- กัน duplicate: เช็ค `model_code` ซ้ำ (UNIQUE) → ถ้าซ้ำ return 409 พร้อมข้อความไทย
- insert: `is_canonical=true, active=true, canonical_product_id=null`
- return product ใหม่ `{ id, model_code }` เพื่อ frontend เลือกต่อทันที

### 7.4 Frontend: ปุ่มเพิ่ม model ใน NewPlacementPage
- ใน section สินค้า (online) ใต้ Select products → ปุ่ม/ลิงก์ `+ เพิ่ม model ใหม่` (โผล่เมื่อเลือก brand แล้ว)
- กดเปิด **AddModelModal** (component ใหม่ `client/src/components/AddModelModal.tsx`, ใช้ `useModalTransition` + `requestClose`)
- fields: model_code (required), หมวดสินค้า (Select จาก `productCategories` dropdown, optional), รูปสินค้า URL (optional)
- submit → `POST /api/products` → ปิด modal → refetch products list → auto-select model ใหม่ใน Select (`set('product_id', newId)`)
- error 409 (ซ้ำ) → โชว์ inline ใน modal
- ดู design เต็มใน design doc §7

### 7.5 dropdowns
`getDropdowns()` มี `productCategories` อยู่แล้ว (ProductDashboardPage ใช้) → AddModelModal ดึงจากตรงนี้ ไม่ต้องเพิ่ม endpoint

---

## 8. i18n (ต้องครบ 3 ภาษา: th/en/zh)

> เพิ่ม key ใน `th.ts` ก่อน → TS error เตือนถ้า en/zh ไม่มี (`satisfies Translations`) → เติมให้ครบ
> domain terms (KOL/GMV/ROI/Barter/Paid/Free/Platform/Model/Excel) คงเป็นอังกฤษทุกภาษา

namespace `dashboard` เพิ่ม:
- `tabKol`, `tabProducts` (มี `tabOverview`, `tabTools` แล้ว — `tabTools` เปลี่ยน label เป็น "เปรียบเทียบ" ถ้ายังไม่ใช่)
- `viewChart` / `viewTable` (ปุ่ม toggle), `exportTable` (tooltip ปุ่ม export ต่อตาราง)
- `paginatorShowing` ("แสดง {{from}}–{{to}} จาก {{total}}"), `paginatorPage` ("หน้า {{page}} / {{pages}}"), `paginatorPrev`, `paginatorNext`
- column headers: `colRank`, `colKol`, `colProduct`, `colChannel`, `colPlatform`, `colCategory`, `colMonth`, `colCampaign`, `colGmv`(=GMV ไม่ต้องแปล), `colOrders`, `colVisits`, `colPlacements`, `colSpend`, `colPercent`, `colRoi`, `colStage`, `colConversion`, `colDate`, `colRevenue`, `colFollower`, `colSku`, `colTier`, `colPayment`

namespace `newPlacement` หรือใหม่ `addModel`:
- `addModelButton` ("+ เพิ่ม model ใหม่"), `addModelTitle`, `modelCodeLabel`, `modelCodePlaceholder`, `categoryLabel` (optional), `imageUrlLabel` (optional), `save`, `cancel`, `duplicateError` ("model code นี้มีอยู่แล้ว"), `addModelSuccess`

(ราย key เต็ม + คำแปล en/zh อยู่ใน design doc §8)

---

## 9. ลำดับการทำ (Phases) + Checklist

> ทำทีละ phase, type-check ด้วย `npx tsc -b` หรือ `npm run build` (ห้าม `tsc --noEmit` เปล่า) หลังทุก phase

### Phase A — Backend เปิด marketing + role gating
- [ ] เปลี่ยน `requireRole` 6 จุดใน `dashboard.ts` ให้รวม `'marketing'`
- [ ] test: marketing login เรียก `/api/dashboard` ได้ + เห็นเฉพาะ brand ตัวเอง

### Phase B — DB migration brand_id
- [ ] `scripts/add_brand_to_products.py` (ALTER + backfill) — รันจริง
- [ ] `prisma db pull` + generate + verify `products.brand_id` โผล่ใน schema
- [ ] แก้ `products_dropdown` query (§7.2)

### Phase C — POST /api/products + AddModelModal
- [ ] POST endpoint (§7.3) + validation + 409
- [ ] `AddModelModal.tsx` + ปุ่มใน NewPlacementPage (§7.4)
- [ ] i18n addModel keys
- [ ] test: เพิ่ม model จริง → โผล่ใน Select → cleanup ลบ row ทดสอบทิ้ง (verify count)

### Phase D — Reusable components
- [ ] `lib/exportTable.ts` + เพิ่ม `xlsx` ใน client deps
- [ ] `DataTable.tsx`
- [ ] `Paginator.tsx`
- [ ] `ChartTableCard.tsx` wrapper

### Phase E — Rewrite DashboardPage 4 tabs
- [ ] tab bar 4 ปุ่ม + lazy load per tab (cache)
- [ ] Tab ภาพรวม: ย้าย widget เดิม, ห่อด้วย ChartTableCard
- [ ] Tab KOL: ranking + platform + content category
- [ ] Tab สินค้า: ดูด ProductDashboard + product donut จาก marketing endpoint
- [ ] Tab เปรียบเทียบ: benchmark + Barter/Tier paginated
- [ ] i18n dashboard keys

### Phase F — Routing/sidebar cleanup
- [ ] App.tsx: redirect `/dashboard/products` + `/marketing` → `/dashboard`
- [ ] `/dashboard` guard → ProtectedRoute, `homePathFor` marketing → `/dashboard`
- [ ] Sidebar: ลบ dropdown + marketing link, ใส่ Dashboard link เดียวทุก role
- [ ] **ลบไฟล์** `MarketingDashboardPage.tsx`, `ProductDashboardPage.tsx` (ดูดเข้า DashboardPage แล้ว) — เช็ค import ค้างไม่มี

### Phase G — Verify + deploy
- [ ] `npm run build` ผ่าน (client + server)
- [ ] ESLint ผ่าน
- [ ] เทสแต่ละ role: admin (ทุก brand), manager (brand ตัวเอง), marketing (brand ตัวเอง เห็นครบ)
- [ ] เทส export ทุกตาราง + เพิ่ม model
- [ ] **เคลียร์ไฟล์ .md ที่ไม่ใช้แล้ว** (ดู §11)
- [ ] อัปเดต `CLAUDE.md` (เพิ่มงานนี้ในลำดับงานที่เสร็จ + แก้ §8 ว่า marketing เห็น dashboard ได้แล้ว + แก้ §4 ว่า products มี brand_id) + `MEMORY.md`/memory files ถ้าจำเป็น
- [ ] commit (ห้ามมี Co-Authored-By: Claude) + push main (auto-deploy)

---

## 11. เคลียร์ไฟล์ .md ที่ไม่ใช้แล้ว

> ทำหลังงานเสร็จ (Phase G). **ลบเฉพาะกลุ่ม A** ที่งานนี้แทนที่โดยตรง — กลุ่ม B ให้ถาม user ก่อนเสมอ (อาจยังอ้างอิงอยู่)

### กลุ่ม A — ลบแล้ว ✅ (ถูกแทนที่ด้วย `DASHBOARD_MERGE_*.md` + งานนี้)
หน้า Marketing Dashboard แบบแยก (`/marketing`) ถูกยุบรวมเข้า `/dashboard` แล้ว → plan/spec ของมันหมดอายุ — **ลบไปแล้วเมื่อ 2026-06-29 (`git rm`)**:
- [x] ~~`docs/superpowers/plans/2026-06-28-marketing-dashboard.md`~~ (ลบแล้ว)
- [x] ~~`docs/superpowers/specs/2026-06-28-marketing-dashboard-design.md`~~ (ลบแล้ว)

### กลุ่ม B — review ก่อนลบ (ไม่เกี่ยวงานนี้โดยตรง — ยืนยันกับ user)
- `DASHBOARD_ideas_plan.md` — backlog ข้อเสนอ dashboard; ข้อ A (monthly trend) / B (funnel) / C (category) / D (KPI) **ลงไปแล้ว** เหลือไอเดียที่ยังไม่ทำ → **ตัดส่วนที่ทำแล้วออก** หรือเก็บไว้เป็น backlog (CLAUDE.md §10 ยังอ้างถึงไฟล์นี้ — ถ้าลบต้องแก้ CLAUDE.md ด้วย)
- `HANDOFF_kol_offplatform_traffic_daily.md` — handoff การ sync off-platform traffic; งาน 50/51 **เสร็จแล้ว** (sync script + dashboard widget) แต่ยังมี TODO "automate sync (GitHub Actions)" ที่อาจอ้างไฟล์นี้ → archive ได้ถ้า automate เสร็จ/ตัดสินใจแล้ว
- `New-designDatabase.md` — ร่าง DB design ช่วงแรก (อังกฤษ/จีน) อาจ stale → ถาม user ว่ายังอ้างอิงอยู่ไหม
- `Design.md` — เอกสาร design language (Apple-style, accent #0066cc ที่เว็บใช้จริงอยู่) → **น่าจะเก็บไว้** เป็น reference ของระบบดีไซน์ ไม่ใช่ของงานนี้

> **กฎ:** อย่าลบไฟล์ที่ไม่ได้สร้างเองโดยไม่ยืนยัน — ถ้า CLAUDE.md อ้างถึงไฟล์ไหน ต้องแก้ reference พร้อมกัน

---

## 10. Gotchas เฉพาะงานนี้

1. **ห้ามแก้ schema ด้วยมือ** — ใช้ `prisma db pull` หลัง ALTER (CLAUDE.md ข้อ 0.2)
2. **`tsc --noEmit` เปล่าใช้ไม่ได้ใน client** — ใช้ `tsc -b` / `npm run build`
3. **AddModelModal ต้องใช้ `requestClose`** ไม่ใช่ `onClose` ตรง (useModalTransition)
4. **xlsx ต้อง lazy import** ในฟังก์ชัน export เท่านั้น (กัน initial bundle โต)
5. **i18n: เพิ่ม key ใน th.ts ก่อน** ให้ TS เตือน en/zh — เช็คตัวแปร `t` shadow ในแต่ละ effect
6. **brand filter ฝั่ง server เดิมกรอง brandIds อยู่แล้ว** — อย่าทำซ้ำฝั่ง client, อย่าเปิดช่องให้ marketing เห็น brand อื่น
7. **POST /api/products เช็ค brand ∈ brandIds** ถ้าไม่ใช่ admin (กัน marketing สร้าง model ให้ brand อื่น)
8. **Recharts:** `initialDimension` ถ้าใช้ width/height 100% + `animationDuration={500}` (ดู CLAUDE.md §9)
9. **ตอน rewrite DashboardPage อย่าทำ component พัง** — ย้าย sub-component (MetricBenchmarkCard, KolRankRow, FunnelCard ฯลฯ) ไปไฟล์แยกถ้าไฟล์ใหญ่เกิน (ไฟล์เดิม 1507 บรรทัด — แตกเป็น `components/dashboard/*` ได้)
10. **ProductTrendModal + KolTrendModal** ยังใช้ต่อใน tab สินค้า/KOL — อย่าลบ
