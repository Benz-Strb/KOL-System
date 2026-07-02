import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  validateImportRows, getDropdowns,
  type ImportKind, type ImportLookups, type ImportRawRow, type ImportRowResult, type ProductCategory,
} from '../api/index.js';
import Select, { PortalDropdownPanel } from './Select.js';
import AddModelModal from './AddModelModal.js';
import AddKolModal, { type CreatedKol } from './AddKolModal.js';
import Toast from './Toast.js';

// Phase 5 — exact error-string prefixes resolveRow() (server/src/routes/placementsImport.ts)
// pushes for "not found in system" so the grid can offer an inline "+ Add" button. Deliberately
// distinct from the separate "wrong brand" Model error (`Model "x" ไม่ได้อยู่ในแบรนด์ "y"`),
// which starts with `Model "` not `ไม่พบ Model "` — a wrong-brand row should NOT get an "add"
// button since the model already exists (just under a different brand).
const MODEL_NOT_FOUND_PREFIX = 'ไม่พบ Model "';
const KOL_NOT_FOUND_PREFIX = 'ไม่พบ KOL "';

// ─── Design note (Phase 4) ───────────────────────────────────────────────
// No existing "editable Excel-like grid" or "bulk edit bar" pattern exists elsewhere
// in this app to copy — following CLAUDE.md/plan §12 point 8 guidance for that case
// (best judgment + note the choice for review), this component:
// - Uses hairline row separators only (no heavy borders), matching the app's minimal
//   convention — see plan §12 point 5.
// - Keeps the 5 sticky-left key columns visually neutral (bg-surface, opaque — needed
//   so horizontally-scrolled content doesn't bleed through) and puts the existing
//   error/warning row tint (bg-red-500/5 / bg-yellow-500/5) only on the scrollable
//   columns — a deliberate simplification to avoid guessing at exact translucent-over-
//   solid blending for a themed `bg-surface` custom property.
// - Shows error/warning text as an expandable row directly under the row (not a
//   tooltip) since tooltips risk being clipped by `overflow-x-auto`.
// - Places the bulk-edit bar as a sticky bar at the bottom of the card (appears only
//   when ≥1 row selected) rather than top, so it doesn't shift the column headers.

type FieldKey = keyof ImportRawRow;
type CellType = 'brand' | 'platform' | 'campaign' | 'payment' | 'model' | 'store' | 'kol' | 'text' | 'number' | 'date';

interface FieldMeta { key: FieldKey; type: CellType; label: string; width: number; }

const SHOP_BRANCH_SEP = ' / '; // matches server's SHOP_BRANCH_SEP

function formatStore(s: { name: string; branch: string | null }) {
  return s.branch ? `${s.name}${SHOP_BRANCH_SEP}${s.branch}` : s.name;
}

function normalizeHandle(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, '');
}

function matchByName<T extends { name: string }>(list: T[], raw: string): T | undefined {
  const n = raw.trim().toLowerCase();
  if (!n) return undefined;
  return list.find(x => x.name.trim().toLowerCase() === n);
}

const PAYMENT_OPTIONS = [
  { id: 'paid', label: 'Paid' },
  { id: 'free', label: 'Free' },
  { id: 'barter', label: 'Barter' },
];

// Column field configs — shared by the grid columns AND the bulk-edit "which column"
// dropdown, so both stay in sync automatically when a column is added/removed.
// `width` is unused for these two (they're rendered via the dedicated sticky columns,
// not the colgroup loop) — kept only so stickyFields() satisfies FieldMeta for the
// bulk-edit "which column" dropdown, which shares this type with scrollFields/EXPAND_FIELDS.
// `colBrandLabel` is passed in (translated via t('importPlacements.colBrand')) since this
// is a plain function, not a component — it can't call useTranslation() itself.
function stickyFields(colBrandLabel: string): FieldMeta[] {
  return [
    { key: 'brand', type: 'brand', label: colBrandLabel, width: 0 },
    { key: 'kolHandle', type: 'kol', label: 'KOL Handle', width: 0 },
  ];
}
function onlineScrollFields(T: { colShopBranch: string; colTargetDate: string; colPaymentType: string }, notesLabel: string): FieldMeta[] {
  return [
    { key: 'platform', type: 'platform', label: 'Platform', width: 130 },
    { key: 'follower', type: 'number', label: 'Follower', width: 110 },
    { key: 'model', type: 'model', label: 'Model', width: 160 },
    { key: 'campaign', type: 'campaign', label: 'Campaign', width: 200 },
    { key: 'targetPubDate', type: 'date', label: T.colTargetDate, width: 160 },
    { key: 'paymentType', type: 'payment', label: T.colPaymentType, width: 120 },
    { key: 'finalPrice', type: 'number', label: 'Final Price', width: 130 },
    { key: 'adsCost', type: 'number', label: 'Ads Cost', width: 120 },
    { key: 'notes', type: 'text', label: notesLabel, width: 220 },
  ];
}
function offlineScrollFields(T: { colShopBranch: string; colTargetDate: string; colPaymentType: string }, notesLabel: string): FieldMeta[] {
  return [
    { key: 'platform', type: 'platform', label: 'Platform', width: 130 },
    { key: 'follower', type: 'number', label: 'Follower', width: 110 },
    { key: 'shopBranch', type: 'store', label: T.colShopBranch, width: 220 },
    { key: 'campaign', type: 'campaign', label: 'Campaign', width: 200 },
    { key: 'targetPubDate', type: 'date', label: T.colTargetDate, width: 160 },
    { key: 'paymentType', type: 'payment', label: T.colPaymentType, width: 120 },
    { key: 'finalPrice', type: 'number', label: 'Final Price', width: 130 },
    { key: 'adsCost', type: 'number', label: 'Ads Cost', width: 120 },
    { key: 'notes', type: 'text', label: notesLabel, width: 220 },
  ];
}
const EXPAND_FIELDS: FieldMeta[] = [
  { key: 'adContentName', type: 'text', label: 'Ad Content Name', width: 0 },
  { key: 'utmCampaignName', type: 'text', label: 'UTM Campaign Name', width: 0 },
  { key: 'shopeeUtm', type: 'text', label: 'Shopee UTM', width: 0 },
  { key: 'lazadaUtm', type: 'text', label: 'Lazada UTM', width: 0 },
  { key: 'websiteUtm', type: 'text', label: 'Website UTM', width: 0 },
];
const MORE_TOGGLE_W = 110;

const cellInputCls = 'w-full px-2.5 py-1.5 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors';

// Sticky-left column widths/offsets (px) — cumulative so each sticky <td>/<th> knows
// exactly where to pin itself. No existing sticky-column pattern elsewhere in the app
// to copy (PlacementsPage's tables only use plain overflow-x-auto), so these are new.
const STICKY_W = { checkbox: 36, row: 44, status: 84, brand: 150, kol: 190 };
const STICKY_LEFT = {
  checkbox: 0,
  row: STICKY_W.checkbox,
  status: STICKY_W.checkbox + STICKY_W.row,
  brand: STICKY_W.checkbox + STICKY_W.row + STICKY_W.status,
  kol: STICKY_W.checkbox + STICKY_W.row + STICKY_W.status + STICKY_W.brand,
};
const stickyTdCls = 'sticky z-10 bg-surface py-2 px-2 align-top';
const stickyThCls = 'sticky z-20 bg-canvas py-2 px-2 text-left text-xs font-medium text-muted uppercase tracking-wide';

// ─── Generic cell controls (id-based lookups <-> raw display strings) ──────
// `usePortal` — forwarded to Select so its dropdown escapes this grid's overflow-x-auto
// table wrapper (see PortalDropdownPanel's doc-comment in Select.tsx); the two call sites
// inside the table (main row + expanded "more fields" row) pass true, the bulk-edit bar
// (which sits outside the table) doesn't need it and leaves it at Select's default false.
function BrandCell({ value, brands, onChange, usePortal }: { value: string; brands: ImportLookups['brands']; onChange: (v: string) => void; usePortal?: boolean }) {
  const matched = matchByName(brands, value);
  return (
    <Select size="sm" usePortal={usePortal} options={brands.map(b => ({ id: b.id, label: b.name }))}
      value={matched ? String(matched.id) : ''}
      onChange={id => { const b = brands.find(x => String(x.id) === id); onChange(b ? b.name : ''); }} />
  );
}
function PlatformCell({ value, platforms, onChange, usePortal }: { value: string; platforms: ImportLookups['platforms']; onChange: (v: string) => void; usePortal?: boolean }) {
  const matched = matchByName(platforms, value);
  return (
    <Select size="sm" usePortal={usePortal} options={platforms.map(p => ({ id: p.id, label: p.name }))}
      value={matched ? String(matched.id) : ''}
      onChange={id => { const p = platforms.find(x => String(x.id) === id); onChange(p ? p.name : ''); }} />
  );
}
function CampaignCell({ value, campaigns, onChange, usePortal }: { value: string; campaigns: ImportLookups['campaigns']; onChange: (v: string) => void; usePortal?: boolean }) {
  const norm = value.trim().toLowerCase();
  const matched = campaigns.find(c => c.code.trim().toLowerCase() === norm || (c.label ?? '').trim().toLowerCase() === norm);
  return (
    <Select size="sm" usePortal={usePortal} options={campaigns.map(c => ({ id: c.id, label: c.label ? `${c.code} — ${c.label}` : c.code }))}
      value={matched ? String(matched.id) : ''}
      onChange={id => { const c = campaigns.find(x => String(x.id) === id); onChange(c ? c.code : ''); }} />
  );
}
function PaymentCell({ value, onChange, usePortal }: { value: string; onChange: (v: string) => void; usePortal?: boolean }) {
  const norm = value.trim().toLowerCase();
  const current = norm === 'จ่ายเงิน' ? 'paid' : (PAYMENT_OPTIONS.find(o => o.id === norm)?.id ?? '');
  return (
    <Select size="sm" usePortal={usePortal} options={PAYMENT_OPTIONS} value={current}
      onChange={id => { const o = PAYMENT_OPTIONS.find(x => x.id === id); onChange(o ? o.label : ''); }} />
  );
}
function ModelCell({ value, products, brandId, onChange, usePortal }: { value: string; products: ImportLookups['products']; brandId: number | null; onChange: (v: string) => void; usePortal?: boolean }) {
  const options = useMemo(() => {
    const filtered = brandId != null ? products.filter(p => p.brandIds.includes(brandId)) : products;
    return filtered.map(p => ({ id: p.id, label: p.model_code }));
  }, [products, brandId]);
  const norm = value.trim().toLowerCase();
  const matched = products.find(p => p.model_code.trim().toLowerCase() === norm);
  return (
    <Select size="sm" usePortal={usePortal} options={options} value={matched ? String(matched.id) : ''}
      onChange={id => { const p = products.find(x => String(x.id) === id); onChange(p ? p.model_code : ''); }} />
  );
}

// Store/branch — "soft": pick from existing combos, or type a new branch name that
// doesn't exist yet (resolveRow() treats that as "will create a new branch").
function StoreBranchCell({ value, stores, onChange }: { value: string; stores: ImportLookups['stores']; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // See PortalDropdownPanel's data-import-dropdown-portal comment — the panel now
    // renders outside `ref`'s subtree, so a click inside it must not count as "outside".
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-import-dropdown-portal]')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const q = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = q ? stores.filter(s => formatStore(s).toLowerCase().includes(q)) : stores;
    return list.slice(0, 30);
  }, [stores, q]);
  return (
    <div ref={ref} className="relative min-w-[170px]">
      <input type="text" value={value} placeholder={t('importPlacements.edit.storeFreeTextHint')}
        onChange={e => onChange(e.target.value)} onFocus={() => setOpen(true)} className={cellInputCls} />
      {open && (
        <PortalDropdownPanel anchorRef={ref} width={256}>
          <div className="overflow-y-auto flex-1 max-h-56">
            {filtered.length === 0 && <div className="px-3 py-2.5 text-sm text-muted">{t('importPlacements.edit.storeNoResults')}</div>}
            {filtered.map(s => (
              <button key={s.id} type="button"
                className="w-full text-left px-3 py-2 hover:bg-canvas border-b border-hairline last:border-0 text-sm text-ink"
                onClick={() => { onChange(formatStore(s)); setOpen(false); }}>
                {formatStore(s)}
              </button>
            ))}
          </div>
        </PortalDropdownPanel>
      )}
    </div>
  );
}

// KOL handle — autocomplete over lookups.kols; selecting one also auto-fills
// Platform + Follower for that row (mirrors the template's VLOOKUP formula behavior).
function KolHandleCell({
  value, kols, platforms, onTextChange, onSelect,
}: {
  value: string; kols: ImportLookups['kols']; platforms: ImportLookups['platforms'];
  onTextChange: (v: string) => void;
  onSelect: (kol: ImportLookups['kols'][number]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // See PortalDropdownPanel's data-import-dropdown-portal comment — the panel now
    // renders outside `ref`'s subtree, so a click inside it must not count as "outside".
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-import-dropdown-portal]')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const platformById = useMemo(() => new Map(platforms.map(p => [p.id, p.name])), [platforms]);
  const q = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = q ? kols.filter(k => k.handle.toLowerCase().includes(q)) : kols;
    return list.slice(0, 30);
  }, [kols, q]);
  return (
    <div ref={ref} className="relative min-w-[170px]">
      <input type="text" value={value} onChange={e => { onTextChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} className={cellInputCls} />
      {open && (
        <PortalDropdownPanel anchorRef={ref} width={256}>
          <div className="overflow-y-auto flex-1 max-h-56">
            {filtered.length === 0 && <div className="px-3 py-2.5 text-sm text-muted">{t('importPlacements.edit.kolNoResults')}</div>}
            {filtered.map(k => (
              <button key={`${k.id}-${k.platform_id ?? 'x'}`} type="button"
                className="w-full text-left px-3 py-2 hover:bg-canvas border-b border-hairline last:border-0 text-sm"
                onClick={() => { onSelect(k); setOpen(false); }}>
                <span className="font-medium text-ink">{k.handle}</span>
                {k.platform_id != null && <span className="text-xs text-muted ml-1.5">{platformById.get(k.platform_id)}</span>}
                {k.follower_count != null && <span className="text-xs text-muted ml-1.5 tabular-nums">{k.follower_count.toLocaleString()}</span>}
              </button>
            ))}
          </div>
        </PortalDropdownPanel>
      )}
    </div>
  );
}

// Dispatches to the right control for every field type except 'kol' (handled
// separately at the call site since it needs the extra platform/follower autofill).
function FieldControl({
  meta, value, onChange, lookups, brandId, usePortal,
}: {
  meta: FieldMeta; value: string; onChange: (v: string) => void; lookups: ImportLookups; brandId: number | null; usePortal?: boolean;
}) {
  switch (meta.type) {
    case 'brand': return <BrandCell value={value} brands={lookups.brands} onChange={onChange} usePortal={usePortal} />;
    case 'platform': return <PlatformCell value={value} platforms={lookups.platforms} onChange={onChange} usePortal={usePortal} />;
    case 'campaign': return <CampaignCell value={value} campaigns={lookups.campaigns} onChange={onChange} usePortal={usePortal} />;
    case 'payment': return <PaymentCell value={value} onChange={onChange} usePortal={usePortal} />;
    case 'model': return <ModelCell value={value} products={lookups.products} brandId={brandId} onChange={onChange} usePortal={usePortal} />;
    case 'store': return <StoreBranchCell value={value} stores={lookups.stores} onChange={onChange} />;
    case 'date': return <input type="date" value={value} onChange={e => onChange(e.target.value)} className={cellInputCls} />;
    case 'number': return <input type="number" value={value.replace(/,/g, '')} onChange={e => onChange(e.target.value)} className={cellInputCls} />;
    case 'text':
    default: return <input type="text" value={value} onChange={e => onChange(e.target.value)} className={cellInputCls} />;
  }
}

function StatusCell({ hasError, hasWarning, validating, t }: { hasError: boolean; hasWarning: boolean; validating: boolean; t: (k: string) => string }) {
  if (validating) return <span className="inline-flex items-center gap-1 text-muted"><Loader2 size={13} className="animate-spin" /></span>;
  if (hasError) return <span className="inline-flex items-center gap-1 text-red-500"><XCircle size={13} /> {t('importPlacements.skip')}</span>;
  if (hasWarning) return <span className="inline-flex items-center gap-1 text-yellow-600"><AlertTriangle size={13} /> {t('importPlacements.warning')}</span>;
  return <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={13} /> {t('importPlacements.ready')}</span>;
}

interface Props {
  rows: ImportRowResult[];
  lookups: ImportLookups;
  kind: ImportKind;
  onRowsChange: (rows: ImportRowResult[]) => void;
}

export default function ImportEditGrid({ rows: initialRows, lookups: initialLookups, kind, onRowsChange }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ImportRowResult[]>(initialRows);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Local mutable copy of the lookups prop — Phase 5's "+ เพิ่ม Model/KOL" flow merges a
  // freshly created product/kol in here immediately (so dropdowns/autocomplete see it right
  // away) while the real fix (clearing the row's error) comes from the full re-validate
  // triggered right after, same as any other edit (see `revision` below).
  const [lookups, setLookups] = useState<ImportLookups>(initialLookups);

  // Phase 5 — "+ เพิ่ม Model" / "+ เพิ่ม KOL" row actions
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  useEffect(() => {
    getDropdowns().then(d => setProductCategories(d.productCategories)).catch(() => {});
  }, []);
  const [addModelState, setAddModelState] = useState<{ brandId: number; modelText: string } | null>(null);
  const [addKolState, setAddKolState] = useState<{ handleText: string; platformText: string; followerText: string } | null>(null);
  const [addToast, setAddToast] = useState('');

  // Bridge local row state back up to the parent page (source of truth for Commit) —
  // stored in a ref so the effect only depends on `rows`, not the parent's callback identity.
  const onRowsChangeRef = useRef(onRowsChange);
  useEffect(() => { onRowsChangeRef.current = onRowsChange; });
  useEffect(() => { onRowsChangeRef.current(rows); }, [rows]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [validating, setValidating] = useState(false);
  const [revalidateError, setRevalidateError] = useState('');
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Race guard for the debounced re-validate call — mirrors KolPicker.tsx's
  // `searchSeq` idiom exactly (CLAUDE.md §9 "Race Condition Guard").
  const revalidateSeq = useRef(0);
  // Bumped on every raw edit (cell/bulk) — separate from `rows` itself, since `rows`
  // also changes when a re-validate response merges errors/warnings back in, and that
  // merge must NOT re-trigger another debounced validate call (would loop forever).
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (revision === 0) return; // initial mount — rows were already validated by the caller
    const seq = ++revalidateSeq.current;
    const timer = setTimeout(() => {
      setValidating(true);
      setRevalidateError('');
      const snapshot = rowsRef.current;
      validateImportRows(kind, snapshot.map(r => ({ rowNumber: r.rowNumber, raw: r.raw })))
        .then(res => {
          if (revalidateSeq.current !== seq) return; // a newer edit already started a fetch
          setRows(prev => prev.map(r => {
            const match = res.rows.find(rr => rr.rowNumber === r.rowNumber);
            return match ? { ...r, errors: match.errors, warnings: match.warnings } : r;
          }));
        })
        .catch((err: unknown) => {
          if (revalidateSeq.current !== seq) return;
          setRevalidateError(err instanceof Error ? err.message : t('importPlacements.edit.revalidateFailed'));
        })
        .finally(() => { if (revalidateSeq.current === seq) setValidating(false); });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, kind]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.size > 0 && selected.size < rows.length;
  }, [selected, rows.length]);

  function applyPatch(targets: number[], patch: Partial<ImportRawRow>) {
    const set = new Set(targets);
    setRows(prev => prev.map(r => (set.has(r.rowNumber) ? { ...r, raw: { ...r.raw, ...patch } } : r)));
    setRevision(v => v + 1);
  }

  function toggleSelect(rowNumber: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.rowNumber))));
  }
  function toggleExpand(rowNumber: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
      return next;
    });
  }

  const editT = { colShopBranch: t('importPlacements.edit.colShopBranch'), colTargetDate: t('importPlacements.edit.colTargetDate'), colPaymentType: t('importPlacements.edit.colPaymentType') };
  const notesLabel = t('importPlacements.colNotes');
  const scrollFields = useMemo(
    () => (kind === 'online' ? onlineScrollFields(editT, notesLabel) : offlineScrollFields(editT, notesLabel)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, editT.colShopBranch, editT.colTargetDate, editT.colPaymentType, notesLabel],
  );
  const colBrandLabel = t('importPlacements.colBrand');
  const bulkFields = useMemo(
    () => [...stickyFields(colBrandLabel), ...scrollFields, ...(kind === 'online' ? EXPAND_FIELDS : [])],
    [scrollFields, kind, colBrandLabel],
  );
  const totalCols = 5 + scrollFields.length + (kind === 'online' ? 1 : 0);
  // Explicit total px width for the <table> — with table-layout:fixed and no width set
  // on the <table> itself, browsers shrink the fixed colgroup widths proportionally to
  // fit the overflow-x-auto container instead of actually overflowing/scrolling, which
  // silently desyncs real column widths from the sticky `left` offsets. Forcing the
  // table wider than the container is what makes it scroll instead of squeeze.
  const stickyTotalW = STICKY_W.checkbox + STICKY_W.row + STICKY_W.status + STICKY_W.brand + STICKY_W.kol;
  const tableWidth = stickyTotalW + scrollFields.reduce((sum, f) => sum + f.width, 0) + (kind === 'online' ? MORE_TOGGLE_W : 0);

  const [bulkField, setBulkField] = useState<FieldKey>('brand');
  const [bulkValue, setBulkValue] = useState('');
  const bulkMeta = bulkFields.find(f => f.key === bulkField) ?? bulkFields[0];

  function handleBulkApply() {
    if (selected.size === 0 || !bulkMeta) return;
    const patch: Partial<ImportRawRow> = { [bulkMeta.key]: bulkValue };
    if (bulkMeta.type === 'kol') {
      const kol = lookups.kols.find(k => normalizeHandle(k.handle) === normalizeHandle(bulkValue));
      if (kol) {
        patch.platform = kol.platform_id != null ? (lookups.platforms.find(p => p.id === kol.platform_id)?.name ?? '') : '';
        patch.follower = kol.follower_count != null ? String(kol.follower_count) : '';
      }
    }
    applyPatch(Array.from(selected), patch);
  }

  return (
    <div>
      {revalidateError && (
        <div className="mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-xs flex items-center gap-2">
          <span className="flex-1">{revalidateError}</span>
          <button onClick={() => setRevalidateError('')} className="text-red-400 hover:text-red-600"><X size={12} /></button>
        </div>
      )}

      {/* No -mx-5/px-5 bleed-to-edge here (unlike the old read-only table) — that padding
          trick leaves a gap to the left of the sticky columns where horizontally-scrolled
          content can visually peek through underneath them. Plain overflow-x-auto keeps
          the sticky `left: 0` columns flush with the container's true edge instead. */}
      <div className="overflow-x-auto border border-hairline rounded-xl">
        <table className="text-sm border-collapse table-fixed" style={{ width: tableWidth }}>
          {/* table-layout:fixed + an explicit <colgroup> is required here — with the
              default `auto` layout, a column's real rendered width is based on its
              widest cell's content (e.g. a long Campaign label), which can silently
              drift away from the fixed `left` offsets the sticky columns are pinned
              at (STICKY_LEFT/STICKY_W below), causing them to visibly misalign with
              the actual column boundaries once scrolled. Fixed widths here keep both
              in sync. */}
          <colgroup>
            <col style={{ width: STICKY_W.checkbox }} />
            <col style={{ width: STICKY_W.row }} />
            <col style={{ width: STICKY_W.status }} />
            <col style={{ width: STICKY_W.brand }} />
            <col style={{ width: STICKY_W.kol }} />
            {scrollFields.map(f => <col key={f.key} style={{ width: f.width }} />)}
            {kind === 'online' && <col style={{ width: MORE_TOGGLE_W }} />}
          </colgroup>
          <thead>
            <tr className="border-b border-hairline">
              <th className={stickyThCls} style={{ left: STICKY_LEFT.checkbox, width: STICKY_W.checkbox }}>
                <input ref={selectAllRef} type="checkbox" aria-label={t('importPlacements.edit.selectAllAria')}
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleSelectAll} className="align-middle" />
              </th>
              <th className={stickyThCls} style={{ left: STICKY_LEFT.row, width: STICKY_W.row }}>{t('importPlacements.colRow')}</th>
              <th className={stickyThCls} style={{ left: STICKY_LEFT.status, width: STICKY_W.status }}>{t('importPlacements.colStatus')}</th>
              <th className={stickyThCls} style={{ left: STICKY_LEFT.brand, width: STICKY_W.brand }}>{t('importPlacements.colBrand')}</th>
              <th className={`${stickyThCls} border-r border-hairline`} style={{ left: STICKY_LEFT.kol, width: STICKY_W.kol }}>KOL Handle</th>
              {scrollFields.map(f => (
                <th key={f.key} className="py-2 px-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis">{f.label}</th>
              ))}
              {kind === 'online' && <th className="py-2 px-2.5 text-left text-xs font-medium text-muted uppercase tracking-wide">{t('importPlacements.edit.moreToggle')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const hasError = row.errors.length > 0;
              const hasWarning = row.warnings.length > 0;
              const tint = hasError ? 'bg-red-500/5' : hasWarning ? 'bg-yellow-500/5' : '';
              const brandId = matchByName(lookups.brands, row.raw.brand)?.id ?? null;
              const isExpanded = expanded.has(row.rowNumber);
              const hasMessages = hasError || hasWarning;
              return (
                <Fragment key={row.rowNumber}>
                  <tr className="border-b border-hairline/50 hover:bg-canvas/40 transition-colors">
                    <td className={stickyTdCls} style={{ left: STICKY_LEFT.checkbox, width: STICKY_W.checkbox }}>
                      <input type="checkbox" aria-label={t('importPlacements.edit.selectRowAria', { row: row.rowNumber })}
                        checked={selected.has(row.rowNumber)} onChange={() => toggleSelect(row.rowNumber)} />
                    </td>
                    <td className={`${stickyTdCls} text-muted tabular-nums`} style={{ left: STICKY_LEFT.row, width: STICKY_W.row }}>
                      {row.rowNumber}
                    </td>
                    <td className={stickyTdCls} style={{ left: STICKY_LEFT.status, width: STICKY_W.status }}>
                      <StatusCell hasError={hasError} hasWarning={hasWarning} validating={validating} t={t} />
                    </td>
                    <td className={stickyTdCls} style={{ left: STICKY_LEFT.brand, width: STICKY_W.brand }}>
                      <BrandCell value={row.raw.brand} brands={lookups.brands}
                        onChange={v => applyPatch([row.rowNumber], { brand: v })} />
                    </td>
                    <td className={`${stickyTdCls} border-r border-hairline`} style={{ left: STICKY_LEFT.kol, width: STICKY_W.kol }}>
                      <KolHandleCell value={row.raw.kolHandle} kols={lookups.kols} platforms={lookups.platforms}
                        onTextChange={v => applyPatch([row.rowNumber], { kolHandle: v })}
                        onSelect={kol => applyPatch([row.rowNumber], {
                          kolHandle: kol.handle,
                          platform: kol.platform_id != null ? (lookups.platforms.find(p => p.id === kol.platform_id)?.name ?? '') : row.raw.platform,
                          follower: kol.follower_count != null ? String(kol.follower_count) : row.raw.follower,
                        })} />
                    </td>
                    {scrollFields.map(f => (
                      <td key={f.key} className={`py-2 px-2.5 align-top overflow-hidden ${tint}`}>
                        <FieldControl meta={f} value={row.raw[f.key]} lookups={lookups} brandId={brandId} usePortal
                          onChange={v => applyPatch([row.rowNumber], { [f.key]: v })} />
                      </td>
                    ))}
                    {kind === 'online' && (
                      <td className={`py-2 px-2.5 align-top ${tint}`}>
                        <button type="button" onClick={() => toggleExpand(row.rowNumber)}
                          className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors">
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          {t('importPlacements.edit.moreToggle')}
                        </button>
                      </td>
                    )}
                  </tr>
                  {hasMessages && (
                    <tr key={`${row.rowNumber}-msg`} className={`border-b border-hairline/50 ${tint}`}>
                      <td className={stickyTdCls} style={{ left: STICKY_LEFT.checkbox, width: STICKY_W.checkbox }} />
                      <td className={stickyTdCls} style={{ left: STICKY_LEFT.row, width: STICKY_W.row }} />
                      <td className={stickyTdCls} style={{ left: STICKY_LEFT.status, width: STICKY_W.status }} />
                      <td className={`${stickyTdCls}`} style={{ left: STICKY_LEFT.brand, width: STICKY_W.brand }} />
                      <td className={`${stickyTdCls} border-r border-hairline`} style={{ left: STICKY_LEFT.kol, width: STICKY_W.kol }} />
                      <td colSpan={totalCols - 5} className="py-1.5 px-2.5 text-xs">
                        {row.errors.map((e, i) => (
                          <div key={`e${i}`} className="text-red-500 flex items-center gap-2">
                            <span>{e}</span>
                            {e.startsWith(MODEL_NOT_FOUND_PREFIX) && brandId != null && (
                              <button type="button"
                                onClick={() => setAddModelState({ brandId, modelText: row.raw.model })}
                                className="text-accent hover:text-accent-hover font-medium whitespace-nowrap transition-colors">
                                {t('importPlacements.edit.addModelButton')}
                              </button>
                            )}
                            {e.startsWith(KOL_NOT_FOUND_PREFIX) && (
                              <button type="button"
                                onClick={() => setAddKolState({
                                  handleText: row.raw.kolHandle,
                                  platformText: row.raw.platform,
                                  followerText: row.raw.follower,
                                })}
                                className="text-accent hover:text-accent-hover font-medium whitespace-nowrap transition-colors">
                                {t('importPlacements.edit.addKolButton')}
                              </button>
                            )}
                          </div>
                        ))}
                        {row.warnings.map((w, i) => <div key={`w${i}`} className="text-yellow-600">{w}</div>)}
                      </td>
                    </tr>
                  )}
                  {kind === 'online' && isExpanded && (
                    <tr key={`${row.rowNumber}-expand`} className={`border-b border-hairline/50 ${tint}`}>
                      <td className={stickyTdCls} style={{ left: STICKY_LEFT.checkbox, width: STICKY_W.checkbox }} />
                      <td className={stickyTdCls} style={{ left: STICKY_LEFT.row, width: STICKY_W.row }} />
                      <td className={stickyTdCls} style={{ left: STICKY_LEFT.status, width: STICKY_W.status }} />
                      <td className={stickyTdCls} style={{ left: STICKY_LEFT.brand, width: STICKY_W.brand }} />
                      <td className={`${stickyTdCls} border-r border-hairline`} style={{ left: STICKY_LEFT.kol, width: STICKY_W.kol }} />
                      <td colSpan={totalCols - 5} className="py-2.5 px-2.5">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-canvas/60 rounded-lg p-3">
                          {EXPAND_FIELDS.map(f => (
                            <div key={f.key}>
                              <label className="block text-[11px] font-medium text-muted mb-1 tracking-wide uppercase">{f.label}</label>
                              <FieldControl meta={f} value={row.raw[f.key]} lookups={lookups} brandId={brandId} usePortal
                                onChange={v => applyPatch([row.rowNumber], { [f.key]: v })} />
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-0 mt-3 p-3 bg-surface border border-hairline rounded-xl shadow-lg flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink">{t('importPlacements.bulk.selectedCount', { count: selected.size })}</span>
          <div className="flex-1 flex flex-wrap items-center gap-2 min-w-[280px]">
            <Select size="sm" className="w-48"
              options={bulkFields.map(f => ({ id: f.key, label: f.label }))}
              value={bulkField}
              onChange={v => { setBulkField(v as FieldKey); setBulkValue(''); }} />
            {bulkMeta && (
              <div className="w-56">
                {bulkMeta.type === 'kol' ? (
                  <KolHandleCell value={bulkValue} kols={lookups.kols} platforms={lookups.platforms}
                    onTextChange={setBulkValue} onSelect={kol => setBulkValue(kol.handle)} />
                ) : (
                  <FieldControl meta={bulkMeta} value={bulkValue} lookups={lookups} brandId={null} onChange={setBulkValue} />
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={handleBulkApply}
            className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover active:scale-[0.99] transition-all">
            {t('importPlacements.bulk.apply', { count: selected.size })}
          </button>
          <button type="button" onClick={() => setSelected(new Set())}
            className="px-3 py-2 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
            {t('importPlacements.bulk.clearSelection')}
          </button>
        </div>
      )}

      {addToast && <Toast message={addToast} onClose={() => setAddToast('')} />}

      {addModelState && (
        <AddModelModal
          brandId={addModelState.brandId}
          productCategories={productCategories}
          initialModelCode={addModelState.modelText}
          onClose={() => setAddModelState(null)}
          onCreated={product => {
            const brandId = addModelState.brandId;
            setLookups(prev => ({
              ...prev,
              products: [...prev.products, { id: product.id, model_code: product.model_code, brandIds: [brandId] }],
            }));
            setRevision(v => v + 1); // re-validate every row — the same model text may appear on several rows
            setAddToast(t('addModel.addModelSuccess'));
          }}
        />
      )}

      {addKolState && (
        <AddKolModal
          prefillHandle={addKolState.handleText}
          prefillPlatformId={(() => {
            const p = matchByName(lookups.platforms, addKolState.platformText);
            return p ? String(p.id) : undefined;
          })()}
          prefillFollowerCount={addKolState.followerText.trim() || undefined}
          platforms={lookups.platforms}
          onClose={() => setAddKolState(null)}
          onCreated={(kol: CreatedKol) => {
            setLookups(prev => ({
              ...prev,
              kols: [...prev.kols, {
                id: kol.id,
                handle: kol.handle,
                handle_normalized: normalizeHandle(kol.handle),
                platform_id: kol.platform_id,
                follower_count: kol.follower_count,
              }],
            }));
            setRevision(v => v + 1); // re-validate every row — the same handle may appear on several rows
            setAddToast(t('addKol.addKolSuccess'));
          }}
        />
      )}
    </div>
  );
}
