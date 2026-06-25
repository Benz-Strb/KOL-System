import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, ChevronLeft, ChevronRight, X, Pencil, ClipboardList, BarChart2, ExternalLink, List, TrendingUp } from 'lucide-react';
import { getPlacements, getKolGmv, getDropdowns, getProducts, type PlacementRow, type KolGmvRow, type Product, type Campaign, type UserOption, type Brand } from '../api/index.js';
import { useAuth } from '../context/AuthContext.js';
import PerformanceModal from '../components/PerformanceModal.js';
import MetricsViewModal from '../components/MetricsViewModal.js';
import Select from '../components/Select.js';
import KolAvatar from '../components/KolAvatar.js';
import BrandLogo from '../components/BrandLogo.js';
import { getPlatformColor } from '../lib/platformColors.js';
import { getCached, setCached } from '../lib/swrCache.js';
import { numberLocale } from '../i18n/locale.js';

function statusOptions(t: (key: string) => string) {
  return [
    { value: 'all', label: t('placements.allStatus') },
    { value: 'planned', label: 'Planned' },
    { value: 'posted', label: 'Posted' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
}

function typeOptions(t: (key: string) => string) {
  return [
    { value: 'all', label: t('placements.allType') },
    { value: 'online', label: 'Online' },
    { value: 'offline_shop', label: 'Offline' },
  ];
}

function paymentOptions(t: (key: string) => string) {
  return [
    { value: 'all', label: t('placements.allPayment') },
    { value: 'paid', label: 'Paid' },
    { value: 'free', label: 'Free' },
    { value: 'barter', label: 'Barter' },
  ];
}

const STATUS_STYLE: Record<string, string> = {
  planned: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25',
  posted:  'bg-green-100 text-green-800 ring-1 ring-green-200 shadow-[0_0_0_3px_rgba(34,197,94,0.08)] dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/25',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-[#86868b]',
};

const PAYMENT_STYLE: Record<string, string> = {
  paid:   'bg-blue-50 text-blue-700 dark:bg-accent/10 dark:text-accent-bright',
  free:   'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
  barter: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
};

const STATUS_DOT: Record<string, string> = {
  planned:   'bg-amber-400',
  posted:    'bg-green-500',
  cancelled: 'bg-gray-400',
};

const STATUS_LEFT: Record<string, string> = {
  planned:   'border-l-amber-400',
  posted:    'border-l-green-500',
  cancelled: 'border-l-gray-200 dark:border-l-white/10',
};

function formatFollower(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

function formatPrice(price: string | null) {
  if (!price) return '—';
  return Number(price).toLocaleString(numberLocale()) + ' ฿';
}

function formatGmv(n: number) {
  if (!n) return '—';
  return n.toLocaleString(numberLocale()) + ' ฿';
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="w-0 p-0 border-l-[3px] border-l-transparent" />
      <td className="px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-canvas shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3.5 bg-canvas rounded-md w-24" />
            <div className="h-2.5 bg-canvas rounded-md w-32" />
          </div>
        </div>
      </td>
      <td className="px-3 py-4">
        <div className="h-4 bg-canvas rounded-md w-10 mb-1.5" />
        <div className="h-2.5 bg-canvas rounded-md w-20" />
      </td>
      <td className="px-3 py-4">
        <div className="h-5 bg-canvas rounded-full w-16 mb-1.5" />
        <div className="h-2.5 bg-canvas rounded-md w-24" />
      </td>
      <td className="px-3 py-4 text-right">
        <div className="h-7 bg-canvas rounded-lg w-20 inline-block" />
      </td>
    </tr>
  );
}


export default function PlacementsPage() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [viewMode, setViewMode] = useState<'list' | 'gmv'>('list');
  const [rows, setRows] = useState<PlacementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [kolGmv, setKolGmv] = useState<KolGmvRow[]>([]);
  const [gmvLoading, setGmvLoading] = useState(false);
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [paymentType, setPaymentType] = useState('all');
  const [productId, setProductId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [picId, setPicId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [perfPlacement, setPerfPlacement] = useState<PlacementRow | null>(null);
  const [metricsPlacement, setMetricsPlacement] = useState<PlacementRow | null>(null);

  const LIMIT = 20;

  useEffect(() => {
    Promise.all([getProducts(), getDropdowns()]).then(([p, d]) => {
      setProducts(p);
      setCampaigns(d.campaigns);
      setUsers(d.users);
      setBrands(d.brands);
    });
  }, []);

  const [debouncedQ, setDebouncedQ] = useState('');
  const [debouncedPriceMin, setDebouncedPriceMin] = useState('');
  const [debouncedPriceMax, setDebouncedPriceMax] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedPriceMin(priceMin); setPage(1); }, 500);
    return () => clearTimeout(timer);
  }, [priceMin]);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedPriceMax(priceMax); setPage(1); }, 500);
    return () => clearTimeout(timer);
  }, [priceMax]);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = {
      status, placement_type: type, q: debouncedQ,
      product_id: productId, campaign_id: campaignId,
      payment_type: paymentType,
      price_min: debouncedPriceMin, price_max: debouncedPriceMax,
      person_in_charge_id: picId, brand_id: brandId, page,
    };
    const cacheKey = `placements:${JSON.stringify(params)}`;
    const cached = getCached<{ rows: PlacementRow[]; total: number }>(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setTotal(cached.total);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await getPlacements(params);
      // ignore stale responses — a newer load() may have already resolved
      // while this older one was still in flight
      if (loadSeq.current !== seq) return;
      setCached(cacheKey, res);
      setRows(res.rows);
      setTotal(res.total);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [status, type, debouncedQ, productId, campaignId, paymentType, debouncedPriceMin, debouncedPriceMax, picId, brandId, page]);

  const loadGmvSeq = useRef(0);
  const loadGmv = useCallback(async () => {
    if (viewMode !== 'gmv') return;
    const seq = ++loadGmvSeq.current;
    const params = {
      status, placement_type: type, q: debouncedQ,
      product_id: productId, campaign_id: campaignId,
      payment_type: paymentType,
      price_min: debouncedPriceMin, price_max: debouncedPriceMax,
      person_in_charge_id: picId, brand_id: brandId,
    };
    const cacheKey = `kol-gmv:${JSON.stringify(params)}`;
    const cached = getCached<KolGmvRow[]>(cacheKey);
    if (cached) {
      setKolGmv(cached);
      setGmvLoading(false);
    } else {
      setGmvLoading(true);
    }
    try {
      const data = await getKolGmv(params);
      if (loadGmvSeq.current !== seq) return;
      setCached(cacheKey, data);
      setKolGmv(data);
    } finally {
      if (loadGmvSeq.current === seq) setGmvLoading(false);
    }
  }, [viewMode, status, type, debouncedQ, productId, campaignId, paymentType, debouncedPriceMin, debouncedPriceMax, picId, brandId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadGmv(); }, [loadGmv]);

  const totalPages = Math.ceil(total / LIMIT);

  const showBrandFilter = appUser?.role === 'admin' || (appUser?.brandIds?.length ?? 0) > 1;
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const secondaryActiveCount = [
    type !== 'all', paymentType !== 'all',
    !!productId, !!picId, !!brandId, !!priceMin, !!priceMax,
  ].filter(Boolean).length;

  const hasActiveFilters = status !== 'all' || !!campaignId || !!q || secondaryActiveCount > 0;

  function clearAll() {
    setStatus('all'); setType('all'); setPaymentType('all');
    setProductId(''); setCampaignId(''); setPicId(''); setBrandId('');
    setPriceMin(''); setPriceMax(''); setQ('');
    setPage(1);
  }

  const gmvTotal = kolGmv.reduce((s, r) => s + r.total_gmv, 0);
  const gmvOrders = kolGmv.reduce((s, r) => s + r.total_orders, 0);

  return (
    <>
    <div className="px-6 py-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">Placements</h1>
          <p className="text-sm text-muted mt-0.5">
            {viewMode === 'list'
              ? t('placements.totalCount', { count: total })
              : t('placements.gmvSummary', { count: kolGmv.length, gmv: formatGmv(gmvTotal) })}
          </p>
        </div>
        <div className="flex items-center bg-canvas border border-hairline rounded-xl p-0.5 gap-0.5">
          {([['list', t('placements.viewList'), List], ['gmv', t('placements.viewGmv'), TrendingUp]] as const).map(([val, label, Icon]) => (
            <button key={val} onClick={() => setViewMode(val)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[9px] text-xs font-medium transition-all ${
                viewMode === val ? 'bg-surface shadow-sm text-ink border border-hairline' : 'text-muted hover:text-ink'
              }`}>
              <Icon size={12} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-surface border border-hairline rounded-2xl mb-4">
        {/* Main row */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              placeholder={t('placements.searchKol')}
              value={q}
              onChange={e => setQ(e.target.value)}
              className="pl-8 pr-7 py-1.5 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent w-44 transition-colors"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="w-px h-4 bg-hairline shrink-0" />

          {viewMode === 'list' && (
            <Select
              size="sm" className="min-w-[120px]"
              options={statusOptions(t).map(o => ({ id: o.value, label: o.label }))}
              value={status}
              onChange={v => { setStatus(v); setPage(1); }}
            />
          )}
          <Select
            size="sm" className="min-w-[160px]"
            options={[{ id: '', label: t('placements.allCampaigns') }, ...campaigns.map(c => ({ id: c.id, label: c.label ?? c.code }))]}
            value={campaignId}
            onChange={v => { setCampaignId(v); setPage(1); }}
          />

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowMoreFilters(v => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                showMoreFilters || secondaryActiveCount > 0
                  ? 'bg-accent/10 border-accent/40 text-accent'
                  : 'bg-input-bg border-input-border text-muted hover:border-accent/40 hover:text-ink'
              }`}
            >
              <SlidersHorizontal size={12} />
              {t('placements.filterButton')}{secondaryActiveCount > 0 ? ` (${secondaryActiveCount})` : ''}
            </button>
            {hasActiveFilters && (
              <button onClick={clearAll} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors whitespace-nowrap">
                <X size={11} /> {t('placements.clearAll')}
              </button>
            )}
          </div>
        </div>

        {/* Secondary filters (expandable) */}
        {showMoreFilters && (
          <div className="border-t border-hairline px-3 py-2.5 flex flex-wrap gap-2">
            {viewMode === 'list' && (
              <>
                <Select
                  size="sm" className="min-w-[110px]"
                  options={typeOptions(t).map(o => ({ id: o.value, label: o.label }))}
                  value={type}
                  onChange={v => { setType(v); setPage(1); }}
                />
                <Select
                  size="sm" className="min-w-[110px]"
                  options={paymentOptions(t).map(o => ({ id: o.value, label: o.label }))}
                  value={paymentType}
                  onChange={v => { setPaymentType(v); setPage(1); }}
                />
              </>
            )}
            <Select
              size="sm" className="min-w-[150px]"
              options={[{ id: '', label: t('placements.allProducts') }, ...products.map(p => ({ id: p.id, label: p.model_code }))]}
              value={productId}
              onChange={v => { setProductId(v); setPage(1); }}
            />
            <Select
              size="sm" className="min-w-[170px]"
              options={[
                { id: '', label: t('placements.allPic') },
                ...users.map(u => ({ id: u.id, label: `${u.full_name}${u.is_active ? '' : t('placements.deactivatedSuffix')}` })),
              ]}
              value={picId}
              onChange={v => { setPicId(v); setPage(1); }}
            />
            {showBrandFilter && (
              <Select
                size="sm" className="min-w-[140px]"
                options={[{ id: '', label: t('common.allBrands') }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
                value={brandId}
                onChange={v => { setBrandId(v); setPage(1); }}
              />
            )}
            {viewMode === 'list' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min="0" placeholder={t('placements.priceMin')} value={priceMin}
                  onChange={e => setPriceMin(e.target.value)}
                  className="w-28 px-3 py-1.5 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent transition-colors"
                />
                <span className="text-muted text-xs">—</span>
                <input
                  type="number" min="0" placeholder={t('placements.priceMax')} value={priceMax}
                  onChange={e => setPriceMax(e.target.value)}
                  className="w-28 px-3 py-1.5 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent transition-colors"
                />
                <span className="text-muted text-xs">฿</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* GMV Table */}
      {viewMode === 'gmv' && (
        <div className="bg-surface border border-hairline rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline bg-canvas">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider w-8">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">KOL</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">Placements</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">Shopee</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">Lazada</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">Website</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">TikTok</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">{t('placements.totalGmv')}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">Orders</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {gmvLoading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center">
                      <div className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    </td>
                  </tr>
                )}
                {!gmvLoading && kolGmv.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-muted text-sm">
                      {t('placements.noGmvData')}
                    </td>
                  </tr>
                )}
                {!gmvLoading && kolGmv.map((r, i) => (
                  <tr key={r.kol_id} className="hover:bg-canvas transition-colors">
                    <td className="px-4 py-3 text-xs text-muted tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3">
                      {r.profile_url ? (
                        <a href={r.profile_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-ink text-sm hover:underline group">
                          {r.handle}
                          <ExternalLink size={11} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </a>
                      ) : (
                        <span className="font-medium text-ink text-sm">{r.handle}</span>
                      )}
                      {r.gen_name && <div className="text-xs text-muted mt-0.5">{r.gen_name}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-muted text-sm tabular-nums">{r.placement_count}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-muted">{formatGmv(r.shopee_gmv)}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-muted">{formatGmv(r.lazada_gmv)}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-muted">{formatGmv(r.website_gmv)}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-muted">{formatGmv(r.tiktok_gmv)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-ink tabular-nums text-sm">{formatGmv(r.total_gmv)}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted text-sm tabular-nums">{r.total_orders ? r.total_orders.toLocaleString(numberLocale()) : '—'}</td>
                  </tr>
                ))}
                {!gmvLoading && kolGmv.length > 0 && (
                  <tr className="border-t-2 border-hairline bg-canvas">
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">{t('placements.grandTotal')}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums">
                      {kolGmv.reduce((s, r) => s + r.placement_count, 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums">
                      {formatGmv(kolGmv.reduce((s, r) => s + r.shopee_gmv, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums">
                      {formatGmv(kolGmv.reduce((s, r) => s + r.lazada_gmv, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums">
                      {formatGmv(kolGmv.reduce((s, r) => s + r.website_gmv, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums">
                      {formatGmv(kolGmv.reduce((s, r) => s + r.tiktok_gmv, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-ink tabular-nums">{formatGmv(gmvTotal)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums">
                      {gmvOrders ? gmvOrders.toLocaleString(numberLocale()) : '—'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* List Table */}
      <div className={viewMode === 'gmv' ? 'hidden' : 'bg-surface border border-hairline rounded-2xl overflow-hidden'}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-canvas">
                <th className="w-1 p-0" />
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">KOL</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">{t('placements.colCampaignProduct')}</th>
                <th className="px-3 py-3 text-left text-[11px] font-semibold text-muted uppercase tracking-wider">{t('placements.colStatus')}</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-sm font-medium text-ink">{t('placements.noResults')}</p>
                    <p className="text-xs text-muted mt-1">{t('placements.tryDifferentFilter')}</p>
                  </td>
                </tr>
              )}
              {!loading && rows.map(r => {
                const handle = r.kols?.handle ?? '';
                const modelOrStore = r.placement_type === 'online'
                  ? (r.products?.model_code ?? null)
                  : r.stores ? `${r.stores.name}${r.stores.branch ? ` · ${r.stores.branch}` : ''}` : null;
                const platformLine = [
                  r.platforms?.name,
                  r.placement_type === 'online' ? 'Online' : 'Offline',
                  r.kols?.content_categories?.name,
                ].filter(Boolean).join(' · ');
                const pic = r.users_placements_person_in_charge_idTousers?.full_name;
                return (
                  <tr key={r.id} className="hover:bg-canvas/60 transition-colors group">
                    {/* Status left bar */}
                    <td className={`w-0 p-0 border-l-[3px] ${STATUS_LEFT[r.status] ?? 'border-l-transparent'}`} />
                    {/* KOL */}
                    <td className="px-4 py-4 max-w-[240px]">
                      <div className="flex items-center gap-2.5">
                        {handle && <KolAvatar handle={handle} avatarUrl={r.kols?.avatar_url} size="sm" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {r.kols?.profile_url ? (
                              <a href={r.kols.profile_url} target="_blank" rel="noopener noreferrer"
                                className="font-semibold text-ink hover:text-accent transition-colors inline-flex items-center gap-1 group/link">
                                {handle}
                                <ExternalLink size={10} className="opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0" />
                              </a>
                            ) : (
                              <span className="font-semibold text-ink">{handle || '—'}</span>
                            )}
                            {r.kols?.follower_count && (
                              <span className="text-[11px] text-muted tabular-nums bg-canvas border border-hairline px-1.5 py-px rounded-md"
                                title={r.kols.follower_count.toLocaleString(numberLocale()) + ' followers'}>
                                {formatFollower(r.kols.follower_count)}
                              </span>
                            )}
                            {r.brands && <BrandLogo name={r.brands.name} logoUrl={r.brands.logo_url} size={16} />}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 text-xs text-muted truncate">
                            {r.platforms?.name && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getPlatformColor(r.platforms.name)}`} />}
                            {platformLine || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* Campaign / Product */}
                    <td className="px-3 py-4">
                      {r.campaigns?.code
                        ? <span className="inline-flex items-center px-2 py-0.5 bg-accent/10 text-accent text-xs font-semibold rounded-md">{r.campaigns.code}</span>
                        : <span className="text-muted text-xs">—</span>}
                      <div className="text-xs text-muted mt-1">{modelOrStore ?? '—'}</div>
                    </td>
                    {/* Status / Payment / PIC */}
                    <td className="px-3 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[r.status] ?? 'bg-gray-400'}`} />
                        {r.status}
                      </span>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`inline-flex px-1.5 py-px rounded text-[11px] font-medium ${PAYMENT_STYLE[r.payment_type] ?? 'bg-canvas text-muted'}`}>
                          {r.payment_type}
                        </span>
                        {r.payment_type === 'paid' && r.final_price && (
                          <span className="text-[11px] text-muted tabular-nums font-medium">{formatPrice(r.final_price)}</span>
                        )}
                        {pic && <span className="text-[11px] text-muted">· {pic}</span>}
                      </div>
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-4 text-right">
                      {r.status !== 'cancelled' && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setPerfPlacement(r)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95 ${
                              r.status === 'posted'
                                ? 'bg-canvas border border-hairline text-muted hover:text-ink hover:border-ink/30'
                                : 'bg-accent text-white hover:bg-accent-hover shadow-sm'
                            }`}
                          >
                            {r.status === 'posted'
                              ? <><Pencil size={10} /> {t('common.edit')}</>
                              : <><ClipboardList size={10} /> {t('performance.save')}</>
                            }
                          </button>
                          {r.status === 'posted' && (
                            <button
                              onClick={() => setMetricsPlacement(r)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-canvas border border-hairline text-muted hover:text-ink hover:border-ink/30 transition-all active:scale-95"
                            >
                              <BarChart2 size={10} /> {t('placements.viewResult')}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-hairline flex items-center justify-between gap-3">
            <span className="text-xs text-muted tabular-nums shrink-0">
              {t('placements.paginationLabel', { total: total.toLocaleString(numberLocale()), page, totalPages })}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-hairline text-muted hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <ChevronLeft size={13} />
              </button>
              {(() => {
                const pages: (number | '…')[] = [];
                if (totalPages <= 7) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (page > 3) pages.push('…');
                  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                  if (page < totalPages - 2) pages.push('…');
                  pages.push(totalPages);
                }
                return pages.map((p, i) =>
                  p === '…' ? (
                    <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-all active:scale-95 ${
                        page === p
                          ? 'bg-accent text-white shadow-sm'
                          : 'border border-hairline text-muted hover:text-ink hover:border-ink/30'
                      }`}
                    >
                      {p}
                    </button>
                  )
                );
              })()}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-hairline text-muted hover:text-ink hover:border-ink/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {perfPlacement && (
      <PerformanceModal
        placement={perfPlacement}
        onClose={() => setPerfPlacement(null)}
        onSaved={() => { setPerfPlacement(null); load(); }}
      />
    )}
    {metricsPlacement && (
      <MetricsViewModal
        placement={metricsPlacement}
        onClose={() => setMetricsPlacement(null)}
      />
    )}
    </>
  );
}
