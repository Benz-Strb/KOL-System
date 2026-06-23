import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronLeft, ChevronRight, X, ExternalLink, Users } from 'lucide-react';
import { getKolDirectory, getDropdowns, type KolDirectoryRow, type Platform, type ContentCategory } from '../api/index.js';
import KolDetailModal from '../components/KolDetailModal.js';
import { getCached, setCached } from '../lib/swrCache.js';
import Select from '../components/Select.js';
import KolAvatar from '../components/KolAvatar.js';
import BrandLogo from '../components/BrandLogo.js';
import { getPlatformColor } from '../lib/platformColors.js';

const LIMIT = 25;

function formatFollower(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString();
}

// ─── Overflow tooltip (portal) ────────────────────────────────
function OverflowTooltip({ label, items }: { label: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = () => {
    clearTimeout(timer.current);
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      const above = r.top > 232;
      const left = Math.min(r.left, window.innerWidth - 216);
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
        className="inline-flex items-center px-1.5 py-px bg-canvas border border-hairline text-muted text-[11px] rounded-md cursor-default select-none"
        onMouseEnter={show} onMouseLeave={hide}>
        {label}
      </span>
      {open && createPortal(
        <div style={style} onMouseEnter={show} onMouseLeave={hide}>
          <div className="bg-ink rounded-lg shadow-xl w-52">
            <div className="max-h-52 overflow-y-auto px-2.5 py-2 flex flex-col gap-1 select-text">
              {items.map(item => (
                <span key={item} className="block text-white text-[11px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded-md leading-snug cursor-text">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Pills ────────────────────────────────────────────────────
function CampaignPills({ campaigns }: { campaigns: KolDirectoryRow['campaigns'] }) {
  const MAX = 6;
  const visible = campaigns.slice(0, MAX);
  const hidden = campaigns.slice(MAX);
  if (campaigns.length === 0) return <span className="text-muted text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(c => (
        <span key={c.code}
          className="inline-flex items-center px-1.5 py-px bg-accent/10 text-accent text-[11px] font-semibold rounded-md"
          title={c.label ?? c.code}>
          {c.code}
        </span>
      ))}
      {hidden.length > 0 && (
        <OverflowTooltip
          label={`+${hidden.length}`}
          items={hidden.map(c => c.label ? `${c.code} ${c.label}` : c.code)}
        />
      )}
    </div>
  );
}

function ProductPills({ products }: { products: string[] }) {
  const MAX = 2;
  const visible = products.slice(0, MAX);
  const hidden = products.slice(MAX);
  if (products.length === 0) return <span className="text-muted text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(p => (
        <span key={p}
          className="inline-flex items-center px-1.5 py-px bg-surface border border-hairline text-ink text-[11px] rounded-md"
          title={p}>
          {p.length > 20 ? p.slice(0, 19) + '…' : p}
        </span>
      ))}
      {hidden.length > 0 && (
        <OverflowTooltip label={`+${hidden.length}`} items={hidden} />
      )}
    </div>
  );
}

const HOVER_EXPAND_DELAY = 400;

// ─── KOL Card ─────────────────────────────────────────────────
function KolCard({ r, onClick }: { r: KolDirectoryRow; onClick: () => void }) {
  const bar = getPlatformColor(r.platform?.name);
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
      className={`bg-surface border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 flex flex-col ${
        expanded
          ? 'relative z-20 scale-[1.12] -translate-y-1 shadow-2xl border-accent/40'
          : 'border-hairline hover:shadow-md hover:border-accent/30 hover:-translate-y-0.5'
      }`}
    >
      {/* Top accent bar */}
      <div className={`h-1 w-full shrink-0 ${bar}`} />

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
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted tabular-nums bg-canvas border border-hairline px-1.5 py-0.5 rounded-md"
                title={r.follower_count.toLocaleString('th-TH') + ' followers'}>
                <Users size={9} className="shrink-0" />
                {formatFollower(r.follower_count)}
              </span>
            )}
            {r.profile_url && (
              <a href={r.profile_url} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-accent hover:bg-canvas transition-colors">
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        {/* Row 2: category badge */}
        {(r.platform || r.category) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {r.platform && (
              <span className="text-[11px] font-medium text-ink bg-canvas border border-hairline px-2 py-0.5 rounded-full">
                {r.platform.name}
              </span>
            )}
            {r.category && (
              <span className="text-[11px] text-muted bg-canvas border border-hairline px-2 py-0.5 rounded-full">
                {r.category}
              </span>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="h-px bg-hairline" />

        {/* Row 3: brands reviewed + campaigns + products */}
        <div className="flex flex-col gap-2 flex-1">
          {r.brands.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">แบรนด์ที่เคยรีวิว</div>
              <div className="flex flex-wrap gap-1.5">
                {r.brands.map(b => (
                  <span
                    key={b.brand_id}
                    className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 bg-canvas border border-hairline rounded-full"
                    title={`${b.brand_name} — ${b.products.length} สินค้า, ${b.campaigns.length} แคมเปญ`}
                  >
                    <BrandLogo name={b.brand_name} logoUrl={b.logo_url} size={14} />
                    <span className="text-[11px] font-medium text-ink">{b.brand_name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">แคมเปญ</div>
            <CampaignPills campaigns={r.campaigns} />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">สินค้า</div>
            <ProductPills products={r.products} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton card ────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-surface border border-hairline rounded-2xl overflow-hidden animate-pulse">
      <div className="h-1 bg-hairline" />
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
        <div className="h-px bg-hairline" />
        <div className="space-y-2">
          <div className="flex gap-1">
            <div className="h-4 bg-canvas rounded-md w-10" />
            <div className="h-4 bg-canvas rounded-md w-10" />
            <div className="h-4 bg-canvas rounded-md w-10" />
          </div>
          <div className="flex gap-1">
            <div className="h-4 bg-canvas rounded-md w-20" />
            <div className="h-4 bg-canvas rounded-md w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function KolsPage() {
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
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
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
      setCached(cacheKey, res);
      setRows(res.rows);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, platformId, categoryId, page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / LIMIT);
  const hasFilters = !!q || !!platformId || !!categoryId;

  function clearAll() { setQ(''); setPlatformId(''); setCategoryId(''); setPage(1); }

  return (
    <div className="px-6 py-6 max-w-screen-xl mx-auto">
      {/* Header + filters in one row */}
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">KOL Directory</h1>
          <p className="text-sm text-muted mt-0.5">{total.toLocaleString()} KOL ทั้งหมด</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="ค้นหา KOL"
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
            options={[{ id: '', label: 'ทุก Platform' }, ...platforms.map(p => ({ id: p.id, label: p.name }))]}
            value={platformId}
            onChange={v => { setPlatformId(v); setPage(1); }}
          />

          <Select
            size="sm" className="min-w-[140px]"
            options={[{ id: '', label: 'ทุก Category' }, ...categories.map(c => ({ id: c.id, label: c.name }))]}
            value={categoryId}
            onChange={v => { setCategoryId(v); setPage(1); }}
          />

          {hasFilters && (
            <button onClick={clearAll} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
              <X size={11} /> ล้างทั้งหมด
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
          <p className="text-sm font-medium text-ink">ไม่พบ KOL</p>
          <p className="text-xs text-muted mt-1">ลองเปลี่ยนเงื่อนไขการค้นหา</p>
          {hasFilters && (
            <button onClick={clearAll} className="mt-4 text-xs text-accent hover:underline">ล้างตัวกรอง</button>
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
            {total.toLocaleString('th-TH')} KOL · หน้า {page}/{totalPages}
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
