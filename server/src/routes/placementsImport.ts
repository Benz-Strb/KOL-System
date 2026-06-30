import { Hono } from 'hono';
import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { requireAuth } from '../middleware/auth.js';
import type { AuthUser } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const SHOP_BRANCH_SEP = ' / ';
const MAX_DATA_ROWS = 1000;

type PlacementKind = 'online' | 'offline_shop';
type TplLang = 'th' | 'en' | 'zh';

// ─── Trilingual strings for template generation ───────────────────────────────
type TplStrings = {
  sheetOnline: string; sheetOffline: string; sheetRef: string;
  hdrBrand: string; hdrShopBranch: string; hdrTargetDate: string;
  hdrPaymentType: string; hdrFinalPrice: string; hdrAdsCost: string; hdrNotes: string;
  hdrCampaignDesc: string;
  datePrompt: string; dateErrTitle: string; dateErr: string;
  listPromptStrict: string; listPromptSoft: string; listErrTitle: string; listErr: string;
};

const TEMPLATE_I18N: Record<TplLang, TplStrings> = {
  th: {
    sheetOnline: 'นำเข้า Placement - Online',
    sheetOffline: 'นำเข้า Placement - Offline',
    sheetRef: 'รายชื่ออ้างอิง',
    hdrBrand: 'แบรนด์',
    hdrShopBranch: 'ห้าง / สาขา',
    hdrTargetDate: 'วันลงโพสต์ (เป้าหมาย)',
    hdrPaymentType: 'ประเภทการจ่ายเงิน',
    hdrFinalPrice: 'ราคาสุทธิ',
    hdrAdsCost: 'ค่าโฆษณา',
    hdrNotes: 'หมายเหตุ',
    hdrCampaignDesc: 'คำอธิบาย Campaign',
    datePrompt: 'คลิกเซลล์แล้วเลือกวันที่จากปฏิทิน หรือพิมพ์รูปแบบ YYYY-MM-DD',
    dateErrTitle: 'วันที่ไม่ถูกต้อง',
    dateErr: 'กรุณาเลือกวันที่ให้ถูกต้อง (ระหว่างปี {y1}-{y2})',
    listPromptStrict: 'เลือก{label}จาก dropdown เท่านั้น',
    listPromptSoft: 'เลือกจาก dropdown ถ้ามี หรือพิมพ์ค่าใหม่ได้ (เช่นรายการที่ยังไม่มีในระบบ)',
    listErrTitle: 'ค่าไม่ถูกต้อง',
    listErr: 'กรุณาเลือก{label}จากรายการใน dropdown (ดูชีต "{refSheet}" ประกอบ)',
  },
  en: {
    sheetOnline: 'Import Placement - Online',
    sheetOffline: 'Import Placement - Offline',
    sheetRef: 'Reference',
    hdrBrand: 'Brand',
    hdrShopBranch: 'Store / Branch',
    hdrTargetDate: 'Target Publication Date',
    hdrPaymentType: 'Payment Type',
    hdrFinalPrice: 'Final Price',
    hdrAdsCost: 'Ads Cost',
    hdrNotes: 'Notes',
    hdrCampaignDesc: 'Campaign Description',
    datePrompt: 'Click the cell and pick a date from the calendar, or type it as YYYY-MM-DD',
    dateErrTitle: 'Invalid date',
    dateErr: 'Please pick a valid date (between {y1}-{y2})',
    listPromptStrict: 'Select {label} from the dropdown only',
    listPromptSoft: 'Pick from the dropdown if available, or type a new value (e.g. an item not yet in the system)',
    listErrTitle: 'Invalid value',
    listErr: 'Please select {label} from the dropdown list (see the "{refSheet}" sheet)',
  },
  zh: {
    sheetOnline: '导入 Placement - Online',
    sheetOffline: '导入 Placement - Offline',
    sheetRef: '参考列表',
    hdrBrand: '品牌',
    hdrShopBranch: '商场 / 分店',
    hdrTargetDate: '目标发布日期',
    hdrPaymentType: '付款类型',
    hdrFinalPrice: '最终价格',
    hdrAdsCost: '广告费用',
    hdrNotes: '备注',
    hdrCampaignDesc: '活动说明',
    datePrompt: '点击单元格从日历选择日期，或按 YYYY-MM-DD 格式输入',
    dateErrTitle: '日期无效',
    dateErr: '请选择有效日期（{y1}-{y2} 年之间）',
    listPromptStrict: '仅可从下拉列表选择{label}',
    listPromptSoft: '如有可从下拉列表选择，或输入新值（例如系统中尚不存在的项目）',
    listErrTitle: '数值无效',
    listErr: '请从下拉列表选择{label}（参见 "{refSheet}" 工作表）',
  },
};

function tpl(lang: string | undefined): TplStrings {
  return TEMPLATE_I18N[(lang === 'en' || lang === 'zh') ? lang : 'th'];
}

function onlineHeaders(T: TplStrings): string[] {
  return [T.hdrBrand, 'KOL Handle', 'Platform', 'Follower', 'Model', 'Campaign', T.hdrTargetDate, T.hdrPaymentType, T.hdrFinalPrice, T.hdrAdsCost, T.hdrNotes];
}
function offlineHeaders(T: TplStrings): string[] {
  return [T.hdrBrand, 'KOL Handle', 'Platform', 'Follower', T.hdrShopBranch, 'Campaign', T.hdrTargetDate, T.hdrPaymentType, T.hdrFinalPrice, T.hdrAdsCost, T.hdrNotes];
}

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
// `id` here is the kol (person) id — i.e. kol_platforms.kol_id, not
// kol_platforms.id — since that's what placements.kol_id must be set to.
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

async function loadLookups(prisma: PrismaClient, user: AuthUser): Promise<Lookups> {
  const isAdmin = user.role === 'admin';
  const seesAllBrands = isAdmin;
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
    // not filtered to is_primary: an Excel row's handle should resolve to
    // whichever specific platform account it actually matches, since a kol
    // can have more than one (each with its own handle/follower_count).
    prisma.kol_platforms.findMany({
      select: { kol_id: true, handle: true, handle_normalized: true, follower_count: true, platform_id: true },
      orderBy: { handle: 'asc' },
    }),
  ]);
  const kolsLookup: KolLookup[] = kols.map(k => ({ id: k.kol_id, handle: k.handle, handle_normalized: k.handle_normalized, follower_count: k.follower_count, platform_id: k.platform_id }));

  const productBrandIds = new Map<number, Set<number>>();
  for (const row of productBrandRows) {
    if (!productBrandIds.has(row.product_id)) productBrandIds.set(row.product_id, new Set());
    productBrandIds.get(row.product_id)!.add(row.brand_id);
  }

  return {
    isAdmin,
    userBrandIds: user.brandIds,
    brands, platforms, campaigns, products, productBrandIds, stores,
    kolsList: kolsLookup,
    kolByNormalized: new Map(kolsLookup.map(k => [k.handle_normalized, k])),
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
// Columns: A Brand | B Platform | C Model-or-Store/Branch | D Campaign | E Campaign Description | F KOL Handle | G KOL Platform | H KOL Follower
function buildReferenceSheet(wb: ExcelJS.Workbook, lk: Lookups, kind: PlacementKind, T: TplStrings) {
  const ref = wb.addWorksheet(T.sheetRef);
  ref.columns = [
    { header: T.hdrBrand, width: 22 },
    { header: 'Platform', width: 18 },
    { header: kind === 'online' ? 'Model' : T.hdrShopBranch, width: kind === 'online' ? 22 : 30 },
    { header: 'Campaign', width: 14 },
    { header: T.hdrCampaignDesc, width: 30 },
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

function refRange(col: string, endRow: number, refSheet: string) {
  return `'${refSheet}'!$${col}$2:$${col}$${endRow}`;
}

// Real Excel date validation (Allow: Date) — lets Excel show its built-in calendar
// picker icon on the cell, and rejects typed text that isn't a real date. This
// stores an actual date value instead of free text, side-stepping the DD/MM vs
// MM/DD locale ambiguity and bad-year typos seen during the original Excel import.
function applyDateValidation(ws: ExcelJS.Worksheet, col: number, T: TplStrings) {
  const currentYear = new Date().getFullYear();
  const y1 = currentYear - 1;
  const y2 = currentYear + 1;
  const min = new Date(y1, 0, 1);
  const max = new Date(y2, 11, 31);
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    const cell = ws.getCell(r, col);
    cell.numFmt = 'yyyy-mm-dd';
    cell.dataValidation = {
      type: 'date',
      operator: 'between',
      allowBlank: true,
      formulae: [min, max],
      showInputMessage: true,
      promptTitle: T.hdrTargetDate,
      prompt: T.datePrompt,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: T.dateErrTitle,
      error: T.dateErr.replace('{y1}', String(y1)).replace('{y2}', String(y2)),
    };
  }
}

// Thousand-separator display for money/count columns so large numbers don't
// become a wall of digits — purely cosmetic, doesn't affect the raw value.
function applyNumberFormat(ws: ExcelJS.Worksheet, col: number, format: string) {
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    ws.getCell(r, col).numFmt = format;
  }
}

function applyListValidation(ws: ExcelJS.Worksheet, col: number, formula: string, label: string, strict: boolean, T: TplStrings) {
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    ws.getCell(r, col).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showInputMessage: true,
      promptTitle: label,
      prompt: strict
        ? T.listPromptStrict.replace('{label}', label)
        : T.listPromptSoft,
      ...(strict ? {
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: T.listErrTitle,
        error: T.listErr.replace('{label}', label).replace('{refSheet}', T.sheetRef),
      } : { showErrorMessage: false }),
    };
  }
}

// Pre-fills Platform/Follower with a VLOOKUP against the KOL reference table
// (columns F:H), keyed off the KOL Handle cell in the same row (column B).
// Users can still overwrite the formula result directly if needed.
function applyKolLookupFormulas(ws: ExcelJS.Worksheet, kolEnd: number, refSheet: string) {
  const lookupRange = `'${refSheet}'!$F$2:$H$${kolEnd}`;
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
app.get('/template/:kind', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const kind = parseKindParam(c.req.param('kind'));
    if (!kind) return c.json({ error: 'kind ต้องเป็น online หรือ offline' }, 400);

    const lk = await loadLookups(prisma, user);

    // Resolve which single brand this template is for — required up front so the
    // Model dropdown (online) only ever offers that brand's products. Users with
    // exactly one accessible brand don't need to choose; users with several must
    // pick one in the UI before downloading.
    let targetBrandId: number;
    const rawBrandId = c.req.query('brand_id');
    if (rawBrandId != null) {
      const parsed = Number(rawBrandId);
      const match = lk.brands.find(b => b.id === parsed);
      if (!match) return c.json({ error: 'แบรนด์ที่เลือกไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง' }, 400);
      targetBrandId = match.id;
    } else if (lk.brands.length === 1) {
      targetBrandId = lk.brands[0].id;
    } else {
      return c.json({ error: 'กรุณาเลือกแบรนด์ก่อนดาวน์โหลด template' }, 400);
    }

    const T = tpl(c.req.query('lang'));

    const templateLk: Lookups = {
      ...lk,
      brands: lk.brands.filter(b => b.id === targetBrandId),
      products: lk.products.filter(p => lk.productBrandIds.get(p.id)?.has(targetBrandId)),
    };

    const wb = new ExcelJS.Workbook();

    const sheetName = kind === 'online' ? T.sheetOnline : T.sheetOffline;
    const headers = kind === 'online' ? onlineHeaders(T) : offlineHeaders(T);
    const categories = kind === 'online' ? ONLINE_CATEGORIES : OFFLINE_CATEGORIES;
    const ws = wb.addWorksheet(sheetName);
    ws.addRow([...headers]);
    ws.columns = headers.map(() => ({ width: 24 }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const ranges = buildReferenceSheet(wb, templateLk, kind, T);

    // Column order: 1 Brand | 2 KOL Handle | 3 Platform | 4 Follower | 5 Model/Store-Branch | 6 Campaign | 7 Date | 8 Payment | 9-11 Price/Notes
    applyListValidation(ws, 1, refRange('A', ranges.brandEnd, T.sheetRef), T.hdrBrand, true, T);
    applyListValidation(ws, 2, refRange('F', ranges.kolEnd, T.sheetRef), 'KOL Handle', true, T);
    applyListValidation(ws, 3, refRange('B', ranges.platformEnd, T.sheetRef), 'Platform', true, T);
    applyListValidation(ws, 5, refRange('C', ranges.colCEnd, T.sheetRef), kind === 'online' ? 'Model' : T.hdrShopBranch, kind === 'online', T);
    applyListValidation(ws, 6, refRange('D', ranges.campaignEnd, T.sheetRef), 'Campaign', true, T);
    applyDateValidation(ws, 7, T);
    applyListValidation(ws, 8, '"Paid,Free,Barter"', T.hdrPaymentType, true, T);
    applyNumberFormat(ws, 4, '#,##0');
    applyNumberFormat(ws, 9, '#,##0.00');
    applyNumberFormat(ws, 10, '#,##0.00');
    applyKolLookupFormulas(ws, ranges.kolEnd, T.sheetRef);

    styleBodyRows(ws, headers.length);
    styleHeaderRow(ws, categories);
    styleReferenceSheet(wb.getWorksheet(T.sheetRef)!, 8, ranges.lastRow);

    const buf = await wb.xlsx.writeBuffer();
    // Buffer is a view into a possibly-larger pooled ArrayBuffer — passing it straight
    // to Response would let the body grab the whole backing buffer (ignoring byteOffset),
    // producing a corrupted .xlsx with extra bytes. Copy into a tightly-sized Uint8Array first.
    const bytes = Uint8Array.from(buf as unknown as Uint8Array);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="placement_import_template_${kind === 'online' ? 'online' : 'offline'}.xlsx"`,
      },
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to generate template' }, 500);
  }
});

// ─── POST /validate/:kind — parse + resolve, no DB writes ──────────────
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

app.post('/validate/:kind', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const kind = parseKindParam(c.req.param('kind'));
    if (!kind) return c.json({ error: 'kind ต้องเป็น online หรือ offline' }, 400);

    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'กรุณาอัปโหลดไฟล์' }, 400);
    if (file.size > MAX_FILE_SIZE) return c.json({ error: 'ไฟล์มีขนาดใหญ่เกินไป (จำกัด 5MB)' }, 400);

    const wb = new ExcelJS.Workbook();
    const buf = Buffer.from(await file.arrayBuffer());
    // exceljs's Buffer param type vs @types/node's generic Buffer<ArrayBufferLike> don't unify cleanly — known ecosystem typing clash
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as any);
    // Use positional first sheet — sheet name may be translated (en/zh templates) so name-match is unreliable
    const ws = wb.worksheets[0];
    if (!ws) return c.json({ error: 'ไม่พบชีตข้อมูลในไฟล์' }, 400);

    const lk = await loadLookups(prisma, user);
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
    return c.json({ summary: { total: rows.length, valid, withErrors: rows.length - valid }, rows });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'ไม่สามารถอ่านไฟล์ได้ — ตรวจสอบว่าเป็นไฟล์ template ที่ถูกต้อง (.xlsx)' }, 400);
  }
});

// ─── POST /commit — re-validate + create only error-free rows ─────────
app.post('/commit', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const body = await c.req.json() as { kind?: string; rows?: { rowNumber: number; raw: RawRow }[] };
    const kind: PlacementKind = body.kind === 'offline' || body.kind === 'offline_shop' ? 'offline_shop' : 'online';
    const inputRows = Array.isArray(body.rows) ? body.rows : [];
    if (inputRows.length === 0) return c.json({ error: 'ไม่มีแถวที่จะบันทึก' }, 400);

    const lk = await loadLookups(prisma, user);
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
            person_in_charge_id: user.id,
            created_by_id: user.id,
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

    return c.json({ created, branchesCreated, failed });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to commit import' }, 500);
  }
});

export default app;
