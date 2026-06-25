import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Search, ChevronLeft, ChevronRight, X, Users } from 'lucide-react';
import { getKolDirectory, getDropdowns, type KolDirectoryRow, type KolBrandRow, type KolPlatformAccount, type Platform, type ContentCategory } from '../api/index.js';
import KolDetailModal from '../components/KolDetailModal.js';
import { getCached, setCached } from '../lib/swrCache.js';
import Select from '../components/Select.js';
import KolAvatar from '../components/KolAvatar.js';
import BrandLogo from '../components/BrandLogo.js';
import PlatformLogo from '../components/PlatformLogo.js';
import { numberLocale } from '../i18n/locale.js';

const LIMIT = 20;

function formatFollower(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

// ─── Brand chip with hover detail (portal) ─────────────────────
// hover a brand → shows every product reviewed for that brand, each
// annotated with which campaign(s) it was reviewed in
function BrandHoverChip({ brand }: { brand: KolBrandRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = () => {
    clearTimeout(timer.current);
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      const above = r.top > 280;
      const left = Math.min(r.left, window.innerWidth - 260);
      setStyle(above
        ? { position: 'fixed', bottom: window.innerHeight - r.top + 8, left, zIndex: 9999 }
        : { position: 'fixed', top: r.bottom + 8, left, zIndex: 9999 });
    }
    setOpen(true);
  };
  const hide = () => { timer.current = setTimeout(() => setOpen(false), 120); };

  return (
    <>
      <span ref={ref}
        className="inline-flex cursor-default select-none transition-transform hover:scale-110"
        onMouseEnter={show} onMouseLeave={hide}
        title={brand.brand_name}>
        <BrandLogo name={brand.brand_name} logoUrl={brand.logo_url} size={32} />
      </span>
      {open && createPortal(
        <div style={style} onMouseEnter={show} onMouseLeave={hide}>
          <div className="bg-surface border border-hairline rounded-lg shadow-xl w-60">
            <div className="px-2.5 py-2 border-b border-hairline">
              <span className="text-ink text-[11px] font-semibold">{brand.brand_name} · {t('kols.reviewedProducts')}</span>
            </div>
            <div className="max-h-56 overflow-y-auto px-2.5 py-2 flex flex-col gap-2 select-text">
              {brand.products.length === 0 ? (
                <span className="text-muted text-[11px]">{t('kols.noData')}</span>
              ) : brand.products.map(p => (
                <div key={p.model_code}>
                  <div className="text-ink text-[11px] font-medium leading-snug">{p.model_code}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.campaigns.length === 0 ? (
                      <span className="text-muted text-[10px]">{t('kols.noCampaign')}</span>
                    ) : p.campaigns.map(c => (
                      <span key={c.code} className="text-muted text-[10px] bg-canvas px-1.5 py-px rounded-md" title={c.label ?? c.code}>
                        {c.code}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const HOVER_EXPAND_DELAY = 400;

// ─── Platform badge — hover shows a URL preview before you commit to a
// click, same portal-popup pattern as BrandHoverChip above ───────────────
function PlatformBadge({ p }: { p: KolPlatformAccount }) {
  const [open, setOpen] = useState(false);
  const [avatarErrored, setAvatarErrored] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const subtitle = [p.handle, p.follower_count ? `${p.follower_count.toLocaleString(numberLocale())} followers` : null]
    .filter(Boolean).join(' · ');

  const show = () => {
    clearTimeout(timer.current);
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      const above = r.top > 200;
      const left = Math.min(r.left, window.innerWidth - 280);
      setStyle(above
        ? { position: 'fixed', bottom: window.innerHeight - r.top + 8, left, zIndex: 9999 }
        : { position: 'fixed', top: r.bottom + 8, left, zIndex: 9999 });
    }
    setOpen(true);
  };
  const hide = () => { timer.current = setTimeout(() => setOpen(false), 120); };

  const badge = (
    <span ref={ref}
      className={`transition-transform inline-flex ${p.profile_url ? 'hover:scale-110' : 'opacity-50'}`}
      onMouseEnter={show} onMouseLeave={hide}>
      <PlatformLogo name={p.platform_name} size={24} />
    </span>
  );

  const preview = open && p.profile_url && createPortal(
    <div style={style} onMouseEnter={show} onMouseLeave={hide}>
      <div className="bg-surface border border-hairline rounded-lg shadow-xl w-64 overflow-hidden">
        {p.avatar_url && !avatarErrored && (
          <img
            src={p.avatar_url}
            alt={p.handle}
            onError={() => setAvatarErrored(true)}
            className="w-full h-36 object-cover bg-canvas border-b border-hairline"
          />
        )}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <PlatformLogo name={p.platform_name} size={16} />
            <span className="text-ink text-[11px] font-semibold">{p.platform_name}</span>
          </div>
          {subtitle && <div className="text-muted text-[11px] mt-0.5">{subtitle}</div>}
          <div className="text-accent text-[11px] mt-1.5 break-all select-text">{p.profile_url}</div>
        </div>
      </div>
    </div>,
    document.body,
  );

  if (!p.profile_url) return badge;
  return (
    <>
      <a href={p.profile_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
        {badge}
      </a>
      {preview}
    </>
  );
}

// ─── KOL Card ─────────────────────────────────────────────────
function KolCard({ r, onClick }: { r: KolDirectoryRow; onClick: () => void }) {
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
      onClick={onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`bg-surface border rounded-xl overflow-hidden cursor-pointer transition-all duration-200 flex flex-col ${
        expanded
          ? 'relative z-20 scale-[1.12] -translate-y-1 shadow-2xl border-accent/40'
          : 'border-hairline hover:border-accent/30'
      }`}
    >
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Row 1: avatar + handle + follower + link */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <KolAvatar handle={r.handle} avatarUrl={r.avatar_url} />
            <div className="min-w-0">
              <div className="font-semibold text-ink text-sm leading-tight truncate">{r.handle}</div>
              {r.gen_name && (
                <div className="text-[11px] text-muted mt-0.5 truncate">{r.gen_name}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {r.follower_count && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted tabular-nums font-mono bg-canvas border border-hairline px-1.5 py-0.5 rounded-md"
                title={r.follower_count.toLocaleString(numberLocale()) + ' followers'}>
                <Users size={9} className="shrink-0" />
                {formatFollower(r.follower_count)}
              </span>
            )}
          </div>
        </div>

        {/* Platform accounts — one badge per platform this kol has, click opens that platform's profile */}
        {r.platforms.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">{t('kols.socialChannels')}</div>
            <div className="flex items-center gap-1.5">
              {r.platforms.map(p => <PlatformBadge key={p.platform_id} p={p} />)}
            </div>
          </div>
        )}

        {/* Brands reviewed — hover a brand to see products + which campaign */}
        <div className="flex-1">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">{t('kols.brandsReviewed')}</div>
          {r.brands.length === 0 ? (
            <span className="text-muted text-xs">—</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {r.brands.map(b => <BrandHoverChip key={b.brand_id} brand={b} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton card ────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-surface border border-hairline rounded-xl overflow-hidden animate-pulse">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-canvas shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-canvas rounded-md w-3/4" />
            <div className="h-2.5 bg-canvas rounded-md w-1/2" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <div className="h-5 bg-canvas rounded-full w-20" />
          <div className="h-5 bg-canvas rounded-full w-16" />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function KolsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<KolDirectoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedKol, setSelectedKol] = useState<KolDirectoryRow | null>(null);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);

  useEffect(() => {
    getDropdowns().then(d => {
      setPlatforms(d.platforms);
      setCategories(d.contentCategories);
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const params = { q: debouncedQ, platform_id: platformId, category_id: categoryId, page };
    const cacheKey = `kols:${JSON.stringify(params)}`;
    const cached = getCached<{ rows: KolDirectoryRow[]; total: number }>(cacheKey);
    if (cached) {
      setRows(cached.rows);
      setTotal(cached.total);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await getKolDirectory(params);
      // a newer load() may have started (and even resolved) while this one
      // was in flight — applying this stale response would silently undo
      // whatever the user is currently looking at
      if (loadSeq.current !== seq) return;
      setCached(cacheKey, res);
      setRows(res.rows);
      setTotal(res.total);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [debouncedQ, platformId, categoryId, page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / LIMIT);
  const hasFilters = !!q || !!platformId || !!categoryId;

  function clearAll() { setQ(''); setPlatformId(''); setCategoryId(''); setPage(1); }

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-screen-xl mx-auto">
      {/* Header + filters in one row */}
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">KOL Directory</h1>
          <p className="text-sm text-muted mt-0.5">{t('kols.totalCount', { count: total })}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
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

          <Select
            size="sm" className="min-w-[140px]"
            options={[{ id: '', label: t('kols.allPlatform') }, ...platforms.map(p => ({ id: p.id, label: p.name }))]}
            value={platformId}
            onChange={v => { setPlatformId(v); setPage(1); }}
          />

          <Select
            size="sm" className="min-w-[140px]"
            options={[{ id: '', label: t('kols.allCategory') }, ...categories.map(c => ({ id: c.id, label: c.name }))]}
            value={categoryId}
            onChange={v => { setCategoryId(v); setPage(1); }}
          />

          {hasFilters && (
            <button onClick={clearAll} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
              <X size={11} /> {t('placements.clearAll')}
            </button>
          )}
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Users size={36} className="text-muted mb-3" />
          <p className="text-sm font-medium text-ink">{t('kols.noResults')}</p>
          <p className="text-xs text-muted mt-1">{t('kols.tryDifferentSearch')}</p>
          {hasFilters && (
            <button onClick={clearAll} className="mt-4 text-xs text-accent hover:underline">{t('kols.clearFilters')}</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {rows.map(r => (
            <KolCard key={r.id} r={r} onClick={() => setSelectedKol(r)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-muted tabular-nums shrink-0">
            {t('kols.paginationLabel', { total: total.toLocaleString(numberLocale()), page, totalPages })}
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
              return pages.map((pg, i) =>
                pg === '…' ? (
                  <span key={`e-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted">…</span>
                ) : (
                  <button key={pg} onClick={() => setPage(pg as number)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-all active:scale-95 ${
                      page === pg ? 'bg-accent text-white shadow-sm' : 'border border-hairline text-muted hover:text-ink hover:border-ink/30'
                    }`}>
                    {pg}
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

      {selectedKol && (
        <KolDetailModal
          kol={selectedKol}
          onClose={() => setSelectedKol(null)}
          onUpdated={partial => {
            setRows(prev => prev.map(r => r.id === selectedKol.id ? { ...r, ...partial } : r));
          }}
        />
      )}
    </div>
  );
}
