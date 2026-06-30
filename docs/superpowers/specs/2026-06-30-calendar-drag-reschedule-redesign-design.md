# ปฏิทิน: ลากเลื่อนวันโพสต์ + ปรับหน้าตาให้ลื่น/ใช้ง่าย

> **สถานะ:** Design (approved) — รอ implementation plan
> **วันที่:** 2026-06-30
> **ไฟล์ที่เกี่ยว:** `client/src/pages/CalendarPage.tsx`, `server/src/routes/calendar.ts`, `server/src/routes/placements.ts`, `client/src/api/index.ts`, `client/src/components/Toast.tsx`, `client/src/i18n/locales/{th,en,zh}.ts`

---

## 1. เป้าหมาย

หน้าปฏิทิน (`/calendar`) ตอนนี้มี 2 ปัญหา:

1. **แก้วันโพสต์ไม่ได้จากปฏิทิน** — เวลา KOL ขอเลื่อนวัน (เช่น จะโพสต์ 7 ก.ค. แต่ไม่ทัน ขอเลื่อนไป 8 ส.ค.) ต้องไปแก้ที่อื่น ไม่ intuitive
2. **หน้าตาจืด + ใช้ยาก** — event chip เล็กมาก (ตัวอักษร 10px) อ่านยาก, แยกแพลตฟอร์ม/สถานะด้วยตายาก, cell โล่ง ไม่มีมิติ

งานนี้แก้ทั้งสองเรื่อง โดยยึด 2 หลัก: **(1) ความลื่นไหลในการใช้งาน** และ **(2) ความรู้สึกง่ายเวลาใช้งาน**

---

## 2. การตัดสินใจที่ล็อกแล้ว (จาก brainstorming)

| หัวข้อ | การตัดสินใจ |
|---|---|
| งานที่ลากได้ | `planned` + `posted` (ลากได้). `cancelled` **ลากไม่ได้** |
| field ที่แก้ | `planned` → `target_pub_date` / `posted` → `publication_date` (แก้ตาม status) |
| display ในปฏิทิน | เปลี่ยนจาก `COALESCE(target, publication)` เป็น **เลือกตาม status** ให้ "สิ่งที่เห็น = field ที่แก้" |
| สิทธิ์ลาก | `admin` + `marketing` เท่านั้น. `manager` = view-only (403 ถ้ายิง endpoint) |
| flow หลังลาก | **บันทึกทันที (optimistic) + Toast undo** |
| drag library | `@dnd-kit/core` (dependency ใหม่) — ลื่น + รองรับ touch |
| mobile | ไม่ลาก — ใช้ปุ่ม "เลื่อนวัน" + date picker ใน modal แทน |

---

## 3. Data semantics — กฎเรื่องวันที่ (สำคัญที่สุด)

### 3.1 สถานะปัจจุบัน (ของเดิม)

`server/src/routes/calendar.ts` เรียงงานด้วย:

```sql
COALESCE(p.target_pub_date, p.publication_date)   -- เลือก target ก่อนเสมอถ้ามี
```

ปัญหา: งานที่ `posted` แล้วมักมี **ทั้ง** `target_pub_date` (ใส่ตอนสร้าง) และ `publication_date` (ใส่ตอนกรอกผลใน `PATCH /:id/performance`) → `COALESCE` เลยโชว์ **วันที่ตั้งใจ ไม่ใช่วันโพสต์จริง** ทำให้ตอนลากกำกวมว่าแก้ field ไหน

> หมายเหตุ: `PATCH /:id/performance` set `publication_date` แต่**ไม่ล้าง** `target_pub_date` → posted จึงมีสองค่าเสมอ

### 3.2 กฎใหม่ (ที่จะ implement)

**หลักการ: "สิ่งที่เห็นบนปฏิทิน = field ที่ลากแล้วแก้"** — เลือกวันแสดงผลตาม `status`:

| status | วันที่แสดง (display) | field ที่ลากแล้วแก้ | ลากได้? |
|---|---|---|---|
| `planned` | `target_pub_date` | `target_pub_date` | ✅ |
| `posted` | `publication_date` (fallback `target_pub_date` ถ้า null) | `publication_date` | ✅ |
| `cancelled` | `COALESCE(target_pub_date, publication_date)` (คงเดิม) | — | ❌ |

**SQL ใหม่** (ทั้ง `event_date` และ `date_source` ใน main query + `kol-latest` ต้องใช้ logic เดียวกัน):

```sql
CASE
  WHEN p.status = 'posted' THEN COALESCE(p.publication_date, p.target_pub_date)
  ELSE COALESCE(p.target_pub_date, p.publication_date)
END AS event_date
```

`date_source`:
```sql
CASE
  WHEN p.status = 'posted' AND p.publication_date IS NOT NULL THEN 'actual'
  WHEN p.target_pub_date IS NOT NULL THEN 'target'
  ELSE 'actual'
END AS date_source
```

> **กฎที่ห้ามลืม (CLAUDE.md ข้อ 1):** การแก้ `publication_date` ของงาน posted = แก้ "ข้อมูลที่บันทึกแล้ว" — อนุญาตเพราะเป็นเคสแก้วันที่กรอกผิด (พี่ตัดสินใจแล้ว) แต่ undo ต้องทำงานได้เสมอ และมี race guard กันเขียนทับ

### 3.3 WHERE clause (date range filter)

`WHERE` ที่กรองช่วง `from..to` ต้องใช้ `event_date` แบบใหม่ด้วย (ไม่ใช่ `COALESCE` เดิม) — แนะนำทำเป็น CTE/subquery หรือ repeat `CASE` ใน WHERE เพื่อให้ filter กับ display ตรงกัน มิฉะนั้นงาน posted บางอันจะหลุดกรอบเดือน

---

## 4. Backend — endpoint ใหม่

### 4.1 `PATCH /api/placements/:id/schedule`

ใส่ใน `server/src/routes/placements.ts` (ใกล้ๆ `PATCH /:id/performance`)

**Request body:**
```ts
{ date: string }  // "YYYY-MM-DD"
```

**Logic:**
```
1. id = Number(param('id'))
2. ตรวจ role: ต้องเป็น 'admin' หรือ 'marketing' → ไม่ใช่ คืน 403
   (manager ลากไม่ได้ — view-only)
3. ตรวจ date format ด้วย regex /^\d{4}-\d{2}-\d{2}$/ → ไม่ผ่าน คืน 400
4. โหลด placement: select { brand_id, status, target_pub_date, publication_date }
   - ไม่เจอ → 404
5. non-admin: เช็ค user.brandIds.includes(existing.brand_id) → ไม่ใช่ คืน 403
6. ตาม status:
   - 'cancelled' → คืน 400 { error: 'cannot reschedule cancelled placement' }
   - 'planned'   → update { target_pub_date: new Date(date) }
   - 'posted'    → update { publication_date: new Date(date) }
   - status อื่น → 400
7. คืน { ok: true, id, date, status, field: 'target_pub_date' | 'publication_date' }
```

**ความปลอดภัย:** ใช้ Prisma `update` (parameterized) — ไม่ใช่ `$queryRawUnsafe`. ไม่มี string interpolation ของ user input

**หมายเหตุ timezone:** `new Date("2026-08-08")` parse เป็น UTC midnight. column เป็น `date` (ไม่มี time) → ปลอดภัย แต่ให้ทำตาม pattern เดิมใน `POST /` (`new Date(b.target_pub_date)`) เพื่อ consistency

### 4.2 API client

`client/src/api/index.ts` — เพิ่ม:

```ts
export const reschedulePlacement = (id: number, date: string) =>
  api<{ ok: true; id: number; date: string; status: string; field: string }>(
    `/api/placements/${id}/schedule`,
    { method: 'PATCH', body: JSON.stringify({ date }) }
  );
```
(ดู signature ของ `api()` helper ในไฟล์เดิมว่ารับ method/body แบบไหน แล้วทำตาม)

---

## 5. Frontend — drag interaction

### 5.1 Library: `@dnd-kit/core`

ติดตั้งใน `client/`:
```
npm install @dnd-kit/core
```
- ใช้ `DndContext`, `useDraggable` (event chip), `useDroppable` (day cell), `DragOverlay` (ตัวลอยตอนลาก)
- `PointerSensor` พร้อม `activationConstraint: { distance: 6 }` — กันลากหลุดเวลาตั้งใจแค่คลิกเปิด modal
- รองรับ touch ได้ในตัว แต่บน mobile เราปิด drag (ดู 5.5) เพราะ month grid เล็กเกินจะลากแม่น

### 5.2 โครงสร้าง (เฉพาะ month view)

```
<DndContext sensors=... onDragStart=... onDragEnd=...>
  <div grid-cols-7>
    {grid.map(date => <DayCell droppableId={dateStr}>  // useDroppable
       {events.map(ev => <DraggableEventChip ev={ev} />)}  // useDraggable (disabled ถ้า cancelled/ไม่มีสิทธิ์)
    )}
  </div>
  <DragOverlay>{activeEvent && <EventChip ... floating />}</DragOverlay>
</DndContext>
```

- `useDraggable` ตั้ง `disabled` = `ev.status === 'cancelled'` **หรือ** `!canDrag` (role ไม่ใช่ admin/marketing)
- `droppableId` = `dateStr` (YYYY-MM-DD ของ cell)
- **คลิกเปิด modal ต้องยังทำงาน**: เพราะ `activationConstraint.distance` ทำให้ pointer ที่ขยับ < 6px ถือเป็นคลิก ไม่ใช่ drag → `onClick` ของ chip ยังยิงปกติ

### 5.3 onDragEnd — optimistic update + undo

```
onDragEnd(event):
  active = event chip ที่ลาก, over = cell ปลายทาง
  ถ้าไม่มี over หรือ over.id === วันเดิมของ active → ไม่ทำอะไร
  newDate = over.id (YYYY-MM-DD)
  oldDate = active.date

  1. Optimistic: อัปเดต state `events` ทันที (set ev.date = newDate)  + invalidate swrCache key เดือนนี้
  2. ยิง reschedulePlacement(ev.id, newDate) เบื้องหลัง (มี seqRef race guard)
  3. สำเร็จ → Toast { message: t('calendar.rescheduled', {handle, date: formatThai(newDate)}),
                      action: { label: t('common.undo'), onClick: () => undo() } }  // ~6 วิ
  4. fail → rollback state กลับ oldDate + invalidate cache + Toast error (t('calendar.rescheduleFailed'))

undo():
  - ยิง reschedulePlacement(ev.id, oldDate)
  - optimistic ย้าย chip กลับ oldDate
  - ปิด Toast
```

**Race guard (pattern เดิมในเว็บ — CLAUDE.md §9):**
```ts
const mySeq = ++rescheduleSeq.current;
await reschedulePlacement(...);
if (rescheduleSeq.current !== mySeq) return; // ทิ้งผลเก่า
```
> มี `seqRef` ของ `load()` อยู่แล้ว — ใช้ตัวแยกสำหรับ reschedule กันชนกัน

**swrCache:** key ปัจจุบันคือ `calendar:${JSON.stringify({from,to,brandId,kolId,statusFilter,typeFilter})}`. หลังลากสำเร็จให้ `setCached(key, updatedResponse)` หรือ ลบ entry เพื่อให้ refetch ครั้งหน้าได้ข้อมูลใหม่. ระวัง: ถ้า event ย้ายข้ามเดือน (7 ก.ค. → 8 ส.ค.) มันจะหายจากเดือนปัจจุบัน — optimistic ลบ chip ออกจากเดือนนี้ได้เลย และ Toast บอกว่า "เลื่อนไป ส.ค. แล้ว"

### 5.4 Visual feedback ตอนลาก

- event ที่ลากได้: `cursor-grab`, ตอนกด `cursor-grabbing`
- ตอนลาก: chip ต้นทาง opacity ลด (~0.4), `DragOverlay` โชว์ chip ลอยตาม pointer (เงา + ยกขึ้นเล็กน้อย scale 1.03)
- cell ปลายทางที่ hover อยู่ (`isOver`): พื้นเปลี่ยนเป็น `bg-accent/8` + ring เบาๆ `ring-1 ring-accent/30`
- cell ที่ลากไม่ได้ (ปลายทางเป็นอดีตไกล? — ไม่ block, อนุญาตทุก cell) → ไม่มีข้อจำกัดวันปลายทาง

### 5.5 Mobile / touch fallback

- ตรวจ `isMobile()` (มีอยู่แล้ว) → **ปิด** `DndContext`/draggable บน month view (หรือ default ไป agenda view เหมือนเดิม)
- ใน `EventDetailModal` เพิ่มปุ่ม **"เลื่อนวัน"** (เฉพาะ status ≠ cancelled และมีสิทธิ์):
  - กดแล้วโชว์ `<input type="date">` เล็กๆ (หรือ date picker เดิมของเว็บถ้ามี) default = วันปัจจุบันของ event
  - เลือกวัน → ยิง `reschedulePlacement` เดียวกัน → ปิด modal + Toast
- ปุ่มนี้โชว์บน desktop ด้วยก็ได้ (ทางเลือกสำหรับคนไม่อยากลาก)

---

## 6. ขยาย Toast ให้รองรับ undo

`client/src/components/Toast.tsx` ปัจจุบันไม่มีปุ่ม action และ auto-dismiss 3 วิ. เพิ่มแบบ backward-compatible:

```ts
interface Props {
  message: string;
  onClose: () => void;
  duration?: number;                       // ยัง default 3000
  action?: { label: string; onClick: () => void };  // ใหม่ — optional
  variant?: 'success' | 'error';           // ใหม่ — optional, default 'success' (ไอคอน/สี)
}
```
- ถ้ามี `action` → render ปุ่ม label (เช่น "เลิกทำ") ข้างข้อความ; กดแล้วเรียก `onClick` + ปิด toast
- reschedule ส่ง `duration: 6000` ให้ผู้ใช้ทันกด undo
- `variant: 'error'` → ไอคอน/สีแดง (สำหรับ rescheduleFailed)
- **ของเดิมที่เรียก Toast แบบเก่าต้องไม่พัง** (props ใหม่ optional หมด)

> ถ้าในเว็บมี toast manager/context อยู่แล้วให้ใช้ของเดิม — ตรวจ `client/src/components/Toast.tsx` + ที่เรียกใช้ (AdminUsersPage, DashboardPage ฯลฯ) ก่อนแก้ signature

---

## 7. Visual redesign — "จืด → ลื่น + ใช้ง่าย"

โทน **minimal** (ตามรสนิยมที่ตกลงไว้ — เบา ไม่ใส่กรอบ/divider รก) เน้น scannability + มิติ ไม่ใช่สีจัดจ้าน

### 7.1 Event chip ใหม่ (จุดเปลี่ยนหลัก)

ของเดิม: chip สูง ~18px, ตัวอักษร 10px, avatar จิ๋ว, แยก platform/status ยาก

ใหม่:
- **แถบสีซ้าย 3px** = สีตาม **platform** (ใช้ `platformColors.ts` ที่มีอยู่ — TikTok/Shopee/YouTube/Lemon8/FB ฯลฯ) → กวาดตาแล้วรู้ platform ทันที
- avatar (sm) + **handle อ่านง่ายขึ้น** (11–12px, ไม่ใช่ 10px) + จุดสถานะเล็ก (planned=amber / posted=green / cancelled=gray)
- พื้น chip = `bg-surface` + hover ยกเงาเบา (`hover:shadow-sm`) + cursor-grab
- cancelled: handle ขีดฆ่า + opacity ลด (คงเดิม)
- ความสูง chip เพิ่มเล็กน้อยให้หายใจ (จาก ~18px → ~22–24px)

### 7.2 Day cell

- **วันนี้:** วงกลม accent ที่เลขวัน (มีอยู่แล้ว) + พื้น cell ไฮไลต์อ่อน `bg-accent/5` ให้เด่นขึ้น
- **เสาร์-อาทิตย์:** พื้นจางลงนิด (`bg-canvas/40`) แยกสุดสัปดาห์
- **เดือนอื่น (padding):** จางลง (คงเดิม `bg-canvas/60`) + เลขวัน muted
- เพิ่มความสูง cell: `min-h-[90px]` → `min-h-[110px]` ให้ใส่ chip ได้สบายตา
- **"+N more":** ออกแบบใหม่เป็น pill เล็กกดง่าย (`+2 เพิ่มเติม`) แทนข้อความเปล่า

### 7.3 Legend

แถบ legend เล็กๆ ใต้ filter bar หรือมุมขวา: จุดสี + label (planned / posted / cancelled) — ช่วยคนใหม่เข้าใจสีเร็ว

### 7.4 Agenda view

- การ์ดแน่นขึ้น (padding สมดุล), จุดสถานะซ้าย, avatar, handle, platform, campaign/model — จัด hierarchy ให้กวาดง่าย
- header วันที่: เด่นขึ้นนิด, เส้นคั่นบางลง

### 7.5 Micro-interactions

- ทุก hover/drag/drop มี `transition` ลื่น (~150–200ms)
- chip ตอน drop ลง cell ใหม่: animate เข้าตำแหน่ง (dnd-kit จัดการ)
- เปลี่ยนเดือน: คงเดิม (ไม่ต้องทำ slide animation — overkill)

> **ขอบเขตหน้าตา:** spec นี้ให้ทิศทาง + รายละเอียดพอให้ทำตามได้ แต่ไม่ fix ค่าสี/ขนาดทุกพิกเซล — implementer ปรับให้เข้ากับ design system เดิม (`bg-surface`, `border-hairline`, `text-ink`, `text-muted`, `accent` ฯลฯ) และเสนอผู้ใช้ดูได้ถ้าลังเล

---

## 8. i18n keys ที่ต้องเพิ่ม

เพิ่มใน `th.ts` ก่อน (source of truth) แล้วเติม `en.ts`/`zh.ts` ให้ครบ (ไม่งั้น `satisfies Translations` error):

| key | th | en | zh |
|---|---|---|---|
| `calendar.rescheduled` | `เลื่อน @{{handle}} เป็น {{date}} แล้ว` | `Moved @{{handle}} to {{date}}` | `已将 @{{handle}} 移至 {{date}}` |
| `calendar.rescheduleFailed` | `เลื่อนวันไม่สำเร็จ ลองใหม่อีกครั้ง` | `Failed to reschedule, try again` | `改期失败，请重试` |
| `calendar.moveDate` | `เลื่อนวัน` | `Move date` | `更改日期` |
| `calendar.cannotMoveCancelled` | `งานที่ยกเลิกแล้วเลื่อนไม่ได้` | `Cancelled placements can't be moved` | `已取消的排期无法移动` |
| `common.undo` | `เลิกทำ` | `Undo` | `撤销` |

> legend ใช้ label สถานะที่มีอยู่แล้ว (`calendar.statusPlanned/statusPosted/statusCancelled`) — ไม่ต้องเพิ่ม key ใหม่
>
> domain terms (KOL, GMV, planned/posted/cancelled ฯลฯ) คงเป็น English ทุกภาษา (CLAUDE.md §9)

---

## 9. Edge cases & ของที่ต้องระวัง

1. **ลากข้ามเดือน** (7 ก.ค. → 8 ส.ค.): chip หายจากเดือนปัจจุบัน — optimistic ลบออกจาก view เดือนนี้, Toast แจ้งเดือนปลายทาง, undo ดึงกลับ
2. **manager ลาก**: UI ปิด draggable (cursor default) + endpoint คืน 403 (กันยิงตรง)
3. **คลิก vs ลาก**: `activationConstraint.distance: 6` ต้องเทสต์ว่าคลิกเปิด modal ยังทำงาน
4. **posted ที่ `publication_date` เป็น null**: display fallback `target_pub_date`; ลากแล้วเขียน `publication_date` (เซ็ตค่าครั้งแรก) — โอเค
5. **race**: ลากรัวๆ หลายงาน → `seqRef` กันผลเก่าทับ
6. **swrCache stale**: หลังลากต้อง invalidate/update cache key เดือนนั้น ไม่งั้นกลับมาเดือนเดิมเห็นวันเก่า
7. **timezone**: ใช้ `new Date("YYYY-MM-DD")` ตาม pattern เดิม — column เป็น `date` ไม่ใช่ `timestamp` จึงไม่เลื่อนวัน
8. **`kol-latest` endpoint**: ใช้ logic วันที่เดียวกับ main query (เปลี่ยน COALESCE → CASE) เพื่อให้กระโดดเดือนถูก

---

## 10. ขอบเขตงาน (Scope)

**ทำ:**
- [ ] Backend: `PATCH /api/placements/:id/schedule` + แก้ SQL display logic (main query + kol-latest + WHERE)
- [ ] API client: `reschedulePlacement()`
- [ ] Toast: เพิ่ม `action` + `variant` (backward-compatible)
- [ ] Frontend drag: `@dnd-kit/core` ใน month view + optimistic + undo + race guard + cache invalidation
- [ ] Mobile fallback: ปุ่ม "เลื่อนวัน" + date picker ใน EventDetailModal
- [ ] Visual redesign: event chip, day cell, legend, agenda polish
- [ ] i18n: เพิ่ม keys ครบ 3 ภาษา

**ไม่ทำ (ตอนนี้):**
- ลาก/แก้ใน agenda view (agenda เป็น read-only + ปุ่มเลื่อนใน modal พอ)
- เปลี่ยน `kol_id`/แก้ field อื่นจากปฏิทิน (เฉพาะวันที่)
- ลากเลือกหลายงานพร้อมกัน (multi-select drag)
- recurring/ลาก resize ช่วงวัน

---

## 11. Definition of Done

1. ลาก event `planned`/`posted` บน desktop month view → วันเปลี่ยนทันที, DB อัปเดต field ถูกตาม status, Toast undo ใช้งานได้จริง
2. `cancelled` ลากไม่ได้ (cursor default, จับไม่ติด)
3. manager เปิดหน้าได้แต่ลากไม่ได้ + endpoint คืน 403
4. mobile กดปุ่ม "เลื่อนวัน" ใน modal แล้วเปลี่ยนวันได้
5. posted โชว์ `publication_date` (ไม่ใช่ target อีกต่อไป)
6. หน้าตาใหม่: chip อ่านง่าย แยก platform/status ด้วยตาได้, วันนี้/สุดสัปดาห์เด่น, รู้สึกลื่นเวลา hover/drag
7. `npx tsc -b` ผ่าน (ห้ามใช้ bare `tsc --noEmit` — CLAUDE.md §9), i18n ครบ 3 ภาษา
8. ไม่มี Co-Authored-By: Claude ใน commit (CLAUDE.md §0)
