# Excel export / template รองรับ 3 ภาษา (เลือกตอนกดโหลด)

> **สถานะ:** Design (approved) — รอ implementation (มอบให้ Sonnet เขียนโค้ด)
> **วันที่:** 2026-06-30
> **ไฟล์ที่เกี่ยว:**
> - client: `client/src/components/ChartTableCard.tsx`, `client/src/lib/exportTable.ts`, `client/src/pages/DashboardPage.tsx`, `client/src/pages/ImportPlacementsPage.tsx`, `client/src/api/index.ts`, `client/src/i18n/locales/{th,en,zh}.ts`
> - client (component ใหม่): `client/src/components/ExportLangMenu.tsx`
> - server: `server/src/routes/placementsImport.ts`

---

## 1. เป้าหมาย

เว็บมี 3 ภาษา (ไทย/English/中文) แต่ไฟล์ Excel ที่โหลดได้ยัง**ไม่ครบ 3 ภาษา**:

1. **Dashboard export** — หัวตารางแปลตามภาษา UI อยู่แล้ว แต่ยังมีบางส่วน hardcode ภาษาไทย
2. **Template ในหน้า NewPlacements/Import** — hardcode ภาษาไทยทั้งไฟล์ (ฝั่ง server)

งานนี้ทำให้ไฟล์ Excel ที่โหลดได้ทั้ง 2 จุด **เลือกภาษาได้ตอนกดโหลด** (ไทย/English/中文) ผ่าน dropdown ที่ปุ่ม

---

## 2. การตัดสินใจที่ล็อกแล้ว (จาก brainstorming)

| หัวข้อ | การตัดสินใจ |
|---|---|
| ภาษาของไฟล์ | **เลือกตอนกดโหลด** (ไม่ผูกกับภาษา UI) — เช่นดูเว็บภาษาไทยแต่โหลดไฟล์อังกฤษส่งให้คนต่างชาติได้ |
| UI เลือกภาษา | **Dropdown ที่ปุ่ม** — กด Export/ดาวน์โหลด → เมนู ไทย / English / 中文 → ไฟล์ออกภาษานั้น |
| ความเหมือนกัน | ใช้ component เดียวกันทั้ง dashboard และ template |
| ข้อมูลจริง + domain term | **ไม่แปล** — คงเดิมทุกภาษา (ดู §4) |

---

## 3. สถานะปัจจุบัน (ข้อเท็จจริงจากโค้ด — สำคัญต่อ implementer)

### 3.1 Dashboard export (ฝั่ง client)
- `client/src/lib/exportTable.ts` — `exportTableToExcel(columns, rows, filename, sheetName='Sheet1')`
  - หัวตารางมาจาก `columns[].header` (string ที่ resolve มาแล้ว)
  - **hardcode ไทย:** แถวรวม `'รวม'` (บรรทัด ~42), default `sheetName='Sheet1'`
  - แถวรวมใส่ `SUM()` ให้คอลัมน์ที่เป็นตัวเลข; คอลัมน์แรกใส่ `'รวม'`
- `client/src/components/ChartTableCard.tsx` — `handleExport()` เรียก `exportTableToExcel(cols, table.rows, exportFilename)` (ไม่ส่ง sheetName → ได้ `'Sheet1'`)
  - column type มี `{ key, header, align?, width?, render?, exportFormat? }`
- `client/src/pages/DashboardPage.tsx` — สร้าง column ด้วย `header: t('dashboard.colXxx')` (เช่น `colRank/colProduct/colCategory/colPlacements/colOrders/colSku`) → **หัวตารางแปลตามภาษา UI ปัจจุบันอยู่แล้ว**; หัวที่เป็น literal เช่น `'GMV'`, `'%'` ใส่ตรงๆ
  - มี ChartTableCard 3 จุด: product ranking, GMV by category, GMV by SKU

> **ปัญหา:** เพราะผู้ใช้จะเลือกภาษา**อื่น**ตอนโหลด (ไม่ใช่ภาษา UI) `t('dashboard.colXxx')` ที่ resolve ตอน render จึงใช้ไม่ได้ — ต้อง resolve ใหม่ด้วยภาษาที่เลือก

### 3.2 Template (ฝั่ง server — `server/src/routes/placementsImport.ts`)
- สร้างไฟล์ด้วย `exceljs` (`wb.xlsx.writeBuffer()`); endpoint `GET /api/placements/import/template/:kind?brand_id=X`
- ค่าคงที่ปัจจุบัน:
  - `SHEET_NAME = { online: 'นำเข้า Placement - Online', offline_shop: 'นำเข้า Placement - Offline' }`
  - `REF_SHEET_NAME = 'รายชื่ออ้างอิง'`
- **hardcode ไทย** กระจายทั่ว: `ONLINE_HEADERS`/`OFFLINE_HEADERS`, ref-sheet headers ใน `buildReferenceSheet()`, prompt/error ใน `applyDateValidation()` + `applyListValidation()`, label ที่ส่งเข้า validation
- payment dropdown ปัจจุบัน: `applyListValidation(ws, 8, '"จ่ายเงิน,Free,Barter"', 'ประเภทการจ่ายเงิน', true)` (บรรทัด ~543)

### 3.3 Round-trip — ปลอดภัยที่จะแปล (ตรวจแล้ว)
- **parse แบบ positional:** `validate/:kind` ทำ `if (rowNumber === 1) return` (ข้าม header) แล้ว `rowToRaw(row, keys)` อ่านตามลำดับคอลัมน์ → **แปลหัวคอลัมน์ได้ ไม่กระทบ import กลับ**
- **หาชีตข้อมูล:** `wb.getWorksheet(SHEET_NAME[kind]) ?? wb.worksheets[0]` → ถ้าแปลชื่อชีต ชื่อจะไม่ match แต่ fallback `worksheets[0]` (ชีตข้อมูลถูก add เป็นชีตแรกเสมอ) รับได้ → **ต้องเปลี่ยน parse ให้ใช้ชีตแรกแบบตำแหน่ง** (ดู §6.5)
- **payment parse lowercase:** บรรทัด ~276 `PAYMENT_MAP[raw.paymentType.trim().toLowerCase()]` → `'Paid'/'Free'/'Barter'` map ได้ทั้งหมด (`PAYMENT_MAP` มี `paid/free/barter` + คง `'จ่ายเงิน'` ไว้ backward-compat) → **เปลี่ยน dropdown เป็น `Paid,Free,Barter` ปลอดภัย**

---

## 4. ขอบเขต: แปล vs ไม่แปล

**แปล (ตามภาษาที่เลือก):**
- หัวคอลัมน์ที่เป็นคำอธิบาย: แบรนด์, ห้าง/สาขา, ประเภทการจ่ายเงิน, วันลงโพสต์, ราคาสุทธิ, ค่าโฆษณา, หมายเหตุ
- ชื่อชีต (data + reference), หัว ref-sheet, คำอธิบาย Campaign
- ข้อความ in-cell validation (prompt/error ของ date + list), prompt title
- Dashboard: แถว "รวม", ชื่อชีต

**ไม่แปล (คงเดิมทุกภาษา) — ตาม CLAUDE.md §9:**
- ข้อมูลจริง: ชื่อแบรนด์, Model code, Campaign code/label, KOL handle/follower (มาจาก DB)
- domain term ภาษาอังกฤษ: `KOL Handle`, `Platform`, `Model`, `Campaign`, `Follower`, `GMV`, `%`, `Paid`, `Free`, `Barter`
- ค่าใน dropdown ที่ใช้ parse กลับ (payment = `Paid,Free,Barter`)
- ชื่อไฟล์ (.xlsx) — คงอังกฤษ stable (เลี่ยงปัญหา encoding)

**นอกขอบเขต (ไม่ทำในงานนี้):**
- ข้อความ error ของ API (JSON) ตอน generate/upload (เช่น `'กรุณาเลือกแบรนด์ก่อนดาวน์โหลด template'`) — แสดงผ่าน UI ที่เป็นภาษาผู้ใช้อยู่แล้ว, แยกเป็นงาน cleanup ภายหลัง
- export หน้าอื่นนอกจาก 2 จุดนี้

---

## 5. ดีไซน์ Part A — Dashboard export (client)

### 5.1 เปลี่ยน column ให้พก i18n key
ChartTableCard column type เพิ่ม `headerKey` (optional) คู่กับ `header`:
```ts
interface TableColumn {
  key: string;
  header?: string;        // literal เช่น 'GMV', '%'
  headerKey?: string;     // i18n key เช่น 'dashboard.colProduct'
  align?: 'left' | 'center' | 'right';
  width?: string;
  render?: (v: unknown, row: ...) => ReactNode;
  exportFormat?: (v: unknown, row: ...) => string | number;
}
```
กติกา: ต้องมี `header` หรือ `headerKey` อย่างใดอย่างหนึ่ง
- **แสดงบนจอ** (current UI lang): `headerKey ? t(headerKey) : header`
- **ตอน export** (chosen lang): `headerKey ? tt(headerKey) : header` โดย `tt = i18n.getFixedT(chosenLang)`

`DashboardPage.tsx`: เปลี่ยน `header: t('dashboard.colProduct')` → `headerKey: 'dashboard.colProduct'`; ที่เป็น literal (`header: 'GMV'`, `header: '%'`) คงไว้

### 5.2 exportTable.ts — เอา hardcode ออก
เปลี่ยน signature ให้รับ label ที่ resolve มาแล้ว (exportTable.ts ไม่ยุ่งกับ i18n เอง):
```ts
exportTableToExcel(columns, rows, filename, opts?: { sheetName?: string; totalLabel?: string })
```
- แทน `'รวม'` ด้วย `opts.totalLabel ?? 'Total'`
- `sheetName = opts.sheetName ?? 'Data'`

### 5.3 ChartTableCard — resolve ทุกอย่างด้วยภาษาที่เลือก
`handleExport(lang)`:
```ts
const tt = i18n.getFixedT(lang);
const cols = table.columns.map(c => ({
  ...c,
  header: c.headerKey ? tt(c.headerKey) : (c.header ?? ''),
  format: c.exportFormat,
}));
await exportTableToExcel(cols, table.rows, exportFilename, {
  sheetName: tt('export.sheetName'),   // หรือ title ของ card ถ้ามี key
  totalLabel: tt('export.totalRow'),
});
```
ปุ่ม Export เดิม → เปลี่ยนเป็น `<ExportLangMenu onPick={handleExport} label={t('...')} />` (§7)

---

## 6. ดีไซน์ Part B — Template (server)

### 6.1 client ส่ง lang
`client/src/api/index.ts` → `downloadImportTemplate(kind, brandId, lang)` เพิ่ม query `&lang=${lang}`
`ImportPlacementsPage.tsx` → ปุ่มดาวน์โหลด template เปลี่ยนเป็น `<ExportLangMenu onPick={lang => downloadImportTemplate(kind, brandId, lang)} .../>`

### 6.2 server อ่าน lang + ตารางแปล
endpoint `GET /template/:kind` อ่าน `const lang = c.req.query('lang')` แล้ว `const T = tpl(lang)`:
```ts
type TplLang = 'th' | 'en' | 'zh';
function tpl(lang: string | undefined): typeof TEMPLATE_I18N['th'] {
  return TEMPLATE_I18N[(lang === 'en' || lang === 'zh') ? lang : 'th'];
}
```
`TEMPLATE_I18N` = object แปลครบ (ดู §8) ครอบคลุม: sheet names, headers, ref headers, validation prompt/error, labels

### 6.3 headers/ref/validation สร้างตาม lang
- `ONLINE_HEADERS`/`OFFLINE_HEADERS` → เปลี่ยนเป็น function `onlineHeaders(T)`/`offlineHeaders(T)` ที่ดึงจาก `T`
- `buildReferenceSheet(wb, lk, kind, T)` → หัว ref ดึงจาก `T`
- `applyDateValidation(ws, col, T)` → prompt/errorTitle/error ดึงจาก `T` (interpolate ปี)
- `applyListValidation(ws, col, formula, label, strict, T)` → prompt/error ดึงจาก `T` (interpolate `{label}`, `{refSheet}`)
- label ที่ส่งเข้า validation ใช้คำแปลจาก `T` (เช่น `T.hdrBrand`, `T.hdrPaymentType`)

### 6.4 payment dropdown
เปลี่ยนบรรทัด ~543:
```ts
applyListValidation(ws, 8, '"Paid,Free,Barter"', T.hdrPaymentType, true, T);
```
คง `'จ่ายเงิน'` ใน `PAYMENT_MAP` ไว้ (backward-compat ไฟล์เก่า)

### 6.5 parse หาชีตข้อมูลแบบตำแหน่ง
`validate/:kind` (และ commit ถ้าอ่านชีต) — เปลี่ยนจาก
`wb.getWorksheet(SHEET_NAME[kind]) ?? wb.worksheets[0]`
เป็นหา**ชีตข้อมูล = ชีตแรกที่ไม่ใช่ ref sheet** หรือใช้ `wb.worksheets[0]` ตรงๆ (ชีตข้อมูล add ก่อนเสมอ) — เพราะชื่อชีตถูกแปลแล้ว match ด้วยชื่อไม่ได้

---

## 7. ดีไซน์ Part C — `ExportLangMenu` (component ใหม่, shared)

```tsx
<ExportLangMenu
  label={string}              // ข้อความปุ่ม เช่น t('dashboard.export') / t('import.downloadTemplate')
  onPick={(lang: 'th'|'en'|'zh') => void}
  disabled?={boolean}
  icon?={ReactNode}
/>
```
- ปุ่ม + chevron → คลิกเปิด dropdown เมนู 3 ภาษา (`ไทย / English / 中文` — endonym คงที่ทุกภาษา)
- คลิกเลือก → เรียก `onPick(lang)` + ปิดเมนู
- ปิดเมนูเมื่อคลิกนอก (pattern เดียวกับ month picker ใน `CalendarPage.tsx`: `useEffect` + `mousedown` listener + `ref`)
- ใช้ design tokens เดิม (`bg-surface`, `border-hairline`, `text-ink`, `text-muted`, `hover:bg-canvas`)
- ใช้ที่ `ChartTableCard` (dashboard, ปุ่มเขียวเดิม) และ `ImportPlacementsPage` (template, 2 ปุ่ม online/offline)

---

## 8. ตารางคำแปลครบ

### 8.1 Client i18n keys (เพิ่มใน `th.ts` ก่อน → เติม `en.ts`/`zh.ts` ให้ครบ ตาม `satisfies Translations`)

| key | th | en | zh |
|---|---|---|---|
| `export.totalRow` | `รวม` | `Total` | `合计` |
| `export.sheetName` | `ข้อมูล` | `Data` | `数据` |

> เมนูภาษา (ไทย/English/中文) — ใช้ชื่อภาษาที่มีอยู่แล้วในตัวสลับภาษาของเว็บ ถ้าไม่มีค่าคงที่ ให้ hardcode endonym `['ไทย','English','中文']` ใน `ExportLangMenu` (เหมือนกันทุกภาษา ไม่ต้องผ่าน `t()`)
> ปุ่ม Export/Download template ใช้ key ข้อความเดิมที่มีอยู่ (เช่น `dashboard.export`, `import.downloadTemplate`) — ไม่ต้องเพิ่มใหม่ถ้ามีแล้ว

### 8.2 Server `TEMPLATE_I18N` (object ใหม่ใน `placementsImport.ts`)

โครง: `Record<'th'|'en'|'zh', { ...keys... }>`. ค่าแต่ละ key:

| key | ใช้ที่ | th | en | zh |
|---|---|---|---|---|
| `sheetOnline` | ชื่อชีต online | `นำเข้า Placement - Online` | `Import Placement - Online` | `导入 Placement - Online` |
| `sheetOffline` | ชื่อชีต offline | `นำเข้า Placement - Offline` | `Import Placement - Offline` | `导入 Placement - Offline` |
| `sheetRef` | ชื่อ ref sheet | `รายชื่ออ้างอิง` | `Reference` | `参考列表` |
| `hdrBrand` | หัว/label แบรนด์ | `แบรนด์` | `Brand` | `品牌` |
| `hdrShopBranch` | หัว/label ห้าง/สาขา | `ห้าง / สาขา` | `Store / Branch` | `商场 / 分店` |
| `hdrTargetDate` | หัว/label วันลงโพสต์ | `วันลงโพสต์ (เป้าหมาย)` | `Target Publication Date` | `目标发布日期` |
| `hdrPaymentType` | หัว/label จ่ายเงิน | `ประเภทการจ่ายเงิน` | `Payment Type` | `付款类型` |
| `hdrFinalPrice` | หัวราคาสุทธิ | `ราคาสุทธิ` | `Final Price` | `最终价格` |
| `hdrAdsCost` | หัวค่าโฆษณา | `ค่าโฆษณา` | `Ads Cost` | `广告费用` |
| `hdrNotes` | หัวหมายเหตุ | `หมายเหตุ` | `Notes` | `备注` |
| `hdrCampaignDesc` | หัว ref คำอธิบาย Campaign | `คำอธิบาย Campaign` | `Campaign Description` | `活动说明` |
| `datePrompt` | prompt วันที่ | `คลิกเซลล์แล้วเลือกวันที่จากปฏิทิน หรือพิมพ์รูปแบบ YYYY-MM-DD` | `Click the cell and pick a date from the calendar, or type it as YYYY-MM-DD` | `点击单元格从日历选择日期，或按 YYYY-MM-DD 格式输入` |
| `dateErrTitle` | errorTitle วันที่ | `วันที่ไม่ถูกต้อง` | `Invalid date` | `日期无效` |
| `dateErr` | error วันที่ (มี `{y1}`,`{y2}`) | `กรุณาเลือกวันที่ให้ถูกต้อง (ระหว่างปี {y1}-{y2})` | `Please pick a valid date (between {y1}-{y2})` | `请选择有效日期（{y1}-{y2} 年之间）` |
| `listPromptStrict` | prompt dropdown บังคับ (มี `{label}`) | `เลือก{label}จาก dropdown เท่านั้น` | `Select {label} from the dropdown only` | `仅可从下拉列表选择{label}` |
| `listPromptSoft` | prompt dropdown ยืดหยุ่น | `เลือกจาก dropdown ถ้ามี หรือพิมพ์ค่าใหม่ได้ (เช่นรายการที่ยังไม่มีในระบบ)` | `Pick from the dropdown if available, or type a new value (e.g. an item not yet in the system)` | `如有可从下拉列表选择，或输入新值（例如系统中尚不存在的项目）` |
| `listErrTitle` | errorTitle dropdown | `ค่าไม่ถูกต้อง` | `Invalid value` | `数值无效` |
| `listErr` | error dropdown (มี `{label}`,`{refSheet}`) | `กรุณาเลือก{label}จากรายการใน dropdown (ดูชีต "{refSheet}" ประกอบ)` | `Please select {label} from the dropdown list (see the "{refSheet}" sheet)` | `请从下拉列表选择{label}（参见 "{refSheet}" 工作表）` |

**คงเป็นอังกฤษทุกภาษา (ไม่ใส่ใน TEMPLATE_I18N หรือใส่ค่าเดียวกัน 3 ภาษา):**
`KOL Handle`, `Platform`, `Follower`, `Model`, `Campaign`, `KOL Platform`, `KOL Follower`

**ลำดับคอลัมน์ (ต้องคงเดิม — parse อ่านตามตำแหน่ง):**
- ONLINE: `hdrBrand`, `KOL Handle`, `Platform`, `Follower`, `Model`, `Campaign`, `hdrTargetDate`, `hdrPaymentType`, `hdrFinalPrice`, `hdrAdsCost`, `hdrNotes`
- OFFLINE: `hdrBrand`, `KOL Handle`, `Platform`, `Follower`, `hdrShopBranch`, `Campaign`, `hdrTargetDate`, `hdrPaymentType`, `hdrFinalPrice`, `hdrAdsCost`, `hdrNotes`

---

## 9. ไฟล์ที่แตะ (checklist)

**client**
- [ ] `components/ExportLangMenu.tsx` — component ใหม่ (§7)
- [ ] `components/ChartTableCard.tsx` — column type +`headerKey`, `handleExport(lang)` resolve ด้วย `getFixedT`, ใช้ `ExportLangMenu`
- [ ] `lib/exportTable.ts` — signature `opts {sheetName, totalLabel}`, เอา `'รวม'`/`'Sheet1'` ออก
- [ ] `pages/DashboardPage.tsx` — column `header: t(...)` → `headerKey: '...'`; literal คงไว้
- [ ] `pages/ImportPlacementsPage.tsx` — ปุ่มดาวน์โหลด template → `ExportLangMenu`
- [ ] `api/index.ts` — `downloadImportTemplate(kind, brandId, lang)` ส่ง `&lang`
- [ ] `i18n/locales/{th,en,zh}.ts` — เพิ่ม `export.totalRow`, `export.sheetName`

**server**
- [ ] `routes/placementsImport.ts` — `TEMPLATE_I18N` + `tpl()`, headers/ref/validation รับ `T`, endpoint อ่าน `?lang`, payment → `Paid,Free,Barter`, parse หาชีตข้อมูลแบบตำแหน่ง, คง `'จ่ายเงิน'` ใน `PAYMENT_MAP`

---

## 10. สิ่งที่ต้อง verify ก่อนถือว่าเสร็จ

1. โหลด template ทั้ง 3 ภาษา (online + offline) → เปิดใน Excel เช็คหัว/ชีต/dropdown/prompt เป็นภาษานั้น
2. **Round-trip:** โหลด template ภาษา `en` และ `zh` → กรอกข้อมูล (เลือก payment = `Paid`) → upload กลับ → import ผ่าน ไม่ error (พิสูจน์ว่าแปลหัว/ชีต/payment ไม่ทำ parse พัง)
3. Dashboard export 3 ตาราง × 3 ภาษา → หัวตาราง + แถวรวม + ชื่อชีต ตรงภาษาที่เลือก (ไม่ตามภาษา UI)
4. `npx tsc -b` (client) ผ่าน, server `tsc --noEmit` ผ่าน, i18n ครบ 3 ภาษา (`satisfies Translations`)
5. ปุ่ม Export/ดาวน์โหลดเดิมที่ใช้ ExportLangMenu ไม่พัง (เมนูเปิด/ปิด/คลิกนอกได้)

---

## 11. Definition of Done

1. กด Export (dashboard) / ดาวน์โหลด template (import) → เลือกภาษาได้ ไฟล์ออกตรงภาษาที่เลือก ไม่ผูกภาษา UI
2. Template 3 ภาษา: หัวคอลัมน์, ชื่อชีต, ข้อความ validation (วันที่/dropdown) แปลครบ; ข้อมูลจริง + `Paid/Free/Barter` + domain term คงอังกฤษ
3. Dashboard export 3 ภาษา: หัวตาราง + แถว "รวม" + ชื่อชีต แปลครบ
4. Round-trip import ไฟล์ที่โหลดทุกภาษา → ผ่าน
5. `tsc -b` ผ่าน, i18n ครบ 3 ภาษา, ไม่มี Co-Authored-By: Claude ใน commit
