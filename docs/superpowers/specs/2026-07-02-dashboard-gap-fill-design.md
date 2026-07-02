# Dashboard Gap-Fill — เติมเมตริกที่ยังขาดจากรูปอ้างอิง

> **สถานะ:** Design (approved) — รอ implementation plan
> **วันที่:** 2026-07-02
> **ไฟล์ที่เกี่ยว:** `server/src/routes/dashboard.ts`, `client/src/pages/DashboardPage.tsx`, `client/src/api/index.ts`, `client/src/components/RankingList.tsx` (ใหม่), `client/src/i18n/locales/{th,en,zh}.ts`, `CLAUDE.md`
> **ต้นทาง:** user ส่ง 5 รูป screenshot ของ dashboard เครื่องมืออื่น (แบรนด์ "Dreame Performance 2026") ขอให้เทียบกับ dashboard ของเราแล้วเติมเมตริก/กราฟที่ยังไม่มี

---

## 0. สรุปสิ่งที่พบจากการเทียบ (baseline)

### ทำไม่ได้เลยตอนนี้ (ข้อมูลไม่มีจริงใน DB)
- **CPM** และ **Total Impression** — `placement_metrics.impressions` มีอยู่ใน schema แต่เป็น `NULL` 100% (0/1,562 แถว ยืนยันด้วย query ตรง) ไม่มีบอทหรือคนกรอกเลย
- **ไม่อยู่ใน scope งานนี้** — บันทึกเป็น backlog ใน CLAUDE.md เหมือนรายการ engagement columns อื่นที่ว่างอยู่แล้ว (likes/comments/saves/views)

### ของซ้ำที่ต้องลบ (พบระหว่างไล่โค้ด — ไม่มีใครใช้เลย)
- `buildMarketingDashboard()` คำนวณ `byPlatform` (platform_id/platform_name/gmv) และ `byContentCategory` (category_id/category_name/gmv) แต่ **ไม่มีจุดไหนใน `DashboardPage.tsx` เรียกใช้เลย** (grep ยืนยันแล้ว) — ซ้ำกับ `data.platformBreakdown` และ `data.categoryBreakdown` (จาก `buildDashboardOverview()`) ที่มีข้อมูลครบกว่าและถูกใช้งานจริงอยู่แล้ว
- **การกระทำ**: ลบ `byPlatform`/`byContentCategory` ออกจาก `buildMarketingDashboard()`, `EMPTY_MARKETING`, และ type ฝั่ง client (`MarketingDashboardResponse`) — ยืนยันแล้วว่าไม่กระทบ export ใดๆ

### ของที่ backend มีอยู่แล้ว แต่ frontend "ไม่เอามาโชว์" (bug เก่า ไม่ใช่ feature ใหม่)
| จุด | field ที่ backend ส่งอยู่แล้ว | ปัญหา |
|---|---|---|
| `DashboardPlatformRow` (client type) | `total_spend` | backend query มี แต่ type ฝั่ง client ไม่ประกาศไว้ → ไม่ได้ render |
| `DashboardCategoryRow` (client type) | `spend` | เดียวกัน |
| `ProductRankRow` (client type) | `total_spend` | เดียวกัน |

---

## 1. กฎกลาง (cross-cutting rules)

**นิยาม "Cost" ให้ตรงกันทุกจุดในเว็บ** = KOL Spend (`pay_amount` ?? `final_price`) + Ads Cost (`ads_cost`) รวมกัน
- อิงจากรูปอ้างอิง image 2: KOL Cost 1,900,732 + Ads Cost 1,158,932 = Total Expenses 3,059,664 (ตรงเป๊ะ) ยืนยันนิยามนี้แล้ว
- ใช้นิยามเดียวกันนี้ในทุกกราฟ/การ์ดที่มีคำว่า "Cost" (Platform Breakdown, Content Category Breakdown, Product Category, Product SKU, Product Ranking)

**"Total Visit"** = SUM(`placement_metrics.visits`) ทุก channel (shopee+lazada+website — channel อื่น เช่น youtube/lemon8 ไม่มีข้อมูล visits อยู่แล้วเพราะเป็น manual entry channel ไม่ใช่ marketplace) — field นี้ (`summary.total_visits`) มีอยู่แล้วใน backend แค่ยังไม่โชว์เป็นการ์ด KPI

**ranking style ใหม่ (ยืนยันผ่าน visual companion แล้ว):** ribbon badge สีทอง/เงิน/ทองแดง (ไม่ใช้ไอคอนเหรียญ) สำหรับอันดับ 1-3, ป้ายสี่เหลี่ยมมนสีเทาสำหรับอันดับ 4+, มีเส้นคั่น (`border-bottom: 1px solid hairline`) ระหว่างทุกแถว — ใช้ component เดียวกันทั้ง KOL Ranking และ Product Ranking

---

## 2. Backend changes (`server/src/routes/dashboard.ts`)

### 2.1 `buildDashboardOverview()` — ใช้โดย `GET /api/dashboard/`
- **`campaignTrend` query**: เพิ่ม `COALESCE(SUM(pm.visits), 0)::int AS visits` เข้า subquery `pm` (ปัจจุบันมีแค่ gmv/orders) → เพิ่ม field `visits` ใน return type
- **`platformAgg` query** (→ `platformBreakdown`): เพิ่ม ads_cost เข้า `placement_spend` CTE (`SUM(ads_cost)` แยกจาก `SUM(spend)` เดิม) แล้วรวมเป็น `total_cost = total_spend + total_ads_cost` ใน SELECT
- **`categoryBreakdown` query**: เพิ่ม ads_cost (เหมือน platformAgg) และเพิ่ม `SUM(pm.visits)` → ได้ `total_cost` + `visits` เพิ่มจากที่มี `spend`/`gmv`/`orders`/`kol_count` อยู่แล้ว
- **`summary`**: เพิ่ม `total_kol_count: COUNT(DISTINCT kol_id)` จาก placement ที่ match filter (query ใหม่ ไม่ซับซ้อน — นับจาก `matched` array ที่มีอยู่แล้ว ต้อง select `kol_id` เพิ่มใน `matched` query)

### 2.2 `buildProductDashboard()` — ใช้โดย `GET /api/dashboard/products` (Product Ranking widget)
- เพิ่ม `SUM(placements.ads_cost)` เข้า `placement_spend` CTE (แยกเป็น `ads_cost` คนละ field จาก `spend` เดิม) → ได้ `total_ads_cost` ต่อสินค้า
- เพิ่ม `SUM(pm.visits)` เข้า `metric_agg` CTE → ได้ `total_visits` ต่อสินค้า
- ผลลัพธ์: ranking แต่ละแถวมีครบ `total_gmv`, `total_spend`, `total_ads_cost`, `total_visits`, `total_orders`, `placement_count` — พอสำหรับปุ่มสลับเกณฑ์เรียง 4 แบบ (GMV/Ads Spent/Visit/Orders) โดยไม่ต้องเพิ่ม endpoint ใหม่

### 2.3 `buildMarketingDashboard()` — ใช้โดย `GET /api/dashboard/marketing` (Products tab donuts)
- **ลบ** `byPlatform`, `byContentCategory` ทิ้งทั้งคู่ (ดูเหตุผลข้อ 0)
- **`byProductCategory` query**: ปัจจุบันมีแค่ `gmv` (ไม่มี `placement_spend` CTE เช่นกัน) — เพิ่ม CTE `placement_spend` (KOL spend + ads_cost รวมเป็น `total_cost` ตามนิยามข้อ 1) และเพิ่ม `SUM(pm.visits)` เข้า `metric_agg` เดิม → ได้ cost/visit ต่อ category
- **`byProductSku` query**: ปัจจุบันมีแค่ `gmv` (ไม่มี `placement_spend` CTE เลย) — ต้องเพิ่ม CTE `placement_spend` (join `placements.pay_amount`/`final_price` + `ads_cost`) เข้าไปใหม่ เพื่อคำนวณ `total_cost` ตามนิยามรวม (ข้อ 1) ต่อ SKU — ไม่ต้อง visit (รูปอ้างอิงไม่มี visit ใน SKU chart)

### 2.4 Type changes
เพิ่ม field ตามข้อ 2.1–2.3 ใน type ที่เกี่ยวข้องทั้งฝั่ง server (`server/src/routes/dashboard.ts`) และ client (`client/src/api/index.ts`): `DashboardCampaignTrendRow`, `DashboardPlatformRow`, `DashboardCategoryRow`, `ProductRankRow`, `ProductDashboardOverview.summary`, `MarketingDashboardResponse` (ลบ byPlatform/byContentCategory ออก), `DashboardOverview.summary` (เพิ่ม total_kol_count)

---

## 3. Frontend changes (`client/src/pages/DashboardPage.tsx`)

### 3.1 Overview tab
- KPI slab แถว 1 เพิ่ม 3 การ์ด: **Total Expenses** (`data.summary.total_spend + data.summary.total_ads_cost` — คำนวณฝั่ง client ไม่ต้องเพิ่ม backend field), **Total Visit** (`data.summary.total_visits` — มีอยู่แล้ว), **Total KOL** (`data.summary.total_kol_count` — backend ใหม่)
- "GMV vs Spend by Campaign" bar chart → เพิ่มแท่ง/เส้น Visit (ใช้ field `visits` ใหม่ใน `campaignTrend`)

### 3.2 KOL tab
- **Platform Breakdown**: เพิ่มคอลัมน์ Cost (`total_spend + total_ads_cost` ต่อ platform)
- **Content Category Breakdown**: เพิ่มคอลัมน์ Cost + Visit
- **KOL Ranking**: restyle ให้ใช้ `RankingList` component ใหม่ (ribbon + เส้นคั่น) แทนเลขอันดับ+avatar ธรรมดาเดิม — ข้อมูล/logic เดิมไม่เปลี่ยน แค่เปลี่ยนการแสดงผล

### 3.3 Products tab
- **GMV by Product Category (donut)**: ตัว donut ยังแบ่งสัดส่วนตาม GMV เหมือนเดิม (ไม่เปลี่ยน) — เพิ่ม Cost + Visit เป็น **คอลัมน์ใหม่ในลิสต์ legend ข้างๆ donut** (ปัจจุบันมีแค่ ชื่อ/GMV/%) และใน `table.columns` ของปุ่ม export .xlsx
- **GMV by Product SKU (donut)**: เพิ่ม Cost แบบเดียวกัน (คอลัมน์ใหม่ใน legend list + export table, donut ยังคง GMV เป็นหลัก)
- **Product Ranking → อัปเกรดใหญ่สุด**:
  - Restyle เป็น `RankingList` component (ribbon + เส้นคั่น)
  - เพิ่มปุ่มสลับเกณฑ์เรียง (pill-toggle 4 ปุ่ม เหมือน pattern GMV/ROI ของ KOL Ranking): **GMV / Ads Spent / Visit / Orders**
  - ข้อมูลทั้ง 4 เกณฑ์มาจาก response เดียวกัน (ข้อ 2.2) — สลับแค่ sort/format ฝั่ง client ไม่ fetch ใหม่

### 3.4 Component ใหม่: `client/src/components/RankingList.tsx`
```ts
interface RankingListProps {
  rows: { rank: number; name: string; value: string /* formatted */; image?: string | null; onClick?: () => void }[];
}
```
Render แถวสไตล์ที่ยืนยันแล้ว (ribbon ทอง #1 / เงิน #2 / ทองแดง #3 / ป้ายเทาอันดับ 4+, เส้นคั่นทุกแถว) ใช้ร่วมกันทั้ง KOL Ranking และ Product Ranking — ไม่ทำ component แยก 2 ตัว

---

## 4. Out of scope

- CPM, Total Impression — ข้อมูล impressions ว่าง 100% ไม่มีทางทำได้จนกว่าจะมีคนเริ่มกรอก/บอทดึงข้อมูลนี้ → บันทึกเป็น backlog ใน CLAUDE.md
- "Unit Sale" ranking แยกต่างหาก — ใช้ `Orders` เป็นตัวแทน (ข้อมูล unit-level exact count ไม่มีในระบบ มีแค่ order count) ครอบคลุมด้วยปุ่มสลับเกณฑ์ "Orders" ในข้อ 3.3 แล้ว ไม่ต้องทำ widget แยก
- Ranking แยก 4 การ์ด (GMV/Ads Spent/Visit/Orders วางเรียงกัน) ตามรูปต้นฉบับ — เลือกใช้การ์ดเดียวมีปุ่มสลับแทน (Approach B ที่ user เลือก) เพื่อไม่ให้ query/widget ซ้ำซ้อนและหน้าเว็บไม่ยาวเกินไป

---

## 5. แผนทดสอบ (verification)

1. `npx tsc -b` ทั้ง `server/` และ `client/` ต้องผ่านสะอาด
2. ESLint ทั้งสองฝั่งต้องไม่มี error ใหม่ (error เดิมที่มีอยู่ก่อนแก้ ปล่อยผ่านได้)
3. เทียบตัวเลขที่โชว์บนเว็บกับ SQL query ตรงจาก DB จริง (pattern เดียวกับที่ใช้ตรวจงาน pagination/order-by ก่อนหน้านี้ในเซสชัน) อย่างน้อยครบทุกจุดที่แก้: Total Expenses, Total Visit, Total KOL, Campaign Visit, Platform Cost, Content Category Cost+Visit, Product Category Cost+Visit, Product SKU Cost, Product Ranking ครบ 4 เกณฑ์การเรียง
4. Screenshot ยืนยันดีไซน์ ribbon ใหม่ — KOL Ranking และ Product Ranking ต้องหน้าตาตรงกัน (ใช้ component เดียวกันจริง ไม่ใช่ copy code)
5. เพิ่ม i18n key ครบ 3 ภาษา (ไทย/EN/จีน) ตามระบบเดิม (เพิ่มใน `th.ts` ก่อน → TS จะ error ถ้า `en.ts`/`zh.ts` ขาด key เพราะ `satisfies Translations`)
6. เพิ่ม backlog note ใน CLAUDE.md เรื่อง CPM/Impressions (มติ 2026-07-02)
7. ยืนยันว่าลบ `byPlatform`/`byContentCategory` แล้วไม่มี error จาก reference ที่หลงเหลือ (`tsc -b` จะจับได้เองถ้ามี)
