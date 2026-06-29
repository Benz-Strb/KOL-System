import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CalendarDays, List, X, ExternalLink, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { getCalendar, getCalendarKolLatest, getDropdowns, searchKols, type CalendarEvent, type CalendarResponse, type Brand, type KolResult } from '../api/index.js';
import { getCached, setCached } from '../lib/swrCache.js';
import KolAvatar from '../components/KolAvatar.js';
import PlatformLogo from '../components/PlatformLogo.js';
import { useModalTransition } from '../hooks/useModalTransition.js';

// ─── date helpers ────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Returns the Monday that starts the 6-week grid for the given year/month (0-indexed)
function gridStart(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dow = first.getDay(); // 0=Sun
  const daysBack = (dow + 6) % 7; // Mon-based: Mon=0
  const d = new Date(first);
  d.setDate(d.getDate() - daysBack);
  return d;
}

// Returns an array of 42 dates (6 rows × 7 cols, Mon–Sun)
function buildGrid(year: number, month: number): Date[] {
  const start = gridStart(year, month);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function monthLabel(year: number, month: number, locale: string): string {
  return new Date(year, month, 1).toLocaleString(locale, { month: 'long', year: 'numeric' });
}

// ─── status colours ──────────────────────────────────────────────────────────

const STATUS_CHIP: Record<string, string> = {
  planned:   'bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20',
  posted:    'bg-green-100 text-green-800 ring-1 ring-green-200 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/20',
  cancelled: 'bg-gray-100 text-gray-400 ring-1 ring-gray-200 dark:bg-white/5 dark:text-[#86868b] dark:ring-white/10',
};

const STATUS_DOT: Record<string, string> = {
  planned:   'bg-amber-400',
  posted:    'bg-green-500',
  cancelled: 'bg-gray-300 dark:bg-[#86868b]',
};

// ─── EventDetailModal ────────────────────────────────────────────────────────

function EventDetailModal({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);
  const chipCls = STATUS_CHIP[event.status] ?? STATUS_CHIP.planned;
  const isCancelled = event.status === 'cancelled';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 transition-all duration-180 ${
        closed ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={requestClose} />
      <div
        className={`relative bg-surface border border-hairline rounded-2xl shadow-2xl w-full max-w-sm p-5 transition-all duration-180 ${
          closed ? 'translate-y-4 opacity-0 scale-95' : 'translate-y-0 opacity-100 scale-100'
        }`}
      >
        <button
          onClick={requestClose}
          className="absolute top-4 right-4 text-muted hover:text-ink transition-colors p-1 rounded-lg hover:bg-canvas"
        >
          <X size={16} />
        </button>

        {/* KOL row */}
        <div className="flex items-center gap-3 mb-4">
          <KolAvatar handle={event.handle} avatarUrl={event.avatar_url} size="sm" />
          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-sm text-ink truncate ${isCancelled ? 'line-through opacity-60' : ''}`}>
              {event.kol_name}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {event.platform && <PlatformLogo name={event.platform} size={14} />}
              <span className="text-xs text-muted">@{event.handle}</span>
            </div>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${chipCls}`}>
            {event.status}
          </span>
        </div>

        {/* Meta rows */}
        <div className="space-y-1.5 text-sm">
          <MetaRow label={event.date_source === 'target' ? t('calendar.dateSourceTarget') : t('calendar.dateSourceActual')}>
            {event.date}
          </MetaRow>
          {event.campaign_code && <MetaRow label="Campaign">{event.campaign_code}</MetaRow>}
          {event.product_name && <MetaRow label="Model">{event.product_name}</MetaRow>}
          {event.store_name && <MetaRow label="Store">{event.store_name}</MetaRow>}
          <MetaRow label="Type">{event.placement_type === 'online' ? 'Online' : 'Offline'}</MetaRow>
          {event.post_url && (
            <div className="pt-1">
              <a
                href={event.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-accent hover:underline text-xs font-medium"
              >
                <ExternalLink size={13} />
                Post URL
              </a>
            </div>
          )}
        </div>

        {/* Link to placements */}
        <div className="mt-4 pt-4 border-t border-hairline">
          <Link
            to={`/placements/${event.id}`}
            onClick={requestClose}
            className="flex items-center justify-center gap-2 w-full py-2 bg-canvas hover:bg-hairline rounded-xl text-sm font-medium text-ink transition-colors"
          >
            <CalendarDays size={14} />
            {t('calendar.clickToViewPlacements')}
          </Link>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted shrink-0 w-28 text-xs pt-0.5">{label}</span>
      <span className="text-ink text-xs font-medium">{children}</span>
    </div>
  );
}

// ─── EventChip ───────────────────────────────────────────────────────────────

function EventChip({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const isCancelled = event.status === 'cancelled';
  const chipCls = STATUS_CHIP[event.status] ?? STATUS_CHIP.planned;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-opacity hover:opacity-80 ${chipCls} ${
        isCancelled ? 'opacity-50' : ''
      }`}
      title={`${event.kol_name} · ${event.status}`}
    >
      <KolAvatar handle={event.handle} avatarUrl={event.avatar_url} size="sm" />
      <span className={`truncate min-w-0 ${isCancelled ? 'line-through' : ''}`}>
        {event.handle}
      </span>
      {event.platform && (
        <PlatformLogo name={event.platform} size={12} />
      )}
    </button>
  );
}

// ─── KolSearchInput ──────────────────────────────────────────────────────────

function KolSearchInput({
  value, label, onSelect, onClear,
}: {
  value: string;
  label: string;
  onSelect: (kol: KolResult) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(label);
  const [results, setResults] = useState<KolResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) setQuery('');
    else if (label) setQuery(label);
  }, [value, label]);

  function handleChange(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const mySeq = ++seqRef.current;
      setSearching(true);
      try {
        const r = await searchKols(q);
        if (seqRef.current !== mySeq) return;
        setResults(r);
        setOpen(true);
      } finally {
        if (seqRef.current === mySeq) setSearching(false);
      }
    }, 300);
  }

  function select(kol: KolResult) {
    const primaryPlatform = kol.platforms.find(p => p.is_primary) ?? kol.platforms[0];
    setQuery(primaryPlatform?.handle ?? kol.handle);
    setOpen(false);
    setResults([]);
    onSelect(kol);
  }

  function clear() {
    setQuery('');
    setResults([]);
    setOpen(false);
    onClear();
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1 px-2.5 h-8 bg-surface border border-hairline rounded-lg text-sm">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={t('calendar.filterKol')}
          className="flex-1 bg-transparent outline-none placeholder-muted text-ink text-xs min-w-0"
        />
        {searching && (
          <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        )}
        {value && !searching && (
          <button onClick={clear} className="shrink-0 text-muted hover:text-ink transition-colors">
            <X size={12} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-surface border border-hairline rounded-xl shadow-xl z-30 py-1 max-h-48 overflow-y-auto">
          {results.map(kol => {
            const primary = kol.platforms.find(p => p.is_primary) ?? kol.platforms[0];
            return (
              <button
                key={kol.id}
                onMouseDown={e => { e.preventDefault(); select(kol); }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-canvas text-left text-sm"
              >
                <KolAvatar handle={primary?.handle ?? kol.handle} avatarUrl={primary?.avatar_url ?? null} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink truncate">{primary?.handle ?? kol.handle}</div>
                  {kol.gen_name && <div className="text-[10px] text-muted truncate">{kol.gen_name}</div>}
                </div>
                {primary && <PlatformLogo name={primary.platform_name} size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── CalendarPage ─────────────────────────────────────────────────────────────

const TODAY = new Date();
const TODAY_STR = formatDate(TODAY);

// Detect mobile to set default view
function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

export default function CalendarPage() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === 'admin';

  const [viewMode, setViewMode] = useState<'month' | 'agenda'>(() => isMobile() ? 'agenda' : 'month');
  const [year, setYear] = useState(TODAY.getFullYear());
  const [month, setMonth] = useState(TODAY.getMonth()); // 0-indexed

  const [brandId, setBrandId] = useState('');
  const [kolId, setKolId] = useState('');
  const [kolLabel, setKolLabel] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [noDateCount, setNoDateCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const [brands, setBrands] = useState<Brand[]>([]);

  const seqRef = useRef(0);
  const jumpSeqRef = useRef(0);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);
  const pickerRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    setPickerYear(year);
    setPickerOpen(true);
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function handleOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [pickerOpen]);

  // Load brand list for admin filter
  useEffect(() => {
    if (isAdmin) {
      getDropdowns().then(d => setBrands(d.brands)).catch(() => {});
    }
  }, [isAdmin]);

  // Build date range: full grid including padding weeks
  const grid = buildGrid(year, month);
  const from = formatDate(grid[0]);
  const to = formatDate(grid[grid.length - 1]);

  const load = useCallback(async () => {
    const mySeq = ++seqRef.current;
    const cacheKey = `calendar:${JSON.stringify({ from, to, brandId, kolId, statusFilter, typeFilter })}`;
    const cached = getCached<CalendarResponse>(cacheKey);
    if (cached) {
      setEvents(cached.events);
      setNoDateCount(cached.meta.no_date_count);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await getCalendar({
        from, to,
        brand_id: brandId || undefined,
        kol_id: kolId || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        placement_type: typeFilter !== 'all' ? typeFilter : undefined,
      });
      if (seqRef.current !== mySeq) return;
      setCached(cacheKey, res);
      setEvents(res.events);
      setNoDateCount(res.meta.no_date_count);
    } catch {
      if (seqRef.current === mySeq && !cached) { setEvents([]); setNoDateCount(0); }
    } finally {
      if (seqRef.current === mySeq) setLoading(false);
    }
  }, [from, to, brandId, kolId, statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  // Reset expanded cell when month changes
  useEffect(() => { setExpandedDate(null); }, [year, month]);

  // Group events by date
  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    (acc[e.date] ??= []).push(e);
    return acc;
  }, {});

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    setYear(TODAY.getFullYear());
    setMonth(TODAY.getMonth());
  }

  const locale = document.documentElement.lang || 'th';
  const monthTitle = monthLabel(year, month, locale);
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(locale, { month: 'short' })
  );

  // Day-of-week headers Mon–Sun
  const DOW_LABELS_TH = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
  const DOW_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DOW_LABELS_ZH = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const dowLabels = locale.startsWith('zh') ? DOW_LABELS_ZH : locale.startsWith('th') ? DOW_LABELS_TH : DOW_LABELS_EN;

  // Agenda: events sorted by date, grouped
  const agendaDates = Object.keys(eventsByDate).sort();

  const CHIP_MAX = 3;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <div className="sticky top-0 lg:top-0 z-20 bg-canvas border-b border-hairline">
        <div className="px-4 lg:px-6 py-3 flex items-center gap-3">
          <h1 className="text-base font-semibold text-ink mr-auto">{t('calendar.title')}</h1>

          {/* View toggle */}
          <div className="flex items-center bg-surface border border-hairline rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setViewMode('month')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'month' ? 'bg-white dark:bg-white/10 text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              <CalendarDays size={13} />
              <span className="hidden sm:inline">{t('calendar.monthView')}</span>
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'agenda' ? 'bg-white dark:bg-white/10 text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              <List size={13} />
              <span className="hidden sm:inline">{t('calendar.listView')}</span>
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-4 lg:px-6 pb-3 flex flex-wrap items-center gap-2">
          {/* Month navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-surface border border-transparent hover:border-hairline text-muted hover:text-ink transition-all"
            >
              <ChevronLeft size={15} />
            </button>

            {/* Month/year picker trigger */}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={openPicker}
                className="text-sm font-medium text-ink w-36 text-center px-2 py-1 rounded-lg border border-transparent hover:bg-surface hover:border-hairline transition-all"
              >
                {monthTitle}
              </button>

              {pickerOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-30 bg-surface border border-hairline rounded-xl shadow-xl p-3 w-52">
                  {/* Year nav */}
                  <div className="flex items-center justify-between mb-2.5">
                    <button
                      onClick={() => setPickerYear(y => y - 1)}
                      className="p-1 rounded-lg hover:bg-canvas text-muted hover:text-ink transition-colors"
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <span className="text-sm font-semibold text-ink">{pickerYear}</span>
                    <button
                      onClick={() => setPickerYear(y => y + 1)}
                      className="p-1 rounded-lg hover:bg-canvas text-muted hover:text-ink transition-colors"
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                  {/* Month grid */}
                  <div className="grid grid-cols-3 gap-1">
                    {monthNames.map((name, i) => (
                      <button
                        key={i}
                        onClick={() => { setYear(pickerYear); setMonth(i); setPickerOpen(false); }}
                        className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          pickerYear === year && i === month
                            ? 'bg-accent text-white'
                            : 'text-ink hover:bg-canvas'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={nextMonth}
              className="p-1.5 rounded-lg hover:bg-surface border border-transparent hover:border-hairline text-muted hover:text-ink transition-all"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <button
            onClick={goToday}
            className="px-3 h-8 bg-surface border border-hairline rounded-lg text-xs font-medium text-muted hover:text-ink hover:border-accent/40 transition-all"
          >
            {t('calendar.today')}
          </button>

          {/* Brand filter (admin only) */}
          {isAdmin && brands.length > 0 && (
            <select
              value={brandId}
              onChange={e => setBrandId(e.target.value)}
              className="h-8 px-2.5 bg-surface border border-hairline rounded-lg text-xs text-ink outline-none cursor-pointer"
            >
              <option value="">{t('common.allBrands')}</option>
              {brands.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          )}

          {/* KOL search */}
          <KolSearchInput
            value={kolId}
            label={kolLabel}
            onSelect={async kol => {
              const primary = kol.platforms.find(p => p.is_primary) ?? kol.platforms[0];
              setKolId(String(kol.id));
              setKolLabel(primary?.handle ?? kol.handle);
              // กระโดดไปเดือนที่ KOL คนนี้มีงานใกล้สุด (race guard กันเลือกรัวๆ)
              const mySeq = ++jumpSeqRef.current;
              try {
                const { date } = await getCalendarKolLatest({ kol_id: String(kol.id), brand_id: brandId || undefined });
                if (jumpSeqRef.current !== mySeq) return;
                if (date) {
                  const d = new Date(date + 'T00:00:00');
                  setYear(d.getFullYear());
                  setMonth(d.getMonth());
                }
              } catch { /* เงียบไว้ — ถ้าหาเดือนไม่ได้ก็อยู่เดือนเดิม */ }
            }}
            onClear={() => { setKolId(''); setKolLabel(''); }}
          />

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-hairline rounded-lg text-xs text-ink outline-none cursor-pointer"
          >
            <option value="all">{t('calendar.statusAll')}</option>
            <option value="planned">{t('calendar.statusPlanned')}</option>
            <option value="posted">{t('calendar.statusPosted')}</option>
            <option value="cancelled">{t('calendar.statusCancelled')}</option>
          </select>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-hairline rounded-lg text-xs text-ink outline-none cursor-pointer"
          >
            <option value="all">{t('calendar.typeAll')}</option>
            <option value="online">{t('calendar.typeOnline')}</option>
            <option value="offline_shop">{t('calendar.typeOffline')}</option>
          </select>

          {loading && (
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin ml-1" />
          )}
        </div>
      </div>

      {/* No-date banner */}
      {noDateCount > 0 && (
        <div className="mx-4 lg:mx-6 mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle size={14} className="shrink-0" />
          <span>{t('calendar.noDateBanner', { count: noDateCount })}</span>
          <Link
            to={`/placements?${new URLSearchParams({
              no_date: '1',
              ...(brandId ? { brand_id: brandId } : {}),
              ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
              ...(kolId ? { q: kolLabel } : {}),
            }).toString()}`}
            className="ml-auto font-medium underline underline-offset-2 hover:opacity-80 transition-opacity shrink-0"
          >
            {t('calendar.clickToViewPlacements')}
          </Link>
        </div>
      )}

      {/* Content */}
      <div className="p-4 lg:p-6">
        {viewMode === 'month' ? (
          // ── Month grid ──────────────────────────────────────────────────────
          <div className="bg-surface border border-hairline rounded-2xl overflow-hidden">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-hairline">
              {dowLabels.map(d => (
                <div key={d} className="py-2 text-center text-[11px] font-medium text-muted">{d}</div>
              ))}
            </div>

            {/* Cells */}
            <div className="grid grid-cols-7 divide-x divide-hairline">
              {grid.map((date, i) => {
                const dateStr = formatDate(date);
                const isCurrentMonth = date.getMonth() === month;
                const isToday = dateStr === TODAY_STR;
                const dayEvents = eventsByDate[dateStr] ?? [];
                const isExpanded = expandedDate === dateStr;
                const shown = isExpanded ? dayEvents : dayEvents.slice(0, CHIP_MAX);
                const overflow = dayEvents.length - CHIP_MAX;

                return (
                  <div
                    key={i}
                    className={`min-h-[90px] p-1.5 border-b border-hairline flex flex-col gap-0.5 ${
                      !isCurrentMonth ? 'bg-canvas/60' : ''
                    }`}
                  >
                    {/* Day number */}
                    <div className={`self-start w-6 h-6 flex items-center justify-center text-xs font-medium rounded-full mb-0.5 ${
                      isToday
                        ? 'bg-accent text-white'
                        : isCurrentMonth
                          ? 'text-ink'
                          : 'text-muted/50'
                    }`}>
                      {date.getDate()}
                    </div>

                    {/* Event chips */}
                    {shown.map(ev => (
                      <EventChip
                        key={ev.id}
                        event={ev}
                        onClick={() => { setSelectedEvent(ev); setExpandedDate(null); }}
                      />
                    ))}

                    {/* "อีก N" / collapse */}
                    {!isExpanded && overflow > 0 && (
                      <button
                        onClick={() => setExpandedDate(dateStr)}
                        className="w-full text-left text-[10px] text-accent font-medium pl-1 hover:underline"
                      >
                        {t('calendar.moreItems', { n: overflow })}
                      </button>
                    )}
                    {isExpanded && dayEvents.length > CHIP_MAX && (
                      <button
                        onClick={() => setExpandedDate(null)}
                        className="w-full text-left text-[10px] text-muted font-medium pl-1 hover:underline"
                      >
                        ▲
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // ── Agenda / list view ───────────────────────────────────────────────
          <div className="space-y-4 max-w-2xl">
            {agendaDates.length === 0 && !loading && (
              <div className="text-center py-16 text-muted text-sm">{t('calendar.emptyMonth')}</div>
            )}
            {agendaDates.map(dateStr => {
              const dayEvents = eventsByDate[dateStr] ?? [];
              const d = new Date(dateStr + 'T00:00:00');
              const isToday = dateStr === TODAY_STR;
              return (
                <div key={dateStr}>
                  <div className={`flex items-center gap-2 mb-2 ${isToday ? 'text-accent' : 'text-muted'}`}>
                    <span className={`text-xs font-semibold ${isToday ? 'text-accent' : 'text-muted'}`}>
                      {d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <div className="flex-1 h-px bg-hairline" />
                    <span className="text-[10px] text-muted">{t('calendar.allDayEvents', { n: dayEvents.length })}</span>
                  </div>
                  <div className="space-y-1">
                    {dayEvents.map(ev => {
                      const isCancelled = ev.status === 'cancelled';
                      const chipCls = STATUS_CHIP[ev.status] ?? STATUS_CHIP.planned;
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          className={`w-full flex items-center gap-3 px-3 py-2 bg-surface border border-hairline rounded-xl hover:border-accent/30 transition-all text-left ${
                            isCancelled ? 'opacity-60' : ''
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[ev.status] ?? STATUS_DOT.planned}`} />
                          <KolAvatar handle={ev.handle} avatarUrl={ev.avatar_url} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium text-ink truncate ${isCancelled ? 'line-through' : ''}`}>
                              {ev.kol_name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {ev.platform && <PlatformLogo name={ev.platform} size={12} />}
                              <span className="text-[11px] text-muted truncate">@{ev.handle}</span>
                              {ev.campaign_code && (
                                <span className="text-[10px] text-muted/70">· {ev.campaign_code}</span>
                              )}
                            </div>
                          </div>
                          {(ev.product_name || ev.store_name) && (
                            <span className="text-[11px] text-muted truncate max-w-[100px] shrink-0 hidden sm:block">
                              {ev.product_name ?? ev.store_name}
                            </span>
                          )}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${chipCls}`}>
                            {ev.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
