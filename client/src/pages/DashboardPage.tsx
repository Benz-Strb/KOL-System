import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, TrendingUp, Wallet, Megaphone, ListChecks, ShoppingCart, Gauge, X, Trophy, Search, Scale, Download, SlidersHorizontal } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  type TooltipContentProps,
} from 'recharts';
import { useAuth } from '../context/AuthContext.js';
import {
  getDashboardOverview, getDropdowns, searchKols, exportDashboard, getOffplatformTraffic,
  type DashboardOverview, type DashboardKolRow, type DashboardChannelRow, type Campaign, type Brand, type ContentCategory, type KolResult,
  type OffplatformTraffic,
} from '../api/index.js';
import KolTrendModal from '../components/KolTrendModal.js';
import PlatformLogo from '../components/PlatformLogo.js';
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

const OFFPLATFORM_COLORS = ['#3b82f6', '#f97316', '#8b5cf6', '#10b981', '#eab308', '#ef4444'];

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
function KolsByGroupCard({
  title, description, groups, kolMap, onSelectKol,
}: {
  title: string;
  description: string;
  groups: { key: string; label: string; kols: { kol_id: number; placement_count: number; total_gmv: number; total_spend: number }[] }[];
  kolMap: Map<number, DashboardKolRow>;
  onSelectKol: (kolId: number) => void;
}) {
  const { t } = useTranslation();
  const [activeGroup, setActiveGroup] = useState(() => groups[0]?.key ?? '');
  const currentGroup = groups.find(g => g.key === activeGroup);
  const sorted = currentGroup
    ? [...currentGroup.kols].sort((a, b) => b.total_gmv - a.total_gmv)
    : [];

  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
          <Scale size={14} className="text-accent" /> {title}
        </h2>
        <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
          {groups.map(g => (
            <button
              key={g.key}
              onClick={() => setActiveGroup(g.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${activeGroup === g.key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {g.label}
              <span className="ml-1 text-[10px] tabular-nums text-muted">({g.kols.length})</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted mb-3">{description}</p>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <>
          <div className="flex items-center gap-3 px-2 mb-1">
            <span className="w-5 shrink-0" />
            <span className="w-8 shrink-0" />
            <span className="flex-1" />
            <span className="text-[10px] font-medium text-muted uppercase tracking-wide w-20 text-right shrink-0">{t('dashboard.kolSpend')}</span>
            <span className="text-[10px] font-medium text-muted uppercase tracking-wide w-28 text-right shrink-0">GMV</span>
            <span className="w-6 shrink-0" />
          </div>
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
            {sorted.map((entry, i) => {
              const kol = kolMap.get(entry.kol_id);
              return (
                <div
                  key={entry.kol_id}
                  onClick={() => onSelectKol(entry.kol_id)}
                  className="flex items-center gap-3 py-2 px-2 rounded-lg cursor-pointer hover:bg-canvas transition-colors"
                >
                  <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{i + 1}</span>
                  <RankAvatar handle={kol?.handle ?? String(entry.kol_id)} avatarUrl={kol?.avatar_url ?? null} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink truncate">{kol?.handle ?? `KOL #${entry.kol_id}`}</div>
                    {kol?.gen_name && <div className="text-[11px] text-muted truncate">{kol.gen_name}</div>}
                  </div>
                  <span className="text-sm tabular-nums font-mono text-muted w-20 text-right shrink-0">{formatMoney(entry.total_spend)}</span>
                  <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{formatMoney(entry.total_gmv)}</span>
                  <span className="w-6 shrink-0" />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PlatformBreakdownCard({
  rows,
}: {
  rows: { platform_id: number; platform_name: string; placement_count: number; kol_count: number; total_gmv: number }[];
}) {
  const { t } = useTranslation();
  const total = rows.reduce((s, r) => s + r.placement_count, 0);
  const maxCount = Math.max(...rows.map(r => r.placement_count), 1);
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-sm font-semibold text-ink">{t('dashboard.platformBreakdownTitle')}</h2>
        <p className="text-[11px] text-muted">{t('dashboard.platformBreakdownDesc')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-3">
          {rows.map(r => {
            const pct = total > 0 ? (r.placement_count / total) * 100 : 0;
            return (
              <div key={r.platform_id} className="flex items-center gap-2.5">
                <PlatformLogo name={r.platform_name} size={18} />
                <span className="text-sm font-medium text-ink w-24 shrink-0">{r.platform_name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(r.placement_count / maxCount) * 100}%` }} />
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums font-mono w-24 text-right shrink-0">
                  {formatMoney(r.total_gmv)}
                </span>
                <span className="text-[11px] text-muted tabular-nums w-9 text-right shrink-0">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
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
        <span className="text-[11px] font-medium text-muted leading-tight">{label}</span>
      </div>
      <div className="text-2xl font-bold text-ink tabular-nums font-mono leading-tight">{value}</div>
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
  const [offplatformDays, setOffplatformDays] = useState(30);
  const [offplatformData, setOffplatformData] = useState<OffplatformTraffic | null>(null);
  const [offplatformLoading, setOffplatformLoading] = useState(true);

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

  const offplatformSeq = useRef(0);
  const loadOffplatform = useCallback(async () => {
    const seq = ++offplatformSeq.current;
    setOffplatformLoading(true);
    const end = new Date();
    const start = new Date(new Date().setDate(end.getDate() - (offplatformDays - 1)));
    try {
      const res = await getOffplatformTraffic({
        brand_id: brandId,
        date_from: start.toISOString().slice(0, 10),
        date_to: end.toISOString().slice(0, 10),
      });
      if (offplatformSeq.current !== seq) return;
      setOffplatformData(res);
    } finally {
      if (offplatformSeq.current === seq) setOffplatformLoading(false);
    }
  }, [brandId, offplatformDays]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadOffplatform(); }, [loadOffplatform]);

  const offplatformBarData = useMemo(() => {
    if (!offplatformData) return [];
    const dateMap = new Map<string, number>();
    for (const r of offplatformData.dailyTrend) {
      dateMap.set(r.date, (dateMap.get(r.date) ?? 0) + r.revenue);
    }
    return [...dateMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date: date.slice(5), revenue }));
  }, [offplatformData]);

  const rankedKols = data ? (rankMode === 'gmv' ? data.topKolsByGmv : data.topKolsByRoi) : [];
  const campaignTrendData = data
    ? data.campaignTrend.map(c => ({ ...c, name: c.code ?? t('kolTrend.noCampaign') }))
    : [];

  const kolMap = useMemo(() => {
    const m = new Map<number, DashboardKolRow>();
    for (const k of data?.kolValueList ?? []) m.set(k.kol_id, k);
    return m;
  }, [data?.kolValueList]);

  const PAYMENT_ORDER = ['paid', 'barter', 'free'];
  const paymentGroups = useMemo(() => {
    const map = new Map<string, { kol_id: number; placement_count: number; total_gmv: number; total_spend: number }[]>();
    for (const r of data?.kolPaymentBreakdown ?? []) {
      const arr = map.get(r.payment_type) ?? [];
      arr.push({ kol_id: r.kol_id, placement_count: r.placement_count, total_gmv: r.total_gmv, total_spend: r.total_spend });
      map.set(r.payment_type, arr);
    }
    return PAYMENT_ORDER
      .filter(pt => map.has(pt))
      .map(pt => ({ key: pt, label: t(`payment.${pt}`, { defaultValue: pt }), kols: map.get(pt)! }));
  }, [data?.kolPaymentBreakdown, t]);

  const tierGroups = useMemo(() => {
    const map = new Map<string, { kol_id: number; placement_count: number; total_gmv: number; total_spend: number }[]>();
    const tierOrder = new Map<string, number>();
    for (const k of data?.kolValueList ?? []) {
      const tier = k.tier_name ?? 'ไม่ระบุ';
      if (k.kol_tier_id != null && !tierOrder.has(tier)) tierOrder.set(tier, k.kol_tier_id);
      const arr = map.get(tier) ?? [];
      arr.push({ kol_id: k.kol_id, placement_count: k.placement_count, total_gmv: k.total_gmv, total_spend: k.total_spend });
      map.set(tier, arr);
    }
    return [...map.entries()]
      .sort(([ta], [tb]) => (tierOrder.get(ta) ?? 99) - (tierOrder.get(tb) ?? 99))
      .map(([tier, kols]) => ({ key: tier, label: tier, kols }));
  }, [data?.kolValueList]);

  const hasAnyFilter = !!(brandId || campaignId || categoryId || dateFrom || dateTo);
  function clearAllFilters() { setBrandId(''); setCampaignId(''); setCategoryId(''); setDateFrom(''); setDateTo(''); }

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-screen-xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
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

      {/* Filter panel */}
      <div className="bg-surface border border-hairline rounded-xl p-4 mb-6">
        <div className="flex items-center gap-1.5 mb-3">
          <SlidersHorizontal size={13} className="text-muted" />
          <span className="text-xs font-medium text-muted">Filters</span>
          {hasAnyFilter && (
            <button
              onClick={clearAllFilters}
              className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors"
            >
              <X size={11} /> {t('common.clearAll')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">Brand</span>
            <Select
              size="sm" className="min-w-[140px]"
              options={[{ id: '', label: t('common.allBrands') }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
              value={brandId}
              onChange={setBrandId}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">Campaign</span>
            <Select
              size="sm" className="min-w-[180px]"
              options={[{ id: '', label: t('placements.allCampaigns') }, ...campaigns.map(c => ({ id: c.id, label: `${c.code}${c.label ? ` — ${c.label}` : ''}` }))]}
              value={campaignId}
              onChange={setCampaignId}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">{t('dashboard.categoryLabel')}</span>
            <Select
              size="sm" className="min-w-[160px]"
              options={[{ id: '', label: t('dashboard.allCategories') }, ...categories.map(cat => ({ id: cat.id, label: cat.name }))]}
              value={categoryId}
              onChange={setCategoryId}
            />
          </div>
          <div className="h-8 w-px bg-hairline self-end mb-[3px] shrink-0" />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">{t('dashboard.dateRange')}</span>
            <div className="flex items-center gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined} className={selectCls} />
              <span className="text-xs text-muted">–</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined} className={selectCls} />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="flex items-center justify-center w-6 h-6 rounded-md text-muted hover:text-ink hover:bg-canvas transition-colors"
                  title={t('dashboard.clearDate')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
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
          <div className="flex flex-col gap-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-2.5 bg-canvas rounded-md w-24 animate-pulse shrink-0" />
                <div className="flex-1 h-px bg-hairline" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonKpiCard key={i} />)}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-2.5 bg-canvas rounded-md w-28 animate-pulse shrink-0" />
                <div className="flex-1 h-px bg-hairline" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <SkeletonChart />
                <SkeletonChart />
              </div>
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
        <div className="flex flex-col gap-8">
          {/* KPI section */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted shrink-0">{t('dashboard.sectionMetrics')}</span>
              <div className="flex-1 h-px bg-hairline" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard icon={<TrendingUp size={13} />} label={t('dashboard.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
              <KpiCard
                icon={<Gauge size={13} />}
                label={t('dashboard.totalRoi')}
                value={data.summary.roi != null ? `x${data.summary.roi.toFixed(2)}` : '—'}
              />
              <KpiCard icon={<Wallet size={13} />} label={t('dashboard.kolSpend')} value={formatMoney(data.summary.total_spend)} />
              <KpiCard icon={<ShoppingCart size={13} />} label={t('dashboard.totalOrders')} value={data.summary.total_orders.toLocaleString(numberLocale())} />
              <KpiCard
                icon={<ListChecks size={13} />}
                label={t('dashboard.totalPlacements')}
                value={data.summary.total_placements.toLocaleString(numberLocale())}
                sub={t('dashboard.placementsSub', { posted: data.summary.posted_count, planned: data.summary.planned_count, cancelled: data.summary.cancelled_count })}
              />
              <KpiCard icon={<Megaphone size={13} />} label="Ads Cost" value={formatMoney(data.summary.total_ads_cost)} />
            </div>
          </div>

          {/* Analysis section: row 1 = donut + bar chart, row 2 = platform breakdown full width */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted shrink-0">{t('dashboard.sectionAnalysis')}</span>
              <div className="flex-1 h-px bg-hairline" />
            </div>

            {/* Row 1: Donut + Bar chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-surface border border-hairline rounded-xl p-5">
                <h2 className="text-sm font-semibold text-ink mb-4">{t('dashboard.gmvByChannel')}</h2>
                {data.channelBreakdown.length === 0 ? (
                  <p className="text-sm text-muted">{t('dashboard.noGmvData')}</p>
                ) : (() => {
                  const totalGmv = data.channelBreakdown.reduce((s, r) => s + r.gmv, 0);
                  return (
                    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
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
                      <div className="flex-1 flex flex-col gap-2.5 min-w-0">
                        {data.channelBreakdown.map((c, i) => {
                          const pct = totalGmv > 0 ? ((c.gmv / totalGmv) * 100).toFixed(1) : '0.0';
                          return (
                            <div key={c.channel} className="flex items-center gap-2.5 text-sm">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHANNEL_COLOR[c.channel] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
                              <span className="font-medium text-ink w-16 shrink-0">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                              <span className="flex-1 text-right text-ink tabular-nums font-mono">{formatMoney(c.gmv)}</span>
                              <span className="w-12 text-right text-muted tabular-nums shrink-0">{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
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
                      <Bar dataKey="gmv" fill="#0066cc" radius={[4, 4, 0, 0]} animationDuration={500} />
                      <Bar dataKey="spend" fill="#f59e0b" radius={[4, 4, 0, 0]} animationDuration={500} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Row 2: Platform breakdown full width */}
            {data.platformBreakdown.length > 0 && (
              <PlatformBreakdownCard rows={data.platformBreakdown} />
            )}
          </div>

          {/* Top KOL ranking */}
          <div className="bg-surface border border-hairline rounded-xl p-5">
            {/* Title row */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                  <Trophy size={14} className="text-accent" /> {t('dashboard.rankingTitle')}
                </h2>
                {categoryId && (
                  <p className="text-[11px] text-muted mt-0.5">
                    {t('dashboard.compareWithinCategory', { category: categories.find(c => String(c.id) === categoryId)?.name ?? '' })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
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
            {rankMode === 'roi' && (
              <p className="text-[11px] text-muted mb-3">{t('dashboard.roiExplain')}</p>
            )}
            {/* Search row */}
            <div className="mb-4">
              <KolSearchBox onSelect={setTrendKolId} />
            </div>
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

          {/* Off-Platform Traffic widget */}
          <div className="bg-surface border border-hairline rounded-xl p-5">
            <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-ink">{t('dashboard.offplatformTitle')}</h2>
                <p className="text-[11px] text-muted mt-0.5">{t('dashboard.offplatformSubtitle')}</p>
              </div>
              <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
                {([7, 30, 90] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setOffplatformDays(d)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${offplatformDays === d ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {offplatformLoading ? (
              <div className="h-32 flex items-center justify-center">
                <p className="text-sm text-muted">{t('common.loading')}</p>
              </div>
            ) : !offplatformData || offplatformData.dailyTrend.length === 0 ? (
              <p className="text-sm text-muted">{t('dashboard.offplatformNoData')}</p>
            ) : (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="bg-canvas rounded-lg p-3">
                    <p className="text-[11px] text-muted mb-1">{t('dashboard.offplatformRevenue')}</p>
                    <p className="text-base font-semibold text-ink font-mono">{formatMoney(offplatformData.summary.total_revenue)}</p>
                  </div>
                  <div className="bg-canvas rounded-lg p-3">
                    <p className="text-[11px] text-muted mb-1">{t('dashboard.offplatformOrders')}</p>
                    <p className="text-base font-semibold text-ink font-mono">{offplatformData.summary.total_orders.toLocaleString(numberLocale())}</p>
                  </div>
                  <div className="bg-canvas rounded-lg p-3">
                    <p className="text-[11px] text-muted mb-1">{t('dashboard.offplatformVisits')}</p>
                    <p className="text-base font-semibold text-ink font-mono">{offplatformData.summary.total_visits.toLocaleString(numberLocale())}</p>
                  </div>
                </div>

                {/* Chart + breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div>
                    <h3 className="text-xs font-medium text-muted mb-3">{t('dashboard.offplatformDailyTrend')}</h3>
                    <ResponsiveContainer width="100%" height={180} initialDimension={{ width: 400, height: 180 }}>
                      <BarChart data={offplatformBarData} margin={{ left: -16 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={formatAxisMoney} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                          labelStyle={{ color: 'var(--ink)', fontSize: 11 }}
                          formatter={(v) => [formatMoney(Number(v ?? 0)), t('dashboard.offplatformRevenue')]}
                        />
                        <Bar dataKey="revenue" fill="#0066cc" radius={[4, 4, 0, 0]} animationDuration={500} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div>
                    <h3 className="text-xs font-medium text-muted mb-3">{t('dashboard.offplatformChannelBreakdown')}</h3>
                    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-2">
                      <div className="w-36 h-36 shrink-0">
                        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 144, height: 144 }}>
                          <PieChart>
                            <Pie
                              data={offplatformData.channelBreakdown}
                              dataKey="revenue"
                              nameKey="channel"
                              innerRadius="60%"
                              outerRadius="95%"
                              paddingAngle={2}
                              stroke="none"
                              animationDuration={500}
                            >
                              {offplatformData.channelBreakdown.map((ch, i) => (
                                <Cell key={ch.channel} fill={OFFPLATFORM_COLORS[i % OFFPLATFORM_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                              formatter={(v, name) => [formatMoney(Number(v ?? 0)), String(name)]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {offplatformData.channelBreakdown.map((ch, i) => (
                          <div key={ch.channel} className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OFFPLATFORM_COLORS[i % OFFPLATFORM_COLORS.length] }} />
                            <span className="font-medium text-ink shrink-0 w-16 truncate">{ch.channel}</span>
                            <span className="flex-1 text-right text-ink tabular-nums font-mono">{formatMoney(ch.revenue)}</span>
                            <span className="w-20 text-right text-muted tabular-nums font-mono shrink-0">{ch.orders.toLocaleString(numberLocale())} orders</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
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

          <KolsByGroupCard
            title={t('dashboard.paymentCompareTitle')}
            description={t('dashboard.paymentCompareDesc')}
            groups={paymentGroups}
            kolMap={kolMap}
            onSelectKol={setTrendKolId}
          />

          <KolsByGroupCard
            title={t('dashboard.tierCompareTitle')}
            description={t('dashboard.tierCompareDesc')}
            groups={tierGroups}
            kolMap={kolMap}
            onSelectKol={setTrendKolId}
          />
        </div>
      )}

      {trendKolId != null && (
        <KolTrendModal kolId={trendKolId} brandId={brandId || undefined} onClose={() => setTrendKolId(null)} />
      )}
    </div>
  );
}
