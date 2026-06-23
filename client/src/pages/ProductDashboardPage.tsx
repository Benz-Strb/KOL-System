import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, ShoppingCart, ListChecks, Layers, X, Trophy, Image as ImageIcon } from 'lucide-react';
import {
  getProductDashboard, getDropdowns,
  type ProductDashboardOverview, type ProductRankRow, type Campaign, type Brand, type ProductCategory,
} from '../api/index.js';
import Select from '../components/Select.js';
import { getCached, setCached } from '../lib/swrCache.js';

function formatMoney(n: number) {
  return '฿' + Math.round(n).toLocaleString('th-TH');
}

function ProductImage({ url }: { url: string | null }) {
  const [errored, setErrored] = useState(false);
  if (url && !errored) {
    return <img src={url} alt="" onError={() => setErrored(true)} className="w-10 h-10 rounded-lg object-cover shrink-0 bg-canvas border border-hairline" />;
  }
  return (
    <span className="w-10 h-10 rounded-lg shrink-0 bg-canvas border border-hairline flex items-center justify-center text-muted">
      <ImageIcon size={16} />
    </span>
  );
}

const selectCls = [
  'px-3 py-1.5 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/40',
].join(' ');

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-4 flex flex-col gap-2 shadow-sm hover:shadow-lg hover:border-accent/30 hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-accent/10 text-accent shrink-0">
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      </div>
      <div className="text-xl font-bold text-ink tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function SkeletonKpiCard() {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-4 flex flex-col gap-2 animate-pulse">
      <div className="h-2.5 bg-canvas rounded-md w-2/3" />
      <div className="h-5 bg-canvas rounded-md w-1/2" />
      <div className="h-2 bg-canvas rounded-md w-3/4" />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 px-2 animate-pulse">
      <div className="w-6 h-3 bg-canvas rounded-md shrink-0" />
      <div className="w-10 h-10 rounded-lg bg-canvas shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 bg-canvas rounded-md w-1/3" />
        <div className="h-2.5 bg-canvas rounded-md w-1/4" />
      </div>
      <div className="w-20 h-3 bg-canvas rounded-md shrink-0" />
      <div className="w-28 h-3.5 bg-canvas rounded-md shrink-0" />
    </div>
  );
}

function ProductRow({ p, rank, sortMode }: { p: ProductRankRow; rank: number; sortMode: 'gmv' | 'orders' }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-canvas transition-colors">
      <span className="w-6 text-xs font-semibold text-muted text-center shrink-0">{rank}</span>
      <ProductImage url={p.image_url} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink truncate">{p.model_code}</div>
        {p.category_name && <div className="text-[11px] text-muted truncate">{p.category_name}</div>}
      </div>
      <span className="text-xs text-muted tabular-nums shrink-0">{p.placement_count} placement</span>
      {sortMode === 'orders' && (
        <span className="text-xs font-semibold text-emerald-600 tabular-nums w-24 text-right shrink-0">{p.total_orders.toLocaleString('th-TH')} orders</span>
      )}
      <span className="text-sm font-semibold text-ink tabular-nums w-28 text-right shrink-0">{formatMoney(p.total_gmv)}</span>
    </div>
  );
}

export default function ProductDashboardPage() {
  const [data, setData] = useState<ProductDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortMode, setSortMode] = useState<'gmv' | 'orders'>('gmv');

  useEffect(() => {
    getDropdowns().then(d => { setCampaigns(d.campaigns); setBrands(d.brands); setCategories(d.productCategories); });
  }, []);

  const load = useCallback(async () => {
    const params = { brand_id: brandId, campaign_id: campaignId, category_id: categoryId, date_from: dateFrom, date_to: dateTo };
    const cacheKey = `product-dashboard:${JSON.stringify(params)}`;
    const cached = getCached<ProductDashboardOverview>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await getProductDashboard(params);
      setCached(cacheKey, res);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [brandId, campaignId, categoryId, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const ranking = data
    ? [...data.ranking].sort((a, b) => sortMode === 'gmv' ? b.total_gmv - a.total_gmv : b.total_orders - a.total_orders)
    : [];

  return (
    <div className="px-6 py-6 max-w-screen-xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">Dashboard สินค้า</h1>
          <p className="text-sm text-muted mt-0.5">Ranking สินค้าทุกรุ่นตามผลงานที่ทำได้จริง</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select
            size="sm" className="min-w-[140px]"
            options={[{ id: '', label: 'ทุกแบรนด์' }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
            value={brandId}
            onChange={setBrandId}
          />
          <Select
            size="sm" className="min-w-[180px]"
            options={[{ id: '', label: 'ทุกแคมเปญ' }, ...campaigns.map(c => ({ id: c.id, label: `${c.code}${c.label ? ` — ${c.label}` : ''}` }))]}
            value={campaignId}
            onChange={setCampaignId}
          />
          <Select
            size="sm" className="min-w-[160px]"
            options={[{ id: '', label: 'ทุกหมวดหมู่' }, ...categories.map(cat => ({ id: cat.id, label: cat.name }))]}
            value={categoryId}
            onChange={setCategoryId}
          />

          <div className="w-px h-4 bg-hairline shrink-0" />

          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} className={selectCls} />
          <span className="text-xs text-muted">ถึง</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} className={selectCls} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
              <X size={11} /> ล้างวันที่
            </button>
          )}
        </div>
      </div>

      {loading || !data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonKpiCard key={i} />)}
          </div>
          <div className="bg-surface border border-hairline rounded-2xl p-5">
            <div className="h-3.5 bg-canvas rounded-md w-52 mb-4 animate-pulse" />
            <div className="flex flex-col gap-1">
              {Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard icon={<TrendingUp size={13} />} label="GMV รวม" value={formatMoney(data.summary.total_gmv)} />
            <KpiCard icon={<ShoppingCart size={13} />} label="Orders รวม" value={data.summary.total_orders.toLocaleString('th-TH')} />
            <KpiCard icon={<ListChecks size={13} />} label="Placement ทั้งหมด" value={data.summary.total_placements.toLocaleString('th-TH')} />
            <KpiCard icon={<Layers size={13} />} label="สินค้าที่มีผลงาน" value={data.summary.product_count.toLocaleString('th-TH')} />
          </div>

          <div className="bg-surface border border-hairline rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                <Trophy size={14} className="text-accent" /> Ranking สินค้า
              </h2>
              <div className="flex items-center gap-1 bg-canvas rounded-lg p-1">
                <button
                  onClick={() => setSortMode('gmv')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sortMode === 'gmv' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  ตาม GMV
                </button>
                <button
                  onClick={() => setSortMode('orders')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sortMode === 'orders' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  ตาม Orders
                </button>
              </div>
            </div>
            {ranking.length === 0 ? (
              <p className="text-sm text-muted">ยังไม่มีข้อมูล</p>
            ) : (
              <div className="flex flex-col gap-1">
                {ranking.map((p, i) => (
                  <ProductRow key={p.canonical_id} p={p} rank={i + 1} sortMode={sortMode} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
