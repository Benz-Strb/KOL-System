# แผนลด Latency การโหลดข้อมูล (DB / API)

> เอกสารนี้เขียนไว้ให้ **Sonnet ลงมือทำต่อ** — Opus วัด latency จริง + วิเคราะห์คอขวดแล้ว สรุปว่าปัญหา **ไม่ใช่ความเร็ว query หรือ library DB** แต่เป็น **จำนวน round-trip + ระยะทางไป DB (Tokyo) + cold start**
> วันที่วิเคราะห์: 2026-07-01 | Stack: Vite+React / Hono + Prisma 6 + adapter-pg / Hyperdrive / Supabase Postgres (ap-northeast-1, Tokyo)

---

## 0. TL;DR สำหรับคนทำ

ทำ 2 งานนี้ (เรียงตามคุ้มค่า) — ทั้งคู่ **ไม่ต้องเปลี่ยน library** และ **ไม่แตะข้อมูลดิบใน DB**:

1. **Task A — เปิด/จูน Hyperdrive query caching** (ตั้งค่า ไม่ต้องเขียนโค้ด) → ตัด round-trip ไป Tokyo สำหรับ query อ่านซ้ำๆ (dropdown, dashboard, list หน้าแรก)
2. **Task B — เพิ่ม "stale-time" ให้ `swrCache` ฝั่ง client** (แก้โค้ด ~1 ไฟล์ + จุดเรียกใช้) → หยุดยิง DB refetch เบื้องหลังเมื่อข้อมูลเพิ่งโหลดมาไม่นาน (ตอนนี้สลับ filter ไปกลับโดน DB ทุกครั้ง)

(ทางเลือกเสริม: Task C — keep-warm cron ลด cold start "ครั้งแรกช้า")

---

## 1. ผลวัด latency จริง (หลักฐาน)

ยิงไปที่ `https://kol-system-server.shd-technology.workers.dev` จากเครื่องในไทย, แยกส่วนด้วย `curl -w`:

| ส่วนที่วัด | เวลา (warm) | เวลา (cold spike) |
|---|---|---|
| Network ไทย → Cloudflare edge (`time_connect`) | ~40–60ms คงที่ | — |
| Worker + Hono + สร้าง PrismaClient (`/health` ไม่แตะ DB) | ~95–125ms | สูงสุด ~317ms |
| Worker + DB round-trip (`/api/_dbcheck` = `count(*)`) | ~113–165ms | สูงสุด ~586ms |
| **ส่วนต่าง = DB round-trip Worker→Hyperdrive→Tokyo→กลับ** | **~50–150ms** | — |

**ข้อสังเกตสำคัญ:**
- แค่ `count(*)` (query ที่รันใน Postgres < 1ms) ก็กิน ~100–150ms → เวลาหมดไปกับ **การเดินทางไป-กลับ Tokyo** ล้วนๆ ไม่ใช่การประมวลผล query
- `/health` ที่ไม่แตะ DB เลยยังใช้ ~100ms และมี spike ถึง 300ms → นี่คือ **Worker cold start + การ `new PrismaClient()` ทุก request** (ดูข้อ 4)
- ประเมิน request ที่มี auth จริง (warm): `50ms network + ~100ms worker + ~100–150ms DB = ~250–350ms`; cold `~600–700ms`

**สรุปสาเหตุ 2 อาการที่ user รายงาน:**
- "ช้าเฉพาะครั้งแรก" = **cold start** (+300–450ms) → Task C
- "ช้าตอนพิมพ์ค้นหา" = แต่ละคำค้น **วิ่งไป Tokyo 1 รอบ** (~250–350ms) → Task A ช่วยบางส่วน, Task B ช่วยลดรอบซ้ำ

**เหตุผลที่ไม่แนะนำเปลี่ยน library DB (Prisma → Drizzle/Kysely/raw pg):**
ข้อมูลระดับพันแถว (placements 1,237 / kols 677 / metrics 1,562) query เสร็จในหลักไมโครวินาที การเปลี่ยน library เร่ง query ไม่ได้ผลที่วัดออก เพราะเวลาไม่ได้อยู่ที่ query — อยู่ที่ round-trip network. ข้อเดียวที่ library เบากว่าช่วยได้คือ **cold start** (Prisma engine หนัก) แต่ต้องรื้อทุก route + เสีย type-safety → เก็บเป็น handoff item ให้ทีม dev ไม่ทำในเฟสนี้

---

## 2. Task A — เปิด/จูน Hyperdrive Query Caching ⭐ (คุ้มสุด)

### แนวคิด
Hyperdrive cache ผลของ **query อ่าน (SELECT)** ไว้ที่ edge ของ Cloudflare ทั่วโลก. request ที่ query เดิม + พารามิเตอร์เดิม จะได้ผลจาก cache **โดยไม่ต้องวิ่งไป Tokyo** → ตัด ~100–150ms ต่อ request ที่ hit cache ทิ้ง.

ได้ผลมากกับ query ที่ **ซ้ำบ่อยและเหมือนกันข้าม request/user**:
- Dropdown ทั้งหมด (`/api/dropdowns`, products, shops, campaigns) — query แทบไม่เปลี่ยน
- Dashboard overview (query หนัก, filter ชุดเดิมซ้ำ)
- Placements list หน้าแรก (default filter) ที่เปิดบ่อย

ได้ผลน้อยกับ search-as-you-type (แต่ละคำค้นไม่ซ้ำ → cache miss) — แต่ก็ไม่เสียหาย

### ขั้นตอนทำ (ผู้ทำต้องมีสิทธิ์ Cloudflare account `486d5764fbd14f875e3d394235ee09f0`)

Hyperdrive config id = `a156856807ba48f6a310a3f08df79509` (binding `HYPERDRIVE`, ดู `server/wrangler.toml`)

1. **เช็คสถานะ caching ปัจจุบันก่อน** (caching เปิด default อยู่แล้ว แต่ต้องยืนยันค่า):
   ```bash
   npx wrangler hyperdrive get a156856807ba48f6a310a3f08df79509
   ```
   ดูฟิลด์ `caching.disabled`, `caching.max_age`, `caching.stale_while_revalidate`

2. **จูนค่า** (ถ้ายังปิดอยู่ หรือ max_age สั้นไป):
   ```bash
   npx wrangler hyperdrive update a156856807ba48f6a310a3f08df79509 \
     --caching-disabled false \
     --max-age 30 \
     --stale-while-revalidate 60
   ```
   - `max-age 30` = ผล cache สดได้ 30 วิ (ปรับได้ 15–60 ตามความ tolerant ต่อข้อมูลเก่า)
   - `stale-while-revalidate 60` = เกิน max_age แล้วยังเสิร์ฟของเก่าได้อีก 60 วิ ระหว่าง refresh เบื้องหลัง
   - **ไม่ต้อง redeploy Worker** — config มีผลทันที

3. **วัดผลซ้ำ** ด้วยวิธีเดียวกับข้อ 1 (curl -w) — ยิง endpoint อ่านซ้ำๆ ดูว่า round-trip ลดลงไหมหลัง warm cache

### ⚠️ ข้อควรระวัง / กับดัก (สำคัญมาก — ต้องอ่าน)

1. **ความสด (staleness):** หลังมี write (สร้าง/แก้ placement) ผู้ใช้อาจเห็นข้อมูลเก่าได้นานสุด `max_age + stale_while_revalidate`. สำหรับระบบติดตาม KOL รับได้ (ไม่ใช่ realtime) แต่ **ถ้า field ไหนต้องเห็นผลทันทีหลังบันทึก ให้ตั้ง max_age สั้น (15s)**. ฝั่ง client มี optimistic update อยู่แล้ว ช่วยกลบ delay นี้ได้

2. **Prisma อาจ bypass cache:** Hyperdrive cache เฉพาะ query ที่ระบุได้ว่าเป็น SELECT และ **ไม่อยู่ใน transaction**. Prisma กับ driver adapter บาง operation ส่งเป็น prepared statement / ห่อ transaction — อาจ cache ไม่ติด. **ต้องวัดจริงหลังเปิด** (ข้อ 3 ด้านบน) ถ้า round-trip ไม่ลด แปลว่า Prisma ไม่ได้ยิงในรูปแบบที่ cache ได้ → เอกสารนี้ยังคงคุ้มเพราะ Task B ช่วยอีกทาง

3. **`Promise.all([count, findMany])` ใน `placements.ts`** เป็น 2 query แยก — cache แยกกันได้ ไม่มีปัญหา

4. **อย่า cache query ที่มี auth-sensitive result แบบผิด scope:** ไม่ต้องกังวล — Hyperdrive cache key รวม SQL + พารามิเตอร์ทั้งหมด (รวม `brandIds`) ดังนั้น user คนละ brand ได้ cache คนละ entry อยู่แล้ว ปลอดภัย

### เกณฑ์ว่าสำเร็จ
- `wrangler hyperdrive get` แสดง `caching.disabled = false` + max_age ตามตั้ง
- ยิง endpoint อ่านซ้ำ 2 ครั้งติด ครั้งที่ 2 `server_processing` ลดลงชัด (คาดว่า DB delta ~100ms หายไป)
- เปิดเว็บจริง: dropdown/dashboard โหลดครั้งที่ 2+ ไวขึ้น

---

## 3. Task B — เพิ่ม "stale-time" ให้ `swrCache` (ฝั่ง client)

### ปัญหาปัจจุบัน
`client/src/lib/swrCache.ts` เป็น stale-while-revalidate cache ที่ทำงานถูกต้อง **แต่**: ทุกจุดที่เรียกใช้ (เช่น `PlacementsPage.load()`) จะ **ยิง DB refetch เบื้องหลังทุกครั้งเสมอ** แม้เพิ่งโหลดข้อมูลชุดนั้นมา 1 วินาทีก่อน. ผลคือ:
- สลับ filter ไป-กลับ (เช่น status all → posted → all) โดน DB ทุกครั้ง ทั้งที่ข้อมูลเดิมยังสดอยู่
- เปลี่ยน tab ไป-กลับ ยิงซ้ำ
- โหลด DB เกินจำเป็นเยอะ + ผู้ใช้เห็น network ทำงานตลอด

โครงสร้างปัจจุบัน (`swrCache.ts`):
```ts
const store = new Map<string, unknown>();          // ไม่มี timestamp, ไม่มี TTL, โตไม่จำกัด
export function getCached<T>(key: string): T | undefined { return store.get(key) as T | undefined; }
export function setCached<T>(key: string, value: T): void { store.set(key, value); }
export function invalidateCachePrefix(prefix: string): void { /* ลบ key ตาม prefix หลัง mutation */ }
```

Pattern การใช้ปัจจุบัน (เหมือนกันทุกหน้า เช่น `PlacementsPage.tsx:199-218`):
```ts
const cached = getCached(cacheKey);
if (cached) { setRows(cached.rows); setLoading(false); }   // โชว์ของเก่าทันที
else { setLoading(true); }
const res = await getPlacements(params);                    // ← ยิงเสมอ แม้ cached ยังสด
setCached(cacheKey, res);
setRows(res.rows);
```

### สิ่งที่ต้องทำ

**B1. เก็บ timestamp ใน cache + เพิ่มฟังก์ชันเช็คความสด** (แก้ `swrCache.ts`)

เปลี่ยน store ให้เก็บ `{ value, ts }` แล้วเพิ่ม helper:
```ts
type Entry<T> = { value: T; ts: number };
const store = new Map<string, Entry<unknown>>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

// ใหม่: คืน true ถ้ามี cache และยังสด (อายุ < maxAgeMs)
export function isFresh(key: string, maxAgeMs = 15_000): boolean {
  const e = store.get(key);
  return !!e && (Date.now() - e.ts) < maxAgeMs;
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, { value, ts: Date.now() });
}
```
- `invalidateCachePrefix` คงเดิม (แค่เปลี่ยน type เป็น Entry)
- **หมายเหตุ hygiene:** ระหว่างนี้ใส่ eviction กัน Map โตไม่จำกัดด้วย (เช่น เก็บ max 100 key, เกินแล้วลบ key เก่าสุด) — optional แต่ควรทำเพราะ session ยาวๆ cache จะบวม

**B2. ข้าม refetch ถ้าข้อมูลยังสด** (แก้จุดเรียกใช้ทุกหน้าที่ใช้ pattern นี้)

ในทุก `load()` เพิ่มเช็ค `isFresh` ก่อนยิง fetch:
```ts
const cached = getCached(cacheKey);
if (cached) {
  setRows(cached.rows); setTotal(cached.total); setLoading(false);
  if (isFresh(cacheKey)) return;   // ← ใหม่: สดพอแล้ว ไม่ต้องยิง DB ซ้ำ
} else {
  setLoading(true);
}
const res = await getPlacements(params);   // ยิงเฉพาะตอน cache miss หรือ cache เก่า
...
```
**ระวัง sequence guard:** ต้อง `return` **หลัง** set state แต่ **ก่อน** `++loadSeq.current`/await — ดู pattern เดิมให้ดี อย่าให้ early-return ไปข้าม logic ที่จำเป็น (เช่น `if (viewMode !== 'gmv') return;` ที่มีอยู่แล้วใน `loadGmv`)

**ไฟล์ที่ใช้ pattern นี้ (ต้องแก้ให้ครบ — grep `getCached` มาแล้ว):**
- `PlacementsPage.tsx` (2 จุด: `load` + `loadGmv`)
- `KolsPage.tsx`
- `DashboardPage.tsx` (2–3 จุด)
- `SamplesPage.tsx`
- `CalendarPage.tsx`
- `ProductDashboardPage.tsx`
- `MarketingDashboardPage.tsx`
- `AdminUsersPage.tsx`

> เลือก maxAgeMs ให้เหมาะ: list/search ที่แก้บ่อย → 15s; dashboard/dropdown ที่นิ่ง → 60s. ทำเป็น argument ของ `isFresh(key, ms)` ต่อจุดได้

### ⚠️ ข้อควรระวัง
- **หลัง mutation ต้องยัง invalidate ให้ครบ:** ถ้า user แก้ข้อมูลแล้ว `isFresh` ยังบัง refetch จะเห็นของเก่า → ตรวจว่าทุก create/update/delete เรียก `invalidateCachePrefix` อยู่แล้ว (เช่น `CalendarPage` มี). ถ้าหน้าไหนไม่ได้ invalidate หลัง mutate ให้เพิ่ม ไม่งั้น stale-time จะทำให้ bug เห็นชัดขึ้น
- **อย่าลืม optimistic update ที่มีอยู่:** หลายหน้าอัปเดต state ตรงหลัง mutate อยู่แล้ว — stale-time ไม่กระทบ เพราะ invalidate ล้าง cache key ทำให้ครั้งหน้าถือว่า miss

### เกณฑ์ว่าสำเร็จ
- สลับ filter/tab ไป-กลับเร็วๆ ภายใน 15s → ไม่มี network request ใหม่ (ดู DevTools Network) แต่ข้อมูลถูกต้อง
- หลังแก้ข้อมูล → กลับมาหน้าเดิมเห็นข้อมูลใหม่ (invalidate ทำงาน)
- `npx tsc -b` ใน `client/` ผ่าน (อย่าใช้ `tsc --noEmit` เปล่า — เช็ค 0 ไฟล์)

---

## 4. Task C — Keep-warm ลด Cold Start (ทางเลือก, แก้ "ครั้งแรกช้า")

จากผลวัด cold start บวก ~300–450ms. สาเหตุ = Worker isolate ตื่นใหม่ + eval module + `new PrismaClient()`.

**ตัวเลือกที่ทำได้ (เรียงตาม effort):**

1. **Cloudflare Cron Trigger ยิง `/health` ทุก ~5 นาที** (ง่าย, ได้ผลบางส่วน)
   - เพิ่มใน `server/wrangler.toml`:
     ```toml
     [triggers]
     crons = ["*/5 * * * *"]
     ```
     และ `[env.production.triggers]` ซ้ำ (env ไม่ inherit — ดู comment ใน wrangler.toml)
   - เพิ่ม `scheduled` handler ใน `server/src/index.ts` ที่แค่ ping ตัวเอง หรือรัน `SELECT 1` เพื่ออุ่น connection
   - ⚠️ Cloudflare อาจ evict isolate ก่อน 5 นาทีอยู่ดี — ช่วยลดความถี่ cold ไม่ใช่ตัดขาด

2. **เลี่ยง `new PrismaClient()` บน route ที่ไม่ใช้ DB** (micro-opt)
   - ปัจจุบัน `index.ts:31-34` middleware `app.use('*')` สร้าง Prisma client **ทุก request** รวม `/health`, `/`
   - pg Pool ต่อจริงตอน query แรก (lazy) แต่การ `new PrismaClient()` เองก็มีต้นทุน
   - ปรับเป็น **lazy**: เก็บ connectionString ไว้ แล้วสร้าง client เมื่อ route เรียกใช้ครั้งแรก (เช่น getter ใน context) — ลดงานบน request ที่ไม่แตะ DB
   - ผลต่อ cold start ไม่มาก (ตัวหนักคือ isolate spin-up) → ทำเมื่อว่าง

**คำแนะนำ:** ทำ Task A + B ก่อน วัดผล ถ้ายังรู้สึก "ครั้งแรกช้า" ค่อยเพิ่ม Cron keep-warm (ตัวเลือก 1)

---

## 5. สิ่งที่ **ไม่ต้องทำ** (กันเสียเวลา)

- ❌ เปลี่ยน Prisma → Drizzle/Kysely/raw pg เพื่อ "เร่ง query" — query ไม่ใช่คอขวด (ข้อมูลพันแถว) รื้อทั้งเว็บไม่คุ้ม
- ❌ เพิ่ม index เพื่อเร่ง search — `kol_platforms` มีแค่ 736 แถว, ILIKE `%คำ%` ก็เร็วพออยู่แล้ว; index ช่วยเฉพาะตอนโตหลักแสนแถว
- ❌ Prisma Accelerate — ทับซ้อนกับ Hyperdrive (มี connection pool + cache อยู่แล้ว) อย่าใช้ทั้งคู่
- ❌ ย้าย DB ออกจาก Tokyo — เป็น region ที่ใกล้ไทยพอควรแล้ว + ผูกกับ Supabase project เดิม

---

## 6. ลำดับแนะนำ

1. **Task A** (Hyperdrive caching) — 30 นาที, ตั้งค่า + วัดผล ยืนยันว่า Prisma cache ติดจริงไหม
2. **Task B** (swrCache stale-time) — 1–2 ชม, แก้ `swrCache.ts` + 8 หน้า, ระวัง invalidate หลัง mutate, `tsc -b` ผ่าน
3. วัด latency ซ้ำ (curl -w วิธีเดิม) + ลองใช้เว็บจริง เทียบก่อน/หลัง
4. ถ้ายังช้าครั้งแรก → **Task C** ตัวเลือก 1 (Cron keep-warm)

**หลักการที่ห้ามลืม (จาก CLAUDE.md):**
- ไม่แตะข้อมูลดิบใน DB
- `wrangler ... --env production` เสมอ
- client type-check ใช้ `npx tsc -b` เท่านั้น
- ห้ามใส่ `Co-Authored-By: Claude` ใน commit
