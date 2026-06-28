# Design: หน้า Marketing Dashboard + เติม Visits KPI ให้ Manager

> วันที่ 2026-06-28 · แนวทาง A (หน้าใหม่แยก + endpoint ใหม่)
> ที่มา: ฝ่าย marketing ขอเห็น Total GMV / Total Cost / Total Ads cost / Total Visit Shopee·Lazada
> + GMV contribution donuts (อ้างอิงภาพ `20260628-183001.jpg`, `20260628-183007.jpg`)

---

## 1. เป้าหมาย & ขอบเขต

ทำหน้า dashboard เฉพาะฝ่าย **marketing** (ปัจจุบัน marketing ถูกบล็อกจาก dashboard ทั้งหมด — `dashboard.ts` ใช้ `requireRole('admin','manager')`) โดย:

- marketing **ยังคงไม่เห็นหน้า dashboard เดิม** (KOL ranking, ROI, เครื่องมือเปรียบเทียบ, kolValueList)
- หน้าใหม่โชว์เฉพาะข้อมูลระดับภาพรวม + contribution ไม่มีข้อมูลรายคน (KOL-level)
- เติมตัวชี้วัดที่ marketing อยากเห็นแต่ manager ยังไม่มี เข้าไปในหน้า manager dashboard ด้วย

### Out of scope (ยืนยันแล้ว)
- **GMV by Type** (Offline/O2O/Branding/Rich Menu/Product/Promotion) — DB ไม่มี taxonomy นี้ → **ข้ามไปก่อน** จนกว่าจะมี mapping
- ไม่ทำ KOL ranking / ROI / เครื่องมือเทียบ ในหน้า marketing

---

## 2. ข้อมูล (ยืนยันว่ามีจริงใน DB)

| ต้องใช้ | แหล่ง |
|---|---|
| Total GMV | `placement_metrics.gmv` |
| ค่าตัว KOL (KOL cost) | `placements.pay_amount/final_price` (= `total_spend` เดิม) |
| Ads cost | `placements.ads_cost` (ข้อมูลเบาบาง ~5 แถว — โชว์ตามจริง) |
| Total Cost | KOL cost + Ads cost |
| Visits ต่อช่องทาง (Shopee/Lazada) | `placement_metrics.visits` group by `channel` (มีใน `channelBreakdown` เดิม) |
| GMV by Platform | `placements.platform_id` → `platforms` (FB/TikTok/YT/IG/Lemon8) |
| GMV by Product Category | `products.product_category_id` → `product_categories` (logic เดียวกับ `buildProductDashboard`) |
| GMV by Product SKU | `products.model_code` (canonical resolve เหมือน product dashboard) |
| GMV by Content Category | `kols.content_category_id` → `content_categories` (logic เดียวกับ `categoryBreakdown` ที่เพิ่งทำ) |

---

## 3. Backend

### Endpoint ใหม่: `GET /api/dashboard/marketing`
- **สิทธิ์:** admin / manager / marketing
  - แยก middleware: ปัจจุบัน `app.use('*', requireAuth, requireRole('admin','manager'))` ครอบทุก route ในไฟล์ → ต้องปรับให้ route นี้ allow marketing ด้วย
  - วิธี: เปลี่ยน global middleware เป็น `requireAuth` อย่างเดียว แล้วใส่ `requireRole(...)` ราย route (route เดิมทั้งหมดคง `requireRole('admin','manager')`, route ใหม่ใช้ `requireRole('admin','manager','marketing')`) — กัน regression ของ route เดิม
- **Brand scope:** ใช้ `buildDashboardBrandFilter(user.role, user.brandIds, brand_id)` เดิม (marketing/manager กรองตาม `brandIds`, admin เห็นทั้งหมด)
- **Query params:** `brand_id`, `date_from`, `date_to` (ไม่มี campaign/category filter)
- **Response shape:**
```ts
{
  summary: {
    total_gmv: number;
    kol_cost: number;        // = total_spend เดิม
    ads_cost: number;
    total_cost: number;      // kol_cost + ads_cost
    visits_shopee: number;
    visits_lazada: number;
    total_visits: number;
  };
  byPlatform: { platform_id: number; platform_name: string; gmv: number }[];
  byProductCategory: { category_id: number; category_name: string; gmv: number }[];
  byProductSku: { canonical_id: number; model_code: string | null; gmv: number }[]; // top 8 + แถวรวม (canonical_id=-1, model_code=null → frontend แสดงป้าย "อื่นๆ" ผ่าน i18n)
  byContentCategory: { category_id: number; category_name: string; gmv: number }[];
}
```
- **DRY:** reuse SQL pattern จาก `buildDashboardOverview` (platform/content category) และ `buildProductDashboard` (product category/SKU canonical resolve) — แยกเป็น `buildMarketingDashboard()` ใน `dashboard.ts`
- **SKU top 8 + อื่นๆ:** query เรียง GMV desc, ตัด 8 แรก, ที่เหลือ sum รวมเป็น 1 entry `{ canonical_id: -1, model_code: null, gmv }` (frontend แปลงป้ายเป็น "อื่นๆ" ผ่าน i18n เมื่อ `canonical_id === -1`)

---

## 4. Frontend — หน้าใหม่ `MarketingDashboardPage` (`/marketing`)

### Route & Nav
- `App.tsx`: เพิ่ม `<Route path="/marketing">` ภายใต้ `ProtectedRoute` (ทุก role ที่ login เข้าได้ — endpoint คุมสิทธิ์ข้อมูลอยู่แล้ว)
- `homePathFor()`: marketing → `/marketing` (เดิม admin/manager → `/dashboard`, อื่นๆ → `/placements`)
- Sidebar: เพิ่ม NavLink top-level "Marketing Dashboard" (icon เช่น `BarChart3`/`PieChart`) **เห็นได้ทุก role** (marketing/manager/admin) — แยกจาก section "Dashboard" เดิมที่ยังเป็น admin/manager เท่านั้น

### Layout
- **Header:** ชื่อหน้า + ปุ่ม Export Excel (optional — ทำได้ภายหลัง, ไม่บังคับรอบนี้)
- **Filter:** Brand (เฉพาะที่มีสิทธิ์), ช่วงวันที่ (date range) — เท่านั้น
- **KPI row** (6 ใบ): Total GMV · Total Cost (KOL+Ads) · ค่าตัว KOL · Ads Cost · **Visits Shopee** · **Visits Lazada**
- **GMV Contribution** (grid 2 คอลัมน์, donut + legend สไตล์เดียวกับ `gmvByChannel` เดิม):
  1. by Platform
  2. by Product Category
  3. by Product SKU (Top 8 + อื่นๆ)
  4. by Content Category
- ใช้ component/สไตล์เดิม: `KpiCard` pattern, donut (`ResponsiveContainer`+`PieChart`), `FALLBACK_COLORS`, `formatMoney`, race-condition guard (`seq` ref), `swrCache`

### API client
- `client/src/api/index.ts`: เพิ่ม type `MarketingDashboard` + `getMarketingDashboard(params)`

---

## 5. Manager dashboard — เติมที่ขาด (มีแล้วข้าม)

| ตัวชี้วัด | สถานะใน manager dashboard |
|---|---|
| Total GMV | ✅ มีแล้ว (KPI) → ข้าม |
| ค่าตัว KOL | ✅ มีแล้ว ("ค่าใช้จ่าย KOL") → ข้าม |
| Ads cost | ✅ มีแล้ว ("Ads Cost") → ข้าม |
| GMV by Platform / Content category | ✅ มีแล้ว → ข้าม |
| **Visits แยก Shopee/Lazada** | ⚠️ มีแค่ใน Funnel (ไม่เป็น KPI ชัด) → **เพิ่ม** |

**เพิ่ม:** KPI "Visits Shopee" + "Visits Lazada" เข้าแถว "ตัวชี้วัดหลัก" (totals) ของ DashboardPage
- ดึงจาก `data.channelBreakdown` ที่มีอยู่แล้ว (มี `visits` ต่อ channel) — **ไม่ต้องแก้ backend dashboard overview**
- แถว totals จาก 5 ใบ → 7 ใบ (ปรับ grid ให้สมดุล เช่น `lg:grid-cols-7` หรือจัด layout ตามเหมาะสม)

---

## 6. ไฟล์ที่จะถูกแตะ

**Backend**
- `server/src/routes/dashboard.ts` — ปรับ middleware เป็น per-route role, เพิ่ม `buildMarketingDashboard()` + `GET /marketing`

**Frontend**
- `client/src/api/index.ts` — type + `getMarketingDashboard`
- `client/src/pages/MarketingDashboardPage.tsx` — ใหม่
- `client/src/App.tsx` — route + nav link + `homePathFor` marketing
- `client/src/pages/DashboardPage.tsx` — เพิ่ม KPI Visits Shopee/Lazada (manager)
- `client/src/i18n/locales/{th,en,zh}.ts` — key ใหม่ (th ก่อน ตามกฎ `satisfies Translations`)

---

## 7. ความเสี่ยง / ข้อควรระวัง
- **เปลี่ยน middleware ใน dashboard.ts** ต้องไม่ทำให้ route เดิมหลุดสิทธิ์ → ใส่ `requireRole('admin','manager')` ครบทุก route เดิม ตรวจด้วย verify หลังแก้
- Ads cost เบาบาง → Total Cost จะ ≈ ค่าตัว KOL เกือบทั้งหมด (สื่อสารตามจริง ไม่ปั้นตัวเลข)
- platforms ของเรา (FB/TikTok/YT/IG/Lemon8) ไม่ตรงกับภาพอ้างอิง (Tiktok/Line/FB) — ใช้ของจริงในระบบ
- domain terms (GMV/Visits/Shopee/Lazada/SKU ฯลฯ) คงเป็น English ทุกภาษา ตามกฎ i18n
