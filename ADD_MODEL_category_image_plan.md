# แผนแก้ไข: AddModelModal — จัดการหมวดหมู่ + อัปโหลดรูป

> เป้าหมาย: ใน **New Placement → ปุ่ม "เพิ่ม model ใหม่"** (AddModelModal)
> 1. ให้ **เพิ่มหมวดหมู่สินค้า** ได้ในตัว (ทุก role) + **แก้ไข/ลบ** หมวดหมู่ได้ (admin เท่านั้น)
> 2. ช่องรูป model เปลี่ยนจากวาง URL → **อัปโหลดไฟล์รูป** (เก็บบน Supabase Storage)
>
> เอกสารนี้เป็นสเปกให้ dev (Sonnet) เขียนโค้ดต่อ — ยังไม่ต้องเขียนโค้ดในรอบ brainstorm นี้

---

## 0. การตัดสินใจที่ล็อกแล้ว (อย่าเปลี่ยนเอง)

| เรื่อง | สรุป |
|---|---|
| ที่เก็บรูป | **Supabase Storage** bucket `product-images` (public) |
| ฟอร์มรูป | **อัปโหลดอย่างเดียว** — ตัดช่องวาง URL ทิ้ง |
| schema `products` | **ไม่แก้** — `image_url` ยังเป็น string เก็บ public URL เหมือนเดิม |
| เพิ่มหมวดหมู่ | **ทุก role** |
| แก้ไข/ลบ หมวดหมู่ | **admin เท่านั้น** |
| ลบหมวดหมู่ | **soft delete** (`active=false`) เสมอ — ห้าม hard delete (products อ้าง FK + dashboard GMV รายหมวดผูกอยู่) |
| ช่องทางอัปโหลด | ผ่าน **Hono** เท่านั้น (browser ห้ามต่อ Storage/DB ตรง) ใช้ service role key ฝั่ง server |

---

## 1. สถานะปัจจุบัน (ไฟล์ที่เกี่ยวข้อง)

- `client/src/components/AddModelModal.tsx` — modal เพิ่มสินค้า: ช่อง `model_code` + `Select` หมวดหมู่ (อ่านอย่างเดียว) + `input type="url"` รูป
- `client/src/pages/NewPlacementPage.tsx` — เปิด AddModelModal, ส่ง prop `productCategories` (มาจาก `getDropdowns()`)
- `client/src/api/index.ts`
  - `type ProductCategory = { id: number; name: string }` (บรรทัด ~5)
  - `getDropdowns()` + `clearDropdownCache()` (cache ใน module — บรรทัด ~70–95)
  - `createProduct(...)` (บรรทัด ~825)
  - helper `api<T>(path, init)` — ใส่ `Authorization` ให้อัตโนมัติ, ถ้า body เป็น `FormData` **อย่าตั้ง `Content-Type`** (ปล่อยให้ browser ใส่ boundary เอง)
- `server/src/routes/products.ts` — `GET /` + `POST /` (สร้างสินค้า, เช็ค brand/duplicate/role)
- `server/src/routes/dropdowns.ts` — `prisma.product_categories.findMany({ where: { active: true }, orderBy: { name: 'asc' } })`
- `server/src/lib/supabaseAdmin.ts` — `getSupabaseAdmin(env)` (มี `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` พร้อมใช้)
- `server/src/index.ts` — bootstrap Hono + mount routes (ต้อง mount route ใหม่ตรงนี้)

**DB ปัจจุบัน** (`schema.prisma`):
```prisma
model product_categories {
  id     Int     @id @default(autoincrement())
  name   String  @unique
  active Boolean @default(true)
  // + relation products[]
}
model products {
  ...
  image_url           String?
  product_category_id Int?
  ...
}
```
→ **ไม่ต้องแก้ schema / ไม่ต้อง `prisma db pull`** ทั้งสองฟีเจอร์ ใช้คอลัมน์ที่มีอยู่แล้ว

---

## 2. งาน Manual ครั้งเดียว (ต้องทำก่อน deploy — เขียน checklist ให้ตอนส่งมอบ)

ใน Supabase Dashboard (project `hdrweioqqqpslsjizkci`):
1. Storage → New bucket → ชื่อ **`product-images`** → ตั้งเป็น **Public bucket**
2. ไม่ต้องตั้ง RLS policy เพิ่ม — เพราะ server อัปด้วย **service role key** (bypass RLS) และอ่านผ่าน public URL
3. (ออปชัน) ตั้ง file size limit ของ bucket ที่ ~2MB และ allowed MIME `image/jpeg,image/png,image/webp` เป็นด่านสองนอกจาก validate ใน Hono

> ⚠️ ถ้าไม่อยากให้ public ทั้ง bucket: ทางเลือกคือ private bucket + server คืน signed URL — **ไม่เลือกทางนี้** (image_url ต้องเป็น URL ถาวรเพราะแสดงในตาราง/ดashboard หลายที่ และ signed URL หมดอายุ) ยึด public ตามข้อ 1

---

## 3. Backend

### 3.1 อัปโหลดรูป — `POST /api/products/image`

เพิ่มใน `server/src/routes/products.ts` (route เดิม `app` mount ที่ `/api/products` อยู่แล้ว → path รวมเป็น `/api/products/image`)

- **Auth:** `requireAuth` (มี `app.use('*', requireAuth)` อยู่แล้ว) — ทุก role อัปได้ (สอดคล้องกับ `POST /` ที่ทุก role ของ brand สร้างสินค้าได้)
- **รับไฟล์:** `const body = await c.req.parseBody(); const file = body['file']` (เป็น `File`) — หรือ `await c.req.formData()`
- **Validate (สำคัญ — บอท/ผู้ใช้ส่งอะไรมาก็ได้):**
  - มีไฟล์จริง (`file instanceof File`) ไม่งั้น `400`
  - `file.type` ∈ `{'image/jpeg','image/png','image/webp'}` ไม่งั้น `400 { error: 'invalid_type' }`
  - `file.size` ≤ `2 * 1024 * 1024` ไม่งั้น `400 { error: 'too_large' }`
- **ตั้งชื่อไฟล์ unique:** `products/${crypto.randomUUID()}.${ext}` โดย `ext` map จาก MIME (`jpeg→jpg`, `png→png`, `webp→webp`) — **อย่าเชื่อนามสกุลจากชื่อไฟล์เดิม**
- **อัปขึ้น Storage ผ่าน REST** (ตรงกับ pattern เดิมในโปรเจกต์ — ไม่พึ่ง storage client บน Workers):
  ```ts
  const path = `products/${crypto.randomUUID()}.${ext}`;
  const upRes = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/product-images/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': file.type,
        'x-upsert': 'false',
      },
      body: await file.arrayBuffer(),
    },
  );
  if (!upRes.ok) return c.json({ error: 'upload_failed' }, 502);
  const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/product-images/${path}`;
  return c.json({ url: publicUrl }, 201);
  ```
  > `env` = `c.env` (Bindings). ถ้าใช้ `getSupabaseAdmin(c.env).storage.from('product-images').upload(...)` ก็ได้ แต่ REST ตรงเสถียรกว่าบน Workers — เลือก REST
- **คืน:** `{ url: string }` — frontend เก็บไว้ส่งเป็น `image_url` ตอน `createProduct` (endpoint `POST /` เดิมไม่ต้องแก้)

### 3.2 จัดการหมวดหมู่ — route ใหม่ `server/src/routes/productCategories.ts`

สร้างไฟล์ใหม่ตามแพทเทิร์น route เดิม (`new Hono<AppEnv>()` + `app.use('*', requireAuth)`) แล้ว **mount ใน `server/src/index.ts`** ที่ `'/api/product-categories'`

| Method | Path | สิทธิ์ | ทำอะไร |
|---|---|---|---|
| `POST` | `/api/product-categories` | ทุก role | สร้างหมวดหมู่ใหม่ |
| `PATCH` | `/api/product-categories/:id` | **admin** | เปลี่ยนชื่อ |
| `DELETE` | `/api/product-categories/:id` | **admin** | soft delete (`active=false`) |

รายละเอียด:

- **POST**
  - `name = (body.name ?? '').trim()` — ว่าง → `400 { error: 'name_required' }`
  - กันซ้ำ (case-insensitive แนะนำ): เช็ค `findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })`
    - ถ้าเจอแถวที่ `active=true` → `409 { error: 'duplicate' }`
    - ถ้าเจอแถวที่ `active=false` (เคยลบ) → **reactivate** (`update active=true`) แล้วคืนแถวนั้น แทนการสร้างใหม่ (กันชน unique constraint `name`)
  - ไม่เจอ → `create({ data: { name, active: true } })`
  - คืน `{ id, name }` (201)
- **PATCH** — admin only (`if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)`)
  - `name` ใหม่ trim/ไม่ว่าง/ไม่ซ้ำ (เช็คเหมือน POST) → `update`
  - คืน `{ id, name }`
- **DELETE** — admin only
  - `update({ where: { id }, data: { active: false } })` (ไม่ hard delete)
  - คืน `{ ok: true }`
  - ไม่ต้องเช็คว่ามี product ใช้อยู่ไหม — soft delete ปลอดภัยอยู่แล้ว (row คงอยู่ → product/dashboard ที่ผูกยังแสดงชื่อได้, แค่หายจาก dropdown เพราะ `where active=true`)

> **หมายเหตุสิทธิ์:** ใช้ `c.get('user').role` ที่ `requireAuth` เซ็ตไว้ (`{ id, role, brandIds }`). หมวดหมู่ไม่ผูก brand → ไม่ต้องเช็ค brandIds

---

## 4. Frontend

### 4.1 `client/src/api/index.ts` — เพิ่มฟังก์ชัน

```ts
// อัปโหลดรูป — ส่ง FormData อย่าตั้ง Content-Type เอง
export const uploadProductImage = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api<{ url: string }>('/api/products/image', { method: 'POST', body: fd });
};

export const createProductCategory = (name: string) =>
  api<ProductCategory>('/api/product-categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
export const updateProductCategory = (id: number, name: string) =>
  api<ProductCategory>(`/api/product-categories/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
export const deleteProductCategory = (id: number) =>
  api<{ ok: boolean }>(`/api/product-categories/${id}`, { method: 'DELETE' });
```

### 4.2 `AddModelModal.tsx` — แก้

**State หมวดหมู่ให้ refresh ได้** (เดิมรับ prop ตรงๆ):
```ts
const [categories, setCategories] = useState(productCategories);
const [showManage, setShowManage] = useState(false);
```
`categoryOptions` map จาก `categories` แทน `productCategories`

**ช่องหมวดหมู่** — เพิ่มลิงก์ "จัดการ" ข้าง label:
- ทุก role เห็นปุ่มเปิด ManageCategoriesModal (เพราะทุก role เพิ่มได้)
- ปุ่มแก้/ลบ ใน ManageCategoriesModal ค่อยซ่อนตาม role (ดู 4.3)

**ช่องรูป** — แทน `input type="url"` ทั้งบล็อก ด้วย uploader:
- state: `imageUrl` (เดิม), `uploading: boolean`, `uploadError: string | null`
- `<input type="file" accept="image/png,image/jpeg,image/webp">` (ซ่อน, trigger ด้วยปุ่ม "เลือกรูป")
- onChange:
  - validate ฝั่ง client ก่อน (type + size ≤ 2MB) → ถ้าไม่ผ่านโชว์ error ไม่ต้องยิง API
  - `setUploading(true)` → `const { url } = await uploadProductImage(file)` → `setImageUrl(url)` → `setUploading(false)`
  - catch → `setUploadError(t('addModel.uploadError'))`
- พรีวิว: ถ้ามี `imageUrl` โชว์ `<img>` ขนาดเล็ก (เช่น 80×80 rounded-lg object-cover) + ปุ่มลบ (`X`) → `setImageUrl('')`
- ตอน submit ส่ง `image_url: imageUrl || null` เหมือนเดิม
- ปุ่ม submit ควร disable ถ้า `uploading` ด้วย

> ดีไซน์: ยึดสไตล์เดิมของเว็บ (rounded-lg, `bg-input-bg`, `border-input-border`, `text-accent` สำหรับลิงก์) — โทนเบา/minimal ไม่ใส่กรอบหนา ไม่ต้องมี dropzone ลากวางก็ได้ (ปุ่มเลือก + พรีวิว พอ)

**ตอนปิด ManageCategoriesModal** → callback อัป `categories` (รับ list ใหม่) + `clearDropdownCache()` (ให้หน้าอื่น/ดashboard refetch)

### 4.3 `client/src/components/ManageCategoriesModal.tsx` — ไฟล์ใหม่ (modal ซ้อน)

Props (ร่าง):
```ts
interface Props {
  onClose: () => void;
  categories: ProductCategory[];
  isAdmin: boolean;                       // จาก useAuth() role === 'admin'
  onChange: (next: ProductCategory[]) => void;  // ส่ง list ล่าสุดกลับให้ parent
}
```
- ใช้ `useModalTransition` + `requestClose` (ห้ามเรียก onClose ตรง — กฎโปรเจกต์)
- z-index สูงกว่า AddModelModal (เช่น `z-[60]`) เพราะซ้อนกัน
- **แถวเพิ่มใหม่** (บนสุด, ทุก role): input + ปุ่ม "เพิ่ม" → `createProductCategory(name)` → append เข้า list + `onChange`
  - กัน duplicate: ถ้า API คืน 409 โชว์ error "หมวดหมู่นี้มีอยู่แล้ว"
- **ลิสต์หมวดหมู่** (เฉพาะ `active`): แต่ละแถวโชว์ชื่อ
  - ถ้า `isAdmin`: มีปุ่มดินสอ (แก้ชื่อ inline เป็น input → `updateProductCategory`) + ปุ่มถังขยะ (`deleteProductCategory` → เอาออกจาก list + `onChange`)
  - ถ้าไม่ใช่ admin: โชว์ชื่ออย่างเดียว (อ่านอย่างเดียว)
- ทุก mutation สำเร็จ → เรียก `onChange(nextList)` ให้ AddModelModal sync ทันที (ไม่ต้องรอปิด modal)
- มี race guard ไม่จำเป็น (ไม่มี debounced search) แต่ปุ่มต้อง disable ระหว่าง submit กัน double-click

### 4.4 หา role ของ user
ดูว่าหน้า/คอมโพเนนต์อื่นดึง role จากไหน (น่าจะ `useAuth()`/AuthContext → `user.role`). ส่ง `isAdmin={user.role === 'admin'}` ลงมาจาก NewPlacementPage หรือ AddModelModal

---

## 5. i18n (เพิ่ม key ใน `th.ts` ก่อน แล้ว en/zh ให้ครบ — `satisfies Translations`)

namespace `addModel` (มีอยู่แล้ว) — เพิ่ม/แก้:
- ลบการใช้ `imageUrlLabel` (หรือคงไว้แต่เปลี่ยนข้อความ) → ใช้ label ใหม่ เช่น:
  - `imageLabel`: "รูปสินค้า" / "Product image" / "产品图片"
  - `chooseImage`: "เลือกรูป" / "Choose image" / "选择图片"
  - `removeImage`: "ลบรูป"
  - `uploading`: "กำลังอัปโหลด…"
  - `uploadError`: "อัปโหลดรูปไม่สำเร็จ"
  - `invalidImageType`: "รองรับเฉพาะ JPG / PNG / WebP"
  - `imageTooLarge`: "รูปต้องไม่เกิน 2MB"
  - `manageCategories`: "จัดการ" (ลิงก์ข้างหมวดหมู่)

namespace ใหม่ `manageCategories`:
- `title`: "จัดการหมวดหมู่สินค้า"
- `addPlaceholder`: "ชื่อหมวดหมู่ใหม่"
- `add`: "เพิ่ม"
- `duplicate`: "หมวดหมู่นี้มีอยู่แล้ว"
- `confirmDelete`: "ลบหมวดหมู่นี้?" (ใช้กับปุ่มถังขยะ — admin)
- `empty`: "ยังไม่มีหมวดหมู่"

> คำ domain (KOL/GMV/etc.) คงภาษาอังกฤษ — แต่ "หมวดหมู่/รูปสินค้า" แปลปกติ

---

## 6. Edge cases & กฎที่ต้องระวัง

- **ตัด field URL ออกแล้ว** แต่ product เก่าที่ `image_url` เป็น URL ภายนอกยังแสดงได้ปกติ (แค่ฟอร์มสร้างใหม่ไม่มีช่อง URL) — ตรวจว่า ProductDashboardPage/ที่แสดงรูปไม่พัง
- **อัปรูปแล้วแต่ไม่กด submit** (ปิด modal ทิ้ง) → ไฟล์ค้างใน Storage (orphan). ยอมรับได้ในเฟสนี้ (ไม่ทำ cleanup job) — บันทึกเป็น known limitation
- **ชื่อหมวดหมู่ unique constraint**: การลบเป็น soft delete → ชื่อยังถูกจองใน DB. ถ้าผู้ใช้เพิ่มชื่อเดิมที่เคยลบ → ต้อง **reactivate** (ข้อ 3.2 POST) ไม่ใช่ create ซ้ำ ไม่งั้นชน unique → 500
- **non-admin เปิด ManageCategoriesModal**: ต้องเพิ่มได้อย่างเดียว — อย่าลืมเช็ค `isAdmin` ทั้งฝั่ง UI **และ** ฝั่ง server (PATCH/DELETE ต้อง 403 ถ้าไม่ใช่ admin — อย่าพึ่ง UI อย่างเดียว)
- **`api<T>` กับ FormData**: อย่าตั้ง `Content-Type` (ข้อ 4.1) — ถ้าตั้งเป็น `multipart/form-data` เองจะไม่มี boundary แล้ว parse พัง
- **modal ซ้อน**: ManageCategoriesModal ต้อง `z` สูงกว่า + คลิก backdrop ของตัวเองปิดเฉพาะตัวเอง (`stopPropagation`) ไม่ทะลุไปปิด AddModelModal

---

## 7. ลำดับงานแนะนำ (ให้ dev ทำ)

1. **Manual:** สร้าง bucket `product-images` (public) ใน Supabase
2. **Server:** `POST /api/products/image` ใน `products.ts` (+ test ด้วย curl/REST: อัปรูปได้ public URL)
3. **Server:** route ใหม่ `productCategories.ts` (POST ทุก role / PATCH+DELETE admin) + mount ใน `index.ts`
4. **Client api:** เพิ่ม `uploadProductImage` + `create/update/deleteProductCategory`
5. **Client:** `ManageCategoriesModal.tsx` ใหม่
6. **Client:** แก้ `AddModelModal.tsx` (uploader แทน URL + ลิงก์จัดการ + state refresh)
7. **i18n:** เติม key 3 ภาษา
8. **Verify** (ข้อ 8) → build → deploy

---

## 8. Verify ก่อนปิดงาน

- `cd server && npx wrangler dev` (หรือ deploy preview) — ทดสอบ:
  - อัปรูป jpg/png/webp ≤2MB → ได้ public URL เปิดดูได้
  - อัปไฟล์ไม่ใช่รูป / >2MB → 400 ข้อความถูก
  - POST หมวดหมู่ใหม่ (login เป็น marketing) → 201
  - PATCH/DELETE หมวดหมู่ ด้วย marketing → **403**; ด้วย admin → สำเร็จ
  - เพิ่มชื่อที่เคยลบ → reactivate ไม่ error
- **Client typecheck:** `cd client && npx tsc -b` (อย่าใช้ `tsc --noEmit` เปล่า — เช็ค 0 ไฟล์)
- `cd client && npm run build` ผ่าน
- ทดสอบใน UI: เปิด New Placement → เพิ่ม model → อัปรูป + เพิ่มหมวดหมู่ → สร้างสินค้าสำเร็จ + รูป/หมวดหมู่โผล่
- **Cleanup:** ลบ product/หมวดหมู่/รูป ที่สร้างตอน test ออกจาก DB + Storage (ห้ามทิ้งข้อมูลทดสอบจริง — กฎโปรเจกต์)

---

## 9. สรุปไฟล์ที่แตะ

**ใหม่:**
- `server/src/routes/productCategories.ts`
- `client/src/components/ManageCategoriesModal.tsx`

**แก้:**
- `server/src/routes/products.ts` (+`POST /image`)
- `server/src/index.ts` (mount route หมวดหมู่)
- `client/src/api/index.ts` (4 ฟังก์ชันใหม่)
- `client/src/components/AddModelModal.tsx` (uploader + ลิงก์จัดการ + state)
- `client/src/i18n/th.ts`, `en.ts`, `zh.ts` (key ใหม่)

**ไม่แตะ:** `schema.prisma` (ไม่ต้อง migrate), `POST /api/products` เดิม

**Deploy:** push `main` → Workers Builds auto-deploy ทั้ง client+server (server endpoint ใหม่ต้องมี secret `SUPABASE_SERVICE_ROLE_KEY` ซึ่งตั้งไว้แล้ว)

---

# ภาคผนวก: Optimistic UI ทั้งเว็บ (งานแยก — แต่ทำในรอบเดียวกันได้)

> **ปัญหาที่ผู้ใช้รายงาน:** ปุ่มที่มี effect กับ DB ส่วนใหญ่ "รอ backend ทำงานเสร็จก่อนแล้วค่อยอัปเดต UI" → รู้สึกหน่วง
> **เป้าหมาย:** อัปเดต UI **ทันที** แล้วค่อย sync กับ backend เบื้องหลัง — ถ้า fail ค่อย rollback + เตือน
> **ขอบเขต:** เฉพาะ client (`client/src/`) ไม่แตะ backend/DB

## A. นโยบาย — optimistic เมื่อไหร่ / block เมื่อไหร่ (อ่านก่อนทำ)

**ไม่ใช่ทุกปุ่มควร optimistic** — แยกตามนี้:

### ✅ ทำ optimistic (mutation บน row ที่มีอยู่แล้ว — ไม่ต้องรอ id ใหม่)
toggle / เปลี่ยนสถานะ / แก้ field / ลบ / rename → อัปเดต local state ทันที, ยิง request เบื้องหลัง, fail แล้ว rollback
**เหตุผล:** ไม่ต้องพึ่งค่าที่ server สร้าง — rollback ได้สะอาด

### ⛔ คง blocking ไว้ (พร้อม pending state ชัดเจน — spinner/disable ปุ่ม)
**create ที่ผลลัพธ์ถูกใช้ต่อทันที** (ต้องใช้ `id`/ค่าที่ server คำนวณ เช่น tier, handle_normalized, recomputed primary) **และ form save หนักๆ**
**เหตุผล (pushback — อย่าทำ optimistic ปลอมตรงนี้):** ถ้าใส่ temp id แล้วเอาไปเป็น FK (`store_id`, `product_id`, `kol_id`) ทันที แล้ว create fail → ฟอร์มชี้ไปยัง record ที่ไม่มีจริง = บั๊กหนักกว่าเดิม. กลุ่มนี้ปรับ "ความรู้สึกเร็ว" ด้วย spinner + disable ปุ่มกันกดซ้ำ ก็พอ ไม่ต้องโกหก UI

> ตัวอย่างที่ **ห้าม** optimistic: `createKol` (KolPicker → `selectKol(created)` ใช้ id ทันที), `createStoreBranch` (→ `set('store_id', created.id)`), `createProduct` (→ `onCreated` ใช้ id), `addKolPlatform` (server recompute primary/tier ทั้ง bundle)

## B. Helper กลาง — `client/src/lib/optimistic.ts` (ไฟล์ใหม่)

โค้ดเบสมี pattern นี้ inline อยู่แล้วใน `CalendarPage.sendReschedule` และ `AdminUsersPage.handleToggleUser` (optimistic + rollback ใน catch) — สกัดเป็น helper เดียวให้ reuse:

```ts
// อัปเดต UI ก่อน, ยิง request, ถ้า fail → rollback + เรียก onError
export async function optimistic<T>(opts: {
  apply: () => void;            // mutate local state ทันที
  rollback: () => void;         // ย้อนกลับถ้า request fail
  request: () => Promise<T>;
  onError?: (e: unknown) => void;
}): Promise<T | undefined> {
  opts.apply();
  try {
    return await opts.request();
  } catch (e) {
    opts.rollback();
    opts.onError?.(e);
    return undefined;
  }
}
```

- **toggle/delete ล้วน:** ใช้ helper นี้ตรงๆ
- **edit ที่ server คืน canonical row:** `apply()` เดาค่าใหม่ก่อน → เมื่อ `request()` คืน row จริง ค่อย reconcile (`setRows(prev => prev.map(r => r.id === id ? returned : r))`) — ป้องกัน field คำนวณฝั่ง server (เช่น tier) ไม่ตรง
- **race guard:** ถ้าปุ่มกดรัวได้ (toggle ซ้ำเร็วๆ) ใส่ `seqRef` แบบ CalendarPage — ดูกฎ "Race Condition Guard" ใน CLAUDE.md

### B.1 Pattern: optimistic-insert ด้วย temp id (สำหรับ create ที่ id แค่โชว์ใน list)
ใช้กับ `createKolTerm` + `createSample` (ตัดสินใจแล้ว — ดูกลุ่ม 2). id ของ row ใหม่ **ห้ามถูกเอาไปใช้เป็น FK ต่อทันที** ถึงจะใช้ pattern นี้ได้:
```ts
const tempId = -Date.now();                 // id ลบ = ยังไม่ commit (กันชนกับ id จริงที่เป็นบวก)
const optimisticRow = { ...formValues, id: tempId, __pending: true };
setRows(prev => [optimisticRow, ...prev]);  // แทรกทันที
try {
  const real = await createSample(payload);
  setRows(prev => prev.map(r => r.id === tempId ? real : r)); // reconcile ด้วย row จริง
} catch (e) {
  setRows(prev => prev.filter(r => r.id !== tempId));         // เอาแถวออก
  showToast(t('common.saveFailed'));
}
```
- ระหว่าง `__pending` ทำให้แถวจางลงเล็กน้อย (`opacity-60`) + **disable ปุ่มแก้/ลบ** ของแถวนั้น (กดแก้ row ที่ยังไม่มี id จริงไม่ได้)
- ถ้า list มี total/pagination (SamplesPage) → ปรับ `setTotal(n => n + 1)` ตอนแทรก และ `-1` ตอน fail
- **อย่าใช้กับกลุ่ม 3** — id ที่นั่นถูกใช้เป็น FK ทันที temp id จะพัง

## C. รายการจุดที่ต้องแก้ (per call site)

### กลุ่ม 1 — มี optimistic แล้ว ✅ (ใช้เป็นต้นแบบ ไม่ต้องแก้)
| ไฟล์ | action |
|---|---|
| `CalendarPage.tsx` | ลากเลื่อนวัน (`reschedulePlacement`) — gold standard: optimistic + seq guard + rollback |
| `AdminUsersPage.tsx` | toggle user active (`handleToggleUser`), toggle brand active (`handleToggleBrandActive`) |

### กลุ่ม 2 — เปลี่ยนเป็น optimistic 🔧 (งานหลักของ requirement นี้)
| ไฟล์ | บรรทัด(ราว) | action | ตอนนี้ | ทำเป็น |
|---|---|---|---|---|
| `SamplesPage.tsx` | ~309 | เปลี่ยนสถานะ sample (`updateSample`) | setRows หลัง await | apply สถานะใหม่ทันที + reconcile กับ row ที่คืน |
| `SamplesPage.tsx` | ~319 | ลบ sample (`deleteSample`) | setRows หลัง await | ลบจาก list ทันที + ลด total, fail แล้ว insert คืน |
| `KolDetailModal.tsx` | ~275 | ลบ commercial term (`deleteKolTerm`) | setTerms หลัง await | ลบทันที + rollback |
| `KolDetailModal.tsx` | ~416 | แก้ handle/follower platform (`updateKolPlatform`) | onChanged หลัง await | apply ค่าใหม่ทันที + reconcile bundle ที่คืน |
| `KolDetailModal.tsx` | ~428 | ลบ platform (`deleteKolPlatform`) | onChanged หลัง await | เอา platform ออกทันที + rollback |
| `KolDetailModal.tsx` | ~56 | แก้ profile (tags/selling/contact) (`updateKol`) | onUpdated หลัง await | apply ค่าใหม่ทันที (field ผู้ใช้พิมพ์เอง รู้ค่าอยู่แล้ว) + rollback |
| `AdminUsersPage.tsx` | ~208 | แก้ brand ของ user (`updateAdminUser`) | setUsers หลัง await | apply ทันที + reconcile |
| `AdminUsersPage.tsx` | ~224 | แก้อีเมล inline (`updateAdminUser`) | setUsers หลัง await | apply ทันที + rollback |
| `AdminUsersPage.tsx` | ~267 | แก้ชื่อ/โลโก้ brand (`updateAdminBrand`) | setBrands หลัง await | apply ทันที + reconcile |
| `KolDetailModal.tsx` | ~254 | เพิ่ม term (`createKolTerm`) | setTerms หลัง await | **optimistic-insert + temp id** (ดู B.1) |
| `SamplesPage.tsx` | ~101 | สร้าง sample (`createSample`) | onCreated หลัง await | **optimistic-insert + temp id** (ดู B.1) + ปรับ total |

> **set primary platform** ใน KolDetailModal (ถ้ามีปุ่มดาว/ตั้งหลัก) — เป็น toggle บน row ที่มีอยู่ → optimistic ได้ แต่ server recompute `is_primary` ของทั้งชุด → apply ทันทีแล้ว **reconcile ด้วย bundle ที่คืน** (อย่าเดา primary ของตัวอื่นเอง)

### กลุ่ม 3 — คง blocking + ปรับ pending state ให้ชัด ⏳ (อย่าทำ optimistic ปลอม — ตัดสินใจแล้ว)
ทุกอันต้อง: **disable ปุ่มระหว่างยิง** + spinner/ข้อความ `t('common.saving')` + กันกดซ้ำ
| ไฟล์ | action | เหตุผลที่ blocking |
|---|---|---|
| `KolPicker.tsx` | สร้าง KOL (`createKol`) | `selectKol(created)` ใช้ id ทันที |
| `AddModelModal.tsx` | สร้างสินค้า (`createProduct`) | `onCreated` ใช้ id |
| `NewPlacementPage.tsx` | สร้างสาขา (`createStoreBranch`) | `set('store_id', created.id)` |
| `NewPlacementPage.tsx` | สร้าง placement (`createPlacement`) | navigate ออกหลังเสร็จ |
| `KolDetailModal.tsx` | เพิ่ม platform (`addKolPlatform`) | server recompute primary/tier ทั้ง bundle |
| `PerformanceModal.tsx` | บันทึก performance (`updatePerformance`) | form หนัก หลาย metric — blocking ชัดเจนกว่า |
| `AdminUsersPage.tsx` | สร้าง user/brand, reset password | ต้องใช้ id / แสดงรหัสผ่าน |

### กลุ่ม 4 — แก้ anti-pattern (ทำแน่นอน ไม่เกี่ยว optimistic) 🐛
| ไฟล์ | บรรทัด | ปัญหา | แก้เป็น |
|---|---|---|---|
| `AdminUsersPage.tsx` | ~155 | `createAdminUser` แล้ว `await load()` **refetch ทั้งหน้า** | append user ที่ API คืนเข้า `setUsers` (เลียนแบบ `createAdminBrand` ~243 ที่ทำถูกอยู่แล้ว) |

## D. มาตรฐาน error surface (ทำพร้อมกัน — feedback เรื่อง UI minimal)
- `AdminUsersPage.tsx` ใช้ `alert(...)` **5 จุด** (บรรทัด ~176, 190, 213, 229, 290) ตอน rollback/error → เปลี่ยนเป็น **`Toast`** (component มีอยู่แล้ว ใช้ในหน้านี้อยู่แล้ว) ให้ทั้งเว็บ error แบบเดียวกัน ไม่เด้ง browser alert
- rollback ทุกจุดควรโชว์ Toast สั้นๆ เช่น `t('common.saveFailed')` (เพิ่ม i18n key นี้ 3 ภาษา)
- ระหว่าง pending ใช้ `t('common.saving')` (มีแล้ว)

## E. Verify (ภาคนี้)
- ทดสอบ "ตัดเน็ต/throttle" (DevTools Network → Offline) แล้วกดปุ่มกลุ่ม 2 → UI ต้องเปลี่ยนทันที **แล้ว rollback + Toast** เมื่อ request fail
- กดปุ่มกลุ่ม 2 ตอนเน็ตปกติ → เปลี่ยนทันที ไม่กระพริบ/ไม่เด้งกลับ (reconcile แล้วค่าตรง)
- toggle รัวๆ (เช่น sample status) → ไม่มี response เก่าทับใหม่ (ใส่ seq guard ถ้าจำเป็น)
- กลุ่ม 3 → ปุ่ม disable + spinner ระหว่างรอ กดซ้ำไม่ได้
- `cd client && npx tsc -b` + `npm run build` ผ่าน
- **Cleanup** ข้อมูล test ทุกชิ้น (กฎโปรเจกต์)

## F. ไฟล์ที่แตะ (ภาคผนวกนี้)
**ใหม่:** `client/src/lib/optimistic.ts`
**แก้:** `SamplesPage.tsx`, `KolDetailModal.tsx`, `AdminUsersPage.tsx`, `KolPicker.tsx`, `AddModelModal.tsx`, `NewPlacementPage.tsx`, `PerformanceModal.tsx`, i18n (`th/en/zh` — key `common.saveFailed`)
**ไม่แตะ:** backend ทั้งหมด, `CalendarPage.tsx` (ทำถูกแล้ว)

---

# Handoff Checklist สำหรับ Sonnet

> ทำตามลำดับ ติ๊กทีละข้อ. แต่ละ phase จบด้วย `cd client && npx tsc -b` (อย่าใช้ `tsc --noEmit` เปล่า) ให้ผ่านก่อนไปต่อ

## Phase 0 — เตรียม (มนุษย์ทำ ไม่ใช่ Sonnet)
- [ ] สร้าง Supabase bucket `product-images` แบบ **Public** (ดูข้อ 2) — ถ้ายังไม่ทำ endpoint อัปรูปจะ 502

## Phase 1 — Backend: อัปโหลดรูป
- [ ] เพิ่ม `POST /api/products/image` ใน `server/src/routes/products.ts` (validate type/size → อัป REST → คืน `{ url }`) ตามข้อ 3.1
- [ ] ทดสอบด้วย REST/curl: อัป jpg/png/webp ≤2MB ได้ public URL เปิดดูได้ / ไฟล์ผิดชนิด/ใหญ่เกิน → 400

## Phase 2 — Backend: จัดการหมวดหมู่
- [ ] สร้าง `server/src/routes/productCategories.ts` (POST ทุก role / PATCH+DELETE admin-only / soft delete / reactivate ชื่อซ้ำ) ตามข้อ 3.2
- [ ] mount ที่ `/api/product-categories` ใน `server/src/index.ts`
- [ ] ทดสอบสิทธิ์: PATCH/DELETE ด้วย marketing → **403**; admin → ผ่าน; เพิ่มชื่อที่เคยลบ → reactivate ไม่ error

## Phase 3 — Client API
- [ ] เพิ่มใน `client/src/api/index.ts`: `uploadProductImage`, `createProductCategory`, `updateProductCategory`, `deleteProductCategory` (ข้อ 4.1) — **FormData อย่าตั้ง Content-Type**
- [ ] เพิ่ม helper `client/src/lib/optimistic.ts` (ข้อ B)

## Phase 4 — Client UI: AddModelModal + หมวดหมู่
- [ ] สร้าง `client/src/components/ManageCategoriesModal.tsx` (ข้อ 4.3) — ใช้ `useModalTransition`/`requestClose`, z สูงกว่า, non-admin เพิ่มได้อย่างเดียว
- [ ] แก้ `AddModelModal.tsx`: uploader แทนช่อง URL + พรีวิว/ลบรูป + ลิงก์ "จัดการ" + state `categories` refresh ได้ (ข้อ 4.2)
- [ ] ส่ง `isAdmin` ลงมา (จาก `useAuth().user.role`)

## Phase 5 — Optimistic UI (ภาคผนวก)
- [ ] **กลุ่ม 4 ก่อน** (anti-pattern): `createAdminUser` เลิก `await load()` → append row ที่ API คืน
- [ ] **กลุ่ม 2** เปลี่ยนเป็น optimistic ตามตารางข้อ C (toggle/edit/delete ใช้ `optimistic()`; `createKolTerm`/`createSample` ใช้ temp-id ข้อ B.1)
- [ ] **กลุ่ม 3** เพิ่ม disable+spinner ระหว่าง pending (ไม่ทำ optimistic)
- [ ] แทน `alert()` 5 จุดใน `AdminUsersPage.tsx` ด้วย `Toast` (ข้อ D)

## Phase 6 — i18n
- [ ] เพิ่ม key ใน `th.ts` **ก่อน** แล้วไล่เติม `en.ts`/`zh.ts` ให้ TS ไม่ error (`satisfies Translations`):
  - `addModel.*` (imageLabel/chooseImage/removeImage/uploading/uploadError/invalidImageType/imageTooLarge/manageCategories)
  - namespace `manageCategories` (title/addPlaceholder/add/duplicate/confirmDelete/empty)
  - `common.saveFailed`
- [ ] คำ domain (KOL/GMV/Barter ฯลฯ) คงอังกฤษ ไม่ผ่าน `t()`

## Phase 7 — Verify & ส่ง
- [ ] `cd client && npx tsc -b` ผ่าน + `npm run build` ผ่าน
- [ ] UI: New Placement → เพิ่ม model → อัปรูป + เพิ่ม/แก้/ลบ หมวดหมู่ → สร้างสินค้าได้ รูป/หมวดหมู่โผล่
- [ ] Optimistic: DevTools Network → **Offline** แล้วกดปุ่มกลุ่ม 2 → UI เปลี่ยนทันที **แล้ว rollback + Toast** เมื่อ fail; เน็ตปกติ → ไม่กระพริบ/ไม่เด้งกลับ
- [ ] **Cleanup ข้อมูล test ทุกชิ้น** (product/category/รูปใน Storage/user) — verify count กลับเป็น 0 ก่อนปิดงาน (กฎโปรเจกต์)
- [ ] commit **ห้ามมี** `Co-Authored-By: Claude` (กฎ CLAUDE.md ข้อ 0.6)

## ⚠️ กับดักที่ห้ามพลาด (สรุปจากทั้งไฟล์)
1. `tsc -b` ไม่ใช่ `tsc --noEmit` (client เป็น solution-style เช็ค 0 ไฟล์)
2. FormData: **อย่า** ตั้ง `Content-Type` เอง
3. หมวดหมู่: `name` unique → ลบ = soft delete, เพิ่มซ้ำ = **reactivate** ไม่ใช่ create
4. เช็ค admin **ฝั่ง server** ด้วย (PATCH/DELETE category) ไม่ใช่แค่ซ่อนปุ่ม
5. modal: ใช้ `requestClose` ไม่ใช่ `onClose`; modal ซ้อนคุม z-index + `stopPropagation`
6. optimistic temp-id (B.1): id เป็นเลขลบ, disable แก้/ลบ row จนได้ id จริง — **ห้าม**ใช้กับกลุ่ม 3
7. i18n: เติม `th.ts` ก่อนเสมอ ไม่งั้น TS error ที่ en/zh
8. ระวัง `const { t }` ถูก shadow ด้วย local var ชื่อ `t` (เช็คชื่อตัวแปรในแต่ละ scope)
