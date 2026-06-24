import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, X, ChevronLeft, ChevronRight, Package } from 'lucide-react';
import {
  getSamples, createSample, updateSample, deleteSample,
  getDropdowns, getProducts, searchKols,
  type KolSample, type Brand, type Product, type KolResult,
} from '../api/index.js';
import { useAuth } from '../context/AuthContext.js';
import { useModalTransition } from '../hooks/useModalTransition.js';
import { getCached, setCached } from '../lib/swrCache.js';
import Select from '../components/Select.js';
import KolAvatar from '../components/KolAvatar.js';

const LIMIT = 25;

const STATUS_LABELS: Record<string, string> = {
  to_be_shipped: 'รอส่ง',
  shipped: 'ส่งแล้ว',
  signed_for: 'รับแล้ว',
};
const STATUS_COLORS: Record<string, string> = {
  to_be_shipped: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25',
  shipped: 'bg-blue-100 text-blue-800 ring-1 ring-blue-200 dark:bg-accent/15 dark:text-accent-bright dark:ring-accent/25',
  signed_for: 'bg-green-100 text-green-800 ring-1 ring-green-200 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/25',
};
const RETURN_LABELS: Record<string, string> = {
  return_required: 'ต้องคืน',
  no_return_required: 'ไม่ต้องคืน',
};

const STATUS_NEXT: Record<string, string> = {
  to_be_shipped: 'shipped',
  shipped: 'signed_for',
};

const inputCls = [
  'w-full px-3 py-2 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent',
].join(' ');
const labelCls = 'block text-xs font-medium text-muted mb-1 tracking-wide uppercase';

// ─── Create Sample Modal ─────────────────────────────────────
function CreateSampleModal({
  availableBrands,
  defaultBrandId,
  onClose,
  onCreated,
}: {
  availableBrands: Brand[];
  defaultBrandId: number | null;   // null = user มีหลาย brand → ให้เลือกเอง
  onClose: () => void;
  onCreated: (s: KolSample) => void;
}) {
  const { closed, requestClose } = useModalTransition(onClose);
  const [kolQuery, setKolQuery] = useState('');
  const [kolResults, setKolResults] = useState<KolResult[]>([]);
  const [selectedKol, setSelectedKol] = useState<KolResult | null>(null);
  const kolSearchSeq = useRef(0);
  const [form, setForm] = useState({
    brand_id: defaultBrandId ? String(defaultBrandId) : '',
    product_id: '',
    sample_status: 'to_be_shipped',
    return_policy: 'no_return_required',
    notes: '',
  });
  const [brandProducts, setBrandProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // โหลดสินค้าทันทีที่ brand_id เซ็ต (รวมถึง defaultBrandId)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!form.brand_id) { setBrandProducts([]); return; }
    setLoadingProducts(true);
    getProducts(form.brand_id)
      .then(setBrandProducts)
      .finally(() => setLoadingProducts(false));
  }, [form.brand_id]);

  // เมื่อ user เปลี่ยน brand → reset product ที่เลือกไว้
  function handleBrandChange(brandId: string) {
    setForm(f => ({ ...f, brand_id: brandId, product_id: '' }));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!kolQuery.trim() || selectedKol) { setKolResults([]); return; }
    const seq = ++kolSearchSeq.current;
    const t = setTimeout(() => {
      searchKols(kolQuery).then(r => {
        if (kolSearchSeq.current === seq) setKolResults(r);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [kolQuery, selectedKol]);

  async function handleCreate() {
    if (!selectedKol) { setError('กรุณาเลือก KOL'); return; }
    if (!form.brand_id) { setError('กรุณาเลือก Brand'); return; }
    setSaving(true); setError('');
    try {
      const sample = await createSample({
        kol_id: selectedKol.id,
        brand_id: Number(form.brand_id),
        product_id: form.product_id ? Number(form.product_id) : null,
        sample_status: form.sample_status,
        return_policy: form.return_policy,
        notes: form.notes,
      });
      onCreated(sample);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      setSaving(false);
    }
  }

  const autoSelectedBrand = defaultBrandId
    ? availableBrands.find(b => b.id === defaultBrandId)
    : null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div className={`bg-surface border border-hairline rounded-2xl shadow-2xl w-full max-w-md transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h3 className="font-semibold text-ink tracking-tight">เพิ่ม Sample</h3>
          <button type="button" onClick={requestClose} className="text-muted hover:text-ink p-1 rounded-lg transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* KOL picker */}
          <div>
            <label className={labelCls}>KOL *</label>
            {selectedKol ? (
              <div className="flex items-center justify-between px-3 py-2 bg-accent/5 border border-accent/30 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-ink">{selectedKol.handle}</span>
                  {selectedKol.gen_name && <span className="text-xs text-muted ml-2">{selectedKol.gen_name}</span>}
                </div>
                <button onClick={() => { setSelectedKol(null); setKolQuery(''); }}
                  className="text-muted hover:text-ink transition-colors"><X size={13} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                <input type="text" value={kolQuery} onChange={e => setKolQuery(e.target.value)}
                  placeholder="ค้นหา KOL..." className={inputCls + ' pl-8'} />
                {kolResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-hairline rounded-lg shadow-lg z-20 overflow-hidden max-h-40 overflow-y-auto">
                    {kolResults.map(k => (
                      <button key={k.id} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-canvas transition-colors"
                        onClick={() => { setSelectedKol(k); setKolQuery(''); setKolResults([]); }}>
                        <span className="font-medium text-ink">{k.handle}</span>
                        {k.gen_name && <span className="text-muted ml-2 text-xs">{k.gen_name}</span>}
                        {k.platforms.length > 0 && (
                          <span className="ml-2 text-xs text-muted">· {k.platforms.map(p => p.platform_name).join(', ')}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Brand — auto หรือ dropdown */}
            <div>
              <label className={labelCls}>Brand</label>
              {autoSelectedBrand ? (
                <div className="px-3 py-2 bg-canvas border border-hairline rounded-lg text-sm text-ink">
                  {autoSelectedBrand.name}
                </div>
              ) : (
                <Select
                  options={[{ id: '', label: 'เลือก Brand *' }, ...availableBrands.map(b => ({ id: b.id, label: b.name }))]}
                  value={form.brand_id}
                  onChange={handleBrandChange}
                />
              )}
            </div>

            {/* Product — เปิดได้เมื่อมี brand */}
            <div>
              <label className={labelCls}>
                สินค้า
                {loadingProducts && (
                  <span className="ml-1 inline-block w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin align-middle" />
                )}
              </label>
              <Select
                options={[
                  { id: '', label: !form.brand_id ? 'เลือก Brand ก่อน' : loadingProducts ? 'กำลังโหลด...' : 'เลือกสินค้า (ไม่บังคับ)' },
                  ...brandProducts.map(p => ({ id: p.id, label: p.model_code })),
                ]}
                value={form.product_id}
                onChange={v => setForm(f => ({ ...f, product_id: v }))}
                disabled={!form.brand_id || loadingProducts}
              />
              {form.brand_id && !loadingProducts && brandProducts.length === 0 && (
                <p className="text-[11px] text-muted mt-1">ยังไม่มีสินค้าของ brand นี้</p>
              )}
            </div>
            <div>
              <label className={labelCls}>สถานะเริ่มต้น</label>
              <Select
                options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ id: k, label: v }))}
                value={form.sample_status}
                onChange={v => setForm(f => ({ ...f, sample_status: v }))}
              />
            </div>
            <div>
              <label className={labelCls}>นโยบายคืน</label>
              <Select
                options={Object.entries(RETURN_LABELS).map(([k, v]) => ({ id: k, label: v }))}
                value={form.return_policy}
                onChange={v => setForm(f => ({ ...f, return_policy: v }))}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="..." className={inputCls} />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={requestClose}
              className="flex-1 py-2 border border-hairline rounded-full text-sm text-ink hover:bg-canvas transition-colors">
              ยกเลิก
            </button>
            <button type="button" onClick={handleCreate} disabled={saving}
              className="flex-1 py-2 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-all">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function SamplesPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<KolSample[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');

  const [brands, setBrands] = useState<Brand[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    getDropdowns().then(d => setBrands(d.brands));
  }, []);

  // brands ที่ user เข้าถึงได้ (admin เห็นทุก brand)
  const userBrands = appUser?.role === 'admin'
    ? brands
    : brands.filter(b => appUser?.brandIds.includes(b.id));

  // ถ้ามีแค่ brand เดียว → auto-select ไม่ต้องให้เลือก
  const defaultBrandId = userBrands.length === 1 ? userBrands[0].id : null;

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = { status: statusFilter || undefined, brand_id: brandFilter || undefined, page };
    const cacheKey = `samples:${JSON.stringify(params)}`;
    const cached = getCached<{ rows: KolSample[]; total: number }>(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setTotal(cached.total);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await getSamples(params);
      if (loadSeq.current !== seq) return;
      setCached(cacheKey, res);
      setRows(res.rows);
      setTotal(res.total);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [statusFilter, brandFilter, page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function handleStatusAdvance(sample: KolSample) {
    const next = STATUS_NEXT[sample.sample_status];
    if (!next) return;
    const now = new Date().toISOString().slice(0, 10);
    const updated = await updateSample(sample.id, {
      sample_status: next,
      ...(next === 'shipped' ? { shipped_at: now } : {}),
      ...(next === 'signed_for' ? { signed_at: now } : {}),
    });
    setRows(prev => prev.map(r => r.id === sample.id ? updated : r));
  }

  async function handleDelete(id: number) {
    if (!confirm('ลบ sample นี้?')) return;
    await deleteSample(id);
    setRows(prev => prev.filter(r => r.id !== id));
    setTotal(t => t - 1);
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="px-6 py-6 max-w-screen-xl mx-auto">
      {/* Header + Filters */}
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">จัดการ Sample</h1>
          <p className="text-sm text-muted mt-0.5">{total.toLocaleString()} รายการทั้งหมด</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            size="sm" className="min-w-[140px]"
            options={[{ id: '', label: 'ทุกสถานะ' }, ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ id: k, label: v }))]}
            value={statusFilter}
            onChange={v => { setStatusFilter(v); setPage(1); }}
          />
          {brands.length > 1 && (
            <Select
              size="sm" className="min-w-[140px]"
              options={[{ id: '', label: 'ทุก Brand' }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
              value={brandFilter}
              onChange={v => { setBrandFilter(v); setPage(1); }}
            />
          )}
          {(statusFilter || brandFilter) && (
            <button onClick={() => { setStatusFilter(''); setBrandFilter(''); setPage(1); }}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
              <X size={11} /> ล้าง
            </button>
          )}
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover active:scale-95 transition-all">
            <Plus size={13} />
            เพิ่ม Sample
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface border border-hairline rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-canvas">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">KOL</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">สินค้า</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">Brand</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">สถานะ</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">คืน</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">วันส่ง / รับ</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {loading && (
                <tr><td colSpan={7} className="py-16 text-center">
                  <div className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="py-16 text-center">
                  <Package size={28} className="text-muted mx-auto mb-2" />
                  <p className="text-sm font-medium text-ink">ยังไม่มี sample</p>
                  <p className="text-xs text-muted mt-1">กด "เพิ่ม Sample" เพื่อเริ่มต้น</p>
                </td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="hover:bg-canvas/60 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {r.kols?.handle && <KolAvatar handle={r.kols.handle} avatarUrl={r.kols.avatar_url} size="sm" />}
                      <div>
                        <div className="font-medium text-ink text-sm">{r.kols?.handle ?? '—'}</div>
                        {r.kols?.gen_name && <div className="text-xs text-muted">{r.kols.gen_name}</div>}
                        {r.kols?.platforms?.name && <div className="text-xs text-muted">{r.kols.platforms.name}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-ink">{r.products?.model_code ?? <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-3 text-xs text-ink">{r.brands?.name ?? <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => handleStatusAdvance(r)}
                      disabled={!STATUS_NEXT[r.sample_status]}
                      title={STATUS_NEXT[r.sample_status] ? `คลิกเพื่ออัปเป็น "${STATUS_LABELS[STATUS_NEXT[r.sample_status]]}"` : undefined}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-all ${STATUS_COLORS[r.sample_status]} ${STATUS_NEXT[r.sample_status] ? 'cursor-pointer hover:opacity-70 active:scale-95' : 'cursor-default'}`}
                    >
                      {STATUS_LABELS[r.sample_status] ?? r.sample_status}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${r.return_policy === 'return_required' ? 'bg-orange-100 text-orange-800 ring-1 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/25' : 'bg-canvas text-muted border border-hairline'}`}>
                      {RETURN_LABELS[r.return_policy] ?? r.return_policy}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {r.shipped_at && <div>ส่ง {r.shipped_at}</div>}
                    {r.signed_at && <div>รับ {r.signed_at}</div>}
                    {!r.shipped_at && !r.signed_at && '—'}
                  </td>
                  <td className="px-3 py-3">
                    <button onClick={() => handleDelete(r.id)}
                      className="text-muted hover:text-red-500 p-1 rounded transition-colors">
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-hairline flex items-center justify-between gap-3">
            <span className="text-xs text-muted tabular-nums">
              {total.toLocaleString('th-TH')} รายการ · หน้า {page}/{totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-hairline text-muted hover:text-ink disabled:opacity-30 transition-all">
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-hairline text-muted hover:text-ink disabled:opacity-30 transition-all">
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateSampleModal
          availableBrands={userBrands}
          defaultBrandId={defaultBrandId}
          onClose={() => setShowCreate(false)}
          onCreated={s => { setShowCreate(false); setRows(prev => [s, ...prev]); setTotal(t => t + 1); }}
        />
      )}
    </div>
  );
}
