import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, MeasuringStrategy, pointerWithin,
  useDraggable, useDroppable, type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, CalendarDays, List, X, ExternalLink, AlertCircle, CalendarClock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { getCalendar, getCalendarKolLatest, getDropdowns, searchKols, reschedulePlacement, type CalendarEvent, type CalendarResponse, type Brand, type KolResult } from '../api/index.js';
import { getCached, setCached, isFresh, invalidateCachePrefix } from '../lib/swrCache.js';
import KolAvatar from '../components/KolAvatar.js';
import PlatformLogo from '../components/PlatformLogo.js';
import Toast from '../components/Toast.js';
import { useModalTransition } from '../hooks/useModalTransition.js';

// ─── date helpers ────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Returns the Sunday that starts the 6-week grid for the given year/month (0-indexed)
function gridStart(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const daysBack = first.getDay(); // Sun-based: Sun=0
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
  const l = locale.startsWith('th') ? `${locale}-u-ca-gregory` : locale;
  return new Date(year, month, 1).toLocaleString(l, { month: 'long', year: 'numeric' });
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

// Thai weekday colours (สีประจำวัน), Sun→Sat. Kept gentle, not loud —
// applied only to the small day-of-week header labels.
const DOW_COLOR: string[] = [
  'text-red-400',       // อาทิตย์ — แดง
  'text-amber-500',     // จันทร์ — เหลือง
  'text-pink-400',      // อังคาร — ชมพู
  'text-emerald-500',   // พุธ — เขียว
  'text-orange-400',    // พฤหัสบดี — ส้ม
  'text-sky-500',       // ศุกร์ — ฟ้า
  'text-purple-400',    // เสาร์ — ม่วง
];

// ─── EventDetailModal ────────────────────────────────────────────────────────

function EventDetailModal({
  event, onClose, canReschedule, onReschedule,
}: {
  event: CalendarEvent;
  onClose: () => void;
  canReschedule: boolean;
  onReschedule: (date: string) => void;
}) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);
  const chipCls = STATUS_CHIP[event.status] ?? STATUS_CHIP.planned;
  const isCancelled = event.status === 'cancelled';
  const [picking, setPicking] = useState(false);

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

        {/* Move date (mobile-friendly fallback to drag — also handy on desktop) */}
        {canReschedule && (
          <div className="mt-4">
            {picking ? (
              <input
                type="date"
                autoFocus
                defaultValue={event.date}
                onChange={e => { if (e.target.value) { onReschedule(e.target.value); requestClose(); } }}
                className="w-full px-3 py-2 bg-canvas border border-hairline rounded-xl text-sm text-ink outline-none focus:border-accent transition-colors"
              />
            ) : (
              <button
                onClick={() => setPicking(true)}
                className="flex items-center justify-center gap-2 w-full py-2 bg-canvas hover:bg-hairline rounded-xl text-sm font-medium text-ink transition-colors"
              >
                <CalendarClock size={14} />
                {t('calendar.moveDate')}
              </button>
            )}
          </div>
        )}

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

// Presentational chip contents — shared by the in-grid button and the DragOverlay.
// Left bar = platform colour (scannable), avatar + handle, status dot on the right.
function EventChipContent({ event }: { event: CalendarEvent }) {
  const isCancelled = event.status === 'cancelled';
  return (
    <>
      {/* Status = the colour stripe (planned/posted/cancelled); platform = the logo. */}
      <span className={`w-[3px] self-stretch shrink-0 ${STATUS_DOT[event.status] ?? STATUS_DOT.planned}`} />
      <span className="flex-1 min-w-0 flex items-center gap-1.5 pl-1.5 pr-2 py-[3px]">
        <KolAvatar handle={event.handle} avatarUrl={event.avatar_url} size="sm" />
        <span className={`flex-1 min-w-0 truncate text-left text-[11.5px] leading-tight text-ink ${isCancelled ? 'line-through opacity-60' : ''}`}>
          {event.handle}
        </span>
        {event.platform && <PlatformLogo name={event.platform} size={12} />}
      </span>
    </>
  );
}

function DraggableEventChip({
  event, draggable, onClick,
}: {
  event: CalendarEvent;
  draggable: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(event.id),
    disabled: !draggable,
  });
  const isCancelled = event.status === 'cancelled';

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      className={`group w-full flex items-stretch overflow-hidden rounded-lg bg-surface ring-1 ring-hairline hover:ring-accent/30 hover:shadow-sm transition-all ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isCancelled ? 'opacity-50' : ''}`}
      title={`${event.kol_name} · ${event.status}`}
    >
      <EventChipContent event={event} />
    </button>
  );
}

// Droppable day cell wrapper — highlights when an event hovers over it.
// baseBg is kept separate so the drag-over highlight cleanly replaces it
// (no competing bg-* utilities in one class string).
function DroppableDay({
  dateStr, baseBg, className, children,
}: {
  dateStr: string;
  baseBg: string;
  className: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });
  return (
    <div
      ref={setNodeRef}
      className={`${className} transition-colors ${isOver ? 'bg-accent/10 ring-1 ring-inset ring-accent/40' : baseBg}`}
    >
      {children}
    </div>
  );
}

// Month-nav arrow flanking the grid. Click = change month. During a drag,
// it's a drop zone: hovering it auto-advances the month (handled by the
// parent's onDragOver timer) so events can be dragged across months.
function MonthNavEdge({
  dir, label, onNav, droppable,
}: {
  dir: 'prev' | 'next';
  label: string;
  onNav: () => void;
  droppable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `nav-${dir}`, disabled: !droppable });
  return (
    <button
      ref={setNodeRef}
      onClick={onNav}
      aria-label={label}
      title={label}
      className={`group shrink-0 self-stretch w-8 sm:w-10 flex items-center justify-center rounded-2xl transition-colors ${
        isOver ? 'bg-accent/10 text-accent' : 'text-muted/40 hover:text-ink'
      }`}
    >
      <span
        className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
          isOver ? 'bg-accent/15 scale-110' : 'group-hover:bg-surface group-hover:shadow-sm'
        }`}
      >
        {dir === 'prev' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </span>
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

// ─── Legend ──────────────────────────────────────────────────────────────────

function Legend() {
  const { t } = useTranslation();
  const items: { status: string; label: string }[] = [
    { status: 'planned', label: t('calendar.statusPlanned') },
    { status: 'posted', label: t('calendar.statusPosted') },
    { status: 'cancelled', label: t('calendar.statusCancelled') },
  ];
  return (
    <div className="flex items-center gap-3">
      {items.map(it => (
        <div key={it.status} className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[it.status]}`} />
          <span className="text-[11px] text-muted">{it.label}</span>
        </div>
      ))}
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

type ToastState = {
  id: number;
  message: string;
  variant?: 'success' | 'error';
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export default function CalendarPage() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === 'admin';
  const canDrag = appUser?.role === 'admin' || appUser?.role === 'marketing';

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
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);

  const [brands, setBrands] = useState<Brand[]>([]);

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastIdRef = useRef(0);
  const closeToast = useCallback(() => setToast(null), []);
  const showToast = useCallback((s: Omit<ToastState, 'id'>) => {
    setToast({ ...s, id: ++toastIdRef.current });
  }, []);

  const seqRef = useRef(0);
  const jumpSeqRef = useRef(0);
  const rescheduleSeqRef = useRef(0);
  // Auto month-navigation while dragging over an edge arrow (cross-month drag).
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navDirRef = useRef<'prev' | 'next' | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

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

  const locale = document.documentElement.lang || 'th';

  const load = useCallback(async () => {
    const mySeq = ++seqRef.current;
    const cacheKey = `calendar:${JSON.stringify({ from, to, brandId, kolId, statusFilter, typeFilter })}`;
    const cached = getCached<CalendarResponse>(cacheKey);
    if (cached) {
      setEvents(cached.events);
      setNoDateCount(cached.meta.no_date_count);
      setLoading(false);
      if (isFresh(cacheKey)) return; // data is still fresh — skip the background refetch
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

  // Latest load() kept in a ref so reschedule can resync the visible month
  // (needed for cross-month drops) without depending on load's identity.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Latest events kept in a ref so reschedule can tell, without a stale closure,
  // whether the dragged chip currently lives in the visible month.
  const eventsRef = useRef(events);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Reset expanded cell when month changes
  useEffect(() => { setExpandedDate(null); }, [year, month]);

  // ── Reschedule (drag-to-move / modal "move date") ──────────────────────────
  const fmtShort = useCallback(
    (dateStr: string) => new Date(dateStr + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
    [locale]
  );

  const applyEventDate = useCallback((id: number, date: string) => {
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, date } : e)));
  }, []);

  // Core move: optimistic update + API call + rollback on failure (no toast).
  // Returns whether it succeeded and whether a newer move superseded it (race guard).
  const sendReschedule = useCallback(async (
    ev: CalendarEvent, targetDate: string, fromDate: string,
  ): Promise<{ ok: boolean; superseded: boolean }> => {
    // Optimistic: move chip immediately (may leave the visible month — that's fine).
    // Capture whether the chip is in the currently-loaded month BEFORE moving it:
    // a same-month move is fully handled on screen, but a cross-month move can't
    // be (the destination month isn't loaded), so only the latter needs a reload.
    const wasVisible = eventsRef.current.some(e => e.id === ev.id);
    applyEventDate(ev.id, targetDate);
    invalidateCachePrefix('calendar:');
    const mySeq = ++rescheduleSeqRef.current;
    try {
      await reschedulePlacement(ev.id, targetDate);
      // Only resync on a cross-month move so the chip appears in the destination.
      // Skipping it for same-month moves removes the full-grid reload flicker that
      // made every drag feel laggy even though the optimistic update was instant.
      if (!wasVisible) loadRef.current();
      return { ok: true, superseded: rescheduleSeqRef.current !== mySeq };
    } catch {
      if (rescheduleSeqRef.current === mySeq) {
        applyEventDate(ev.id, fromDate); // rollback
        invalidateCachePrefix('calendar:');
      }
      return { ok: false, superseded: false };
    }
  }, [applyEventDate]);

  const performReschedule = useCallback(async (
    ev: CalendarEvent, newDate: string, oldDate: string,
  ) => {
    if (newDate === oldDate) return;
    const r = await sendReschedule(ev, newDate, oldDate);
    if (!r.ok) {
      showToast({ message: t('calendar.rescheduleFailed'), variant: 'error', duration: 4000 });
      return;
    }
    if (r.superseded) return; // a newer drag won — don't show a stale toast
    showToast({
      message: t('calendar.rescheduled', { handle: ev.handle, date: fmtShort(newDate) }),
      variant: 'success',
      duration: 6000,
      action: {
        label: t('common.undo'),
        onClick: async () => {
          const u = await sendReschedule(ev, oldDate, newDate);
          if (!u.ok) showToast({ message: t('calendar.rescheduleFailed'), variant: 'error', duration: 4000 });
        },
      },
    });
  }, [sendReschedule, fmtShort, showToast, t]);

  function clearNavTimer() {
    if (navTimerRef.current) { clearTimeout(navTimerRef.current); navTimerRef.current = null; }
    navDirRef.current = null;
  }

  function onDragStart(e: DragStartEvent) {
    const ev = events.find(x => String(x.id) === e.active.id);
    setActiveEvent(ev ?? null);
  }

  // Hovering an edge arrow during a drag auto-advances the month (after a
  // brief intentional hold) and keeps advancing while held, so an event can
  // be carried across months and dropped on a day in the destination.
  function onDragOver(e: DragOverEvent) {
    const overId = e.over?.id;
    const dir = overId === 'nav-prev' ? 'prev' : overId === 'nav-next' ? 'next' : null;
    if (dir === navDirRef.current) return; // unchanged — let the running timer continue
    clearNavTimer();
    navDirRef.current = dir;
    if (!dir) return;
    const step = dir === 'prev' ? prevMonth : nextMonth;
    const tick = () => { step(); navTimerRef.current = setTimeout(tick, 700); };
    navTimerRef.current = setTimeout(tick, 450);
  }

  function onDragEnd(e: DragEndEvent) {
    clearNavTimer();
    const ev = activeEvent;
    setActiveEvent(null);
    if (!ev || !e.over) return;
    const overId = String(e.over.id);
    if (overId === 'nav-prev' || overId === 'nav-next') return; // dropped on an arrow, not a day
    performReschedule(ev, overId, ev.date);
  }

  function onDragCancel() {
    clearNavTimer();
    setActiveEvent(null);
  }

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

  const monthTitle = monthLabel(year, month, locale);
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(locale, { month: 'short' })
  );

  // Day-of-week headers Mon–Sun
  const DOW_LABELS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const DOW_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_LABELS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dowLabels = locale.startsWith('zh') ? DOW_LABELS_ZH : locale.startsWith('th') ? DOW_LABELS_TH : DOW_LABELS_EN;

  // Agenda: events sorted by date, grouped
  const agendaDates = Object.keys(eventsByDate).sort();

  const CHIP_MAX = 3;

  // Drag is desktop-only (month grid too small to aim on touch); mobile uses the
  // "move date" button inside the modal instead.
  const dndEnabled = canDrag && !isMobile();

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
                    <input
                      type="number"
                      value={pickerYear}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 2000 && v <= 2099) setPickerYear(v);
                      }}
                      className="w-16 text-center text-sm font-semibold text-ink bg-transparent outline-none border-b border-hairline focus:border-accent transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
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

          {/* Legend */}
          <div className="ml-auto hidden sm:block">
            <Legend />
          </div>
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
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <div className="flex items-stretch gap-0.5 sm:gap-1">
            {/* Prev-month arrow — click to navigate, or hover while dragging to carry an event back a month */}
            <MonthNavEdge dir="prev" label={t('calendar.prevMonth')} onNav={prevMonth} droppable={dndEnabled} />
            {/* Single gap-px grid: the hairline shows through 1px gaps as clean,
                uniform cell lines (no doubled borders); ring adds the outer edge. */}
            <div className="flex-1 min-w-0 rounded-2xl overflow-hidden bg-hairline ring-1 ring-hairline">
              <div className="grid grid-cols-7 gap-px">
                {/* Day-of-week header row (same grid so lines stay aligned) */}
                {dowLabels.map((d, i) => (
                  <div
                    key={d}
                    className={`bg-canvas py-2 text-center text-[11px] font-semibold tracking-wide ${DOW_COLOR[i]}`}
                  >
                    {d}
                  </div>
                ))}

                {grid.map((date, i) => {
                  const dateStr = formatDate(date);
                  const isCurrentMonth = date.getMonth() === month;
                  const isToday = dateStr === TODAY_STR;
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const dayEvents = eventsByDate[dateStr] ?? [];
                  const isExpanded = expandedDate === dateStr;
                  const shown = isExpanded ? dayEvents : dayEvents.slice(0, CHIP_MAX);
                  const overflow = dayEvents.length - CHIP_MAX;

                  const cellBg = !isCurrentMonth
                    ? 'bg-canvas/70'
                    : isToday
                      ? 'bg-accent/[0.05]'
                      : isWeekend
                        ? 'bg-canvas/40'
                        : 'bg-surface';

                  return (
                    <DroppableDay
                      key={i}
                      dateStr={dateStr}
                      baseBg={cellBg}
                      className={`min-h-[94px] p-1.5 flex flex-col gap-0.5 ${!isCurrentMonth ? 'opacity-45' : ''}`}
                    >
                      {/* Day number */}
                      <div className={`self-start min-w-6 h-6 px-1.5 flex items-center justify-center text-xs rounded-full mb-0.5 ${
                        isToday
                          ? 'bg-accent text-white font-semibold'
                          : isCurrentMonth
                            ? `text-ink font-medium ${isWeekend ? 'text-muted' : ''}`
                            : 'text-muted'
                      }`}>
                        {date.getDate()}
                      </div>

                      {/* Event chips */}
                      {shown.map(ev => (
                        <DraggableEventChip
                          key={ev.id}
                          event={ev}
                          draggable={dndEnabled && ev.status !== 'cancelled'}
                          onClick={() => { setSelectedEvent(ev); setExpandedDate(null); }}
                        />
                      ))}

                      {/* "+N more" / collapse */}
                      {!isExpanded && overflow > 0 && (
                        <button
                          onClick={() => setExpandedDate(dateStr)}
                          className="self-start mt-px px-2 py-0.5 rounded-full text-[10.5px] text-muted font-medium hover:bg-hairline/60 hover:text-ink transition-colors"
                        >
                          {t('calendar.moreItems', { n: overflow })}
                        </button>
                      )}
                      {isExpanded && dayEvents.length > CHIP_MAX && (
                        <button
                          onClick={() => setExpandedDate(null)}
                          className="self-start mt-px px-2 py-0.5 rounded-full text-[10.5px] text-muted font-medium hover:bg-hairline/60 hover:text-ink transition-colors"
                        >
                          {t('calendar.showLess')}
                        </button>
                      )}
                    </DroppableDay>
                  );
                })}
              </div>
            </div>
            {/* Next-month arrow — hover while dragging to carry an event forward a month */}
            <MonthNavEdge dir="next" label={t('calendar.nextMonth')} onNav={nextMonth} droppable={dndEnabled} />
            </div>

            <DragOverlay dropAnimation={null}>
              {activeEvent && (
                <div className="flex items-stretch overflow-hidden rounded-lg bg-surface ring-1 ring-hairline shadow-xl scale-[1.03] min-w-[150px] max-w-[230px] cursor-grabbing">
                  <EventChipContent event={activeEvent} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
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
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold ${isToday ? 'text-accent' : 'text-ink'}`}>
                      {d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <div className="flex-1 h-px bg-hairline/60" />
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
                          className={`w-full flex items-stretch overflow-hidden bg-surface ring-1 ring-hairline rounded-xl hover:ring-accent/30 hover:shadow-sm transition-all text-left ${
                            isCancelled ? 'opacity-60' : ''
                          }`}
                        >
                          {/* Status stripe — same language as the month chips */}
                          <span className={`w-1 self-stretch shrink-0 ${STATUS_DOT[ev.status] ?? STATUS_DOT.planned}`} />
                          <span className="flex-1 min-w-0 flex items-center gap-3 pl-3 pr-3 py-2.5">
                            <KolAvatar handle={ev.handle} avatarUrl={ev.avatar_url} size="sm" />
                            <span className="flex-1 min-w-0">
                              <span className={`block text-sm font-medium text-ink truncate ${isCancelled ? 'line-through' : ''}`}>
                                {ev.kol_name}
                              </span>
                              <span className="flex items-center gap-1.5 mt-0.5">
                                {ev.platform && <PlatformLogo name={ev.platform} size={12} />}
                                <span className="text-[11px] text-muted truncate">@{ev.handle}</span>
                                {ev.campaign_code && (
                                  <span className="text-[10px] text-muted/70">· {ev.campaign_code}</span>
                                )}
                              </span>
                            </span>
                            {(ev.product_name || ev.store_name) && (
                              <span className="text-[11px] text-muted truncate max-w-[100px] shrink-0 hidden sm:block">
                                {ev.product_name ?? ev.store_name}
                              </span>
                            )}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${chipCls}`}>
                              {ev.status}
                            </span>
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
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          canReschedule={canDrag && selectedEvent.status !== 'cancelled'}
          onReschedule={date => performReschedule(selectedEvent, date, selectedEvent.date)}
        />
      )}

      {/* Toast (reschedule confirmation / undo / error) */}
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          variant={toast.variant}
          duration={toast.duration}
          action={toast.action}
          onClose={closeToast}
        />
      )}
    </div>
  );
}
