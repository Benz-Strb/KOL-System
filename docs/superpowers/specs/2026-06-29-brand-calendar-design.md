# แผน: ปฏิทินตารางงาน KOL รายแบรนด์ (Brand Calendar)

> สถานะ: **ร่างแผน — ยังไม่ลงมือ**
> วันที่: 2026-06-29
> ขอบเขต: เพิ่มหน้า `/calendar` แสดงตารางงาน KOL เป็นปฏิทิน + filter ตาม KOL/แบรนด์/สถานะ
> ผู้ทำ: intern (React) → ถ้า handoff ให้ระบุชัดในแต่ละ phase

---

## 1. เป้าหมาย / Use cases

ผู้ใช้อยากเห็น "งานของ KOL จะเกิดวันไหน" ในมุมมองปฏิทิน แทนที่จะไล่อ่านตาราง PlacementsPage ทีละแถว

| # | Use case | ใครใช้ |
|---|---|---|
| U1 | ดูภาพรวมทั้งเดือนว่าแบรนด์นี้มี KOL โพสต์/ออกงานวันไหนบ้าง | manager, marketing |
| U2 | filter ดู KOL คนเดียว → "คนนี้มีงานอีกทีวันไหน" | marketing, manager |
| U3 | แยกสีงานที่ **วางแผนไว้ (planned)** กับ **โพสต์แล้ว (posted)** | ทุก role |
| U4 | คลิกวัน/งาน → เห็นรายละเอียด placement (เปิด KolDetailModal หรือลิงก์ไป PlacementsPage) | ทุก role |

**ออกนอกขอบเขต (ไม่ทำในรอบนี้):** drag-drop เลื่อนวัน, สร้าง placement จากปฏิทินโดยตรง, sync Google Calendar, view รายสัปดาห์/รายวันแบบ time-grid (ชั่วโมง)

---

## 2. ⚠️ ข้อจำกัดข้อมูลจริง (อ่านก่อนตัดสินใจ design)

ปฏิทินต้องพึ่ง "วันที่" — แต่ `placements` มี 2 คอลัมน์วันที่ที่ **มีข้อมูลไม่เท่ากัน**:

| คอลัมน์ | ความหมาย | สถานะข้อมูลจริง | กรอกจากไหน |
|---|---|---|---|
| `target_pub_date` (Date) | วันที่ **วางแผน** จะโพสต์ | **เกือบว่าง** (CLAUDE.md §10: target_pub_date ≈ 0) | ฟอร์ม Plan/Booking (`NewPlacementPage` — optional), bulk import |
| `publication_date` (Date) | วันที่ **โพสต์จริง** | **มีข้อมูล** (ใช้ใน dashboard monthly trend, 964 posted) | ฟอร์ม Performance (`placements.ts` ตอน status→posted) |

### ผลกระทบต่อ design (สำคัญ)

- Use case หลักที่ผู้ใช้ขอ — **"KOL คนนี้จะมีงานอีกทีวันไหน" (อนาคต)** — พึ่ง `target_pub_date` ซึ่ง **ตอนนี้แทบไม่มีข้อมูล** → ปฏิทินจะดูว่างจนกว่าทีมจะเริ่มกรอก target_pub_date สม่ำเสมอ
- ส่วนงาน **ที่โพสต์ไปแล้ว** จะโชว์ได้ทันทีจาก `publication_date`

### ข้อเสนอ: event date = `COALESCE(target_pub_date, publication_date)`

```
ถ้ามี target_pub_date  → วางบนวันนั้น (งานที่วางแผน, สีหนึ่ง)
ไม่งั้นใช้ publication_date → วางบนวันที่โพสต์จริง (งาน posted, อีกสี)
ไม่มีทั้งคู่           → ไม่ขึ้นบนปฏิทิน (นับแยกเป็น badge "ไม่มีวันที่ N รายการ")
```

ทำให้ปฏิทิน **มีประโยชน์ทันทีวันนี้** (จาก publication_date ย้อนหลัง) และ **ค่อยๆ เป็น forward-schedule** เมื่อ adoption ของ target_pub_date เพิ่มขึ้น

### สิ่งที่ควรทำคู่กัน
1. ✅ **ทำแล้ว (2026-06-29)** — `target_pub_date` เป็น **required** ใน Plan form แล้ว: validation ฝั่ง client (`NewPlacementPage.tsx`) + label `*` + server guard `POST /api/placements` คืน 400 ถ้าไม่ส่ง (ไม่กระทบ bulk import) + i18n key `newPlacement.targetDateRequired` ครบ 3 ภาษา → placement ใหม่จากฟอร์มจะมีวันที่เสมอ
2. (option, ยังไม่ทำ) backfill `target_pub_date` ของ 1,237 แถวเดิม จาก Excel ต้นทางถ้าคอลัมน์วันวางแผนมีในไฟล์ — ของเก่ายังว่างจนกว่าจะ backfill

> 👉 **จุดที่ต้องให้ผู้ใช้ตัดสินใจ** ดูข้อ 9

---

## 3. Backend — endpoint ใหม่

`GET /api/calendar` (route ใหม่ `server/src/routes/calendar.ts`, mount ใน `index.ts`)

**Query params:**

| param | ค่า | หมายเหตุ |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD` | ช่วงที่ปฏิทินกำลังแสดง (เดือนที่เปิด ± padding สัปดาห์) — **บังคับ** เพื่อไม่ดึงทั้ง 1,237 แถว |
| `brand_id` | int หรือไม่ส่ง | ใช้ `buildBrandFilter(isAdmin, user.brandIds, brand_id)` แบบเดียวกับ placements |
| `kol_id` | int | filter U2 |
| `status` | `planned`/`posted`/`all` | default `all` |
| `placement_type` | `online`/`offline_shop`/`all` | |

**Logic:**
- `WHERE COALESCE(target_pub_date, publication_date) BETWEEN from AND to`
- respect brand filter (manager/marketing เห็นเฉพาะ `brandIds`, admin เห็นทุก brand)
- ใช้ `$queryRaw` join `kols` + `kol_platforms(is_primary)` + `platforms` + `products`/`stores` + `campaigns` (pattern เดียวกับ GET `/api/placements` บรรทัด ~48–74)

**Response shape (lean — เฉพาะที่ปฏิทินต้องใช้):**
```ts
type CalendarEvent = {
  id: number;
  date: string;            // YYYY-MM-DD (COALESCE result)
  date_source: 'target' | 'actual';   // มาจาก target_pub_date หรือ publication_date
  status: string;          // planned | posted | cancelled
  placement_type: string;  // online | offline_shop
  kol_id: number;
  kol_name: string;
  handle: string;
  avatar_url: string | null;
  platform: string | null;
  product_name: string | null;   // online
  store_name: string | null;     // offline
  campaign_code: string | null;
  post_url: string | null;
};
// + meta: { no_date_count: number }  // งานที่ไม่มีวันที่ทั้งคู่ ในชุด filter เดียวกัน
```

**ทางเลือกที่พิจารณาแล้ว:** reuse `GET /api/placements` ตรงๆ — ไม่เลือก เพราะ endpoint นั้น paginate + คืน field เยอะเกินจำเป็น และไม่มี date-range filter; endpoint เฉพาะเบากว่าและ query ชัดกว่า

---

## 4. Frontend — หน้า `CalendarPage`

ไฟล์: `client/src/pages/CalendarPage.tsx`

### Component ปฏิทิน — เขียนเอง (ไม่เพิ่ม library)
ไม่ใช้ FullCalendar / react-big-calendar เพราะ:
- bundle หนัก + จัด style ให้เข้า design token (Anuphan, `--surface`, `rounded-xl`) ยาก
- โปรเจกต์เคยทำ bundle split + ชอบ minimal — month-grid เขียนเองคุม style ได้เต็มที่

**Month grid:** ตาราง 7 คอลัมน์ (จ–อา) × 5–6 แถว, สร้างวันด้วย `date-fns` (มีในโปรเจกต์อยู่แล้ว? เช็คก่อน — ถ้าไม่มีใช้ native `Date`)
- แต่ละ cell แสดง chip งานสูงสุด ~3 อัน + "อีก N รายการ" → คลิกเปิด popover/วัน
- chip สีตาม `status`: planned = สี accent อ่อน, posted = เขียว, cancelled = เทา/ขีดฆ่า (ใช้ palette เดียวกับ status pill ใน PlacementsPage)
- chip แสดง avatar เล็ก (`KolAvatar`) + handle + platform logo (`PlatformLogo`)

**2 มุมมอง (toggle):**
1. **เดือน (month grid)** — default, ภาพรวม U1
2. **รายการ (agenda/list)** — group ตามวัน, อ่านง่ายบนมือถือ + เหมาะ U2 (KOL คนเดียว)

### Filter bar (reuse pattern จาก DashboardPage filter panel)
- เลือกเดือน (‹ มิ.ย. 2026 ›) + ปุ่ม "วันนี้"
- Brand (admin เท่านั้นที่เลือกได้; manager/marketing ล็อกตาม brand ตัวเอง)
- KOL (autocomplete — reuse logic จาก KolSearchBox/KolPicker) ← หัวใจ U2
- สถานะ: ทั้งหมด / วางแผน / โพสต์แล้ว
- ประเภท: ทั้งหมด / online / offline

### Interaction
- คลิก chip/วัน → เปิด modal สรุป placement (reuse `KolDetailModal` หรือทำ mini popover) + ปุ่มลิงก์ไป `/placements?...`
- ใช้ `useModalTransition` (`requestClose` ไม่ใช่ `onClose` ตรง) ตามกฎโปรเจกต์
- ใส่ **race-condition guard** (`seq.current` pattern, CLAUDE.md §9) เพราะมีการเปลี่ยนเดือน/filter ถี่

### Badge "ไม่มีวันที่"
ถ้า `meta.no_date_count > 0` แสดงแถบเล็กบนสุด: "มี N งานที่ยังไม่ระบุวันที่ — ดูในหน้ารายการ" ลิงก์ไป PlacementsPage (กันงานหายเงียบจากปฏิทิน)

---

## 5. Routing + Nav + สิทธิ์

- **Route:** เพิ่มใน `App.tsx` — `<Route path="/calendar" element={<ProtectedRoute><CalendarPage/></ProtectedRoute>} />`
- **Nav:** เพิ่ม `<NavLink to="/calendar">` ใน sidebar (App.tsx) ใกล้ "รายการ" — icon `CalendarDays` (lucide)
- **สิทธิ์:** ทุก role ที่ login เห็นได้ (admin/manager/marketing); brand filter อัตโนมัติผ่าน `buildBrandFilter` — ไม่ต้องมี role guard พิเศษเหมือน /dashboard
- ไม่กระทบ login-redirect-by-role เดิม

---

## 6. i18n

เพิ่ม namespace `calendar` ใน `th.ts` ก่อน → เติม `en.ts` / `zh.ts` ให้ครบ (`satisfies Translations` จะ error ถ้าขาด)

keys คร่าวๆ: `title`, `monthView`, `listView`, `today`, `filterKol`, `filterStatus`, `statusPlanned`, `statusPosted`, `noDateBanner`, `moreItems`, `emptyMonth`

> domain word คงภาษาอังกฤษ: KOL, placement, online/offline, campaign (ตามกฎ §9)

---

## 7. ลำดับงาน (phases)

| Phase | งาน | verify |
|---|---|---|
| **P1** | Backend `GET /api/calendar` + brand/kol/status filter + COALESCE date + meta.no_date_count | curl/Thunder ด้วย mint session admin → เช็ค shape + brand isolation |
| **P2** | `CalendarPage` month grid (read-only) + ดึง API + สีตาม status | `tsc -b` ผ่าน, เปิดหน้าจริงเช็คเดือนปัจจุบัน |
| **P3** | Filter bar (เดือน/brand/kol/status/type) + race guard + agenda view | สลับ filter, สลับเดือน ไม่มี response เก่าทับ |
| **P4** | คลิก event → modal/ลิงก์, badge "ไม่มีวันที่", responsive (มือถือ → agenda) | เช็คมือถือ width + a11y focus |
| **P5** | i18n ครบ 3 ภาษา + nav link + route | สลับภาษา ไม่มี key หาย |

verify client เสมอด้วย `npx tsc -b` / `npm run build` (**ห้าม** `tsc --noEmit` เปล่า — เช็ค 0 ไฟล์)

---

## 8. ไฟล์ที่จะแตะ (สรุป)

**ใหม่:**
- `server/src/routes/calendar.ts`
- `client/src/pages/CalendarPage.tsx`
- (อาจ) `client/src/components/CalendarMonthGrid.tsx`, `CalendarEventChip.tsx`

**แก้:**
- `server/src/index.ts` (mount route)
- `client/src/App.tsx` (route + nav link)
- `client/src/api/index.ts` (fn `getCalendar()`)
- `client/src/i18n/th.ts`, `en.ts`, `zh.ts`

**ไม่แตะ:** DB schema (ใช้คอลัมน์เดิม), placements form, dashboard, tab เครื่องมือเปรียบเทียบ

---

## 9. 🔴 จุดที่ต้องให้ผู้ใช้ตัดสินใจ ก่อนเริ่ม P1

1. **target_pub_date เกือบว่าง** → ปฏิทิน "งานอนาคต" จะว่างจนกว่าทีมจะกรอก
   - (ก) ทำเลยด้วย `COALESCE(target_pub_date, publication_date)` — โชว์ของที่มี (posted ย้อนหลัง) + planned ที่ทยอยกรอก ← **แนะนำ**
   - (ข) รอจนทีมเริ่มกรอก target_pub_date ก่อนค่อยทำหน้า
2. ~~ควรทำ `target_pub_date` ให้ required ใน Plan form ไหม~~ → ✅ **ตัดสินใจแล้ว: ทำ required แล้ว (2026-06-29)** ดูข้อ 2
3. งาน `status='cancelled'` ให้โชว์บนปฏิทินไหม (เสนอ: โชว์แบบจาง/ขีดฆ่า) — **ยังรอตัดสิน**
4. มุมมองเริ่มต้น: เดือน หรือ รายการ (เสนอ: เดือนบน desktop, รายการบนมือถือ) — **ยังรอตัดสิน**

---

## 10. หมายเหตุเชื่อมโยง
- pattern brand filter: `server/src/routes/placements.ts` (`buildBrandFilter`)
- pattern KOL autocomplete: `KolSearchBox` / `KolPicker`
- pattern filter panel + race guard: `DashboardPage.tsx` + CLAUDE.md §9
- status pill สี: `PlacementsPage.tsx`
