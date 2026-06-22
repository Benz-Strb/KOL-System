import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { prisma } from '../prisma.js';
import type { AuthUser } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const REF_SHEET_NAME = 'รายชื่ออ้างอิง';
const SHOP_BRANCH_SEP = ' / ';
const MAX_DATA_ROWS = 1000;

type PlacementKind = 'online' | 'offline_shop';

const SHEET_NAME: Record<PlacementKind, string> = {
  online: 'นำเข้า Placement - Online',
  offline_shop: 'นำเข้า Placement - Offline',
};

// Column layout per template kind — "ประเภท Placement" is no longer a column;
// it's implied by which template file you downloaded/uploaded.
const ONLINE_HEADERS = [
  'แบรนด์', 'KOL Handle', 'Platform', 'Follower', 'Model', 'Campaign',
  'Target Publication Date', 'ประเภทการจ่ายเงิน', 'Final Price', 'Ads Cost', 'หมายเหตุ',
] as const;
const OFFLINE_HEADERS = [
  'แบรนด์', 'KOL Handle', 'Platform', 'Follower', 'ห้าง / สาขา', 'Campaign',
  'Target Publication Date', 'ประเภทการจ่ายเงิน', 'Final Price', 'Ads Cost', 'หมายเหตุ',
] as const;

export interface RawRow {
  brand: string; kolHandle: string; platform: string; follower: string;
  model: string; shopBranch: string; campaign: string; targetPubDate: string;
  paymentType: string; finalPrice: string; adsCost: string; notes: string;
}

const ONLINE_RAW_KEYS: (keyof RawRow)[] = [
  'brand', 'kolHandle', 'platform', 'follower', 'model', 'campaign',
  'targetPubDate', 'paymentType', 'finalPrice', 'adsCost', 'notes',
];
const OFFLINE_RAW_KEYS: (keyof RawRow)[] = [
  'brand', 'kolHandle', 'platform', 'follower', 'shopBranch', 'campaign',
  'targetPubDate', 'paymentType', 'finalPrice', 'adsCost', 'notes',
];

const PAYMENT_MAP: Record<string, 'paid' | 'free' | 'barter'> = {
  'จ่ายเงิน': 'paid', paid: 'paid', free: 'free', barter: 'barter',
};

function normalizeHandle(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, '');
}

function findByName<T extends { name: string }>(list: T[], name: string): T | undefined {
  const n = name.trim().toLowerCase();
  return list.find(x => x.name.trim().toLowerCase() === n);
}

function formatShopBranch(s: { name: string; branch: string | null }) {
  return s.branch ? `${s.name}${SHOP_BRANCH_SEP}${s.branch}` : s.name;
}

// Accepts the user-facing 'online' | 'offline' URL segment and maps to the DB enum value.
function parseKindParam(v: string): PlacementKind | null {
  if (v === 'online') return 'online';
  if (v === 'offline') return 'offline_shop';
  return null;
}

// ─── Shared lookup context (loaded fresh for both validate + commit) ──
interface KolLookup { id: number; handle: string; handle_normalized: string; follower_count: number | null; platform_id: number | null }
interface StoreLookup { id: number; name: string; branch: string | null }

interface Lookups {
  isAdmin: boolean;
  userBrandIds: number[];
  brands: { id: number; name: string }[];
  platforms: { id: number; name: string }[];
  campaigns: { id: number; code: string; label: string | null }[];
  products: { id: number; model_code: string }[];
  productBrandIds: Map<number, Set<number>>; // product_id -> brand_ids it has actually been placed under
  stores: StoreLookup[];
  kolsList: KolLookup[];
  kolByNormalized: Map<string, KolLookup>;
}

async function loadLookups(user: AuthUser): Promise<Lookups> {
  const isAdmin = user.role === 'admin';
  const seesAllBrands = isAdmin || user.role === 'manager';
  const currentYear = new Date().getFullYear();

  const [brands, platforms, campaigns, products, productBrandRows, stores, kols] = await Promise.all([
    prisma.brands.findMany({
      where: { active: true, ...(seesAllBrands ? {} : { id: { in: user.brandIds } }) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.platforms.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.campaigns.findMany({ where: { year: currentYear }, orderBy: { start_date: 'asc' }, select: { id: true, code: true, label: true } }),
    prisma.$queryRaw<{ id: number; model_code: string }[]>`SELECT id, model_code FROM products_dropdown ORDER BY model_code`,
    // products has no brand column — derive product↔brand membership from placement history,
    // same approach as GET /api/products?brand_id= used by the manual form (NewPlacementPage)
    prisma.$queryRaw<{ product_id: number; brand_id: number }[]>`
      SELECT DISTINCT product_id, brand_id FROM placements WHERE product_id IS NOT NULL`,
    prisma.stores.findMany({ where: { active: true }, orderBy: [{ name: 'asc' }, { branch: 'asc' }], select: { id: true, name: true, branch: true } }),
    prisma.kols.findMany({
      select: { id: true, handle: true, handle_normalized: true, follower_count: true, platform_id: true },
      orderBy: { handle: 'asc' },
    }),
  ]);

  const productBrandIds = new Map<number, Set<number>>();
  for (const row of productBrandRows) {
    if (!productBrandIds.has(row.product_id)) productBrandIds.set(row.product_id, new Set());
    productBrandIds.get(row.product_id)!.add(row.brand_id);
  }

  return {
    isAdmin,
    userBrandIds: user.brandIds,
    brands, platforms, campaigns, products, productBrandIds, stores,
    kolsList: kols,
    kolByNormalized: new Map(kols.map(k => [k.handle_normalized, k])),
  };
}

// ─── Row resolution (pure — used identically by validate + commit) ────
interface ResolveCtx { newStoreKeys: Set<string> }

interface ResolvedData {
  brand_id: number | null;
  placement_type: PlacementKind;
  kol_id: number | null;
  platform_id: number | null;
  follower_at_time: number | null;
  product_id: number | null;
  store_id: number | null;
  store_new_shop: string | null;
  store_new_branch: string | null;
  campaign_id: number | null;
  target_pub_date: string | null;
  payment_type: 'paid' | 'free' | 'barter';
  final_price: string | null;
  ads_cost: string | null;
  notes: string | null;
}

function resolveRow(
  raw: RawRow, lk: Lookups, ctx: ResolveCtx, placementType: PlacementKind,
): { data: ResolvedData; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  let brand_id: number | null = null;
  if (!raw.brand.trim()) {
    errors.push('ต้องระบุแบรนด์');
  } else {
    const b = findByName(lk.brands, raw.brand);
    if (!b) errors.push(`ไม่พบแบรนด์ "${raw.brand}" หรือไม่มีสิทธิ์เข้าถึง`);
    else brand_id = b.id;
  }

  let kol_id: number | null = null;
  let existingKol: KolLookup | undefined;
  if (!raw.kolHandle.trim()) {
    errors.push('ต้องระบุ KOL Handle');
  } else {
    const norm = normalizeHandle(raw.kolHandle);
    existingKol = lk.kolByNormalized.get(norm);
    if (existingKol) {
      kol_id = existingKol.id;
    } else {
      errors.push(`ไม่พบ KOL "${raw.kolHandle.trim()}" ในระบบ — กรุณาเพิ่ม KOL นี้ในเว็บก่อน (หน้า "เพิ่ม Placement" หรือ KOL Directory) แล้วนำเข้าไฟล์นี้อีกครั้ง`);
    }
  }

  let platform_id: number | null = null;
  if (raw.platform.trim()) {
    const p = findByName(lk.platforms, raw.platform);
    if (!p) errors.push(`ไม่พบ Platform "${raw.platform}"`);
    else platform_id = p.id;
  } else if (existingKol) {
    platform_id = existingKol.platform_id;
  }

  let follower_at_time: number | null = null;
  if (raw.follower.trim()) {
    const n = Number(raw.follower.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) errors.push(`Follower "${raw.follower}" ไม่ใช่ตัวเลขที่ถูกต้อง`);
    else follower_at_time = Math.round(n);
  } else if (existingKol) {
    follower_at_time = existingKol.follower_count;
  }

  let product_id: number | null = null;
  if (placementType === 'online' && raw.model.trim()) {
    const prod = lk.products.find(p => p.model_code.trim().toLowerCase() === raw.model.trim().toLowerCase());
    if (!prod) {
      errors.push(`ไม่พบ Model "${raw.model}"`);
    } else if (brand_id != null && !lk.productBrandIds.get(prod.id)?.has(brand_id)) {
      errors.push(`Model "${raw.model}" ไม่ได้อยู่ในแบรนด์ "${raw.brand.trim()}" — ตรวจสอบว่าเลือก Model ถูกแบรนด์`);
    } else {
      product_id = prod.id;
    }
  }

  let store_id: number | null = null;
  let store_new_shop: string | null = null;
  let store_new_branch: string | null = null;
  if (placementType === 'offline_shop') {
    if (!raw.shopBranch.trim()) {
      errors.push('ต้องระบุห้าง / สาขา (Offline)');
    } else {
      const sepIdx = raw.shopBranch.indexOf(SHOP_BRANCH_SEP);
      const shopPart = sepIdx === -1 ? raw.shopBranch.trim() : raw.shopBranch.slice(0, sepIdx).trim();
      const branchInput = sepIdx === -1 ? null : (raw.shopBranch.slice(sepIdx + SHOP_BRANCH_SEP.length).trim() || null);

      const shopMatch = findByName(lk.stores, shopPart);
      if (!shopMatch) {
        errors.push(`ไม่พบห้าง "${shopPart}"`);
      } else {
        const canonicalShopName = shopMatch.name;
        const exact = lk.stores.find(s =>
          s.name.trim().toLowerCase() === canonicalShopName.trim().toLowerCase() &&
          (s.branch?.trim().toLowerCase() ?? null) === (branchInput?.toLowerCase() ?? null)
        );
        if (exact) {
          store_id = exact.id;
        } else {
          store_new_shop = canonicalShopName;
          store_new_branch = branchInput;
          const key = `${canonicalShopName.toLowerCase()}||${(branchInput ?? '').toLowerCase()}`;
          if (ctx.newStoreKeys.has(key)) {
            warnings.push(`จะใช้สาขาใหม่ "${canonicalShopName}${SHOP_BRANCH_SEP}${branchInput ?? '(ไม่ระบุสาขา)'}" ที่จะสร้างจากแถวอื่นในไฟล์นี้`);
          } else {
            ctx.newStoreKeys.add(key);
            warnings.push(`ไม่พบสาขา "${branchInput ?? '(ไม่ระบุสาขา)'}" ของห้าง "${canonicalShopName}" — จะสร้างสาขาใหม่`);
          }
        }
      }
    }
  }

  let campaign_id: number | null = null;
  if (raw.campaign.trim()) {
    const cInput = raw.campaign.trim().toLowerCase();
    const c = lk.campaigns.find(c => c.code.trim().toLowerCase() === cInput || (c.label?.trim().toLowerCase() ?? '') === cInput);
    if (!c) errors.push(`ไม่พบ Campaign "${raw.campaign}" (ปี ${new Date().getFullYear()})`);
    else campaign_id = c.id;
  }

  let target_pub_date: string | null = null;
  if (raw.targetPubDate.trim()) {
    const s = raw.targetPubDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      target_pub_date = s;
    } else {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) errors.push(`วันที่ "${s}" ไม่ถูกต้อง (ใช้รูปแบบ YYYY-MM-DD)`);
      else target_pub_date = d.toISOString().slice(0, 10);
    }
  }

  let payment_type: 'paid' | 'free' | 'barter' = 'paid';
  if (raw.paymentType.trim()) {
    const mapped = PAYMENT_MAP[raw.paymentType.trim().toLowerCase()];
    if (!mapped) errors.push(`ประเภทการจ่ายเงิน "${raw.paymentType}" ไม่ถูกต้อง (ต้องเป็น จ่ายเงิน/Free/Barter)`);
    else payment_type = mapped;
  }

  let final_price: string | null = null;
  if (payment_type === 'paid') {
    if (!raw.finalPrice.trim()) {
      errors.push('ต้องระบุ Final Price เมื่อประเภทการจ่ายเงินเป็น "จ่ายเงิน"');
    } else {
      const n = Number(raw.finalPrice.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) errors.push(`Final Price "${raw.finalPrice}" ไม่ใช่ตัวเลขที่ถูกต้อง`);
      else final_price = String(n);
    }
  }

  let ads_cost: string | null = null;
  if (raw.adsCost.trim()) {
    const n = Number(raw.adsCost.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) errors.push(`Ads Cost "${raw.adsCost}" ไม่ใช่ตัวเลขที่ถูกต้อง`);
    else ads_cost = String(n);
  }

  const notes = raw.notes.trim() || null;

  return {
    data: {
      brand_id, placement_type: placementType, kol_id, platform_id, follower_at_time,
      product_id, store_id, store_new_shop, store_new_branch, campaign_id,
      target_pub_date, payment_type, final_price, ads_cost, notes,
    },
    errors, warnings,
  };
}

// ─── Reference sheet — shared builder for both template kinds ─────────
// Columns: A แบรนด์ | B Platform | C Model-or-ห้าง/สาขา | D Campaign | E คำอธิบาย Campaign | F KOL Handle | G KOL Platform | H KOL Follower
function buildReferenceSheet(wb: ExcelJS.Workbook, lk: Lookups, kind: PlacementKind) {
  const ref = wb.addWorksheet(REF_SHEET_NAME);
  ref.columns = [
    { header: 'แบรนด์', width: 22 },
    { header: 'Platform', width: 18 },
    { header: kind === 'online' ? 'Model' : 'ห้าง / สาขา', width: kind === 'online' ? 22 : 30 },
    { header: 'Campaign', width: 14 },
    { header: 'คำอธิบาย Campaign', width: 30 },
    { header: 'KOL Handle', width: 26 },
    { header: 'KOL Platform', width: 16 },
    { header: 'KOL Follower', width: 14 },
  ];

  const platformById = new Map(lk.platforms.map(p => [p.id, p.name]));
  const brandList = lk.brands.map(b => b.name);
  const platformList = lk.platforms.map(p => p.name);
  const colCList = kind === 'online' ? lk.products.map(p => p.model_code) : lk.stores.map(formatShopBranch);
  const campaignCodeList = lk.campaigns.map(c => c.code);
  const campaignLabelList = lk.campaigns.map(c => c.label ?? '');
  const kolHandleList = lk.kolsList.map(k => k.handle);
  const kolPlatformList = lk.kolsList.map(k => (k.platform_id != null ? platformById.get(k.platform_id) ?? '' : ''));
  const kolFollowerList: (number | null)[] = lk.kolsList.map(k => k.follower_count ?? null);

  const lists: (string | number | null)[][] = [
    brandList, platformList, colCList, campaignCodeList, campaignLabelList,
    kolHandleList, kolPlatformList, kolFollowerList,
  ];
  const maxLen = Math.max(...lists.map(l => l.length), 1);
  for (let i = 0; i < maxLen; i++) {
    lists.forEach((list, col) => { ref.getCell(i + 2, col + 1).value = list[i] ?? null; });
  }
  for (let r = 2; r <= 1 + maxLen; r++) ref.getCell(r, 8).numFmt = '#,##0'; // KOL Follower — เลขเยอะ ใส่ , กันตาลาย

  const endRow = (len: number) => Math.max(2, 1 + len);
  return {
    brandEnd: endRow(brandList.length),
    platformEnd: endRow(platformList.length),
    colCEnd: endRow(colCList.length),
    campaignEnd: endRow(campaignCodeList.length),
    kolEnd: endRow(kolHandleList.length),
    lastRow: 1 + maxLen,
  };
}

function refRange(col: string, endRow: number) {
  return `'${REF_SHEET_NAME}'!$${col}$2:$${col}$${endRow}`;
}

// Real Excel date validation (Allow: Date) — lets Excel show its built-in calendar
// picker icon on the cell, and rejects typed text that isn't a real date. This
// stores an actual date value instead of free text, side-stepping the DD/MM vs
// MM/DD locale ambiguity and bad-year typos seen during the original Excel import.
function applyDateValidation(ws: ExcelJS.Worksheet, col: number, label: string) {
  const currentYear = new Date().getFullYear();
  const min = new Date(currentYear - 1, 0, 1);
  const max = new Date(currentYear + 1, 11, 31);
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    const cell = ws.getCell(r, col);
    cell.numFmt = 'yyyy-mm-dd';
    cell.dataValidation = {
      type: 'date',
      operator: 'between',
      allowBlank: true,
      formulae: [min, max],
      showInputMessage: true,
      promptTitle: label,
      prompt: 'คลิกเซลล์แล้วเลือกวันที่จากปฎิทิน หรือพิมพ์รูปแบบ YYYY-MM-DD',
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'วันที่ไม่ถูกต้อง',
      error: `กรุณาเลือกวันที่ให้ถูกต้อง (ระหว่างปี ${currentYear - 1}-${currentYear + 1})`,
    };
  }
}

// Thousand-separator display for money/count columns so large numbers don't
// become a wall of digits ("ตาลาย") — purely cosmetic, doesn't affect the raw value.
function applyNumberFormat(ws: ExcelJS.Worksheet, col: number, format: string) {
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    ws.getCell(r, col).numFmt = format;
  }
}

function applyListValidation(ws: ExcelJS.Worksheet, col: number, formula: string, label: string, strict: boolean) {
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    ws.getCell(r, col).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showInputMessage: true,
      promptTitle: label,
      prompt: strict
        ? `เลือก${label}จาก dropdown เท่านั้น`
        : `เลือกจาก dropdown ถ้ามี หรือพิมพ์ค่าใหม่ได้ (เช่นรายการที่ยังไม่มีในระบบ)`,
      ...(strict ? {
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'ค่าไม่ถูกต้อง',
        error: `กรุณาเลือก${label}จากรายการใน dropdown (ดูชีต "${REF_SHEET_NAME}" ประกอบ)`,
      } : { showErrorMessage: false }),
    };
  }
}

// Pre-fills Platform/Follower with a VLOOKUP against the KOL reference table
// (columns F:H), keyed off the KOL Handle cell in the same row (column B).
// Users can still overwrite the formula result directly if needed.
function applyKolLookupFormulas(ws: ExcelJS.Worksheet, kolEnd: number) {
  const lookupRange = `'${REF_SHEET_NAME}'!$F$2:$H$${kolEnd}`;
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    ws.getCell(r, 3).value = { formula: `IFERROR(VLOOKUP($B${r},${lookupRange},2,FALSE),"")` };
    ws.getCell(r, 4).value = { formula: `IFERROR(VLOOKUP($B${r},${lookupRange},3,FALSE),"")` };
  }
}

// ─── Visual styling — color-coded by how the column behaves ───────────
type ColCategory = 'strict' | 'soft' | 'auto' | 'free' | 'date';

// 1 แบรนด์ | 2 KOL Handle | 3 Platform | 4 Follower | 5 Model/ห้าง-สาขา | 6 Campaign | 7 วันที่ | 8 จ่ายเงิน | 9 Final Price | 10 Ads Cost | 11 หมายเหตุ
const ONLINE_CATEGORIES: ColCategory[] = ['strict', 'strict', 'auto', 'auto', 'strict', 'strict', 'date', 'strict', 'free', 'free', 'free'];
const OFFLINE_CATEGORIES: ColCategory[] = ['strict', 'strict', 'auto', 'auto', 'soft', 'strict', 'date', 'strict', 'free', 'free', 'free'];

const CATEGORY_COLOR: Record<ColCategory, string> = {
  strict: 'FF2563EB', // น้ำเงิน — ต้องเลือกจาก dropdown เท่านั้น
  soft: 'FFD97706',   // ส้ม — เลือกจาก dropdown หรือพิมพ์ใหม่ได้
  auto: 'FF059669',   // เขียว — คำนวณอัตโนมัติจาก KOL ที่เลือก (แก้ไขเองได้)
  free: 'FF6B7280',   // เทา — กรอกข้อมูลอิสระ
  date: 'FF7C3AED',   // ม่วง — เลือกวันที่จากปฎิทิน (Excel date picker)
};

const BORDER_SIDE = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: BORDER_SIDE, left: BORDER_SIDE, bottom: BORDER_SIDE, right: BORDER_SIDE,
};
const ZEBRA_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

function styleHeaderRow(ws: ExcelJS.Worksheet, categories: ColCategory[]) {
  const headerRow = ws.getRow(1);
  headerRow.height = 32;
  categories.forEach((cat, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CATEGORY_COLOR[cat] } };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

function styleBodyRows(ws: ExcelJS.Worksheet, numCols: number) {
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    const isEven = r % 2 === 0;
    for (let c = 1; c <= numCols; c++) {
      const cell = ws.getCell(r, c);
      cell.border = THIN_BORDER;
      if (isEven) cell.fill = ZEBRA_FILL;
    }
  }
}

function styleReferenceSheet(ref: ExcelJS.Worksheet, numCols: number, lastRow: number) {
  const headerRow = ref.getRow(1);
  headerRow.height = 28;
  for (let c = 1; c <= numCols; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
  for (let r = 2; r <= lastRow; r++) {
    const isEven = r % 2 === 0;
    for (let c = 1; c <= numCols; c++) {
      const cell = ref.getCell(r, c);
      cell.border = THIN_BORDER;
      if (isEven) cell.fill = ZEBRA_FILL;
    }
  }
}

// ─── GET /template/:kind — download blank import template (with dropdowns) ──
router.get('/template/:kind', async (req, res) => {
  try {
    const kind = parseKindParam(String(req.params.kind));
    if (!kind) { res.status(400).json({ error: 'kind ต้องเป็น online หรือ offline' }); return; }

    const lk = await loadLookups(req.user!);

    // Resolve which single brand this template is for — required up front so the
    // Model dropdown (online) only ever offers that brand's products. Users with
    // exactly one accessible brand don't need to choose; users with several must
    // pick one in the UI before downloading.
    let targetBrandId: number;
    const { brand_id: rawBrandId } = req.query as Record<string, string>;
    if (rawBrandId != null) {
      const parsed = Number(rawBrandId);
      const match = lk.brands.find(b => b.id === parsed);
      if (!match) { res.status(400).json({ error: 'แบรนด์ที่เลือกไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง' }); return; }
      targetBrandId = match.id;
    } else if (lk.brands.length === 1) {
      targetBrandId = lk.brands[0].id;
    } else {
      res.status(400).json({ error: 'กรุณาเลือกแบรนด์ก่อนดาวน์โหลด template' });
      return;
    }

    const templateLk: Lookups = {
      ...lk,
      brands: lk.brands.filter(b => b.id === targetBrandId),
      products: lk.products.filter(p => lk.productBrandIds.get(p.id)?.has(targetBrandId)),
    };

    const wb = new ExcelJS.Workbook();

    const headers = kind === 'online' ? ONLINE_HEADERS : OFFLINE_HEADERS;
    const categories = kind === 'online' ? ONLINE_CATEGORIES : OFFLINE_CATEGORIES;
    const ws = wb.addWorksheet(SHEET_NAME[kind]);
    ws.addRow([...headers]);
    ws.columns = headers.map(() => ({ width: 24 }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const ranges = buildReferenceSheet(wb, templateLk, kind);

    // Column order: 1 แบรนด์ | 2 KOL Handle | 3 Platform | 4 Follower | 5 Model/ห้าง-สาขา | 6 Campaign | 7 วันที่ | 8 ประเภทจ่ายเงิน | 9-11 ราคา/หมายเหตุ
    applyListValidation(ws, 1, refRange('A', ranges.brandEnd), 'แบรนด์', true);
    applyListValidation(ws, 2, refRange('F', ranges.kolEnd), 'KOL Handle', true);
    applyListValidation(ws, 3, refRange('B', ranges.platformEnd), 'Platform', true);
    applyListValidation(ws, 5, refRange('C', ranges.colCEnd), kind === 'online' ? 'Model' : 'ห้าง / สาขา', kind === 'online');
    applyListValidation(ws, 6, refRange('D', ranges.campaignEnd), 'Campaign', true);
    applyDateValidation(ws, 7, 'Target Publication Date');
    applyListValidation(ws, 8, '"จ่ายเงิน,Free,Barter"', 'ประเภทการจ่ายเงิน', true);
    applyNumberFormat(ws, 4, '#,##0');      // Follower — จำนวนนับ ไม่ใช่เงิน
    applyNumberFormat(ws, 9, '#,##0.00');   // Final Price — เงิน แสดงทศนิยมตามจริง ไม่ปัด
    applyNumberFormat(ws, 10, '#,##0.00');  // Ads Cost — เงิน แสดงทศนิยมตามจริง ไม่ปัด
    applyKolLookupFormulas(ws, ranges.kolEnd);

    styleBodyRows(ws, headers.length);
    styleHeaderRow(ws, categories);
    styleReferenceSheet(wb.getWorksheet(REF_SHEET_NAME)!, 8, ranges.lastRow);

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="placement_import_template_${kind === 'online' ? 'online' : 'offline'}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to generate template' });
  }
});

// ─── POST /validate/:kind — parse + resolve, no DB writes ──────────────
function uploadMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) { res.status(400).json({ error: err instanceof Error ? err.message : 'อัปโหลดไฟล์ไม่สำเร็จ' }); return; }
    next();
  });
}

function cellText(row: ExcelJS.Row, idx: number): string {
  const cell = row.getCell(idx);
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const obj = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(obj.richText)) return obj.richText.map(t => t.text).join('').trim();
    if (obj.text != null) return String(obj.text).trim();
    if (obj.result != null) return String(obj.result).trim();
    return '';
  }
  return String(v).trim();
}

function rowToRaw(row: ExcelJS.Row, keys: (keyof RawRow)[]): RawRow {
  const out: RawRow = {
    brand: '', kolHandle: '', platform: '', follower: '', model: '', shopBranch: '',
    campaign: '', targetPubDate: '', paymentType: '', finalPrice: '', adsCost: '', notes: '',
  };
  keys.forEach((key, i) => { out[key] = cellText(row, i + 1); });
  return out;
}

router.post('/validate/:kind', uploadMiddleware, async (req, res) => {
  try {
    const kind = parseKindParam(String(req.params.kind));
    if (!kind) { res.status(400).json({ error: 'kind ต้องเป็น online หรือ offline' }); return; }
    if (!req.file) { res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์' }); return; }

    const wb = new ExcelJS.Workbook();
    // exceljs's Buffer param type vs @types/node's generic Buffer<ArrayBufferLike> don't unify cleanly — known ecosystem typing clash
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(req.file.buffer as any);
    const ws = wb.getWorksheet(SHEET_NAME[kind]) ?? wb.worksheets[0];
    if (!ws) { res.status(400).json({ error: 'ไม่พบชีตข้อมูลในไฟล์' }); return; }

    const lk = await loadLookups(req.user!);
    const ctx: ResolveCtx = { newStoreKeys: new Set() };
    const keys = kind === 'online' ? ONLINE_RAW_KEYS : OFFLINE_RAW_KEYS;

    const rows: { rowNumber: number; raw: RawRow; errors: string[]; warnings: string[] }[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const raw = rowToRaw(row, keys);
      const isBlank = keys.every(k => !raw[k].trim());
      if (isBlank) return;
      const { errors, warnings } = resolveRow(raw, lk, ctx, kind);
      rows.push({ rowNumber, raw, errors, warnings });
    });

    const valid = rows.filter(r => r.errors.length === 0).length;
    res.json({ summary: { total: rows.length, valid, withErrors: rows.length - valid }, rows });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'ไม่สามารถอ่านไฟล์ได้ — ตรวจสอบว่าเป็นไฟล์ template ที่ถูกต้อง (.xlsx)' });
  }
});

// ─── POST /commit — re-validate + create only error-free rows ─────────
router.post('/commit', async (req, res) => {
  try {
    const body = req.body as { kind?: string; rows?: { rowNumber: number; raw: RawRow }[] };
    const kind: PlacementKind = body.kind === 'offline' || body.kind === 'offline_shop' ? 'offline_shop' : 'online';
    const inputRows = Array.isArray(body.rows) ? body.rows : [];
    if (inputRows.length === 0) { res.status(400).json({ error: 'ไม่มีแถวที่จะบันทึก' }); return; }

    const lk = await loadLookups(req.user!);
    const ctx: ResolveCtx = { newStoreKeys: new Set() };

    let created = 0, branchesCreated = 0;
    const failed: { rowNumber: number; error: string }[] = [];

    for (const item of inputRows) {
      try {
        const { data, errors } = resolveRow(item.raw, lk, ctx, kind);
        if (errors.length > 0) { failed.push({ rowNumber: item.rowNumber, error: errors[0] }); continue; }

        if (!lk.isAdmin && data.brand_id != null && !lk.userBrandIds.includes(data.brand_id)) {
          failed.push({ rowNumber: item.rowNumber, error: 'ไม่มีสิทธิ์เข้าถึงแบรนด์นี้' });
          continue;
        }

        const kolId = data.kol_id;

        let storeId = data.store_id;
        if (!storeId && data.store_new_shop) {
          const store = await prisma.stores.create({
            data: { name: data.store_new_shop, branch: data.store_new_branch },
            select: { id: true },
          });
          storeId = store.id;
          lk.stores.push({ id: storeId, name: data.store_new_shop, branch: data.store_new_branch });
          branchesCreated++;
        }

        const priceFields = data.payment_type === 'paid'
          ? { final_price: data.final_price, pay_amount: null }
          : { final_price: null, pay_amount: null };

        await prisma.placements.create({
          data: {
            brand_id: data.brand_id!,
            placement_type: data.placement_type,
            kol_id: kolId,
            platform_id: data.platform_id,
            product_id: data.placement_type === 'online' ? data.product_id : null,
            store_id: data.placement_type === 'offline_shop' ? storeId : null,
            campaign_id: data.campaign_id,
            person_in_charge_id: req.user!.id,
            created_by_id: req.user!.id,
            payment_type: data.payment_type,
            ...priceFields,
            ads_cost: data.ads_cost,
            follower_at_time: data.follower_at_time,
            target_pub_date: data.target_pub_date ? new Date(data.target_pub_date) : null,
            notes: data.notes,
            status: 'planned',
          },
        });
        created++;
      } catch (err) {
        console.error('[import/commit] row failed', item.rowNumber, err);
        failed.push({ rowNumber: item.rowNumber, error: 'เกิดข้อผิดพลาดขณะบันทึก' });
      }
    }

    res.json({ created, branchesCreated, failed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to commit import' });
  }
});

export default router;
