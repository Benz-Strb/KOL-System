# Dashboard Overview — Redesign Mock Brief (รอทำ mock 2-3 แบบ)

> สถานะ: **รอทำ mockup** (เขียนไว้ 2026-06-28) — คราวหน้าหยิบไปทำ mock 2-3 แบบให้ผู้ใช้ดูก่อนเลือก แล้วค่อยลงมือจริง
> ขอบเขต: **หน้า Overview ของ `/dashboard` เท่านั้น** (tab "ภาพรวม") — ไฟล์ `client/src/pages/DashboardPage.tsx`
> ⚠️ ขั้นนี้ทำแค่ **mock ให้เลือก** ยังไม่แก้โค้ดจริง จนกว่าผู้ใช้จะเลือกแบบ

---

## 1. ปัญหา / เป้าหมาย

จากรีวิว design (2026-06-28): หน้า Overview **ใช้งานได้ดีและ consistent** แต่ติด 2 อย่าง
1. **ยาวมาก** (สูง ~3,200px ที่จอ 1440) ต้องเลื่อนเยอะ
2. **กล่องมีกรอบเรียงต่อกัน 15+ ใบ** → รู้สึก "ตารางกล่อง" หนาแน่น

เป้าหมาย mock: ลดความรู้สึกกล่องเยอะ + ลดความยาว โดย**คงข้อมูลครบเท่าเดิม** และ**ไม่หลุด design system**

### รสนิยมผู้ใช้ (ต้องยึด)
- ชอบดีไซน์ **เบา/minimal** มากกว่ามีกรอบ/divider ชัด → ทิศทางควรไป "ลดเส้น ลดกล่อง"
- ชอบให้ **เสนอ preview ให้เลือกก่อนทำ** → ต้อง mock 2-3 แบบจริง ไม่ใช่อธิบายเฉยๆ
- (อ้างอิง memory: `feedback_ui_design_taste`)

---

## 2. โครงหน้า Overview ปัจจุบัน (inventory — ไม่ต้อง derive ใหม่)

ลำดับ section จากบนลงล่างใน tab "ภาพรวม":

1. **Header** — "Dashboard / สรุปผลงาน KOL" + ปุ่ม Export Excel (เขียว, มุมขวาบน)
2. **Filters card** (มีกรอบ) — Brand · Campaign · หมวดหมู่ · ช่วงวันที่ (date range)
3. **Tabs** — `ภาพรวม` | `เครื่องมือเปรียบเทียบ`
4. **Section "ตัวชี้วัดหลัก"** — **7 KPI card** (grid-cols-7): GMV รวม · ค่าใช้จ่าย KOL · Orders รวม · Placement ทั้งหมด (มี sub-line) · Ads Cost · Visits Shopee · Visits Lazada
5. **Section "ประสิทธิภาพ"** — **4 KPI card**: ROI รวม · GMV เฉลี่ย/โพสต์ · Conversion Rate · อัตราโพสต์สำเร็จ
6. **Section "วิเคราะห์ยอดขาย"**:
   - แนวโน้มรายเดือน (bar + line, full-width)
   - GMV แยกตามช่องทาง (donut) ‖ GMV vs ค่าใช้จ่าย ต่อแคมเปญ (bar) — 2 คอลัมน์
   - เส้นทางการซื้อ (Funnel) ‖ GMV แยกตามหมวดคอนเทนต์ (bar list) — 2 คอลัมน์
   - สัดส่วนการจ้างงานตาม Platform (full-width, list 2 คอลัมน์)
7. **Ranking KOL (Top 10)** — list + ช่องค้นหา + toggle GMV/ROI
8. **Off-Platform Traffic** — 3 KPI + bar รายวัน + donut + toggle 7d/30d/90d

ทุก card ตอนนี้ = `bg-surface border border-hairline rounded-xl`

---

## 3. ทิศทาง mock ที่จะทำ (2-3 แบบให้เลือก)

> ทำเป็น mock จริงให้เห็นภาพ (HTML/หน้าจริง + screenshot) ไม่ใช่บรรยาย — ใช้ข้อมูล/สีจริงจากเว็บ

### แบบ A — "Grouped panels" (รวมกล่อง ลดเส้น) ⭐ ตรงรสนิยมสุด
KPI ที่เป็นกล่องมีกรอบรายใบ → ยุบรวมเป็น **แผงใหญ่ใบเดียวต่อ section ไม่มีกรอบย่อย** ตัวเลขวางบนพื้น section คั่นด้วยช่องไฟ/เส้นบางจางๆ แทนกรอบเต็มใบ
```
┌ ตัวชี้วัดหลัก ───────────────────────────────────────┐
│  GMV รวม   ค่าใช้จ่าย   Orders   Placement   Ads   Visits… │   ← ไม่มีกรอบย่อย
│  2.8M      12M         281      1,237       9K    56K     │
└──────────────────────────────────────────────────────┘
(charts ด้านล่างคงกรอบบางไว้ แต่ KPI ทั้งหมดไร้กรอบ)
```
ผล: ลดจำนวน "กล่อง" จาก ~15 เหลือ ~6-7 รู้สึกโล่งขึ้นทันที

### แบบ B — "2 คอลัมน์ ลดความยาว"
ลดการเลื่อนแนวตั้ง: จัด chart เป็น masonry 2 คอลัมน์แน่นขึ้น + KPI เป็นแถบ compact บนสุด
```
[ KPI strip เตี้ยๆ เต็มกว้าง ]
[ แนวโน้มรายเดือน      ] [ GMV ช่องทาง (donut) ]
[ GMV vs spend (bar)  ] [ Funnel              ]
[ หมวดคอนเทนต์         ] [ Platform breakdown  ]
[ Ranking KOL (เต็มกว้าง)                      ]
```
ผล: สั้นลง ~30-40% แต่กล่องยังอยู่ (เน้นแก้ "ยาว" มากกว่า "กล่องเยอะ")

### แบบ C — "Progressive / collapsible" (ถ้าทำทัน)
คงโครงเดิม แต่ section รอง (วิเคราะห์ยอดขาย, off-platform) **ยุบได้ (collapsible)** ดีฟอลต์เปิดเฉพาะ KPI + ranking ที่เหลือกดเปิด + มี sub-nav เลื่อนถึง section
ผล: หน้าแรกสั้น เห็นของสำคัญก่อน ที่เหลือ on-demand

> แนะนำโฟกัส **A + B** ก่อน (คุ้มและตรงโจทย์ "เบา/สั้น"); C เป็นทางเลือกถ้าผู้ใช้อยากคงทุกอย่างไว้แต่ซ่อนได้

---

## 4. ข้อจำกัด (ต้องคงไว้ทุกแบบ)

- ข้อมูล/widget **ครบเท่าเดิม** ห้ามตัดตัวชี้วัด (แค่จัดวางใหม่)
- คง design token เดิม: สี accent ฟ้า, เลข `font-mono tabular-nums`, rounded-xl, font Anuphan
- ใช้ component เดิมเท่าที่ได้ (`KpiCard`, donut, recharts pattern) — ดู gotchas recharts ใน CLAUDE.md §9
- responsive ต้องไม่พัง (มี off-canvas sidebar drawer ที่ mobile)
- i18n: ข้อความใหม่ผ่าน `t()` ครบ 3 ภาษา (th source of truth)
- ไม่แตะ backend / tab "เครื่องมือเปรียบเทียบ" / หน้าอื่น

---

## 5. วิธีนำเสนอ (ตอนทำจริงคราวหน้า)

1. ใช้ frontend-design skill วาง design plan สั้นๆ ก่อน
2. ทำ mock 2-3 แบบ (A/B/C) — เปิดหน้าจริงด้วย dev server + Playwright screenshot (mint session admin: `benz.natthawut@shd-technology.co.th`, ดู CLAUDE.md §9)
3. เสนอ screenshot ให้ผู้ใช้เลือก (ใช้ AskUserQuestion พร้อม preview ถ้าเหมาะ)
4. ผู้ใช้เลือก → เขียน implementation plan (writing-plans) → ลงมือ

---

## 6. จุดอ้างอิงอื่นจากรีวิว (ทำแยกได้ทีหลัง — ไม่ใช่ scope หน้านี้)
- Donut ที่สไลซ์เดียวครอง ~96% (หน้า Marketing: GMV by Platform) → เปลี่ยนเป็น bar เดี่ยว
- หน้าสินค้า: list 57 แถว ครึ่งล่าง ฿0 → ดีฟอลต์ซ่อน/หรี่แถวไม่มียอด
- Avatar ว่าง (กล่องเทา) ใน ranking → ปัญหา URL หมดอายุ (ไม่ใช่ดีไซน์)
