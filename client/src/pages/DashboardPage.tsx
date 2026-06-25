import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, TrendingUp, Wallet, Megaphone, ListChecks, ShoppingCart, Gauge, X, Trophy, Search, Scale, Download } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  type TooltipContentProps,
} from 'recharts';
import { useAuth } from '../context/AuthContext.js';
import {
  getDashboardOverview, getDropdowns, searchKols, exportDashboard,
  type DashboardOverview, type DashboardKolRow, type DashboardChannelRow, type Campaign, type Brand, type ContentCategory, type KolResult,
} from '../api/index.js';
import KolTrendModal from '../components/KolTrendModal.js';
import Select from '../components/Select.js';
import Toast from '../components/Toast.js';
import { getCached, setCached } from '../lib/swrCache.js';
import { numberLocale } from '../i18n/locale.js';

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
  return '฿' + Math.round(n).toLocaleString(numberLocale());
}

function formatAxisMoney(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

const TOOLTIP_TOP_N = 5;
const BAND_TOLERANCE = 0.2;

// Generic "type a value, see KOLs who were near it, and what GMV they
// delivered" card — same shape for price and follower-count benchmarking,
// just a different accessor/formatter on the same kolValueList.
function MetricBenchmarkCard({
  title, description, unitSuffix, placeholder, step, kolValueList, getValue, formatValue, onSelectKol,
}: {
  title: string;
  description: (tolerancePercent: number) => string;
  unitSuffix: string;
  placeholder: string;
  step: number;
  kolValueList: DashboardKolRow[];
  getValue: (k: DashboardKolRow) => number | null;
  formatValue: (v: number) => string;
  onSelectKol: (kolId: number) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const value = Number(input);
  const tolerancePercent = Math.round(BAND_TOLERANCE * 100);

  const bandKols = value > 0
    ? kolValueList
        .map(k => ({ ...k, metricValue: getValue(k) }))
        .filter((k): k is typeof k & { metricValue: number } => k.metricValue != null && k.metricValue > 0)
        .filter(k => k.metricValue >= value * (1 - BAND_TOLERANCE) && k.metricValue <= value * (1 + BAND_TOLERANCE))
        .sort((a, b) => b.total_gmv - a.total_gmv)
    : [];
  const bandAvgGmv = bandKols.length > 0
    ? bandKols.reduce((sum, k) => sum + k.total_gmv, 0) / bandKols.length
    : null;

  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5 mb-1">
        <Scale size={14} className="text-accent" /> {title}
      </h2>
      <p className="text-[11px] text-muted mb-3">{description(tolerancePercent)}</p>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted shrink-0">{t('dashboard.compareValueLabel')}</span>
        <div className="relative">
          <input
            type="number" min="0" step={step}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={placeholder}
            className="w-40 pl-3 pr-16 py-1.5 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">{unitSuffix}</span>
        </div>
      </div>

      {value <= 0 ? (
        <p className="text-sm text-muted">{t('dashboard.enterValueHint')}</p>
      ) : bandKols.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noKolNear', { value: formatValue(value), pct: tolerancePercent })}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-2 px-1">
            <span className="text-xs text-muted">
              {t('dashboard.foundInRange', { count: bandKols.length, low: formatValue(value * (1 - BAND_TOLERANCE)), high: formatValue(value * (1 + BAND_TOLERANCE)) })}
            </span>
            <span className="text-xs text-ink font-semibold shrink-0">{t('dashboard.avgGmvInRange')} <span className="font-mono">{formatMoney(bandAvgGmv ?? 0)}</span></span>
          </div>
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
            {bandKols.map((k, i) => (
              <div
                key={k.kol_id}
                onClick={() => onSelectKol(k.kol_id)}
                className="flex items-center gap-3 py-2 px-2 rounded-lg cursor-pointer hover:bg-canvas transition-colors"
              >
                <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{i + 1}</span>
                <RankAvatar handle={k.handle} avatarUrl={k.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink truncate">{k.handle}</div>
                  {k.gen_name && <div className="text-[11px] text-muted truncate">{k.gen_name}</div>}
                </div>
                <span className="text-xs text-muted tabular-nums shrink-0">{formatValue(k.metricValue)}</span>
                <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{formatMoney(k.total_gmv)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Generic "compare an average value across a few fixed groups" card —
// shared shape for barter-vs-paid and follower-tier comparisons (both are
// "which group of GMV.metricValue is biggest" not a "type a value" lookup
// like MetricBenchmarkCard above).
function GroupCompareCard({
  title, description, rows, formatValue,
}: {
  title: string;
  description: string;
  rows: { label: string; value: number; countLabel: string }[];
  formatValue: (v: number) => string;
}) {
  const { t } = useTranslation();
  const maxValue = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5 mb-1">
        <Scale size={14} className="text-accent" /> {title}
      </h2>
      <p className="text-[11px] text-muted mb-4">{description}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(r => (
            <div key={r.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{r.label}</span>
                <span className="text-sm font-semibold text-ink font-mono">{formatValue(r.value)}</span>
              </div>
              <div className="h-2 rounded-full bg-canvas overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / maxValue) * 100}%` }} />
              </div>
              <span className="text-[11px] text-muted">{r.countLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelTooltip({ active, payload }: TooltipContentProps) {
  const { t } = useTranslation();
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
        <div className="text-muted py-0.5">{t('dashboard.noCampaignData')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(c => {
            const pct = row.gmv > 0 ? (c.gmv / row.gmv) * 100 : 0;
            return (
              <div key={c.campaign_id ?? 'none'} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink truncate">{c.code ?? t('kolTrend.noCampaign')}</span>
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
              <span>{t('dashboard.moreCampaigns', { count: rest.length })}</span>
              <span className="tabular-nums">{formatMoney(restTotal)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KolRankRow({ k, rank, mode, onSelect }: { k: DashboardKolRow; rank: number; mode: 'gmv' | 'roi'; onSelect: (kolId: number) => void }) {
  const { t } = useTranslation();
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
      title={t('dashboard.clickToViewTrend')}
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
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!query) { setResults([]); return; }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchKols(query);
        if (searchSeq.current !== seq) return; // a newer keystroke already started a fetch
        setResults(r);
      } finally {
        if (searchSeq.current === seq) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
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
        placeholder={t('dashboard.searchOtherKol')}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-60 pl-7 pr-3 py-1.5 rounded-lg text-xs bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors"
      />
      {open && query && (
        <div className="absolute z-30 right-0 w-72 mt-1.5 bg-surface border border-hairline rounded-xl shadow-xl max-h-64 overflow-y-auto">
          {loading && <div className="px-3 py-3 text-sm text-muted">{t('kolPicker.searching')}</div>}
          {!loading && results.length === 0 && <div className="px-3 py-3 text-sm text-muted">{t('kolPicker.noResults')}</div>}
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
  const { t } = useTranslation();
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
  const [trendKolId, setTrendKolId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'tools'>('overview');

  async function handleExport() {
    setExporting(true); setExportError('');
    try {
      await exportDashboard({ brand_id: brandId, campaign_id: campaignId, category_id: categoryId, date_from: dateFrom, date_to: dateTo });
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : t('download.failed'));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    getDropdowns().then(d => { setCampaigns(d.campaigns); setBrands(d.brands); setCategories(d.contentCategories); });
  }, []);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
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
      if (loadSeq.current !== seq) return;
      setCached(cacheKey, res);
      setData(res);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [brandId, campaignId, categoryId, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const rankedKols = data ? (rankMode === 'gmv' ? data.topKolsByGmv : data.topKolsByRoi) : [];
  const campaignTrendData = data
    ? data.campaignTrend.map(c => ({ ...c, name: c.code ?? t('kolTrend.noCampaign') }))
    : [];

  return (
    <div className="px-6 py-6 max-w-screen-xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted mt-0.5">{t('dashboard.subtitle')}{appUser?.role === 'manager' ? ' (manager view)' : ''}</p>
          </div>

          <button
            onClick={handleExport}
            disabled={exporting || loading || !data}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#217346] text-white text-xs font-medium rounded-full hover:bg-[#1a5c38] active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all whitespace-nowrap shadow-sm"
          >
            <Download size={12} /> {exporting ? t('common.loading') : 'Export Excel'}
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select
            size="sm" className="min-w-[140px]"
            options={[{ id: '', label: t('common.allBrands') }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
            value={brandId}
            onChange={setBrandId}
          />
          <Select
            size="sm" className="min-w-[180px]"
            options={[{ id: '', label: t('placements.allCampaigns') }, ...campaigns.map(c => ({ id: c.id, label: `${c.code}${c.label ? ` — ${c.label}` : ''}` }))]}
            value={campaignId}
            onChange={setCampaignId}
          />
          <Select
            size="sm" className="min-w-[160px]"
            options={[{ id: '', label: t('dashboard.allCategories') }, ...categories.map(cat => ({ id: cat.id, label: cat.name }))]}
            value={categoryId}
            onChange={setCategoryId}
          />

          <div className="w-px h-4 bg-hairline shrink-0" />

          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} className={selectCls} />
          <span className="text-xs text-muted">{t('dashboard.to')}</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} className={selectCls} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
              <X size={11} /> {t('dashboard.clearDate')}
            </button>
          )}
        </div>
      </div>

      {exportError && <Toast message={exportError} onClose={() => setExportError('')} />}

      <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 mb-6 w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {t('dashboard.tabOverview')}
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'tools' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {t('dashboard.tabTools')}
        </button>
      </div>

      {loading || !data ? (
        activeTab === 'overview' ? (
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
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <SkeletonChart />
            <SkeletonChart />
            <SkeletonChart />
            <SkeletonChart />
          </div>
        )
      ) : activeTab === 'overview' ? (
        <div className="flex flex-col gap-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard icon={<TrendingUp size={13} />} label={t('dashboard.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
            <KpiCard icon={<Wallet size={13} />} label={t('dashboard.kolSpend')} value={formatMoney(data.summary.total_spend)} />
            <KpiCard icon={<Megaphone size={13} />} label="Ads Cost" value={formatMoney(data.summary.total_ads_cost)} />
            <KpiCard
              icon={<Gauge size={13} />}
              label={t('dashboard.totalRoi')}
              value={data.summary.roi != null ? `x${data.summary.roi.toFixed(2)}` : '—'}
            />
            <KpiCard
              icon={<ListChecks size={13} />}
              label={t('dashboard.totalPlacements')}
              value={data.summary.total_placements.toLocaleString(numberLocale())}
              sub={t('dashboard.placementsSub', { posted: data.summary.posted_count, planned: data.summary.planned_count, cancelled: data.summary.cancelled_count })}
            />
            <KpiCard icon={<ShoppingCart size={13} />} label={t('dashboard.totalOrders')} value={data.summary.total_orders.toLocaleString(numberLocale())} />
          </div>

          {/* Channel breakdown + campaign trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-surface border border-hairline rounded-xl p-5">
              <h2 className="text-sm font-semibold text-ink mb-4">{t('dashboard.gmvByChannel')}</h2>
              {data.channelBreakdown.length === 0 ? (
                <p className="text-sm text-muted">{t('dashboard.noGmvData')}</p>
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
                        <span className="w-20 text-right text-muted tabular-nums font-mono shrink-0">{c.orders.toLocaleString(numberLocale())} orders</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-surface border border-hairline rounded-xl p-5">
              <h2 className="text-sm font-semibold text-ink mb-4">{t('dashboard.gmvVsSpendByCampaign')}</h2>
              {campaignTrendData.length === 0 ? (
                <p className="text-sm text-muted">{t('dashboard.noData')}</p>
              ) : (
                <ResponsiveContainer width="100%" height={224}>
                  <BarChart data={campaignTrendData} margin={{ left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                      labelStyle={{ color: 'var(--ink)' }}
                      formatter={(v, n) => [formatMoney(Number(v ?? 0)), n === 'gmv' ? t('kolTrend.gmv') : t('kolTrend.spend')]}
                    />
                    <Legend formatter={(v: string) => (v === 'gmv' ? t('kolTrend.gmv') : t('kolTrend.spend'))} wrapperStyle={{ fontSize: 11 }} />
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
                <Trophy size={14} className="text-accent" /> {t('dashboard.rankingTitle')}
                {categoryId && (
                  <span className="text-xs font-normal text-muted">
                    {t('dashboard.compareWithinCategory', { category: categories.find(c => String(c.id) === categoryId)?.name ?? '' })}
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
                    {t('dashboard.byGmv')}
                  </button>
                  <button
                    onClick={() => setRankMode('roi')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${rankMode === 'roi' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                  >
                    {t('dashboard.byRoi')}
                  </button>
                </div>
              </div>
            </div>
            {rankMode === 'roi' && (
              <p className="text-[11px] text-muted mb-3">{t('dashboard.roiExplain')}</p>
            )}
            {rankedKols.length === 0 ? (
              <p className="text-sm text-muted">{rankMode === 'roi' ? t('dashboard.noDataRoi') : t('dashboard.noDataGmv')}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {rankedKols.map((k, i) => (
                  <KolRankRow key={k.kol_id} k={k} rank={i + 1} mode={rankMode} onSelect={setTrendKolId} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <MetricBenchmarkCard
            title={t('dashboard.priceBenchmarkTitle')}
            description={pct => t('dashboard.priceBenchmarkDesc', { pct })}
            unitSuffix={t('common.currency')}
            placeholder={t('dashboard.priceBenchmarkPlaceholder')}
            step={1000}
            kolValueList={data.kolValueList}
            getValue={k => (k.placement_count > 0 && k.total_spend > 0) ? k.total_spend / k.placement_count : null}
            formatValue={formatMoney}
            onSelectKol={setTrendKolId}
          />

          <MetricBenchmarkCard
            title={t('dashboard.followerBenchmarkTitle')}
            description={pct => t('dashboard.followerBenchmarkDesc', { pct })}
            unitSuffix="Followers"
            placeholder={t('dashboard.followerBenchmarkPlaceholder')}
            step={1000}
            kolValueList={data.kolValueList}
            getValue={k => k.follower_count}
            formatValue={v => Math.round(v).toLocaleString(numberLocale())}
            onSelectKol={setTrendKolId}
          />

          <GroupCompareCard
            title={t('dashboard.paymentCompareTitle')}
            description={t('dashboard.paymentCompareDesc')}
            formatValue={formatMoney}
            rows={data.paymentTypeBreakdown.map(r => ({
              label: t(`payment.${r.payment_type}`, { defaultValue: r.payment_type }),
              value: r.avg_gmv,
              countLabel: t('dashboard.placementCountLabel', { count: r.placement_count }),
            }))}
          />

          <GroupCompareCard
            title={t('dashboard.tierCompareTitle')}
            description={t('dashboard.tierCompareDesc')}
            formatValue={formatMoney}
            rows={data.tierBreakdown.map(r => ({
              label: r.tier_name,
              value: r.avg_gmv_per_kol,
              countLabel: t('dashboard.kolCountLabel', { count: r.kol_count }),
            }))}
          />
        </div>
      )}

      {trendKolId != null && (
        <KolTrendModal kolId={trendKolId} brandId={brandId || undefined} onClose={() => setTrendKolId(null)} />
      )}
    </div>
  );
}
