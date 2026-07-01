import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { requireAuth } from '../middleware/auth.js';
import type { AuthUser } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';
import { isSafeUrl } from '../lib/isSafeUrl.js';

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
  requiredLegend: string;
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
    requiredLegend: '* = คอลัมน์ที่ต้องกรอกข้อมูล (Final Price ต้องกรอกเมื่อประเภทการจ่ายเงิน = Paid เท่านั้น)',
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
    requiredLegend: '* = required column (Final Price is required only when Payment Type = Paid)',
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
    requiredLegend: '* = 必填列（Final Price 仅在付款类型 = Paid 时才需要填写）',
  },
};

function tpl(lang: string | undefined): TplStrings {
  return TEMPLATE_I18N[(lang === 'en' || lang === 'zh') ? lang : 'th'];
}

// Required columns get a trailing " *" — see T.requiredLegend (Reference sheet)
// for what "*" means; Final Price is only conditionally required (payment=paid)
// but still marked, matching the plan's table.
function onlineHeaders(T: TplStrings): string[] {
  return [
    `${T.hdrBrand} *`, 'KOL Handle *', 'Platform *', 'Follower *', 'Model *', 'Campaign *',
    `${T.hdrTargetDate} *`, `${T.hdrPaymentType} *`, `${T.hdrFinalPrice} *`, T.hdrAdsCost,
    'Ad Content Name', 'UTM Campaign Name', 'Shopee UTM', 'Lazada UTM', 'Website UTM', T.hdrNotes,
  ];
}
function offlineHeaders(T: TplStrings): string[] {
  return [
    `${T.hdrBrand} *`, 'KOL Handle *', 'Platform *', 'Follower *', `${T.hdrShopBranch} *`, 'Campaign *',
    `${T.hdrTargetDate} *`, `${T.hdrPaymentType} *`, `${T.hdrFinalPrice} *`, T.hdrAdsCost, T.hdrNotes,
  ];
}

export interface RawRow {
  brand: string; kolHandle: string; platform: string; follower: string;
  model: string; shopBranch: string; campaign: string; targetPubDate: string;
  paymentType: string; finalPrice: string; adsCost: string;
  adContentName: string; utmCampaignName: string; shopeeUtm: string; lazadaUtm: string; websiteUtm: string;
  notes: string;
}

// Order matches onlineHeaders()/offlineHeaders() column order exactly — parsing
// in rowToRaw() is positional (column i+1 -> keys[i]).
const ONLINE_RAW_KEYS: (keyof RawRow)[] = [
  'brand', 'kolHandle', 'platform', 'follower', 'model', 'campaign',
  'targetPubDate', 'paymentType', 'finalPrice', 'adsCost',
  'adContentName', 'utmCampaignName', 'shopeeUtm', 'lazadaUtm', 'websiteUtm',
  'notes',
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

  const [brands, platforms, campaigns, products, productBrandRows, productOwnBrandRows, stores, kols] = await Promise.all([
    prisma.brands.findMany({
      where: { active: true, ...(seesAllBrands ? {} : { id: { in: user.brandIds } }) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.platforms.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.campaigns.findMany({ where: { year: currentYear }, orderBy: { start_date: 'asc' }, select: { id: true, code: true, label: true } }),
    prisma.$queryRaw<{ id: number; model_code: string }[]>`SELECT id, model_code FROM products_dropdown ORDER BY model_code`,
    // Historic product↔brand membership derived from placement history, same approach
    // as GET /api/products?brand_id= used by the manual form (NewPlacementPage).
    prisma.$queryRaw<{ product_id: number; brand_id: number }[]>`
      SELECT DISTINCT product_id, brand_id FROM placements WHERE product_id IS NOT NULL`,
    // products.brand_id (Phase B, work item 56) — a product's "home" brand. Needed so a
    // model just created via POST /api/products (no placements yet) doesn't get flagged
    // as "wrong brand" on its very first import row (it'd have zero placement history).
    prisma.$queryRaw<{ id: number; brand_id: number }[]>`SELECT id, brand_id FROM products WHERE brand_id IS NOT NULL`,
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
  for (const row of productOwnBrandRows) {
    if (!productBrandIds.has(row.id)) productBrandIds.set(row.id, new Set());
    productBrandIds.get(row.id)!.add(row.brand_id);
  }

  return {
    isAdmin,
    userBrandIds: user.brandIds,
    brands, platforms, campaigns, products, productBrandIds, stores,
    kolsList: kolsLookup,
    kolByNormalized: new Map(kolsLookup.map(k => [k.handle_normalized, k])),
  };
}

// Shape returned to the client under `lookups` in /validate/:kind and
// /validate-rows/:kind responses — lets the Phase 4 editable grid build its
// dropdowns without a separate fetch. `products[].brandIds` is derived from
// the `productBrandIds` Map (product_id -> Set<brand_id>) already computed above.
function buildLookupsResponse(lk: Lookups) {
  return {
    brands: lk.brands,
    platforms: lk.platforms,
    campaigns: lk.campaigns,
    products: lk.products.map(p => ({
      id: p.id,
      model_code: p.model_code,
      brandIds: Array.from(lk.productBrandIds.get(p.id) ?? []),
    })),
    stores: lk.stores,
    kols: lk.kolsList.map(k => ({
      id: k.id, handle: k.handle, handle_normalized: k.handle_normalized,
      platform_id: k.platform_id, follower_count: k.follower_count,
    })),
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
  payment_type: 'paid' | 'free' | 'barter' | null;
  final_price: string | null;
  ads_cost: string | null;
  ad_content_name: string | null;
  utm_campaign_name: string | null;
  shopee_utm: string | null;
  lazada_utm: string | null;
  website_utm: string | null;
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
  } else if (existingKol?.platform_id != null) {
    // blank cell but the KOL Handle column resolved to a known KOL — the template's
    // VLOOKUP formula would normally have auto-filled this already; fall back the
    // same way in case the user cleared/overwrote the formula.
    platform_id = existingKol.platform_id;
  } else {
    errors.push('ต้องระบุ Platform');
  }

  let follower_at_time: number | null = null;
  if (raw.follower.trim()) {
    const n = Number(raw.follower.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) errors.push(`Follower "${raw.follower}" ไม่ใช่ตัวเลขที่ถูกต้อง`);
    else follower_at_time = Math.round(n);
  } else if (existingKol?.follower_count != null) {
    follower_at_time = existingKol.follower_count;
  } else {
    errors.push('ต้องระบุ Follower');
  }

  let product_id: number | null = null;
  if (placementType === 'online') {
    if (!raw.model.trim()) {
      errors.push('ต้องระบุ Model');
    } else {
      const prod = lk.products.find(p => p.model_code.trim().toLowerCase() === raw.model.trim().toLowerCase());
      if (!prod) {
        errors.push(`ไม่พบ Model "${raw.model}"`);
      } else if (brand_id != null && !lk.productBrandIds.get(prod.id)?.has(brand_id)) {
        errors.push(`Model "${raw.model}" ไม่ได้อยู่ในแบรนด์ "${raw.brand.trim()}" — ตรวจสอบว่าเลือก Model ถูกแบรนด์`);
      } else {
        product_id = prod.id;
      }
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
  if (!raw.campaign.trim()) {
    errors.push('ต้องระบุ Campaign');
  } else {
    const cInput = raw.campaign.trim().toLowerCase();
    const c = lk.campaigns.find(c => c.code.trim().toLowerCase() === cInput || (c.label?.trim().toLowerCase() ?? '') === cInput);
    if (!c) errors.push(`ไม่พบ Campaign "${raw.campaign}" (ปี ${new Date().getFullYear()})`);
    else campaign_id = c.id;
  }

  let target_pub_date: string | null = null;
  if (!raw.targetPubDate.trim()) {
    errors.push('ต้องระบุวันลงโพสต์ (เป้าหมาย)');
  } else {
    const s = raw.targetPubDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      target_pub_date = s;
    } else {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) errors.push(`วันที่ "${s}" ไม่ถูกต้อง (ใช้รูปแบบ YYYY-MM-DD)`);
      else target_pub_date = d.toISOString().slice(0, 10);
    }
  }

  let payment_type: 'paid' | 'free' | 'barter' | null = null;
  if (!raw.paymentType.trim()) {
    errors.push('ต้องระบุประเภทการจ่ายเงิน');
  } else {
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

  // UTM / ad-content fields — online only, all optional; the 3 URL fields are
  // scheme-validated (http/https only) to keep obviously-bad links out of the DB.
  let ad_content_name: string | null = null;
  let utm_campaign_name: string | null = null;
  let shopee_utm: string | null = null;
  let lazada_utm: string | null = null;
  let website_utm: string | null = null;
  if (placementType === 'online') {
    ad_content_name = raw.adContentName.trim() || null;
    utm_campaign_name = raw.utmCampaignName.trim() || null;
    if (raw.shopeeUtm.trim()) {
      const v = raw.shopeeUtm.trim();
      if (!isSafeUrl(v)) errors.push(`Shopee UTM "${v}" ต้องเป็น URL ที่ขึ้นต้นด้วย http:// หรือ https://`);
      else shopee_utm = v;
    }
    if (raw.lazadaUtm.trim()) {
      const v = raw.lazadaUtm.trim();
      if (!isSafeUrl(v)) errors.push(`Lazada UTM "${v}" ต้องเป็น URL ที่ขึ้นต้นด้วย http:// หรือ https://`);
      else lazada_utm = v;
    }
    if (raw.websiteUtm.trim()) {
      const v = raw.websiteUtm.trim();
      if (!isSafeUrl(v)) errors.push(`Website UTM "${v}" ต้องเป็น URL ที่ขึ้นต้นด้วย http:// หรือ https://`);
      else website_utm = v;
    }
  }

  const notes = raw.notes.trim() || null;

  return {
    data: {
      brand_id, placement_type: placementType, kol_id, platform_id, follower_at_time,
      product_id, store_id, store_new_shop, store_new_branch, campaign_id,
      target_pub_date, payment_type, final_price, ads_cost,
      ad_content_name, utm_campaign_name, shopee_utm, lazada_utm, website_utm,
      notes,
    },
    errors, warnings,
  };
}

// Converts a 1-based column index to its Excel letter (1 -> A, 26 -> Z, 27 -> AA, ...).
function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ─── Reference sheet — shared builder for both template kinds ─────────
// Columns A-H (both kinds): A Brand | B Platform | C Model-or-Store/Branch | D Campaign
// | E Campaign Description | F KOL Handle | G KOL Platform | H KOL Follower
//
// Online only, starting at column I — powers the dependent Model dropdown (see
// applyDependentListValidation / the plan's §4.3 "helper-column" method):
//   I .. I+N-1        one column per accessible brand, header = brand name, values =
//                      that brand's model codes (N = lk.brands.length, so this degrades
//                      correctly to a single column when the user only has 1 brand)
//   I+N               brand→rangeName lookup table col 1: brand name
//   I+N+1             brand→rangeName lookup table col 2: `modelsBrand<brand id>`
// A workbook-level defined name `modelsBrand<id>` is created per brand pointing at its
// column I..I+N-1 range — the data sheet's hidden helper column VLOOKUPs the row's Brand
// against the lookup table to get the range *name* (as text), then the Model cell's
// validation formula is `INDIRECT(<that name>)`.
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
  let overallLastRow = 1 + maxLen;
  let dependentModel: { lookupRangeAddr: string; numExtraCols: number } | undefined;

  if (kind === 'online') {
    const startCol = 9; // I — right after the shared A-H columns
    let maxModelRows = 0;
    lk.brands.forEach((b, i) => {
      const col = startCol + i;
      const colL = colLetter(col);
      const models = lk.products
        .filter(p => lk.productBrandIds.get(p.id)?.has(b.id))
        .map(p => p.model_code);
      ref.getCell(1, col).value = b.name;
      models.forEach((m, r) => { ref.getCell(r + 2, col).value = m; });
      maxModelRows = Math.max(maxModelRows, models.length);
      const modelsEndRow = endRow(models.length);
      wb.definedNames.add(`'${T.sheetRef}'!$${colL}$2:$${colL}$${modelsEndRow}`, `modelsBrand${b.id}`);
    });

    // Brand -> rangeName lookup table, right after the N per-brand model columns.
    const lookupCol1 = startCol + lk.brands.length;
    const lookupCol2 = lookupCol1 + 1;
    const lookupCol1L = colLetter(lookupCol1);
    const lookupCol2L = colLetter(lookupCol2);
    ref.getCell(1, lookupCol1).value = T.hdrBrand;
    ref.getCell(1, lookupCol2).value = 'ModelRangeName';
    lk.brands.forEach((b, i) => {
      ref.getCell(i + 2, lookupCol1).value = b.name;
      ref.getCell(i + 2, lookupCol2).value = `modelsBrand${b.id}`;
    });
    const lookupEndRow = endRow(lk.brands.length);

    dependentModel = {
      lookupRangeAddr: `'${T.sheetRef}'!$${lookupCol1L}$2:$${lookupCol2L}$${lookupEndRow}`,
      numExtraCols: lk.brands.length + 2,
    };
    overallLastRow = Math.max(overallLastRow, 1 + maxModelRows, lookupEndRow);
  }

  // Legend explaining the " *" required-column marker used in onlineHeaders()/offlineHeaders()
  ref.getCell(overallLastRow + 2, 1).value = T.requiredLegend;

  return {
    brandEnd: endRow(brandList.length),
    platformEnd: endRow(platformList.length),
    colCEnd: endRow(colCList.length),
    campaignEnd: endRow(campaignCodeList.length),
    kolEnd: endRow(kolHandleList.length),
    lastRow: overallLastRow,
    dependentModel,
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

// Dependent Model dropdown (online only, §4.3 of the import-upgrade plan): each row's
// validation formula points at that row's own hidden helper cell (helperCol), which holds
// the resolved `modelsBrand<id>` range name (as text) for whatever brand is in column A of
// that row — INDIRECT() then turns that name into the actual list. Note: no leading "="
// in `formulae` — desktop Excel expects the bare function call here, same as the other
// list validations in this file (e.g. applyListValidation, the "Paid,Free,Barter" list).
function applyDependentListValidation(ws: ExcelJS.Worksheet, col: number, helperCol: number, label: string, T: TplStrings) {
  const helperColL = colLetter(helperCol);
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    ws.getCell(r, col).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`INDIRECT($${helperColL}${r})`],
      showInputMessage: true,
      promptTitle: label,
      prompt: T.listPromptStrict.replace('{label}', label),
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: T.listErrTitle,
      error: T.listErr.replace('{label}', label).replace('{refSheet}', T.sheetRef),
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

// Hidden helper column feeding the dependent Model dropdown (see applyDependentListValidation
// and buildReferenceSheet's doc-comment). Per row: look up the row's own Brand cell (column A)
// in the Reference sheet's brand->rangeName table to get back the `modelsBrand<id>` range name
// as text — that text is what INDIRECT() on the Model cell resolves into an actual list.
function applyModelHelperColumn(ws: ExcelJS.Worksheet, helperCol: number, lookupRangeAddr: string) {
  for (let r = 2; r <= MAX_DATA_ROWS; r++) {
    ws.getCell(r, helperCol).value = { formula: `IFERROR(VLOOKUP($A${r},${lookupRangeAddr},2,FALSE),"")` };
  }
  ws.getColumn(helperCol).hidden = true;
}

// ─── Visual styling — color-coded by how the column behaves ───────────
// 'locked'/'performance' are used only by buildStoredWorkbook() (post-commit
// reference file) — not by the editable GET /template/:kind sheets.
type ColCategory = 'strict' | 'soft' | 'auto' | 'free' | 'date' | 'locked' | 'performance';

// Online, 16 cols: 1 แบรนด์ | 2 KOL Handle | 3 Platform | 4 Follower | 5 Model (dependent) | 6 Campaign
// | 7 วันที่ | 8 จ่ายเงิน | 9 Final Price | 10 Ads Cost | 11 Ad Content Name | 12 UTM Campaign Name
// | 13 Shopee UTM | 14 Lazada UTM | 15 Website UTM | 16 หมายเหตุ
const ONLINE_CATEGORIES: ColCategory[] = [
  'strict', 'strict', 'auto', 'auto', 'strict', 'strict', 'date', 'strict', 'free', 'free',
  'free', 'free', 'free', 'free', 'free', 'free',
];
// Offline, 11 cols: 1 แบรนด์ | 2 KOL Handle | 3 Platform | 4 Follower | 5 ห้าง/สาขา | 6 Campaign
// | 7 วันที่ | 8 จ่ายเงิน | 9 Final Price | 10 Ads Cost | 11 หมายเหตุ
const OFFLINE_CATEGORIES: ColCategory[] = ['strict', 'strict', 'auto', 'auto', 'soft', 'strict', 'date', 'strict', 'free', 'free', 'free'];

const CATEGORY_COLOR: Record<ColCategory, string> = {
  strict: 'FF2563EB', // น้ำเงิน — ต้องเลือกจาก dropdown เท่านั้น
  soft: 'FFD97706',   // ส้ม — เลือกจาก dropdown หรือพิมพ์ใหม่ได้
  auto: 'FF059669',   // เขียว — คำนวณอัตโนมัติจาก KOL ที่เลือก (แก้ไขเองได้)
  free: 'FF6B7280',   // เทา — กรอกข้อมูลอิสระ
  date: 'FF7C3AED',   // ม่วง — เลือกวันที่จากปฎิทิน (Excel date picker)
  locked: 'FF4B5563',    // เทาเข้ม — placement_id ห้ามแก้ (buildStoredWorkbook)
  performance: 'FF0D9488', // เขียวอมฟ้า — คอลัมน์ performance ว่าง ให้กรอกทีหลัง (buildStoredWorkbook)
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
    const T = tpl(c.req.query('lang'));

    const wb = new ExcelJS.Workbook();

    const sheetName = kind === 'online' ? T.sheetOnline : T.sheetOffline;
    const headers = kind === 'online' ? onlineHeaders(T) : offlineHeaders(T);
    const categories = kind === 'online' ? ONLINE_CATEGORIES : OFFLINE_CATEGORIES;
    const ws = wb.addWorksheet(sheetName);
    ws.addRow([...headers]);
    ws.columns = headers.map(() => ({ width: 24 }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Template now covers every brand the user can access (loadLookups already scopes
    // `lk.brands`/`lk.products` to the user's permissions) — there's no more single-brand
    // selection up front. The Model dropdown (online) instead filters per-brand *inside*
    // Excel via the dependent-list mechanism built by buildReferenceSheet() below.
    const ranges = buildReferenceSheet(wb, lk, kind, T);

    // Column order online (16): 1 Brand | 2 KOL Handle | 3 Platform | 4 Follower | 5 Model
    // (dependent on Brand) | 6 Campaign | 7 Date | 8 Payment | 9 Final Price | 10 Ads Cost
    // | 11 Ad Content Name | 12 UTM Campaign Name | 13 Shopee UTM | 14 Lazada UTM | 15 Website UTM | 16 Notes
    // Column order offline (11): same through col 8, then 9 Final Price | 10 Ads Cost | 11 Notes
    // — column 5 is ห้าง/สาขา (soft, non-dependent) instead of Model; no UTM columns offline.
    applyListValidation(ws, 1, refRange('A', ranges.brandEnd, T.sheetRef), T.hdrBrand, true, T);
    applyListValidation(ws, 2, refRange('F', ranges.kolEnd, T.sheetRef), 'KOL Handle', true, T);
    applyListValidation(ws, 3, refRange('B', ranges.platformEnd, T.sheetRef), 'Platform', true, T);
    if (kind === 'online' && ranges.dependentModel) {
      const helperCol = 30; // well past all 16 real columns; hidden, excluded from ONLINE_RAW_KEYS
      applyModelHelperColumn(ws, helperCol, ranges.dependentModel.lookupRangeAddr);
      applyDependentListValidation(ws, 5, helperCol, 'Model', T);
    } else {
      applyListValidation(ws, 5, refRange('C', ranges.colCEnd, T.sheetRef), T.hdrShopBranch, false, T);
    }
    applyListValidation(ws, 6, refRange('D', ranges.campaignEnd, T.sheetRef), 'Campaign', true, T);
    applyDateValidation(ws, 7, T);
    applyListValidation(ws, 8, '"Paid,Free,Barter"', T.hdrPaymentType, true, T);
    applyNumberFormat(ws, 4, '#,##0');
    applyNumberFormat(ws, 9, '#,##0.00');
    applyNumberFormat(ws, 10, '#,##0.00');
    applyKolLookupFormulas(ws, ranges.kolEnd, T.sheetRef);

    styleBodyRows(ws, headers.length);
    styleHeaderRow(ws, categories);
    const refNumCols = kind === 'online' && ranges.dependentModel
      ? 8 + ranges.dependentModel.numExtraCols
      : 8;
    styleReferenceSheet(wb.getWorksheet(T.sheetRef)!, refNumCols, ranges.lastRow);

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
    campaign: '', targetPubDate: '', paymentType: '', finalPrice: '', adsCost: '',
    adContentName: '', utmCampaignName: '', shopeeUtm: '', lazadaUtm: '', websiteUtm: '',
    notes: '',
  };
  keys.forEach((key, i) => { out[key] = cellText(row, i + 1); });
  return out;
}

// Fills in any RawRow fields missing from a JSON body (client is expected to send
// the full shape, but this guards against partial payloads crashing resolveRow's
// `.trim()` calls on undefined).
function normalizeRawRow(r: Partial<RawRow>): RawRow {
  return {
    brand: r.brand ?? '', kolHandle: r.kolHandle ?? '', platform: r.platform ?? '', follower: r.follower ?? '',
    model: r.model ?? '', shopBranch: r.shopBranch ?? '', campaign: r.campaign ?? '', targetPubDate: r.targetPubDate ?? '',
    paymentType: r.paymentType ?? '', finalPrice: r.finalPrice ?? '', adsCost: r.adsCost ?? '',
    adContentName: r.adContentName ?? '', utmCampaignName: r.utmCampaignName ?? '', shopeeUtm: r.shopeeUtm ?? '',
    lazadaUtm: r.lazadaUtm ?? '', websiteUtm: r.websiteUtm ?? '', notes: r.notes ?? '',
  };
}

// Shared per-row resolution loop — single source of truth for both
// POST /validate/:kind (file upload) and POST /validate-rows/:kind (JSON body),
// so resolveRow's logic never has to be duplicated client-side.
function resolveRows(
  items: { rowNumber: number; raw: RawRow }[],
  lk: Lookups,
  kind: PlacementKind,
): {
  summary: { total: number; valid: number; withErrors: number };
  rows: { rowNumber: number; raw: RawRow; errors: string[]; warnings: string[] }[];
} {
  const ctx: ResolveCtx = { newStoreKeys: new Set() };
  const rows = items.map(item => {
    const { errors, warnings } = resolveRow(item.raw, lk, ctx, kind);
    return { rowNumber: item.rowNumber, raw: item.raw, errors, warnings };
  });
  const valid = rows.filter(r => r.errors.length === 0).length;
  return { summary: { total: rows.length, valid, withErrors: rows.length - valid }, rows };
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
    const keys = kind === 'online' ? ONLINE_RAW_KEYS : OFFLINE_RAW_KEYS;

    const items: { rowNumber: number; raw: RawRow }[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const raw = rowToRaw(row, keys);
      const isBlank = keys.every(k => !raw[k].trim());
      if (isBlank) return;
      items.push({ rowNumber, raw });
    });

    const { summary, rows } = resolveRows(items, lk, kind);
    return c.json({ summary, rows, lookups: buildLookupsResponse(lk) });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'ไม่สามารถอ่านไฟล์ได้ — ตรวจสอบว่าเป็นไฟล์ template ที่ถูกต้อง (.xlsx)' }, 400);
  }
});

// ─── POST /validate-rows/:kind — JSON-body re-validate (no file) ───────
// Single source of truth for re-validating after inline edits / bulk edit /
// adding a KOL-Model in the Phase 4 editable grid — the client must never
// re-implement resolveRow's logic itself, only call this endpoint.
app.post('/validate-rows/:kind', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const kind = parseKindParam(c.req.param('kind'));
    if (!kind) return c.json({ error: 'kind ต้องเป็น online หรือ offline' }, 400);

    const body = await c.req.json() as { rows?: (Partial<RawRow> & { rowNumber?: number })[] };
    const inputRows = Array.isArray(body.rows) ? body.rows : [];

    const lk = await loadLookups(prisma, user);
    // rowNumber: use what the client sent, or fall back to array position (1-based) —
    // there's no Excel header row to offset against here, so index+1 is simplest.
    const items = inputRows.map((r, i) => ({
      rowNumber: typeof r.rowNumber === 'number' ? r.rowNumber : i + 1,
      raw: normalizeRawRow(r),
    }));

    const { summary, rows } = resolveRows(items, lk, kind);
    return c.json({ summary, rows, lookups: buildLookupsResponse(lk) });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to validate rows' }, 500);
  }
});

// ─── Stored/committed workbook — regenerated "as-committed" reference file ──
// Built once per successful POST /commit from the resolved values actually
// written to the DB (not the raw upload) + uploaded to the private `import-files`
// bucket so the user can later download it, fill in performance offline, and
// (Phase 7) upload it back to auto-match placements by the placement_id column.
interface CommittedRow { placementId: number; raw: RawRow; data: ResolvedData }

const PAYMENT_DISPLAY: Record<'paid' | 'free' | 'barter', string> = { paid: 'Paid', free: 'Free', barter: 'Barter' };

// Field names double as the header text — Phase 7's performance-import parser
// reads these back by exact key, so keep them snake_case and stable.
const PERFORMANCE_HEADERS_COMMON = ['publication_date', 'post_url', 'pay_amount'];
// atc_value only exists for shopee (see PATCH /:id/performance in placements.ts /
// applyPerformance() — lazada/website never write atc_value).
const PERFORMANCE_HEADERS_ONLINE_MARKETPLACE = [
  'shopee_visits', 'shopee_atc', 'shopee_atc_value', 'shopee_orders', 'shopee_gmv',
  'lazada_visits', 'lazada_atc', 'lazada_orders', 'lazada_gmv',
  'website_visits', 'website_atc', 'website_orders', 'website_gmv',
];
// Manual engagement fields (youtube/lemon8) — entered regardless of the online/offline
// marketplace gating, so present on both kinds.
const PERFORMANCE_HEADERS_MANUAL = ['vdo_view', 'likes', 'comments', 'saves', 'shares'];

function performanceHeaders(kind: PlacementKind): string[] {
  return [
    ...PERFORMANCE_HEADERS_COMMON,
    ...(kind === 'online' ? PERFORMANCE_HEADERS_ONLINE_MARKETPLACE : []),
    ...PERFORMANCE_HEADERS_MANUAL,
  ];
}

function buildStoredWorkbook(committedRows: CommittedRow[], kind: PlacementKind, lk: Lookups): ExcelJS.Workbook {
  const T = tpl(undefined); // Thai — this is a generated reference/output file, not the editable template
  const wb = new ExcelJS.Workbook();
  const sheetName = kind === 'online' ? T.sheetOnline : T.sheetOffline;
  const ws = wb.addWorksheet(sheetName);

  // Same column set/order as the input template (reuse the same header/category
  // arrays so the two never drift apart) — just prefixed with a locked placement_id
  // column and suffixed with an empty performance block.
  const planHeaders = kind === 'online' ? onlineHeaders(T) : offlineHeaders(T);
  const planCategories = kind === 'online' ? ONLINE_CATEGORIES : OFFLINE_CATEGORIES;
  const perfHeaders = performanceHeaders(kind);

  const headers = ['placement_id', ...planHeaders, ...perfHeaders];
  const categories: ColCategory[] = ['locked', ...planCategories, ...perfHeaders.map((): ColCategory => 'performance')];

  ws.addRow(headers);
  ws.columns = headers.map(() => ({ width: 22 }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const brandById = new Map(lk.brands.map(b => [b.id, b.name]));
  const platformById = new Map(lk.platforms.map(p => [p.id, p.name]));
  const productById = new Map(lk.products.map(p => [p.id, p.model_code]));
  const campaignById = new Map(lk.campaigns.map(c => [c.id, c.code]));
  const storeById = new Map(lk.stores.map(s => [s.id, formatShopBranch(s)]));

  committedRows.forEach((row, i) => {
    const r = i + 2;
    const d = row.data;
    // Match by BOTH kol_id and platform_id — a person can have more than one
    // platform account, so kol_id alone could recover the wrong handle.
    const kol = lk.kolsList.find(k => k.id === d.kol_id && k.platform_id === d.platform_id);

    const planValues: (string | number | Date | null)[] = kind === 'online'
      ? [
          d.brand_id != null ? brandById.get(d.brand_id) ?? '' : '',
          kol?.handle ?? '',
          d.platform_id != null ? platformById.get(d.platform_id) ?? '' : '',
          d.follower_at_time,
          d.product_id != null ? productById.get(d.product_id) ?? '' : '',
          d.campaign_id != null ? campaignById.get(d.campaign_id) ?? '' : '',
          d.target_pub_date ? new Date(d.target_pub_date) : null,
          d.payment_type ? PAYMENT_DISPLAY[d.payment_type] : '',
          d.final_price != null ? Number(d.final_price) : null,
          d.ads_cost != null ? Number(d.ads_cost) : null,
          d.ad_content_name,
          d.utm_campaign_name,
          d.shopee_utm,
          d.lazada_utm,
          d.website_utm,
          d.notes,
        ]
      : [
          d.brand_id != null ? brandById.get(d.brand_id) ?? '' : '',
          kol?.handle ?? '',
          d.platform_id != null ? platformById.get(d.platform_id) ?? '' : '',
          d.follower_at_time,
          d.store_id != null ? storeById.get(d.store_id) ?? '' : '',
          d.campaign_id != null ? campaignById.get(d.campaign_id) ?? '' : '',
          d.target_pub_date ? new Date(d.target_pub_date) : null,
          d.payment_type ? PAYMENT_DISPLAY[d.payment_type] : '',
          d.final_price != null ? Number(d.final_price) : null,
          d.ads_cost != null ? Number(d.ads_cost) : null,
          d.notes,
        ];

    ws.getCell(r, 1).value = row.placementId;
    planValues.forEach((v, idx) => { ws.getCell(r, 2 + idx).value = v; });
    // Performance columns (2 + planValues.length .. end) are left blank on purpose.
  });

  const numDataRows = committedRows.length;
  // Cosmetic number/date formats — target date & follower/price columns are at
  // fixed positions regardless of kind (col 1 is placement_id, so +1 vs the
  // template's own column numbers).
  for (let r = 2; r <= numDataRows + 1; r++) {
    ws.getCell(r, 5).numFmt = '#,##0';       // Follower
    ws.getCell(r, 8).numFmt = 'yyyy-mm-dd';  // Target publication date
    ws.getCell(r, 10).numFmt = '#,##0.00';   // Final price
    ws.getCell(r, 11).numFmt = '#,##0.00';   // Ads cost
  }

  styleHeaderRow(ws, categories);
  for (let r = 2; r <= numDataRows + 1; r++) {
    const isEven = r % 2 === 0;
    for (let c = 1; c <= headers.length; c++) {
      const cell = ws.getCell(r, c);
      cell.border = THIN_BORDER;
      if (isEven) cell.fill = ZEBRA_FILL;
    }
  }

  // Visually lock the placement_id column (body rows only — header keeps its
  // category color from styleHeaderRow above) + explain it via a cell note.
  const lockedFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  for (let r = 2; r <= numDataRows + 1; r++) ws.getCell(r, 1).fill = lockedFill;
  ws.getCell(1, 1).note = 'ห้ามแก้ — ใช้ match ตอนกรอก performance';

  return wb;
}

// ─── POST /commit — re-validate + create only error-free rows ─────────
app.post('/commit', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const body = await c.req.json() as {
      kind?: string; rows?: { rowNumber: number; raw: RawRow }[]; originalFilename?: string;
    };
    const kind: PlacementKind = body.kind === 'offline' || body.kind === 'offline_shop' ? 'offline_shop' : 'online';
    const inputRows = Array.isArray(body.rows) ? body.rows : [];
    if (inputRows.length === 0) return c.json({ error: 'ไม่มีแถวที่จะบันทึก' }, 400);

    const lk = await loadLookups(prisma, user);
    const ctx: ResolveCtx = { newStoreKeys: new Set() };

    let created = 0, branchesCreated = 0;
    const failed: { rowNumber: number; error: string }[] = [];
    const committedRows: CommittedRow[] = [];

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

        const placement = await prisma.placements.create({
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
            payment_type: data.payment_type!,
            ...priceFields,
            ads_cost: data.ads_cost,
            follower_at_time: data.follower_at_time,
            target_pub_date: data.target_pub_date ? new Date(data.target_pub_date) : null,
            notes: data.notes,
            ...(data.placement_type === 'online' ? {
              ad_content_name: data.ad_content_name,
              utm_campaign_name: data.utm_campaign_name,
              shopee_utm: data.shopee_utm,
              lazada_utm: data.lazada_utm,
              website_utm: data.website_utm,
            } : {}),
            status: 'planned',
          },
          select: { id: true },
        });
        created++;
        // store_id may have just been resolved above (new branch) — data.store_id
        // itself is still null in that case, so record the actual id used.
        committedRows.push({ placementId: placement.id, raw: item.raw, data: { ...data, store_id: storeId } });
      } catch (err) {
        console.error('[import/commit] row failed', item.rowNumber, err);
        failed.push({ rowNumber: item.rowNumber, error: 'เกิดข้อผิดพลาดขณะบันทึก' });
      }
    }

    // Regenerate + store the "as-committed" reference workbook. This is a
    // best-effort side effect: placements above are already created, so a
    // failure here must NOT fail the whole commit response — just log it and
    // return fileId: null so the frontend can show a "saved, but file not kept" note.
    let fileId: number | null = null;
    if (committedRows.length > 0) {
      try {
        const wb = buildStoredWorkbook(committedRows, kind, lk);
        const buf = await wb.xlsx.writeBuffer();
        // Same buffer-copy trick as GET /template/:kind — an ExcelJS buffer can
        // point into a larger pooled ArrayBuffer; copy before sending it anywhere.
        const bytes = Uint8Array.from(buf as unknown as Uint8Array);

        const storagePath = `${user.id}/${crypto.randomUUID()}.xlsx`;
        const env = c.env;
        const upRes = await fetch(
          `${env.SUPABASE_URL}/storage/v1/object/import-files/${storagePath}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'x-upsert': 'false',
            },
            body: bytes,
          },
        );
        if (!upRes.ok) {
          throw new Error(`storage upload failed: ${upRes.status} ${await upRes.text()}`);
        }

        const brandNames = Array.from(new Set(
          committedRows
            .map(r => (r.data.brand_id != null ? lk.brands.find(b => b.id === r.data.brand_id)?.name : undefined))
            .filter((n): n is string => !!n),
        ));

        const fileRow = await prisma.import_files.create({
          data: {
            user_id: user.id,
            kind: kind === 'offline_shop' ? 'offline' : 'online',
            file_type: 'plan',
            storage_path: storagePath,
            original_filename: typeof body.originalFilename === 'string' ? body.originalFilename : null,
            placement_count: created,
            brand_summary: brandNames.length > 0 ? brandNames.join(', ') : null,
          },
          select: { id: true },
        });
        fileId = fileRow.id;
      } catch (err) {
        console.error('[import/commit] failed to store reference workbook — placements already committed, continuing', err);
        fileId = null;
      }
    }

    return c.json({ created, branchesCreated, failed, fileId });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to commit import' }, 500);
  }
});

// ─── GET /files — history tab list (Phase 6) ───────────────────────────
// non-admin: always scoped to the caller's own files (?userId is ignored,
// not honored/403'd — see phase-6-brief.md §9.1). admin: sees everything by
// default, ?userId= narrows to one user. import_files.kind is already stored
// as the URL-facing 'online'/'offline' pair (see POST /commit above), so no
// extra mapping via parseKindParam() is needed here — just validate it.
app.get('/files', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const isAdmin = user.role === 'admin';

    const where: Prisma.import_filesWhereInput = {};
    if (isAdmin) {
      const userIdParam = c.req.query('userId');
      if (userIdParam) {
        const uid = Number(userIdParam);
        if (Number.isFinite(uid)) where.user_id = uid;
      }
    } else {
      where.user_id = user.id;
    }

    const kindParam = c.req.query('kind');
    if (kindParam === 'online' || kindParam === 'offline') where.kind = kindParam;

    const rows = await prisma.import_files.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: {
        id: true, kind: true, original_filename: true, placement_count: true,
        brand_summary: true, created_at: true,
        users: { select: { id: true, full_name: true, email: true } },
      },
    });

    return c.json(rows.map(r => ({
      id: r.id,
      kind: r.kind,
      original_filename: r.original_filename,
      placement_count: r.placement_count,
      brand_summary: r.brand_summary,
      created_at: r.created_at,
      user: { id: r.users.id, name: r.users.full_name, email: r.users.email },
    })));
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to list import files' }, 500);
  }
});

// ─── GET /files/:id/download — private-bucket proxy (Phase 6) ──────────
// Bucket `import-files` is private (D2/D6 of the import-upgrade plan) — the
// browser never gets a direct Supabase Storage URL. Only the owner or an
// admin may pull the bytes through here; anyone else gets an explicit 403
// (not a 404) per the brief's acceptance criteria.
app.get('/files/:id/download', async c => {
  try {
    const prisma = c.get('prisma');
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

    const file = await prisma.import_files.findUnique({
      where: { id },
      select: { user_id: true, storage_path: true, original_filename: true },
    });
    if (!file) return c.json({ error: 'not found' }, 404);

    const isAdmin = user.role === 'admin';
    if (!isAdmin && file.user_id !== user.id) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const env = c.env;
    const objRes = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/import-files/${file.storage_path}`,
      { headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
    );
    if (!objRes.ok) {
      console.error('[import/files/download] storage fetch failed', objRes.status, await objRes.text().catch(() => ''));
      return c.json({ error: 'ไม่พบไฟล์ในที่เก็บ — อาจถูกลบไปแล้ว' }, 502);
    }

    const bytes = new Uint8Array(await objRes.arrayBuffer());
    const filename = file.original_filename || `import_${id}.xlsx`;
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'failed to download import file' }, 500);
  }
});

export default app;
