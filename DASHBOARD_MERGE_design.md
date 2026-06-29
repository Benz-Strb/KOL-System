# Dashboard Merge — Visual Design Spec

> คู่กับ `DASHBOARD_MERGE_plan.md` — ไฟล์นี้ลง detail visual ทุกอย่าง (สี, spacing, Tailwind class, ตำแหน่งปุ่ม) เพื่อให้ implement แล้วได้ดีไซน์ตรงกับระบบเดิมเป๊ะ
> **ปรัชญาดีไซน์ของ user:** เบา/minimal, เลี่ยงกรอบ/divider หนา, ใช้ token เดิม (`surface/hairline/ink/muted/canvas/accent`) — อย่าใส่ shadow ที่ไม่จำเป็น

---

## 0. Design tokens (ใช้ตามนี้ตลอด — มาจากระบบเดิม)

| Token | ใช้ทำอะไร |
|---|---|
| `bg-surface` | พื้น card |
| `bg-canvas` | พื้นหน้า / พื้น track bar / พื้น toggle group / zebra row |
| `border-hairline` | เส้นขอบบางทุกที่ |
| `text-ink` | ตัวอักษรหลัก |
| `text-muted` | label/รอง |
| `text-accent` `bg-accent` `bg-accent/10` | สีหลัก (น้ำเงิน) — ไอคอน, ปุ่ม primary, active ring |
| `bg-input-bg` `border-input-border` | ช่อง input/select |
| ตัวเลขทุกที่ | `tabular-nums font-mono` |
| Title การ์ด | `text-sm font-semibold text-ink` |
| Description | `text-[11px] text-muted` |
| Card | `bg-surface border border-hairline rounded-xl p-5` |

**สีกราฟ (คงเดิม):**
- Channel: shopee `#f97316`, lazada `#3b82f6`, website `#8b5cf6`, tiktok `#111827`, youtube `#ef4444`, lamon8 `#10b981`
- Bar GMV `#0066cc`, Bar/Line Spend/Orders `#f59e0b`
- Donut fallback: `['#f97316','#3b82f6','#8b5cf6','#111827','#ef4444','#10b981','#eab308','#ec4899','#06b6d4']`
- Off-platform: `['#3b82f6','#f97316','#8b5cf6','#10b981','#eab308','#ef4444']`
- Funnel stages: `['#3b82f6','#8b5cf6','#10b981']`
- Export green: `#217346` (hover `#1a5c38`)

---

## 1. Layout หน้ารวม

```
┌──────────────────────────────────────────────────────────────┐
│ Dashboard                              [⬇ Export Excel(เขียว)] │  ← header
│ คำอธิบายสั้น (subtitle)                                          │
├──────────────────────────────────────────────────────────────┤
│ ⚙ Filters                                       [✕ Clear All]  │  ← filter panel (card)
│ Brand[▾]  Campaign[▾]  หมวดคอนเทนต์[▾] │ ช่วงวันที่ [date]–[date] │
├──────────────────────────────────────────────────────────────┤
│ ( ภาพรวม )( KOL )( สินค้า )( เปรียบเทียบ )                       │  ← tab bar (segmented)
├──────────────────────────────────────────────────────────────┤
│                                                                │
│   widget cards (ตาม tab ที่เลือก, gap-6 / gap-8)                 │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```
- container: `px-4 sm:px-6 py-4 sm:py-6 max-w-screen-xl mx-auto` (เหมือนเดิม)
- header: `flex items-center justify-between gap-4 flex-wrap mb-5`
- filter panel: คง markup เดิมจาก DashboardPage (card `bg-surface border border-hairline rounded-xl p-4 mb-6`, label ทุกช่อง, ปุ่ม Clear All) — **ใช้ร่วมทุก tab**
- **Filter ต่อ tab:** Brand/Campaign/หมวด/วันที่ ใช้ร่วม. tab สินค้าใช้ `productCategories` ใน filter หมวด (สลับชุดหมวดตาม tab: KOL/ภาพรวม = contentCategories, สินค้า = productCategories) — หรือคงหมวดคอนเทนต์ไว้ tab เดียว ถ้าซับซ้อนไป ให้ filter หมวดโชว์เฉพาะ tab ที่ใช้

### Tab bar (segmented control)
```html
<div class="flex items-center gap-1 bg-canvas rounded-lg p-1 mb-6 w-fit">
  <button class="px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors
                 {active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}">
    {label}
  </button>
  ...×4
</div>
```
- ลำดับ: `ภาพรวม` `KOL` `สินค้า` `เปรียบเทียบ`
- responsive: บนจอแคบ ให้ scroll แนวนอน (`overflow-x-auto`) ไม่ wrap

---

## 2. ChartTableCard wrapper — header กับปุ่ม

```
┌─ Title การ์ด        description ───── [headerRight] [📊|▦] [⬇] ─┐
│                                                                │
│   chart  หรือ  DataTable                                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```
- card: `bg-surface border border-hairline rounded-xl p-5`
- header row: `flex items-start justify-between gap-3 mb-4`
  - ซ้าย: `<h2 class="text-sm font-semibold text-ink">{title}</h2>` + `<p class="text-[11px] text-muted mt-0.5">{description}</p>` (ถ้ามี)
  - ขวา (`flex items-center gap-2 shrink-0`): `headerRight` (เช่น GMV/ROI toggle, 7/30/90d) → **ปุ่ม view toggle** → **ปุ่ม export**

### ปุ่ม view toggle [กราฟ|ตาราง]  (segmented เล็ก เหมือน toggle เดิมในเว็บ)
```html
<div class="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
  <button title="กราฟ" class="px-2 py-1 rounded-md transition-colors
        {view==='chart' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}">
    <BarChart3 size={13} />
  </button>
  <button title="ตาราง" class="px-2 py-1 rounded-md transition-colors
        {view==='table' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}">
    <TableIcon size={13} />   <!-- lucide: Table หรือ Rows3 -->
  </button>
</div>
```
- ไอคอน lucide: กราฟ = `BarChart3`, ตาราง = `Table` (หรือ `LayoutList`)

### ปุ่ม Export (ต่อตาราง) — ขนาดเล็ก ไม่เด่นเท่าปุ่ม header
```html
<button title="Export Excel"
  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium
         text-[#217346] bg-[#217346]/10 hover:bg-[#217346]/20 active:scale-95 transition-all shrink-0">
  <Download size={12} /> Excel
</button>
```
- **โชว์ปุ่ม export ตลอด** (ทั้ง mode กราฟ/ตาราง) — กดได้เสมอ เพราะ export จากข้อมูล ไม่ใช่จากสิ่งที่เห็น
- สีปุ่ม export ต่อตาราง = **เขียว outline/soft** (`text-[#217346] bg-[#217346]/10`) ต่างจากปุ่ม header ที่เป็นเขียวทึบ (`bg-[#217346] text-white`) — ให้ลำดับชั้นชัด: header = export ทั้งหมด (เด่น), per-card = export เฉพาะ (เบา)

---

## 3. ปุ่ม Export ทั้งหมด (header) — คงสไตล์เดิม
```html
<button class="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#217346] text-white
   text-xs font-medium rounded-full hover:bg-[#1a5c38] active:scale-95
   disabled:opacity-50 disabled:active:scale-100 transition-all whitespace-nowrap shadow-sm">
  <Download size={12} /> Export Excel
</button>
```

---

## 4. DataTable — สไตล์ตาราง

```html
<div class="overflow-x-auto -mx-1 px-1">
  <table class="w-full text-xs">
    <thead>
      <tr class="text-muted border-b border-hairline">
        <th class="text-left  font-medium py-2 pr-2">{header ซ้าย}</th>
        <th class="text-right font-medium py-2 px-2">{header ตัวเลข}</th>
        ...
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-hairline last:border-0 hover:bg-canvas transition-colors">
        <td class="py-2.5 pr-2 text-ink">{ค่า text}</td>
        <td class="py-2.5 px-2 text-right text-ink tabular-nums font-mono">{ตัวเลข}</td>
        ...
      </tr>
    </tbody>
  </table>
</div>
```
**กติกา:**
- ข้อความ/ชื่อ ชิดซ้าย `text-ink`; ตัวเลข/เงิน/% ชิดขวา `tabular-nums font-mono`
- เงิน format `฿1,234` (helper `formatMoney` เดิม), % ทศนิยม 1 ตำแหน่ง, ROI `x1.23`
- คอลัมน์อันดับ (rank): `w-8 text-center text-muted font-semibold`
- คอลัมน์ที่มี avatar/logo (KOL/สินค้า/platform): cell มี `flex items-center gap-2` + `RankAvatar`/`PlatformLogo`/`ProductImage` (ใช้ component เดิม) + ชื่อ
- ไม่ต้อง zebra ทึบ — ใช้แค่ `border-b border-hairline` + `hover:bg-canvas` (เบาตามรสนิยม user)
- ถ้าแถวเยอะและ **ไม่ใช่** Barter/Tier → `max-h-[420px] overflow-y-auto` + header `sticky top-0 bg-surface`
- empty: `<p class="text-sm text-muted">{t('dashboard.noData')}</p>`

### คอลัมน์แต่ละตาราง (key → header)
| Widget | คอลัมน์ |
|---|---|
| Monthly trend | เดือน · Placements · GMV · Orders |
| GMV by Channel | Channel(สี+ชื่อ) · GMV · % · Orders · Visits |
| GMV vs Spend by Campaign | Campaign · GMV · Spend |
| Funnel | Stage · จำนวน · % ของ Visits  (+ แถวสรุป ATC rate / Conversion rate) |
| Off-platform daily | วันที่ · Revenue · Orders · Visits |
| Off-platform channel | Channel · Revenue · Orders |
| KOL Ranking | อันดับ · KOL(avatar+handle+gen) · Placements · [ROI ถ้า mode roi] · GMV |
| Platform Breakdown | Platform(logo+ชื่อ) · Placements · KOL count · GMV · % |
| Content Category | หมวด(สี+ชื่อ) · KOL count · Placements · GMV · Orders |
| Product Ranking | อันดับ · สินค้า(รูป+model_code+หมวด) · Placements · Orders · GMV |
| GMV by Product Category | หมวดสินค้า · GMV · % |
| GMV by Product SKU | SKU(model_code) · GMV · % |
| Price/Follower Benchmark | อันดับ · KOL · ค่า(ราคา/follower) · GMV |
| Barter vs Paid / Tier | อันดับ · KOL(avatar+handle+gen) · Placements · KOL Spend · GMV |

---

## 5. Paginator (Barter / Tier)

```
┌─ Barter vs Paid    desc ──── [Paid(12)|Barter(8)|Free(3)] [📊|▦] [⬇] ─┐
│  ตาราง 10 แถว                                                          │
│  ...                                                                   │
│  ───────────────────────────────────────────────────────────────────  │
│  แสดง 1–10 จาก 23            [‹ ก่อนหน้า]  หน้า 1 / 3  [ถัดไป ›]        │
└───────────────────────────────────────────────────────────────────────┘
```
- group tabs (Paid/Barter/Free หรือ tier) = segmented เดิม `bg-canvas rounded-lg p-1`, ปุ่ม `px-2.5 py-1 rounded-md text-xs font-medium` + badge นับ `({n})` สี muted
- footer: `flex items-center justify-between gap-3 pt-3 mt-2 border-t border-hairline text-xs`
  - ซ้าย: `<span class="text-muted">{t('dashboard.paginatorShowing',{from,to,total})}</span>`
  - ขวา: ปุ่ม prev/next + ข้อความหน้า
    ```html
    <button class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-muted
       hover:text-ink hover:bg-canvas disabled:opacity-40 disabled:hover:bg-transparent
       transition-colors" disabled={page===1}>
      <ChevronLeft size={13}/> ก่อนหน้า
    </button>
    <span class="text-muted tabular-nums">หน้า {page} / {pages}</span>
    <button ...disabled={page===pages}>ถัดไป <ChevronRight size={13}/></button>
    ```
- **PAGE_SIZE = 10** (const บนสุดไฟล์)
- เปลี่ยน group → `setPage(1)`
- Export = export ทั้งกลุ่มที่เลือก (ทุกหน้า) ไม่ใช่แค่หน้าที่เห็น

---

## 6. KPI slab (ภาพรวม) — คงเดิม ไม่มี toggle
ใช้ markup เดิมเป๊ะ (SlabCell, grid-cols-7 + grid-cols-4, divider hairline, section label "ตัวชี้วัดหลัก"/"ประสิทธิภาพ"). เพิ่ม Total Cost ได้ถ้าต้องการ (KOL Spend + Ads Cost) เป็น SlabCell เพิ่ม. **ไม่ใส่ปุ่ม export/toggle ที่ slab** (เป็น scalar)

---

## 7. AddModelModal — เพิ่ม model

### Entry point (NewPlacementPage, section สินค้า online)
ใต้ Select products:
```html
<button type="button" onClick={openAddModel}
  class="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover
         mt-1.5 transition-colors">
  <Plus size={12} /> {t('addModel.addModelButton')}   <!-- "+ เพิ่ม model ใหม่" -->
</button>
```
- โผล่เมื่อ `form.brand_id` ถูกเลือกแล้วเท่านั้น (model ต้องผูก brand)
- ถ้ายังไม่เลือก brand → ปุ่มซ่อน หรือ disabled + tooltip "เลือกแบรนด์ก่อน"

### Modal (ใช้ `Modal` component + `useModalTransition`/`requestClose`)
```
┌─ เพิ่ม Model ใหม่                                    ✕ ─┐
│                                                        │
│  Model code *                                          │
│  [____________________________]                        │
│  ⚠ model code นี้มีอยู่แล้ว   (error inline สีแดง)        │
│                                                        │
│  หมวดสินค้า  (ไม่บังคับ)                                  │
│  [ เลือกหมวด ▾ ]                                        │
│                                                        │
│  รูปสินค้า URL  (ไม่บังคับ)                               │
│  [____________________________]                        │
│                                                        │
│                         [ ยกเลิก ]  [ บันทึก (accent) ] │
└────────────────────────────────────────────────────────┘
```
- ขนาด: `max-w-md w-full`
- header: `text-base font-semibold text-ink` + ปุ่ม X (`requestClose`)
- field label: `text-xs font-medium text-muted mb-1`
- input: `w-full px-3 py-2 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent`
- หมวดสินค้า: `Select` component เดิม (options จาก `productCategories`, มีตัวเลือก "— ไม่ระบุ —")
- footer: `flex justify-end gap-2 mt-6`
  - ยกเลิก: `px-4 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-canvas transition-colors` → `requestClose`
  - บันทึก: `px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover active:scale-95 disabled:opacity-50 transition-all` — disabled ถ้า model_code ว่าง หรือกำลัง submit
- validation:
  - model_code ว่าง → ปุ่มบันทึก disabled
  - submit แล้ว 409 → error inline ใต้ช่อง model_code (`text-xs text-red-500 mt-1`) ข้อความ `t('addModel.duplicateError')`
- success: ปิด modal (`requestClose`) → refetch products → `set('product_id', newId)` → optional Toast เขียว `t('addModel.addModelSuccess')`

---

## 8. i18n keys เต็ม (เติม th → en → zh)

> domain terms ไม่แปล: KOL, GMV, ROI, Excel, Barter, Paid, Free, Platform, Model, SKU, Campaign, Placement(s), Visits, Orders, ATC, Tier

### `dashboard.*`
| key | th | en | zh |
|---|---|---|---|
| tabKol | KOL | KOL | KOL |
| tabProducts | สินค้า | Products | 产品 |
| tabTools | เปรียบเทียบ | Compare | 对比 |
| viewChart | กราฟ | Chart | 图表 |
| viewTable | ตาราง | Table | 表格 |
| exportTable | ดาวน์โหลด Excel | Export Excel | 导出 Excel |
| paginatorShowing | แสดง {{from}}–{{to}} จาก {{total}} | Showing {{from}}–{{to}} of {{total}} | 显示 {{from}}–{{to}} / {{total}} |
| paginatorPage | หน้า {{page}} / {{pages}} | Page {{page}} / {{pages}} | 第 {{page}} / {{pages}} 页 |
| paginatorPrev | ก่อนหน้า | Prev | 上一页 |
| paginatorNext | ถัดไป | Next | 下一页 |
| colRank | อันดับ | Rank | 排名 |
| colKol | KOL | KOL | KOL |
| colProduct | สินค้า | Product | 产品 |
| colChannel | Channel | Channel | Channel |
| colPlatform | Platform | Platform | Platform |
| colCategory | หมวด | Category | 类别 |
| colMonth | เดือน | Month | 月份 |
| colCampaign | Campaign | Campaign | Campaign |
| colOrders | Orders | Orders | Orders |
| colVisits | Visits | Visits | Visits |
| colPlacements | Placements | Placements | Placements |
| colSpend | KOL Spend | KOL Spend | KOL Spend |
| colPercent | % | % | % |
| colRoi | ROI | ROI | ROI |
| colStage | Stage | Stage | 阶段 |
| colConversion | Conversion | Conversion | 转化 |
| colDate | วันที่ | Date | 日期 |
| colRevenue | Revenue | Revenue | Revenue |
| colFollower | Followers | Followers | Followers |
| colSku | SKU | SKU | SKU |
| colTier | Tier | Tier | Tier |
| colKolCount | จำนวน KOL | KOLs | KOL 数 |

(GMV ใช้ literal "GMV" ใน header ตรงๆ ไม่ต้อง key)

### `addModel.*` (namespace ใหม่ หรือใส่ใน newPlacement)
| key | th | en | zh |
|---|---|---|---|
| addModelButton | + เพิ่ม model ใหม่ | + Add new model | + 添加新 model |
| addModelTitle | เพิ่ม Model ใหม่ | Add New Model | 添加新 Model |
| modelCodeLabel | Model code | Model code | Model code |
| modelCodePlaceholder | เช่น Dreame X40 | e.g. Dreame X40 | 例如 Dreame X40 |
| categoryLabel | หมวดสินค้า (ไม่บังคับ) | Category (optional) | 类别（可选） |
| imageUrlLabel | รูปสินค้า URL (ไม่บังคับ) | Image URL (optional) | 图片 URL（可选） |
| selectBrandFirst | เลือกแบรนด์ก่อน | Select a brand first | 请先选择品牌 |
| save | บันทึก | Save | 保存 |
| cancel | ยกเลิก | Cancel | 取消 |
| duplicateError | model code นี้มีอยู่แล้ว | This model code already exists | 该 model code 已存在 |
| addModelSuccess | เพิ่ม model เรียบร้อย | Model added | 已添加 model |

---

## 9. Responsive
- tab bar: scroll แนวนอนบนมือถือ (`overflow-x-auto`), ไม่ wrap
- ChartTableCard header ที่มี headerRight เยอะ (เช่น KOL ranking channel tabs) → `flex-wrap` ได้
- ตาราง: `overflow-x-auto` เสมอ (กันล้นจอแคบ)
- Paginator footer: บนจอแคบ ให้ stack (`flex-col sm:flex-row gap-2`)
- AddModelModal: `max-w-md w-full mx-4` (เว้นขอบจอมือถือ)
- KPI slab: `overflow-x-auto` + `min-w-[700px]` เดิม

---

## 10. สรุปไฟล์ที่แตะ

**สร้างใหม่:**
- `client/src/lib/exportTable.ts`
- `client/src/components/DataTable.tsx`
- `client/src/components/Paginator.tsx`
- `client/src/components/ChartTableCard.tsx`
- `client/src/components/AddModelModal.tsx`
- `client/src/components/dashboard/*` (ถ้าแตก sub-component ออกจาก DashboardPage)
- `scripts/add_brand_to_products.py`

**แก้:**
- `client/src/pages/DashboardPage.tsx` (rewrite 4 tabs)
- `client/src/pages/NewPlacementPage.tsx` (ปุ่ม + AddModelModal)
- `client/src/App.tsx` (routing/sidebar/homePathFor)
- `client/src/i18n/th.ts` `en.ts` `zh.ts`
- `client/src/api/index.ts` (createProduct, ถ้าต้องเพิ่ม marketing/product fetch ใน DashboardPage)
- `client/package.json` (+ xlsx)
- `server/src/routes/dashboard.ts` (role gating ×6)
- `server/src/routes/products.ts` (POST + แก้ dropdown query)
- `server/prisma/schema.prisma` (ผ่าน db pull — brand_id)

**ลบ:**
- `client/src/pages/MarketingDashboardPage.tsx`
- `client/src/pages/ProductDashboardPage.tsx`
