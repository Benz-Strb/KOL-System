# แผนเพิ่มความละเอียดให้หน้า Dashboard

> เอกสารนี้เป็น **ข้อเสนอ** ยังไม่ลงมือทำ — เขียนไว้ให้พี่อ่านก่อนตัดสินใจว่าจะทำอันไหนบ้าง
> อ้างอิงจาก: โค้ดจริง (`DashboardPage.tsx` + `server/src/routes/dashboard.ts`), schema จริง (`schema.prisma`), และ **fill-rate ของข้อมูลจริงใน DB** (query สดวันที่ 2026-06-27)

---

## 1. Dashboard ตอนนี้โชว์อะไรอยู่แล้ว

**แท็บ "ภาพรวม"**
- KPI 6 ใบ: GMV รวม / ROI / ค่าตัว KOL / Orders / Placement (posted·planned·cancelled) / Ads Cost
- GMV แยกตามช่องทางขาย (donut: shopee/lazada/website) + tooltip แยก campaign
- GMV vs ค่าใช้จ่าย ต่อแคมเปญ (bar)
- Platform Breakdown (KOL โพสต์บน Facebook/TikTok/... กี่ placement + GMV)
- Top 10 KOL (toggle GMV / ROI) + ช่องค้นหา KOL
- Off-Platform Traffic (Shopee Ads รายวัน + donut แยก channel)

**แท็บ "เครื่องมือเปรียบเทียบ"**
- เทียบราคา/follower กับ GMV (พิมพ์ค่า → หา KOL ใกล้เคียง)
- เทียบ Paid vs Barter vs Free
- เทียบตาม Follower Tier

---

## 2. ความจริงเรื่องข้อมูล (สำคัญ — กำหนดว่าทำอะไรได้/ไม่ได้)

เช็คจาก DB จริง (`placement_metrics` 1,562 แถว / `placements` 1,237 แถว):

### ✅ คอลัมน์ที่ "มีข้อมูลจริง" → เอามาทำ widget ได้เลย
| คอลัมน์ | ที่มีค่า | หมายเหตุ |
|---|---|---|
| `gmv`, `orders`, `visits`, `atc` | 1,469 / 1,562 | **`atc` (add-to-cart) ยังไม่ถูกเอามาโชว์เลย** |
| `atc_value` | 534 | มูลค่าของที่หยิบใส่ตะกร้า |
| `publication_date` | 1,087 | กระจาย ม.ค.–มิ.ย. 2026 (235/217/170/175/253/37) → **ทำ trend รายเดือนได้** |
| `content_category_id` (kols) | 653 / 676 KOL | Lifestyle 191, Home 113, Pet 110, Family 80, Beauty 62, Tech 48... → **ตอนนี้เป็นแค่ filter ไม่มีกราฟ** |
| `platform_id` (placements) | 100% | FB 722, TikTok 419, YT 48, IG 35, Lemon8 11 |
| `person_in_charge_id` | 100% | ผู้รับผิดชอบแต่ละ placement (9 users) |
| `payment_type` | paid 1,199 / barter 14 / free 24 | |
| `status` | posted 964 / planned 273 | **มี planned 273 ที่ยังไม่ได้โพสต์ = pipeline** |
| `follower_at_time` | 1,166 | follower ตอนที่โพสต์ |

### ❌ คอลัมน์ที่ "ว่างทั้งหมด" → ทำ widget ไม่ได้ตอนนี้ (อย่าเพิ่งเสนอลูกค้า)
- `likes`, `comments`, `saves`, `shares`, `impressions`, `vdo_view`, `engagement_rate`, `clicks` = **0 ทุกแถว** → **Engagement dashboard ทำไม่ได้** จนกว่าบอท/คนจะกรอก (CLAUDE.md: youtube/lamon8 กรอกมือ, tiktok ยังไม่มีข้อมูล)
- `target_pub_date` = 0 → **เทียบ "โพสต์ตรงเวลาไหม" ทำไม่ได้**
- `ads_cost` = มีแค่ 5 แถว → ROI-รวม-ads แทบไม่มีความหมาย ใช้ระวัง
- `kol_samples` = 0, `kol_commercial_terms` = 0, `placement_reposts` = 0 → ยังไม่มีข้อมูล
- channel ขายมีแค่ shopee/website/lazada (tiktok/youtube/lamon8 = 0)
- มีแค่ brand Dreame (brand 2 ว่าง)

---

## 3. ข้อเสนอ (เรียงตามคุ้มค่า/ทำง่าย)

### 🥇 Tier 1 — คุ้มสุด ทำได้เลยด้วยข้อมูลที่มี

**A. Trend ตามเวลา (รายเดือน) — ช่องว่างใหญ่สุดตอนนี้**
ตอนนี้ไม่มีกราฟ "ตามเวลา" จริงๆ เลย (bar ต่อแคมเปญเป็นแค่ proxy และอ่านยากเพราะ 36 แคมเปญ).
- กราฟเส้น/แท่ง: GMV + Orders + จำนวน placement ต่อเดือน (ม.ค.–มิ.ย.)
- ตอบคำถาม "เดือนไหนพีค เทรนด์ขึ้นหรือลง"
- Backend: `GROUP BY to_char(publication_date,'YYYY-MM')` เพิ่มใน `buildDashboardOverview`
- Frontend: line/area chart ใหม่ในแถว Analysis

**B. Conversion Funnel (Visits → ATC → Orders)**
มี `visits`/`atc`/`orders` ครบ 1,469 แถวแต่ไม่เคยเอามาโชว์.
- Funnel 3 ขั้น + อัตราแปลง (ATC rate = atc/visits, Conversion = orders/visits)
- ตอบ "คนเข้าเยอะแต่ทำไมไม่ซื้อ / ช่องไหน convert ดี"
- ทำเป็นภาพรวม + แยกตาม channel ได้
- Backend: เพิ่ม `SUM(atc)` ใน channelBreakdown query (มี visits/orders อยู่แล้ว)

**C. GMV แยกตาม Content Category**
category มีข้อมูล 653/676 KOL แต่เป็นแค่ filter — ไม่มีกราฟ.
- Bar: GMV / orders / จำนวน KOL ต่อหมวด (Lifestyle, Home, Pet, ...)
- ตอบ "คอนเทนต์สายไหนปังสุด ควรจ้างเพิ่ม"
- Backend: query ใหม่ join `kols.content_category_id` → `content_categories`

**D. เติม KPI ที่ยังขาด (แก้นิดเดียว คุ้มมาก)**
KPI card เพิ่ม/ปรับ:
- **GMV เฉลี่ยต่อ placement** (total_gmv / posted_count)
- **Conversion rate** (orders / visits) — มีข้อมูลครบ
- **อัตราโพสต์สำเร็จ** (posted / total) — โชว์ pipeline สุขภาพ
- คำนวณฝั่ง frontend จาก `summary` ที่มีอยู่เกือบหมด (เพิ่ม `total_visits`, `total_atc` ใน summary นิดเดียว)

### 🥈 Tier 2 — มีประโยชน์ แต่ทำเพิ่มหน่อย

**E. Platform Efficiency (ไม่ใช่แค่จำนวน)**
ตอนนี้ Platform Breakdown โชว์จำนวน + GMV รวม. เพิ่ม **GMV ต่อ placement** ต่อ platform → ตอบ "FB จ้างเยอะ (722) แต่ TikTok (419) คุ้มกว่าต่อโพสต์ไหม". แก้ query เดิม (เพิ่มหาร) + แสดงคอลัมน์เพิ่ม.

**F. ผลงานตามผู้รับผิดชอบ (Person in charge)**
`person_in_charge_id` 100%. ตาราง: แต่ละคนดูแลกี่ placement, GMV รวม, posted vs planned. มีประโยชน์กับ manager. (ต้องเช็คเรื่อง privacy/ความเหมาะสมก่อนโชว์)

**G. Pipeline: planned ที่ยังไม่โพสต์**
273 placement สถานะ planned. Widget: planned แยกตามเดือน/แคมเปญที่กำลังจะมา → ตอบ "งานค้างเท่าไหร่".

**H. KOL ใช้ซ้ำ vs ใช้ครั้งเดียว**
นับจาก placements ต่อ kol_id: กี่ % เป็น KOL ที่จ้างซ้ำ, ใครจ้างบ่อยสุด → วัดความสัมพันธ์ระยะยาว.

### 🥉 Tier 3 — ทำได้แต่ value รองลงมา
- **I.** ดึง Top 5 สินค้า (จาก ProductDashboard ที่มีอยู่แล้ว) มาโชว์ย่อในหน้า Dashboard หลัก + ปุ่มลิงก์
- **J.** ไฮไลต์ "Free/Barter GMV" — 38 placement ฟรี/barter ที่ยังสร้าง GMV = มูลค่าที่ได้แบบไม่เสียค่าตัว (ดึงข้อมูลจาก paymentTypeBreakdown ที่มีอยู่)

### 🚫 ยังทำไม่ได้ (ข้อมูลว่าง) — บันทึกไว้ให้รู้ว่าทำไมไม่เสนอ
- Engagement dashboard (likes/comments/saves/views/engagement_rate) — คอลัมน์ว่างหมด
- On-time delivery (`target_pub_date` ว่าง)
- Repost performance (`placement_reposts` = 0)
- Sample tracking (`kol_samples` = 0)
- เทียบข้าม brand (มีแต่ Dreame)

---

## 4. ข้อเสนอชุดที่แนะนำ (ถ้าให้เลือกทำก่อน)
**A + B + C + D** — 4 อันนี้คือชุดที่เพิ่ม "ความละเอียด" ได้มากสุดต่อแรงที่ลง: เพิ่มมิติ **เวลา** (A), **funnel การขาย** (B), **ประเภทคอนเทนต์** (C), และ **ตัวเลขคุณภาพ** (D) — ทั้งหมดใช้ข้อมูลที่มีจริงครบแล้ว ส่วนใหญ่แก้ใน `buildDashboardOverview` query เดียว + เพิ่ม component ในแถว Analysis

## 5. ไฟล์ที่จะถูกแตะ (ถ้าลงมือ)
- `server/src/routes/dashboard.ts` — `buildDashboardOverview()` เพิ่ม field ใน `summary` + query รายเดือน/category/funnel; อัป `EMPTY_RESPONSE` + types
- `client/src/pages/DashboardPage.tsx` — เพิ่ม KPI card + chart component ใหม่ (ใช้ recharts เดิม)
- `client/src/api/index.ts` — เพิ่ม field ใน type `DashboardOverview`
- `client/src/i18n/locales/{th,en,zh}.ts` — เพิ่ม key (th ก่อน ตามกฎ `satisfies Translations`)
- Export Excel (`/export`) — เพิ่มชีตให้ตรงกับ widget ใหม่ (optional)

---

**ตำแหน่งไฟล์นี้:** `D:\internship\KOL_management\kol-system\DASHBOARD_ideas_plan.md` (root ของโปรเจกต์ ข้างๆ `HANDOFF_kol_offplatform_traffic_daily.md`)
