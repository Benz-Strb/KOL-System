import { useState, useEffect, useCallback, useRef } from 'react';
import { ExternalLink, TrendingUp, Wallet, Megaphone, ListChecks, ShoppingCart, Gauge, X, Trophy, Search, Scale } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  type TooltipContentProps,
} from 'recharts';
import { useAuth } from '../context/AuthContext.js';
import {
  getDashboardOverview, getDropdowns, searchKols,
  type DashboardOverview, type DashboardKolRow, type DashboardChannelRow, type Campaign, type Brand, type ContentCategory, type KolResult,
} from '../api/index.js';
import KolTrendModal from '../components/KolTrendModal.js';
import Select from '../components/Select.js';
import { getCached, setCached } from '../lib/swrCache.js';

const HOVER_EXPAND_DELAY = 400;

const CHANNEL_LABEL: Record<string, string> = {
  shopee: 'Shopee',
  lazada: 'Lazada',
  website: 'Website',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  lamon8: 'Lemon8',
};

const CHANNEL_COLOR: Record<string, string> = {
  shopee: '#f97316',
  lazada: '#3b82f6',
  website: '#8b5cf6',
  tiktok: '#111827',
  youtube: '#ef4444',
  lamon8: '#10b981',
};
const FALLBACK_COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#111827', '#ef4444', '#10b981', '#eab308', '#ec4899'];

const AVATAR_COLORS = [
  ['bg-rose-500', 'text-white'], ['bg-orange-500', 'text-white'], ['bg-amber-500', 'text-white'],
  ['bg-emerald-500', 'text-white'], ['bg-teal-500', 'text-white'], ['bg-cyan-500', 'text-white'],
  ['bg-blue-500', 'text-white'], ['bg-indigo-500', 'text-white'], ['bg-violet-500', 'text-white'], ['bg-pink-500', 'text-white'],
];
function getAvatarColor(handle: string) {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) hash = (hash * 31 + handle.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function RankAvatar({ handle, avatarUrl }: { handle: string; avatarUrl: string | null }) {
  const [errored, setErrored] = useState(false);
  const initial = handle.replace(/^[@.]/, '').slice(0, 1).toUpperCase() || '?';
  const [bg, fg] = getAvatarColor(handle);
  if (avatarUrl && !errored) {
    return <img src={avatarUrl} alt={handle} onError={() => setErrored(true)} className="w-8 h-8 rounded-lg object-cover shrink-0 bg-canvas" />;
  }
  return <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold shrink-0 ${bg} ${fg}`}>{initial}</span>;
}

function formatMoney(n: number) {
  return '฿' + Math.round(n).toLocaleString('th-TH');
}

function formatAxisMoney(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

const TOOLTIP_TOP_N = 5;
const PRICE_BAND_TOLERANCE = 0.2;

function ChannelTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as DashboardChannelRow | undefined;
  if (!row) return null;
  const color = CHANNEL_COLOR[row.channel] ?? '#94a3b8';
  const campaigns = [...row.byCampaign].sort((a, b) => b.gmv - a.gmv);
  const visible = campaigns.slice(0, TOOLTIP_TOP_N);
  const rest = campaigns.slice(TOOLTIP_TOP_N);
  const restTotal = rest.reduce((sum, c) => sum + c.gmv, 0);

  return (
    <div className="bg-surface border border-hairline rounded-xl shadow-lg px-3.5 py-3 text-xs min-w-[210px] max-w-[260px]">
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-hairline">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="font-semibold text-ink text-sm">{CHANNEL_LABEL[row.channel] ?? row.channel}</span>
        <span className="ml-auto font-semibold text-ink tabular-nums">{formatMoney(row.gmv)}</span>
      </div>
      {campaigns.length === 0 ? (
        <div className="text-muted py-0.5">ไม่มีข้อมูลแคมเปญ</div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(c => {
            const pct = row.gmv > 0 ? (c.gmv / row.gmv) * 100 : 0;
            return (
              <div key={c.campaign_id ?? 'none'} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink truncate">{c.code ?? 'ไม่มีแคมเปญ'}</span>
                  <span className="text-muted tabular-nums shrink-0">{formatMoney(c.gmv)}</span>
                </div>
                <div className="h-1 rounded-full bg-canvas overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
          {rest.length > 0 && (
            <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-hairline text-muted">
              <span>อีก {rest.length} แคมเปญ</span>
              <span className="tabular-nums">{formatMoney(restTotal)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KolRankRow({ k, rank, mode, onSelect }: { k: DashboardKolRow; rank: number; mode: 'gmv' | 'roi'; onSelect: (kolId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleEnter = () => {
    timer.current = setTimeout(() => setExpanded(true), HOVER_EXPAND_DELAY);
  };
  const handleLeave = () => {
    clearTimeout(timer.current);
    setExpanded(false);
  };

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={() => onSelect(k.kol_id)}
      title="คลิกเพื่อดูเทรนด์ผลงานของ KOL คนนี้"
      className={`rounded-lg border transition-all duration-200 cursor-pointer ${
        expanded
          ? 'relative z-20 scale-[1.05] shadow-xl bg-surface border-accent/40'
          : 'border-transparent hover:bg-canvas'
      }`}
    >
      <div className="flex items-center gap-3 py-2 px-2">
        <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{rank}</span>
        <RankAvatar handle={k.handle} avatarUrl={k.avatar_url} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate">{k.handle}</div>
          {k.gen_name && <div className="text-[11px] text-muted truncate">{k.gen_name}</div>}
        </div>
        <span className="text-xs text-muted tabular-nums font-mono shrink-0">{k.placement_count} placement</span>
        {mode === 'roi' && (
          <span className="text-xs font-semibold text-emerald-600 tabular-nums font-mono w-16 text-right shrink-0">
            {k.roi != null ? `x${k.roi.toFixed(2)}` : '—'}
          </span>
        )}
        <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{formatMoney(k.total_gmv)}</span>
        {k.profile_url && (
          <a href={k.profile_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-canvas transition-colors shrink-0">
            <ExternalLink size={11} />
          </a>
        )}
      </div>
      {expanded && k.byChannel.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-2 -mt-0.5 pl-[44px]">
          {k.byChannel.map(c => (
            <span key={c.channel} className="inline-flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-canvas text-muted">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CHANNEL_COLOR[c.channel] ?? '#94a3b8' }} />
              {CHANNEL_LABEL[c.channel] ?? c.channel} · {formatMoney(c.gmv)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function KolSearchBox({ onSelect }: { onSelect: (kolId: number) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!query) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try { setResults(await searchKols(query)); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function select(kol: KolResult) {
    onSelect(kol.id);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        type="text"
        placeholder="ค้นหา KOL คนอื่น (ไม่ติด Top 10)..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-60 pl-7 pr-3 py-1.5 rounded-lg text-xs bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors"
      />
      {open && query && (
        <div className="absolute z-30 right-0 w-72 mt-1.5 bg-surface border border-hairline rounded-xl shadow-xl max-h-64 overflow-y-auto">
          {loading && <div className="px-3 py-3 text-sm text-muted">กำลังค้นหา...</div>}
          {!loading && results.length === 0 && <div className="px-3 py-3 text-sm text-muted">ไม่พบ KOL</div>}
          {!loading && results.map(kol => (
            <button
              key={kol.id}
              type="button"
              onClick={() => select(kol)}
              className="w-full text-left px-3 py-2.5 hover:bg-canvas border-b border-hairline last:border-0 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-ink text-sm">{kol.handle}</span>
                  {kol.gen_name && <span className="text-xs text-muted ml-1.5">{kol.gen_name}</span>}
                </div>
                {kol.follower_count != null && (
                  <span className="text-xs text-muted tabular-nums shrink-0">{kol.follower_count.toLocaleString()}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const selectCls = [
  'px-3 py-1.5 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/40',
].join(' ');

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-hairline rounded-xl p-4 flex flex-col gap-2 hover:border-accent/30 transition-colors duration-200">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-accent/10 text-accent shrink-0">
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      </div>
      <div className="text-xl font-bold text-ink tabular-nums font-mono leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function SkeletonKpiCard() {
  return (
    <div className="bg-surface border border-hairline rounded-xl p-4 flex flex-col gap-2 animate-pulse">
      <div className="h-2.5 bg-canvas rounded-md w-2/3" />
      <div className="h-5 bg-canvas rounded-md w-1/2" />
      <div className="h-2 bg-canvas rounded-md w-3/4" />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="h-3.5 bg-canvas rounded-md w-40 mb-4 animate-pulse" />
      <div className="h-56 bg-canvas rounded-xl animate-pulse" />
    </div>
  );
}

function SkeletonKolRow() {
  return (
    <div className="flex items-center gap-3 py-2 px-2 animate-pulse">
      <div className="w-5 h-3 bg-canvas rounded-md shrink-0" />
      <div className="w-8 h-8 rounded-lg bg-canvas shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 bg-canvas rounded-md w-1/3" />
        <div className="h-2.5 bg-canvas rounded-md w-1/4" />
      </div>
      <div className="w-16 h-3 bg-canvas rounded-md shrink-0" />
      <div className="w-28 h-3.5 bg-canvas rounded-md shrink-0" />
      <div className="w-6 h-6 rounded-md bg-canvas shrink-0" />
    </div>
  );
}

export default function DashboardPage() {
  const { appUser } = useAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rankMode, setRankMode] = useState<'gmv' | 'roi'>('gmv');
  const [priceInput, setPriceInput] = useState('');
  const [trendKolId, setTrendKolId] = useState<number | null>(null);

  useEffect(() => {
    getDropdowns().then(d => { setCampaigns(d.campaigns); setBrands(d.brands); setCategories(d.contentCategories); });
  }, []);

  const load = useCallback(async () => {
    const params = { brand_id: brandId, campaign_id: campaignId, category_id: categoryId, date_from: dateFrom, date_to: dateTo };
    const cacheKey = `dashboard:${JSON.stringify(params)}`;
    const cached = getCached<DashboardOverview>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await getDashboardOverview(params);
      setCached(cacheKey, res);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [brandId, campaignId, categoryId, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const rankedKols = data ? (rankMode === 'gmv' ? data.topKolsByGmv : data.topKolsByRoi) : [];
  const campaignTrendData = data
    ? data.campaignTrend.map(c => ({ ...c, name: c.code ?? 'ไม่มีแคมเปญ' }))
    : [];

  const priceValue = Number(priceInput);
  const priceBandKols = data && priceValue > 0
    ? data.kolValueList
        .filter(k => k.placement_count > 0 && k.total_spend > 0)
        .map(k => ({ ...k, avgPrice: k.total_spend / k.placement_count }))
        .filter(k => k.avgPrice >= priceValue * (1 - PRICE_BAND_TOLERANCE) && k.avgPrice <= priceValue * (1 + PRICE_BAND_TOLERANCE))
        .sort((a, b) => b.total_gmv - a.total_gmv)
    : [];
  const priceBandAvgGmv = priceBandKols.length > 0
    ? priceBandKols.reduce((sum, k) => sum + k.total_gmv, 0) / priceBandKols.length
    : null;

  return (
    <div className="px-6 py-6 max-w-screen-xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">สรุปผลงาน KOL{appUser?.role === 'manager' ? ' (manager view)' : ''}</p>
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonKpiCard key={i} />)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkeletonChart />
            <SkeletonChart />
          </div>

          <div className="bg-surface border border-hairline rounded-xl p-5">
            <div className="h-3.5 bg-canvas rounded-md w-52 mb-4 animate-pulse" />
            <div className="flex flex-col gap-1">
              {Array.from({ length: 10 }).map((_, i) => <SkeletonKolRow key={i} />)}
            </div>
          </div>

          <SkeletonChart />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard icon={<TrendingUp size={13} />} label="GMV รวม" value={formatMoney(data.summary.total_gmv)} />
            <KpiCard icon={<Wallet size={13} />} label="ค่าใช้จ่าย KOL" value={formatMoney(data.summary.total_spend)} />
            <KpiCard icon={<Megaphone size={13} />} label="Ads Cost" value={formatMoney(data.summary.total_ads_cost)} />
            <KpiCard
              icon={<Gauge size={13} />}
              label="ROI รวม (รวม Ads Cost)"
              value={data.summary.roi != null ? `x${data.summary.roi.toFixed(2)}` : '—'}
            />
            <KpiCard
              icon={<ListChecks size={13} />}
              label="Placement ทั้งหมด"
              value={data.summary.total_placements.toLocaleString('th-TH')}
              sub={`โพสต์แล้ว ${data.summary.posted_count} · วางแผน ${data.summary.planned_count} · ยกเลิก ${data.summary.cancelled_count}`}
            />
            <KpiCard icon={<ShoppingCart size={13} />} label="Orders รวม" value={data.summary.total_orders.toLocaleString('th-TH')} />
          </div>

          {/* Channel breakdown + campaign trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-surface border border-hairline rounded-xl p-5">
              <h2 className="text-sm font-semibold text-ink mb-4">GMV แยกตามช่องทาง</h2>
              {data.channelBreakdown.length === 0 ? (
                <p className="text-sm text-muted">ยังไม่มีข้อมูล GMV</p>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-44 h-44 shrink-0">
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 176, height: 176 }}>
                      <PieChart>
                        <Pie
                          data={data.channelBreakdown}
                          dataKey="gmv"
                          nameKey="channel"
                          innerRadius="60%"
                          outerRadius="95%"
                          paddingAngle={2}
                          stroke="none"
                          animationDuration={500}
                        >
                          {data.channelBreakdown.map((c, i) => (
                            <Cell key={c.channel} fill={CHANNEL_COLOR[c.channel] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={ChannelTooltip} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    {data.channelBreakdown.map((c, i) => (
                      <div key={c.channel} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHANNEL_COLOR[c.channel] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
                        <span className="font-medium text-ink shrink-0 w-16 truncate">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                        <span className="flex-1 text-right text-ink tabular-nums font-mono">{formatMoney(c.gmv)}</span>
                        <span className="w-20 text-right text-muted tabular-nums font-mono shrink-0">{c.orders.toLocaleString('th-TH')} orders</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-surface border border-hairline rounded-xl p-5">
              <h2 className="text-sm font-semibold text-ink mb-4">GMV vs ค่าใช้จ่าย ต่อแคมเปญ</h2>
              {campaignTrendData.length === 0 ? (
                <p className="text-sm text-muted">ยังไม่มีข้อมูล</p>
              ) : (
                <ResponsiveContainer width="100%" height={224}>
                  <BarChart data={campaignTrendData} margin={{ left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                      labelStyle={{ color: 'var(--ink)' }}
                      formatter={(v, n) => [formatMoney(Number(v ?? 0)), n === 'gmv' ? 'GMV' : 'ค่าใช้จ่าย']}
                    />
                    <Legend formatter={(v: string) => (v === 'gmv' ? 'GMV' : 'ค่าใช้จ่าย')} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="gmv" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={500} />
                    <Bar dataKey="spend" fill="#f97316" radius={[4, 4, 0, 0]} animationDuration={500} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Top KOL ranking */}
          <div className="bg-surface border border-hairline rounded-xl p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                <Trophy size={14} className="text-accent" /> Ranking KOL (Top 10)
                {categoryId && (
                  <span className="text-xs font-normal text-muted">
                    — เทียบเฉพาะหมวด {categories.find(c => String(c.id) === categoryId)?.name ?? ''}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <KolSearchBox onSelect={setTrendKolId} />
                <div className="flex items-center gap-1 bg-canvas rounded-lg p-1">
                  <button
                    onClick={() => setRankMode('gmv')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${rankMode === 'gmv' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                  >
                    ตาม GMV
                  </button>
                  <button
                    onClick={() => setRankMode('roi')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${rankMode === 'roi' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                  >
                    ตาม ROI
                  </button>
                </div>
              </div>
            </div>
            {rankMode === 'roi' && (
              <p className="text-[11px] text-muted mb-3">ROI = GMV ÷ ค่าใช้จ่าย KOL (ไม่รวม Ads Cost) — เรียงเฉพาะ KOL ที่มีค่าใช้จ่ายบันทึกไว้ ใช้ดูว่าใครคุ้มจ้างต่อมากที่สุด</p>
            )}
            {rankedKols.length === 0 ? (
              <p className="text-sm text-muted">ยังไม่มีข้อมูล{rankMode === 'roi' ? ' (ต้องมีค่าใช้จ่ายบันทึกไว้)' : 'GMV'}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {rankedKols.map((k, i) => (
                  <KolRankRow key={k.kol_id} k={k} rank={i + 1} mode={rankMode} onSelect={setTrendKolId} />
                ))}
              </div>
            )}
          </div>

          {/* Price benchmark — compare a hypothetical rate against KOLs who actually got paid near it */}
          <div className="bg-surface border border-hairline rounded-xl p-5">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5 mb-1">
              <Scale size={14} className="text-accent" /> เทียบเรทราคากับ GMV ที่เคยทำได้
            </h2>
            <p className="text-[11px] text-muted mb-3">
              กรอกราคาที่จะจ้าง ระบบจะหา KOL ที่เคยได้ราคาใกล้เคียงกัน (±{Math.round(PRICE_BAND_TOLERANCE * 100)}%) แล้วโชว์ GMV ที่ทำได้จริง ใช้ประเมินก่อนต่อรอง/จ้างจริง
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-muted shrink-0">ราคาที่จะจ้าง</span>
              <div className="relative">
                <input
                  type="number" min="0" step="1000"
                  value={priceInput}
                  onChange={e => setPriceInput(e.target.value)}
                  placeholder="เช่น 30000"
                  className="w-40 pl-3 pr-10 py-1.5 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">บาท</span>
              </div>
            </div>

            {priceValue <= 0 ? (
              <p className="text-sm text-muted">กรอกราคาด้านบนเพื่อเทียบกับ KOL ที่เคยได้ราคาใกล้เคียงกัน</p>
            ) : priceBandKols.length === 0 ? (
              <p className="text-sm text-muted">ไม่พบ KOL ที่เคยได้ราคาใกล้เคียง ฿{priceValue.toLocaleString('th-TH')} (±{Math.round(PRICE_BAND_TOLERANCE * 100)}%)</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 mb-2 px-1">
                  <span className="text-xs text-muted">
                    พบ {priceBandKols.length} คน ในช่วงราคา ฿{Math.round(priceValue * (1 - PRICE_BAND_TOLERANCE)).toLocaleString('th-TH')}–฿{Math.round(priceValue * (1 + PRICE_BAND_TOLERANCE)).toLocaleString('th-TH')}
                  </span>
                  <span className="text-xs text-ink font-semibold shrink-0">เฉลี่ย GMV ช่วงนี้: <span className="font-mono">{formatMoney(priceBandAvgGmv ?? 0)}</span></span>
                </div>
                <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
                  {priceBandKols.map((k, i) => (
                    <div
                      key={k.kol_id}
                      onClick={() => setTrendKolId(k.kol_id)}
                      className="flex items-center gap-3 py-2 px-2 rounded-lg cursor-pointer hover:bg-canvas transition-colors"
                    >
                      <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{i + 1}</span>
                      <RankAvatar handle={k.handle} avatarUrl={k.avatar_url} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink truncate">{k.handle}</div>
                        {k.gen_name && <div className="text-[11px] text-muted truncate">{k.gen_name}</div>}
                      </div>
                      <span className="text-xs text-muted tabular-nums shrink-0">ราคาเฉลี่ย <span className="font-mono">{formatMoney(k.avgPrice)}</span></span>
                      <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{formatMoney(k.total_gmv)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {trendKolId != null && (
        <KolTrendModal kolId={trendKolId} brandId={brandId || undefined} onClose={() => setTrendKolId(null)} />
      )}
    </div>
  );
}
