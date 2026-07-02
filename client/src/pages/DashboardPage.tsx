import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, TrendingUp, Wallet, Megaphone, ListChecks, ShoppingCart, Gauge, X, Trophy, Search, Scale, SlidersHorizontal, Coins, Percent, CheckCircle2, MousePointerClick, Image as ImageIcon } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  type TooltipContentProps,
} from 'recharts';
import { useAuth } from '../context/AuthContext.js';
import {
  getDashboardOverview, getDropdowns, searchKols, exportDashboard, getOffplatformTraffic,
  getProductDashboard, getMarketingDashboard,
  type DashboardOverview, type DashboardKolRow, type DashboardChannelRow, type Campaign, type Brand, type ContentCategory, type KolResult,
  type OffplatformTraffic, type ProductDashboardOverview, type MarketingDashboard,
  type DashboardPlatformRow, type DashboardCategoryRow, type ProductRankRow,
} from '../api/index.js';
import KolTrendModal from '../components/KolTrendModal.js';
import ProductTrendModal from '../components/ProductTrendModal.js';
import PlatformLogo from '../components/PlatformLogo.js';
import RankBadge from '../components/RankBadge.js';
import Select from '../components/Select.js';
import Toast from '../components/Toast.js';
import Paginator from '../components/Paginator.js';
import ChartTableCard from '../components/ChartTableCard.js';
import ExportLangMenu, { type ExportLang } from '../components/ExportLangMenu.js';
import { getCached, setCached, isFresh } from '../lib/swrCache.js';
import { numberLocale } from '../i18n/locale.js';
import { todayStr, exportTableToExcel, type ExportColumn } from '../lib/exportTable.js';
import i18n from '../i18n/index.js';

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
const GROUP_PAGE_SIZE = 10;

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
  const [page, setPage] = useState(1);
  const currentGroup = groups.find(g => g.key === activeGroup);
  const sorted = currentGroup
    ? [...currentGroup.kols].sort((a, b) => b.total_gmv - a.total_gmv)
    : [];
  const pages = Math.max(1, Math.ceil(sorted.length / GROUP_PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * GROUP_PAGE_SIZE, page * GROUP_PAGE_SIZE);

  function changeGroup(key: string) {
    setActiveGroup(key);
    setPage(1);
  }

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
              onClick={() => changeGroup(g.key)}
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
          <div className="flex flex-col gap-1">
            {pageRows.map((entry, i) => {
              const kol = kolMap.get(entry.kol_id);
              const rank = (page - 1) * GROUP_PAGE_SIZE + i + 1;
              return (
                <div
                  key={entry.kol_id}
                  onClick={() => onSelectKol(entry.kol_id)}
                  className="flex items-center gap-3 py-2 px-2 rounded-lg cursor-pointer hover:bg-canvas transition-colors"
                >
                  <span className="w-5 text-xs font-semibold text-muted text-center shrink-0">{rank}</span>
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
          {sorted.length > GROUP_PAGE_SIZE && (
            <Paginator page={page} pages={pages} total={sorted.length} pageSize={GROUP_PAGE_SIZE} onPage={setPage} />
          )}
        </>
      )}
    </div>
  );
}

function PlatformBreakdownCard({
  rows,
}: {
  rows: DashboardPlatformRow[];
}) {
  const { t } = useTranslation();
  const total = rows.reduce((s, r) => s + r.placement_count, 0);
  const maxCount = Math.max(...rows.map(r => r.placement_count), 1);
  return (
    <ChartTableCard
      title={t('dashboard.platformBreakdownTitle')}
      description={t('dashboard.platformBreakdownDesc')}
      chart={
        rows.length === 0 ? (
          <p className="text-sm text-muted">{t('dashboard.noData')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map(r => {
              const pct = total > 0 ? (r.placement_count / total) * 100 : 0;
              return (
                <div key={r.platform_id} className="flex items-center gap-2.5">
                  <PlatformLogo name={r.platform_name} size={18} />
                  <span className="text-sm font-medium text-ink w-24 shrink-0 truncate">{r.platform_name}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(r.placement_count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-ink tabular-nums font-mono w-24 text-right shrink-0">
                    {formatMoney(r.total_gmv)}
                  </span>
                  <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">
                    {formatMoney(r.total_spend + r.total_ads_cost)}
                  </span>
                  <span className="text-[11px] text-muted tabular-nums w-9 text-right shrink-0">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        )
      }
      table={{
        columns: [
          { key: 'platform_name', headerKey: 'dashboard.colPlatform' },
          { key: 'placement_count', headerKey: 'dashboard.colPlacements', align: 'right' as const },
          { key: 'kol_count', headerKey: 'dashboard.colKolCount', align: 'right' as const },
          { key: 'total_gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
          { key: 'total_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
        ],
        rows: rows.map(r => ({ ...r, total_cost: r.total_spend + r.total_ads_cost })) as unknown as Record<string, unknown>[],
      }}
      exportFilename={`platform_breakdown_${todayStr()}.xlsx`}
      emptyMessage={t('dashboard.noData')}
    />
  );
}

// A — GMV (bars) + Orders (line) per month; the only true "over time" view
function MonthlyTrendCard({
  rows,
}: {
  rows: { month: string; placement_count: number; gmv: number; orders: number }[];
}) {
  const { t } = useTranslation();
  return (
    <ChartTableCard
      title={t('dashboard.monthlyTrendTitle')}
      description={t('dashboard.monthlyTrendDesc')}
      chart={
        rows.length === 0 ? (
          <p className="text-sm text-muted">{t('dashboard.noData')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 600, height: 260 }}>
            <ComposedChart data={rows} margin={{ left: -16, right: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => String(Math.round(Number(v)))} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                labelStyle={{ color: 'var(--ink)' }}
                formatter={(v, n) => n === 'gmv'
                  ? [formatMoney(Number(v ?? 0)), t('kolTrend.gmv')]
                  : [Number(v ?? 0).toLocaleString(numberLocale()), t('dashboard.totalOrders')]}
              />
              <Legend formatter={(v: string) => (v === 'gmv' ? t('kolTrend.gmv') : t('dashboard.totalOrders'))} wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="gmv" fill="#0066cc" radius={[4, 4, 0, 0]} animationDuration={500} />
              <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} animationDuration={500} />
            </ComposedChart>
          </ResponsiveContainer>
        )
      }
      table={{
        columns: [
          { key: 'month', headerKey: 'dashboard.colMonth' },
          { key: 'placement_count', headerKey: 'dashboard.colPlacements', align: 'right' as const },
          { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
          { key: 'orders', headerKey: 'dashboard.colOrders', align: 'right' as const },
        ],
        rows: rows as unknown as Record<string, unknown>[],
      }}
      exportFilename={`monthly_trend_${todayStr()}.xlsx`}
      emptyMessage={t('dashboard.noData')}
    />
  );
}

// B — Visits → Add to Cart → Orders funnel with conversion rates;
// togglable per sales channel (channelBreakdown already carries visits/atc/orders)
const FUNNEL_COLORS = ['#3b82f6', '#8b5cf6', '#10b981'];
function FunnelCard({
  total, channels,
}: {
  total: { visits: number; atc: number; orders: number };
  channels: { channel: string; visits: number; atc: number; orders: number }[];
}) {
  const { t } = useTranslation();
  const channelOptions = channels.filter(c => c.visits > 0 || c.atc > 0 || c.orders > 0);
  const canCompare = channelOptions.length >= 2;
  const selectable = [
    { key: 'all', label: t('dashboard.funnelAllChannels'), visits: total.visits, atc: total.atc, orders: total.orders },
    ...channelOptions.map(c => ({ key: c.channel, label: CHANNEL_LABEL[c.channel] ?? c.channel, visits: c.visits, atc: c.atc, orders: c.orders })),
  ];
  const [active, setActive] = useState('all');

  const current = selectable.find(o => o.key === active) ?? selectable[0];
  const { visits, atc, orders } = current;
  const stages = [
    { key: 'visits', label: 'Visits', value: visits, color: FUNNEL_COLORS[0] },
    { key: 'atc', label: 'Add to Cart', value: atc, color: FUNNEL_COLORS[1] },
    { key: 'orders', label: 'Orders', value: orders, color: FUNNEL_COLORS[2] },
  ];
  const atcRate = visits > 0 ? (atc / visits) * 100 : null;
  const conversionRate = visits > 0 ? (orders / visits) * 100 : null;
  const hasData = visits > 0 || atc > 0 || orders > 0;

  // compare mode: per-channel rates, with the leader in each column highlighted
  const rows = channelOptions.map(c => ({
    channel: c.channel,
    label: CHANNEL_LABEL[c.channel] ?? c.channel,
    visits: c.visits,
    orders: c.orders,
    atcRate: c.visits > 0 ? (c.atc / c.visits) * 100 : null,
    convRate: c.visits > 0 ? (c.orders / c.visits) * 100 : null,
  }));
  const best = {
    visits: Math.max(...rows.map(r => r.visits), 0),
    orders: Math.max(...rows.map(r => r.orders), 0),
    atcRate: Math.max(...rows.map(r => r.atcRate ?? -1), -1),
    convRate: Math.max(...rows.map(r => r.convRate ?? -1), -1),
  };
  const leadCls = (isLead: boolean) => `tabular-nums font-mono ${isLead ? 'text-accent font-semibold' : 'text-ink'}`;

  async function handleFunnelExport(lang: ExportLang) {
    const tt = i18n.getFixedT(lang);
    const cols: ExportColumn<typeof rows[number]>[] = [
      { key: 'label', header: tt('dashboard.funnelChannelCol') },
      { key: 'visits', header: 'Visits' },
      { key: 'orders', header: 'Orders' },
      { key: 'atcRate', header: 'ATC %', format: (v) => (v != null ? `${Number(v).toFixed(1)}%` : '') },
      { key: 'convRate', header: 'Conv %', format: (v) => (v != null ? `${Number(v).toFixed(2)}%` : '') },
    ];
    await exportTableToExcel(cols, rows, `funnel_${todayStr()}.xlsx`, { sheetName: tt('export.sheetName'), totalLabel: tt('export.totalRow') });
  }

  // card-flip between the funnel face and the compare table; only the body
  // flips (header + toggle stay put so you can always flip back). The 3D
  // container needs an explicit height — measure the visible face so it
  // animates between the two (different) face heights without a jump.
  const flipped = active === 'compare';
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number>();
  useLayoutEffect(() => {
    const measure = () => {
      const h = (flipped ? backRef.current : frontRef.current)?.offsetHeight;
      if (h) setBodyHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frontRef.current) ro.observe(frontRef.current);
    if (backRef.current) ro.observe(backRef.current);
    return () => ro.disconnect();
  }, [flipped]);

  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-ink shrink-0">{t('dashboard.funnelTitle')}</h2>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {(selectable.length > 1 || canCompare) && (
          <div className="flex flex-wrap items-center justify-end gap-1 bg-canvas rounded-lg p-1">
            {canCompare && (
              <button
                onClick={() => setActive('compare')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${active === 'compare' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {t('dashboard.funnelCompare')}
              </button>
            )}
            {selectable.map(o => (
              <button
                key={o.key}
                onClick={() => setActive(o.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${active === o.key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          )}
          {rows.length > 0 && <ExportLangMenu label="Excel" onPick={handleFunnelExport} />}
        </div>
      </div>
      <p className="text-[11px] text-muted mb-4">
        {active === 'compare' ? t('dashboard.funnelCompareHint') : t('dashboard.funnelDesc')}
      </p>

      <div className="[perspective:1400px]">
        <div
          className="relative [transform-style:preserve-3d] transition-[transform,height] duration-500 ease-out"
          style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)', height: bodyHeight }}
        >
          {/* Front face — funnel bars */}
          <div
            ref={frontRef}
            aria-hidden={flipped}
            className={`absolute top-0 left-0 w-full [backface-visibility:hidden] [-webkit-backface-visibility:hidden] ${flipped ? 'pointer-events-none' : ''}`}
          >
            {!hasData ? (
              <p className="text-sm text-muted">{t('dashboard.noData')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {stages.map(s => {
                  const pct = visits > 0 ? (s.value / visits) * 100 : (s.value > 0 ? 100 : 0);
                  return (
                    <div key={s.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-ink">{s.label}</span>
                        <span className="text-sm font-semibold text-ink tabular-nums font-mono">{s.value.toLocaleString(numberLocale())}</span>
                      </div>
                      <div className="h-3 rounded-full bg-canvas overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 2)}%`, background: s.color }} />
                      </div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="bg-canvas rounded-lg p-3">
                    <p className="text-[11px] text-muted mb-1">{t('dashboard.funnelAtcRate')}</p>
                    <p className="text-base font-semibold text-ink font-mono">{atcRate != null ? `${atcRate.toFixed(1)}%` : '—'}</p>
                  </div>
                  <div className="bg-canvas rounded-lg p-3">
                    <p className="text-[11px] text-muted mb-1">{t('dashboard.funnelConversionRate')}</p>
                    <p className="text-base font-semibold text-ink font-mono">{conversionRate != null ? `${conversionRate.toFixed(2)}%` : '—'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Back face — channel comparison table */}
          <div
            ref={backRef}
            aria-hidden={!flipped}
            className={`absolute top-0 left-0 w-full [backface-visibility:hidden] [-webkit-backface-visibility:hidden] [transform:rotateY(180deg)] ${flipped ? '' : 'pointer-events-none'}`}
          >
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted border-b border-hairline">
                    <th className="text-left font-medium py-2 pr-2">{t('dashboard.funnelChannelCol')}</th>
                    <th className="text-right font-medium py-2 px-2">Visits</th>
                    <th className="text-right font-medium py-2 px-2">Orders</th>
                    <th className="text-right font-medium py-2 px-2">ATC %</th>
                    <th className="text-right font-medium py-2 pl-2">Conv %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.channel} className="border-b border-hairline last:border-0">
                      <td className="py-2.5 pr-2">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHANNEL_COLOR[r.channel] ?? '#94a3b8' }} />
                          <span className="font-medium text-ink">{r.label}</span>
                        </span>
                      </td>
                      <td className={`py-2.5 px-2 text-right ${leadCls(r.visits === best.visits && r.visits > 0)}`}>{r.visits.toLocaleString(numberLocale())}</td>
                      <td className={`py-2.5 px-2 text-right ${leadCls(r.orders === best.orders && r.orders > 0)}`}>{r.orders.toLocaleString(numberLocale())}</td>
                      <td className={`py-2.5 px-2 text-right ${leadCls(r.atcRate != null && r.atcRate === best.atcRate)}`}>{r.atcRate != null ? `${r.atcRate.toFixed(1)}%` : '—'}</td>
                      <td className={`py-2.5 pl-2 text-right ${leadCls(r.convRate != null && r.convRate === best.convRate)}`}>{r.convRate != null ? `${r.convRate.toFixed(2)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// C — GMV by the KOL's content category (was filter-only before)
function CategoryBreakdownCard({
  rows,
}: {
  rows: DashboardCategoryRow[];
}) {
  const { t } = useTranslation();
  const maxGmv = Math.max(...rows.map(r => r.gmv), 1);
  return (
    <div className="bg-surface border border-hairline rounded-xl p-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-sm font-semibold text-ink">{t('dashboard.categoryTitle')}</h2>
        <p className="text-[11px] text-muted">{t('dashboard.categoryDesc')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noData')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.category_id} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
              <span className="text-sm font-medium text-ink w-24 shrink-0 truncate">{r.category_name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.gmv / maxGmv) * 100}%`, background: FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
              </div>
              <span className="text-[11px] text-muted tabular-nums w-14 text-right shrink-0">{t('dashboard.kolCountLabel', { count: r.kol_count })}</span>
              <span className="text-sm font-semibold text-ink tabular-nums font-mono w-24 text-right shrink-0">{formatMoney(r.gmv)}</span>
              <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">{formatMoney(r.spend + r.ads_cost)}</span>
              <span className="text-xs text-muted tabular-nums font-mono w-16 text-right shrink-0">{r.visits.toLocaleString()}</span>
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

function KolRankRow({ k, rank, mode, channel, onSelect }: {
  k: DashboardKolRow;
  rank: number;
  mode: 'gmv' | 'roi';
  channel: string;
  onSelect: (kolId: number) => void;
}) {
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

  const displayGmv = channel === 'all'
    ? k.total_gmv
    : (k.byChannel.find(c => c.channel === channel)?.gmv ?? 0);

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
        <RankBadge rank={rank} />
        <RankAvatar handle={k.handle} avatarUrl={k.avatar_url} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate">{k.handle}</div>
          {k.gen_name && <div className="text-[11px] text-muted truncate">{k.gen_name}</div>}
        </div>
        <span className="text-xs text-muted tabular-nums font-mono shrink-0">{k.placement_count} placement</span>
        {mode === 'roi' && channel === 'all' && (
          <span className="text-xs font-semibold text-emerald-600 tabular-nums font-mono w-16 text-right shrink-0">
            {k.roi != null ? `x${k.roi.toFixed(2)}` : '—'}
          </span>
        )}
        <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{formatMoney(displayGmv)}</span>
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
            <span key={c.channel} className={`inline-flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded-full text-muted ${c.channel === channel ? 'bg-accent/10 ring-1 ring-accent/30' : 'bg-canvas'}`}>
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

// A single cell inside the KPI slab — no card border, just spacing + right divider
function SlabCell({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-5 border-r border-hairline last:border-r-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted leading-tight">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-accent/10 text-accent shrink-0">{icon}</span>
        {label}
      </div>
      <div className={`text-[22px] font-bold tabular-nums font-mono leading-tight ${accent ? 'text-accent' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted leading-snug">{sub}</div>}
    </div>
  );
}

function SkeletonKpiSlab() {
  return (
    <div className="bg-surface border border-hairline rounded-xl overflow-hidden animate-pulse">
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[700px]">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-5 py-5 border-r border-hairline last:border-r-0 flex flex-col gap-2">
              <div className="h-2.5 bg-canvas rounded-md w-16" />
              <div className="h-5 bg-canvas rounded-md w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="h-px bg-hairline" />
      <div className="h-2 bg-canvas rounded-md w-20 mx-5 mt-3" />
      <div className="grid grid-cols-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-4 border-r border-hairline last:border-r-0 flex flex-col gap-2">
            <div className="h-2.5 bg-canvas rounded-md w-14" />
            <div className="h-5 bg-canvas rounded-md w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductImage({ url }: { url: string | null }) {
  const [errored, setErrored] = useState(false);
  if (url && !errored) {
    return <img src={url} alt="" onError={() => setErrored(true)} className="w-9 h-9 rounded-lg object-cover shrink-0 bg-canvas border border-hairline" />;
  }
  return (
    <span className="w-9 h-9 rounded-lg shrink-0 bg-canvas border border-hairline flex items-center justify-center text-muted">
      <ImageIcon size={14} />
    </span>
  );
}

const PRODUCT_DONUT_COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#111827', '#ef4444', '#10b981', '#eab308', '#ec4899', '#06b6d4'];

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
  const [rankChannel, setRankChannel] = useState<string>('all');
  const [productRankMode, setProductRankMode] = useState<'gmv' | 'ads_cost' | 'visits' | 'orders'>('gmv');
  const [trendKolId, setTrendKolId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'kol' | 'products' | 'tools'>('overview');
  const [offplatformDays, setOffplatformDays] = useState(30);
  const [offplatformData, setOffplatformData] = useState<OffplatformTraffic | null>(null);
  const [offplatformLoading, setOffplatformLoading] = useState(true);

  // Products tab state
  const [productData, setProductData] = useState<ProductDashboardOverview | null>(null);
  const [productLoading, setProductLoading] = useState(false);
  const [marketingData, setMarketingData] = useState<MarketingDashboard | null>(null);
  const [marketingLoading, setMarketingLoading] = useState(false);
  const [trendProductId, setTrendProductId] = useState<number | null>(null);

  async function handleExport(lang: ExportLang) {
    setExporting(true); setExportError('');
    try {
      await exportDashboard({ brand_id: brandId, campaign_id: campaignId, category_id: categoryId, date_from: dateFrom, date_to: dateTo, lang });
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
      if (isFresh(cacheKey, 60_000)) return; // dashboard data is stable — skip the background refetch
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

  const productSeq = useRef(0);
  const loadProducts = useCallback(async () => {
    const seq = ++productSeq.current;
    const params = { brand_id: brandId, campaign_id: campaignId, category_id: categoryId, date_from: dateFrom, date_to: dateTo };
    const pKey = `products:${JSON.stringify(params)}`;
    const mKey = `marketing:${JSON.stringify(params)}`;
    const cachedP = getCached<ProductDashboardOverview>(pKey);
    const cachedM = getCached<MarketingDashboard>(mKey);
    const freshP = !!cachedP && isFresh(pKey, 60_000);
    const freshM = !!cachedM && isFresh(mKey, 60_000);
    if (cachedP) setProductData(cachedP);
    if (cachedM) setMarketingData(cachedM);
    if (freshP && freshM) return; // both still fresh — skip the background refetch
    if (!freshP) setProductLoading(true);
    if (!freshM) setMarketingLoading(true);
    try {
      const [pd, md] = await Promise.all([
        freshP ? Promise.resolve(null) : getProductDashboard(params),
        freshM ? Promise.resolve(null) : getMarketingDashboard(params),
      ]);
      if (productSeq.current !== seq) return;
      if (pd) { setCached(pKey, pd); setProductData(pd); }
      if (md) { setCached(mKey, md); setMarketingData(md); }
    } finally {
      if (productSeq.current === seq) { setProductLoading(false); setMarketingLoading(false); }
    }
  }, [brandId, campaignId, categoryId, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (activeTab === 'products') loadProducts();
  }, [activeTab, loadProducts]);

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

  const availableChannels = useMemo(() => {
    if (!data) return [] as string[];
    const seen = new Set<string>();
    for (const k of data.kolValueList) {
      for (const c of k.byChannel) if (c.gmv > 0) seen.add(c.channel);
    }
    return (['shopee', 'lazada', 'website', 'tiktok', 'youtube', 'lamon8'] as const).filter(ch => seen.has(ch));
  }, [data]);

  const rankedKols = useMemo((): DashboardKolRow[] => {
    if (!data) return [];
    if (rankChannel === 'all') {
      return rankMode === 'gmv' ? data.topKolsByGmv : data.topKolsByRoi;
    }
    const withChannelGmv = data.kolValueList.map(k => ({
      kol: k,
      channelGmv: k.byChannel.find(c => c.channel === rankChannel)?.gmv ?? 0,
    }));
    return withChannelGmv
      .filter(x => x.channelGmv > 0)
      .sort((a, b) => b.channelGmv - a.channelGmv)
      .slice(0, 10)
      .map(x => x.kol);
  }, [data, rankMode, rankChannel]);

  const campaignTrendData = data
    ? data.campaignTrend.map(c => ({ ...c, name: c.code ?? t('kolTrend.noCampaign') }))
    : [];

  const sortedProductRanking = useMemo(() => {
    if (!productData) return [];
    const key = productRankMode === 'gmv' ? 'total_gmv' : productRankMode === 'ads_cost' ? 'total_ads_cost' : productRankMode === 'visits' ? 'total_visits' : 'total_orders';
    return [...productData.ranking].sort((a, b) => b[key] - a[key]);
  }, [productData, productRankMode]);

  function productRankValue(p: ProductRankRow): string {
    if (productRankMode === 'gmv') return formatMoney(p.total_gmv);
    if (productRankMode === 'ads_cost') return formatMoney(p.total_ads_cost);
    if (productRankMode === 'visits') return p.total_visits.toLocaleString(numberLocale());
    return p.total_orders.toLocaleString(numberLocale());
  }

  const kolMap = useMemo(() => {
    const m = new Map<number, DashboardKolRow>();
    for (const k of data?.kolValueList ?? []) m.set(k.kol_id, k);
    return m;
  }, [data?.kolValueList]);

  const visitsShopee = useMemo(() => data?.channelBreakdown.find(c => c.channel === 'shopee')?.visits ?? 0, [data]);
  const visitsLazada = useMemo(() => data?.channelBreakdown.find(c => c.channel === 'lazada')?.visits ?? 0, [data]);

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
        <ExportLangMenu
          label="Export Excel"
          onPick={handleExport}
          disabled={exporting || loading || !data}
        />
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

      {/* Tab bar — 4 tabs */}
      <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 mb-6 w-fit flex-wrap">
        {(
          [
            { id: 'overview', label: t('dashboard.tabOverview') },
            { id: 'kol', label: t('dashboard.tabKol') },
            { id: 'products', label: t('dashboard.tabProducts') },
            { id: 'tools', label: t('dashboard.tabTools') },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ======= TAB: OVERVIEW — skeleton ======= */}
      {activeTab === 'overview' && (loading || !data) && (
        <div className="flex flex-col gap-8">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-2.5 bg-canvas rounded-md w-24 animate-pulse shrink-0" />
              <div className="flex-1 h-px bg-hairline" />
            </div>
            <SkeletonKpiSlab />
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
        </div>
      )}

      {/* ======= TAB: OVERVIEW — content ======= */}
      {activeTab === 'overview' && !loading && data && (
        <div className="flex flex-col gap-8">
          {/* KPI section — Grouped Panel (แบบ A): รวม 11 KPI ไว้ใน panel เดียว */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted shrink-0">{t('dashboard.sectionMetrics')}</span>
              <div className="flex-1 h-px bg-hairline" />
            </div>
            <div className="bg-surface border border-hairline rounded-xl overflow-hidden">
              {/* Row 1: 10 absolute-number KPIs, split 5+5 to avoid column overflow at normal desktop width */}
              <div className="overflow-x-auto">
                <div className="grid grid-cols-5 min-w-[600px]">
                  <SlabCell icon={<TrendingUp size={12} />} label={t('dashboard.totalGmv')} value={formatMoney(data.summary.total_gmv)} />
                  <SlabCell icon={<Wallet size={12} />} label={t('dashboard.kolSpend')} value={formatMoney(data.summary.total_spend)} />
                  <SlabCell icon={<ShoppingCart size={12} />} label={t('dashboard.totalOrders')} value={data.summary.total_orders.toLocaleString(numberLocale())} />
                  <SlabCell
                    icon={<ListChecks size={12} />}
                    label={t('dashboard.totalPlacements')}
                    value={data.summary.total_placements.toLocaleString(numberLocale())}
                    sub={t('dashboard.placementsSub', { posted: data.summary.posted_count, planned: data.summary.planned_count, cancelled: data.summary.cancelled_count })}
                  />
                  <SlabCell icon={<Megaphone size={12} />} label="Ads Cost" value={formatMoney(data.summary.total_ads_cost)} />
                </div>
                <div className="h-px bg-hairline" />
                <div className="grid grid-cols-5 min-w-[600px]">
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.visitsShopee')} value={visitsShopee.toLocaleString(numberLocale())} />
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.visitsLazada')} value={visitsLazada.toLocaleString(numberLocale())} />
                  <SlabCell icon={<Wallet size={12} />} label={t('dashboard.totalExpenses')} value={formatMoney(data.summary.total_spend + data.summary.total_ads_cost)} />
                  <SlabCell icon={<MousePointerClick size={12} />} label={t('dashboard.totalVisit')} value={data.summary.total_visits.toLocaleString(numberLocale())} />
                  <SlabCell icon={<ListChecks size={12} />} label={t('dashboard.totalKol')} value={data.summary.total_kol_count.toLocaleString(numberLocale())} />
                </div>
              </div>
              {/* Hairline divider between the two rows */}
              <div className="h-px bg-hairline" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted px-5 pt-3 pb-0">{t('dashboard.sectionEfficiency')}</p>
              {/* Row 2: 4 derived-ratio KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4">
                <SlabCell
                  icon={<Gauge size={12} />}
                  label={t('dashboard.totalRoi')}
                  value={data.summary.roi != null ? `x${data.summary.roi.toFixed(2)}` : '—'}
                  accent
                />
                <SlabCell
                  icon={<Coins size={12} />}
                  label={t('dashboard.avgGmvPerPlacement')}
                  value={data.summary.posted_count > 0 ? formatMoney(data.summary.total_gmv / data.summary.posted_count) : '—'}
                  sub={t('dashboard.perPostedPlacement')}
                />
                <SlabCell
                  icon={<Percent size={12} />}
                  label={t('dashboard.conversionRate')}
                  value={data.summary.total_visits > 0 ? `${((data.summary.total_orders / data.summary.total_visits) * 100).toFixed(2)}%` : '—'}
                  sub={t('dashboard.ordersPerVisits')}
                />
                <SlabCell
                  icon={<CheckCircle2 size={12} />}
                  label={t('dashboard.postedRate')}
                  value={data.summary.total_placements > 0 ? `${((data.summary.posted_count / data.summary.total_placements) * 100).toFixed(0)}%` : '—'}
                  sub={t('dashboard.postedOfTotal', { posted: data.summary.posted_count, total: data.summary.total_placements })}
                />
              </div>
            </div>
          </div>

          {/* Analysis section: row 1 = donut + bar chart, row 2 = platform breakdown full width */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted shrink-0">{t('dashboard.sectionAnalysis')}</span>
              <div className="flex-1 h-px bg-hairline" />
            </div>

            {/* Monthly trend (A) — full width, the only over-time view */}
            <div className="mb-6">
              <MonthlyTrendCard rows={data.monthlyTrend} />
            </div>

            {/* Row 1: Donut + Bar chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <ChartTableCard
                title={t('dashboard.gmvByChannel')}
                chart={
                  data.channelBreakdown.length === 0 ? (
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
                  })()
                }
                table={{
                  columns: [
                    { key: 'channel_label', headerKey: 'dashboard.colChannel' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'pct', headerKey: 'dashboard.colPercent', align: 'right' as const },
                  ],
                  rows: (() => {
                    const total = data.channelBreakdown.reduce((s, r) => s + r.gmv, 0);
                    return data.channelBreakdown.map(c => ({
                      ...c,
                      channel_label: CHANNEL_LABEL[c.channel] ?? c.channel,
                      pct: total > 0 ? `${((c.gmv / total) * 100).toFixed(1)}%` : '0.0%',
                    } as Record<string, unknown>));
                  })(),
                }}
                exportFilename={`gmv_by_channel_${todayStr()}.xlsx`}
                emptyMessage={t('dashboard.noGmvData')}
              />

              <ChartTableCard
                title={t('dashboard.gmvVsSpendByCampaign')}
                chart={
                  campaignTrendData.length === 0 ? (
                    <p className="text-sm text-muted">{t('dashboard.noData')}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={224}>
                      <BarChart data={campaignTrendData} margin={{ left: -16, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hairline, #e5e7eb)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={50} />
                        <YAxis yAxisId="money" tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                        <YAxis yAxisId="visits" orientation="right" tick={{ fontSize: 11 }} tickFormatter={formatAxisMoney} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }}
                          labelStyle={{ color: 'var(--ink)' }}
                          formatter={(v, n) => {
                            if (n === 'visits') return [Number(v ?? 0).toLocaleString(numberLocale()), t('dashboard.colVisits')];
                            return [formatMoney(Number(v ?? 0)), n === 'gmv' ? t('kolTrend.gmv') : t('kolTrend.spend')];
                          }}
                        />
                        <Legend formatter={(v: string) => (v === 'gmv' ? t('kolTrend.gmv') : v === 'spend' ? t('kolTrend.spend') : t('dashboard.colVisits'))} wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="money" dataKey="gmv" fill="#0066cc" radius={[4, 4, 0, 0]} animationDuration={500} />
                        <Bar yAxisId="money" dataKey="spend" fill="#f59e0b" radius={[4, 4, 0, 0]} animationDuration={500} />
                        <Bar yAxisId="visits" dataKey="visits" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={500} />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                }
                table={{
                  columns: [
                    { key: 'name', headerKey: 'dashboard.colCampaign' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'spend', headerKey: 'dashboard.colSpend', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'visits', headerKey: 'dashboard.colVisits', align: 'right' as const },
                  ],
                  rows: campaignTrendData as unknown as Record<string, unknown>[],
                }}
                exportFilename={`gmv_vs_spend_campaign_${todayStr()}.xlsx`}
                emptyMessage={t('dashboard.noData')}
              />
            </div>

            {/* Funnel */}
            <div className="mb-6">
              <FunnelCard
                total={{ visits: data.summary.total_visits, atc: data.summary.total_atc, orders: data.summary.total_orders }}
                channels={data.channelBreakdown}
              />
            </div>
          </div>

          {/* Off-Platform Traffic — Daily Trend */}
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
                <ChartTableCard
                  bare
                  title={t('dashboard.offplatformDailyTrend')}
                  chart={
                    <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 800, height: 220 }}>
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
                  }
                  table={{
                    columns: [
                      { key: 'date', headerKey: 'dashboard.colDate' },
                      { key: 'revenue', headerKey: 'dashboard.colRevenue', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    ],
                    rows: offplatformBarData as unknown as Record<string, unknown>[],
                  }}
                  exportFilename={`offplatform_daily_${todayStr()}.xlsx`}
                />
                <div className="mt-6 pt-5 border-t border-hairline">
                  <ChartTableCard
                    bare
                    title={t('dashboard.offplatformChannelBreakdown')}
                    chart={
                      <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-8">
                        <div className="w-40 h-40 shrink-0">
                          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 160 }}>
                            <PieChart>
                              <Pie data={offplatformData.channelBreakdown} dataKey="revenue" nameKey="channel" innerRadius="60%" outerRadius="95%" paddingAngle={2} stroke="none" animationDuration={500}>
                                {offplatformData.channelBreakdown.map((ch, i) => (
                                  <Cell key={ch.channel} fill={OFFPLATFORM_COLORS[i % OFFPLATFORM_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(v, name) => [formatMoney(Number(v ?? 0)), String(name)]} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex-1 flex flex-col gap-2.5 min-w-0 w-full">
                          {offplatformData.channelBreakdown.map((ch, i) => (
                            <div key={ch.channel} className="flex items-center gap-2 text-xs">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OFFPLATFORM_COLORS[i % OFFPLATFORM_COLORS.length] }} />
                              <span className="font-medium text-ink shrink-0 w-20 truncate">{ch.channel}</span>
                              <span className="flex-1 text-right text-ink tabular-nums font-mono">{formatMoney(ch.revenue)}</span>
                              <span className="w-24 text-right text-muted tabular-nums font-mono shrink-0">{ch.orders.toLocaleString(numberLocale())} orders</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    }
                    table={{
                      columns: [
                        { key: 'channel', headerKey: 'dashboard.colChannel' },
                        { key: 'revenue', headerKey: 'dashboard.colRevenue', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                        { key: 'orders', headerKey: 'dashboard.colOrders', align: 'right' as const },
                      ],
                      rows: offplatformData.channelBreakdown as unknown as Record<string, unknown>[],
                    }}
                    exportFilename={`offplatform_channel_${todayStr()}.xlsx`}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ======= TAB: KOL — skeleton ======= */}
      {activeTab === 'kol' && (loading || !data) && (
        <div className="flex flex-col gap-6">
          <div className="bg-surface border border-hairline rounded-xl p-5">
            <div className="h-3.5 bg-canvas rounded-md w-52 mb-4 animate-pulse" />
            <div className="flex flex-col gap-1">{Array.from({ length: 10 }).map((_, i) => <SkeletonKolRow key={i} />)}</div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonChart /><SkeletonChart /></div>
        </div>
      )}

      {/* ======= TAB: KOL — content ======= */}
      {activeTab === 'kol' && !loading && data && (
        <div className="flex flex-col gap-6">
          {/* KOL Ranking */}
          <div className="bg-surface border border-hairline rounded-xl p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
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
              {rankChannel === 'all' && (
                <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
                  <button onClick={() => setRankMode('gmv')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${rankMode === 'gmv' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('dashboard.byGmv')}</button>
                  <button onClick={() => setRankMode('roi')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${rankMode === 'roi' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('dashboard.byRoi')}</button>
                </div>
              )}
            </div>
            {availableChannels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <button onClick={() => setRankChannel('all')} className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${rankChannel === 'all' ? 'bg-ink text-canvas' : 'bg-canvas text-muted hover:text-ink'}`}>{t('common.all')}</button>
                {availableChannels.map(ch => (
                  <button
                    key={ch}
                    onClick={() => setRankChannel(ch)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${rankChannel === ch ? 'text-white' : 'bg-canvas text-muted hover:text-ink'}`}
                    style={rankChannel === ch ? { background: CHANNEL_COLOR[ch] ?? '#64748b' } : {}}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: rankChannel === ch ? 'rgba(255,255,255,0.7)' : (CHANNEL_COLOR[ch] ?? '#94a3b8') }} />
                    {CHANNEL_LABEL[ch] ?? ch}
                  </button>
                ))}
              </div>
            )}
            {rankMode === 'roi' && rankChannel === 'all' && (
              <p className="text-[11px] text-muted mb-3">{t('dashboard.roiExplain')}</p>
            )}
            <div className="mb-4"><KolSearchBox onSelect={setTrendKolId} /></div>
            {rankedKols.length === 0 ? (
              <p className="text-sm text-muted">{rankMode === 'roi' && rankChannel === 'all' ? t('dashboard.noDataRoi') : t('dashboard.noDataGmv')}</p>
            ) : (
              <div className="flex flex-col divide-y divide-hairline">
                {rankedKols.map((k, i) => <KolRankRow key={k.kol_id} k={k} rank={i + 1} mode={rankMode} channel={rankChannel} onSelect={setTrendKolId} />)}
              </div>
            )}
          </div>

          {/* Platform + Category breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PlatformBreakdownCard rows={data.platformBreakdown} />
            <CategoryBreakdownCard rows={data.categoryBreakdown} />
          </div>
        </div>
      )}

      {/* ======= TAB: PRODUCTS — skeleton ======= */}
      {activeTab === 'products' && (productLoading || marketingLoading || (!productData && !marketingData)) && (
        <div className="flex flex-col gap-6">
          <SkeletonChart />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><SkeletonChart /><SkeletonChart /></div>
        </div>
      )}

      {/* ======= TAB: PRODUCTS — content ======= */}
      {activeTab === 'products' && !productLoading && !marketingLoading && (productData || marketingData) && (
        <div className="flex flex-col gap-6">
          {productData && (
            <ChartTableCard
              title={t('productDashboard.rankingTitle')}
              headerRight={
                <div className="flex items-center gap-1 bg-canvas rounded-lg p-1 shrink-0">
                  <button onClick={() => setProductRankMode('gmv')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'gmv' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>GMV</button>
                  <button onClick={() => setProductRankMode('ads_cost')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'ads_cost' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('productDashboard.byAdsSpent')}</button>
                  <button onClick={() => setProductRankMode('visits')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'visits' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('productDashboard.byVisit')}</button>
                  <button onClick={() => setProductRankMode('orders')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${productRankMode === 'orders' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>{t('productDashboard.byOrders')}</button>
                </div>
              }
              chart={
                sortedProductRanking.length === 0 ? (
                  <p className="text-sm text-muted">{t('dashboard.noData')}</p>
                ) : (
                  <div className="flex flex-col divide-y divide-hairline">
                    {sortedProductRanking.map((p, i) => (
                      <button
                        key={p.canonical_id}
                        onClick={() => setTrendProductId(p.canonical_id)}
                        className="flex items-center gap-3 py-2 px-2 hover:bg-canvas transition-colors text-left w-full"
                      >
                        <RankBadge rank={i + 1} />
                        <ProductImage url={p.image_url} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink truncate">{p.model_code}</div>
                          {p.category_name && <div className="text-[11px] text-muted truncate">{p.category_name}</div>}
                        </div>
                        <span className="text-xs text-muted tabular-nums font-mono w-20 text-right shrink-0">{p.placement_count} {t('dashboard.colPlacements')}</span>
                        <span className="text-sm font-semibold text-ink tabular-nums font-mono w-28 text-right shrink-0">{productRankValue(p)}</span>
                      </button>
                    ))}
                  </div>
                )
              }
              table={{
                columns: [
                  { key: 'rank', headerKey: 'dashboard.colRank', align: 'center' as const, width: '40px' },
                  { key: 'model_code', headerKey: 'dashboard.colProduct' },
                  { key: 'category_name', headerKey: 'dashboard.colCategory' },
                  { key: 'placement_count', headerKey: 'dashboard.colPlacements', align: 'right' as const },
                  { key: 'total_orders', headerKey: 'dashboard.colOrders', align: 'right' as const },
                  { key: 'total_gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                  { key: 'total_ads_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                  { key: 'total_visits', headerKey: 'dashboard.colVisits', align: 'right' as const },
                ],
                rows: sortedProductRanking.map((p, i) => ({ ...p, rank: i + 1, category_name: p.category_name ?? '—' } as Record<string, unknown>)),
              }}
              exportFilename={`product_ranking_${todayStr()}.xlsx`}
              emptyMessage={t('dashboard.noData')}
            />
          )}

          {marketingData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* GMV by product category */}
              <ChartTableCard
                title={t('marketing.gmvByProductCategory')}
                chart={(() => {
                  const catRows = marketingData.byProductCategory.filter(r => r.gmv > 0);
                  const catTotal = catRows.reduce((s, r) => s + r.gmv, 0);
                  if (catRows.length === 0) return <p className="text-sm text-muted">{t('dashboard.noData')}</p>;
                  return (
                    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
                      <div className="w-40 h-40 shrink-0">
                        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 160 }}>
                          <PieChart>
                            <Pie data={catRows} dataKey="gmv" nameKey="category_name" innerRadius="60%" outerRadius="95%" paddingAngle={2} stroke="none" animationDuration={500}>
                              {catRows.map((r, i) => <Cell key={r.category_id ?? i} fill={PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(v, n) => [formatMoney(Number(v ?? 0)), String(n)]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
                        {catRows.map((r, i) => (
                          <div key={r.category_id ?? i} className="flex items-center gap-2.5 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length] }} />
                            <span className="font-medium text-ink truncate flex-1 min-w-0">{r.category_name ?? '—'}</span>
                            <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                            <span className="text-xs text-muted tabular-nums font-mono shrink-0">{formatMoney(r.total_cost)}</span>
                            <span className="text-xs text-muted tabular-nums font-mono shrink-0">{r.visits.toLocaleString()}</span>
                            <span className="w-12 text-right text-muted tabular-nums shrink-0">{catTotal > 0 ? ((r.gmv / catTotal) * 100).toFixed(1) : '0.0'}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                table={{
                  columns: [
                    { key: 'category_name', headerKey: 'dashboard.colCategory' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'total_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'visits', headerKey: 'dashboard.colVisits', align: 'right' as const },
                    { key: 'pct', header: '%', align: 'right' as const },
                  ],
                  rows: (() => {
                    const rows = marketingData.byProductCategory.filter(r => r.gmv > 0);
                    const total = rows.reduce((s, r) => s + r.gmv, 0);
                    return rows.map(r => ({ ...r, category_name: r.category_name ?? '—', pct: total > 0 ? `${((r.gmv / total) * 100).toFixed(1)}%` : '0.0%' } as Record<string, unknown>));
                  })(),
                }}
                exportFilename={`gmv_by_category_${todayStr()}.xlsx`}
              />

              {/* GMV by product SKU */}
              <ChartTableCard
                title={t('marketing.gmvByProductSku')}
                chart={(() => {
                  const skuRows = marketingData.byProductSku.filter(r => r.gmv > 0);
                  const skuTotal = skuRows.reduce((s, r) => s + r.gmv, 0);
                  if (skuRows.length === 0) return <p className="text-sm text-muted">{t('dashboard.noData')}</p>;
                  return (
                    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
                      <div className="w-40 h-40 shrink-0">
                        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height: 160 }}>
                          <PieChart>
                            <Pie data={skuRows.slice(0, 9)} dataKey="gmv" nameKey="model_code" innerRadius="60%" outerRadius="95%" paddingAngle={2} stroke="none" animationDuration={500}>
                              {skuRows.slice(0, 9).map((r, i) => <Cell key={r.canonical_id} fill={PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 12 }} formatter={(v, n) => [formatMoney(Number(v ?? 0)), String(n)]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
                        {skuRows.slice(0, 8).map((r, i) => (
                          <div key={r.canonical_id} className="flex items-center gap-2.5 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRODUCT_DONUT_COLORS[i % PRODUCT_DONUT_COLORS.length] }} />
                            <span className="font-medium text-ink truncate flex-1 min-w-0">{r.model_code ?? '—'}</span>
                            <span className="text-ink tabular-nums font-mono shrink-0">{formatMoney(r.gmv)}</span>
                            <span className="text-xs text-muted tabular-nums font-mono shrink-0">{formatMoney(r.total_cost)}</span>
                            <span className="w-12 text-right text-muted tabular-nums shrink-0">{skuTotal > 0 ? ((r.gmv / skuTotal) * 100).toFixed(1) : '0.0'}%</span>
                          </div>
                        ))}
                        {skuRows.length > 8 && <p className="text-[11px] text-muted">+{skuRows.length - 8} {t('dashboard.othersLabel')}</p>}
                      </div>
                    </div>
                  );
                })()}
                table={{
                  columns: [
                    { key: 'model_code', headerKey: 'dashboard.colSku' },
                    { key: 'gmv', header: 'GMV', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'total_cost', headerKey: 'dashboard.colCost', align: 'right' as const, render: (v) => formatMoney(Number(v ?? 0)), exportFormat: (v) => Number(v ?? 0) },
                    { key: 'pct', header: '%', align: 'right' as const },
                  ],
                  rows: (() => {
                    const rows = marketingData.byProductSku.filter(r => r.gmv > 0);
                    const total = rows.reduce((s, r) => s + r.gmv, 0);
                    return rows.map(r => ({ ...r, model_code: r.model_code ?? '—', pct: total > 0 ? `${((r.gmv / total) * 100).toFixed(1)}%` : '0.0%' } as Record<string, unknown>));
                  })(),
                }}
                exportFilename={`gmv_by_sku_${todayStr()}.xlsx`}
              />
            </div>
          )}
        </div>
      )}

      {/* ======= TAB: TOOLS — skeleton ======= */}
      {activeTab === 'tools' && (loading || !data) && (
        <div className="flex flex-col gap-6">
          <SkeletonChart /><SkeletonChart /><SkeletonChart /><SkeletonChart />
        </div>
      )}

      {/* ======= TAB: TOOLS — content ======= */}
      {activeTab === 'tools' && !loading && data && (
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
      {trendProductId != null && (
        <ProductTrendModal
          productId={trendProductId}
          brandId={brandId || undefined}
          campaignId={campaignId || undefined}
          dateFrom={dateFrom || undefined}
          dateTo={dateTo || undefined}
          onClose={() => setTrendProductId(null)}
          onSelectKol={setTrendKolId}
        />
      )}
    </div>
  );
}
