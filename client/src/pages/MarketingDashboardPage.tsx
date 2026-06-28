import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Wallet, Megaphone, Coins, MousePointerClick } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { getMarketingDashboard, getDropdowns, type MarketingDashboard, type Brand } from '../api/index.js';
import Select from '../components/Select.js';
import { getCached, setCached } from '../lib/swrCache.js';
import { numberLocale } from '../i18n/locale.js';

const DONUT_COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#111827', '#ef4444', '#10b981', '#eab308', '#ec4899', '#06b6d4'];

function formatMoney(n: number) { return '฿' + Math.round(n).toLocaleString(numberLocale()); }

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-hairline rounded-xl p-4 flex flex-col gap-2 hover:border-accent/30 transition-colors duration-200">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-accent/10 text-accent shrink-0">{icon}</span>
        <span className="text-[11px] font-medium text-muted leading-tight">{label}</span>
      </div>
      <div className="text-2xl font-bold text-ink tabular-nums font-mono leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function ContributionDonut({ title, rows }: { title: string; rows: { key: string; label: string; gmv: number }[] }) {
  const { t } = useTranslation();
  const data = rows.filter(r => r.gmv > 0);
  const total = data.reduce((s, r) => s + r.gmv, 0);
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <h2 className="text-sm font-semibold text-ink mb-4">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          <div className="w-40 h-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 160 }}>
              <PieChart>
                <Pie data={data} dataKey="gmv" nameKey="label" innerRadius="60%" outerRadius="95%" paddingAngle={2} stroke="none" animationDuration={500}>
                  {data.map((r, i) => <Cell key={r.key} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                  formatter={(v, n) => [formatMoney(Number(v ?? 0)), String(n)]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
            {data.map((r, i) => {
              const pct = total > 0 ? ((r.gmv / total) * 100).toFixed(1) : '0.0';
              return (
                <div key={r.key} className="flex items-center gap-2.5 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="font-medium text-ink truncate flex-1 min-w-0">{r.label}</span>
                  <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                  <span className="w-12 text-right text-muted tabular-nums shrink-0">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const selectCls = ['px-3 py-1.5 rounded-lg text-sm transition-colors', 'bg-input-bg border border-input-border text-ink',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/40'].join(' ');

export default function MarketingDashboardPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<MarketingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => { getDropdowns().then(d => setBrands(d.brands)); }, []);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = { brand_id: brandId, date_from: dateFrom, date_to: dateTo };
    const cacheKey = `marketing:${JSON.stringify(params)}`;
    const cached = getCached<MarketingDashboard>(cacheKey);
    if (cached) { setData(cached); setLoading(false); } else { setLoading(true); }
    try {
      const res = await getMarketingDashboard(params);
      if (loadSeq.current !== seq) return;
      setCached(cacheKey, res); setData(res);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [brandId, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const skuLabel = (canonical_id: number, model_code: string | null) =>
    canonical_id === -1 ? t('dashboard.othersLabel') : (model_code ?? '—');

  const platformRows = useMemo(() => (data?.byPlatform ?? []).map(r => ({ key: `p${r.platform_id}`, label: r.platform_name, gmv: r.gmv })), [data]);
  const productCatRows = useMemo(() => (data?.byProductCategory ?? []).map(r => ({ key: `pc${r.category_id ?? 'none'}`, label: r.category_name ?? t('dashboard.othersLabel'), gmv: r.gmv })), [data, t]);
  const skuRows = useMemo(() => (data?.byProductSku ?? []).map(r => ({ key: `s${r.canonical_id}`, label: skuLabel(r.canonical_id, r.model_code), gmv: r.gmv })), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const contentCatRows = useMemo(() => (data?.byContentCategory ?? []).map(r => ({ key: `cc${r.category_id}`, label: r.category_name, gmv: r.gmv })), [data]);

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-screen-xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink tracking-tight">{t('marketing.title')}</h1>
        <p className="text-sm text-muted mt-0.5">{t('marketing.subtitle')}</p>
      </div>

      {/* Filters */}
      <div className="bg-surface border border-hairline rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Brand</span>
          <Select size="sm" className="min-w-[140px]"
            options={[{ id: '', label: t('common.allBrands') }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
            value={brandId} onChange={setBrandId} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">{t('dashboard.dateRange')}</span>
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} className={selectCls} />
            <span className="text-xs text-muted">–</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} className={selectCls} />
          </div>
        </div>
      </div>

      {loading || !data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface border border-hairline rounded-xl p-4 h-[92px] animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface border border-hairline rounded-xl p-5 h-56 animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard icon={<TrendingUp size={13} />} label={t('dashboard.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
            <KpiCard icon={<Coins size={13} />} label={t('marketing.totalCost')} value={formatMoney(data.summary.total_cost)} />
            <KpiCard icon={<Wallet size={13} />} label={t('dashboard.kolSpend')} value={formatMoney(data.summary.kol_cost)} />
            <KpiCard icon={<Megaphone size={13} />} label="Ads Cost" value={formatMoney(data.summary.ads_cost)} />
            <KpiCard icon={<MousePointerClick size={13} />} label={t('dashboard.visitsShopee')} value={data.summary.visits_shopee.toLocaleString(numberLocale())} />
            <KpiCard icon={<MousePointerClick size={13} />} label={t('dashboard.visitsLazada')} value={data.summary.visits_lazada.toLocaleString(numberLocale())} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ContributionDonut title={t('marketing.gmvByPlatform')} rows={platformRows} />
            <ContributionDonut title={t('marketing.gmvByProductCategory')} rows={productCatRows} />
            <ContributionDonut title={t('marketing.gmvByProductSku')} rows={skuRows} />
            <ContributionDonut title={t('marketing.gmvByContentCategory')} rows={contentCatRows} />
          </div>
        </div>
      )}
    </div>
  );
}
