import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus } from 'lucide-react';

interface Option { id: string | number; label: string; iconUrl?: string | null; }

// small inline icon for options that opt in via `iconUrl` (e.g. brand logos) —
// falls back to an initial when there's no URL or it fails to load. Kept
// local instead of reusing BrandLogo so this generic dropdown stays
// domain-agnostic (any Select usage can pass iconUrl, not just brands).
function OptionIcon({ url, label }: { url: string | null | undefined; label: string }) {
  const [errored, setErrored] = useState(false);
  if (url && !errored) {
    return <img src={url} alt="" onError={() => setErrored(true)} className="w-4 h-4 rounded object-contain bg-white border border-hairline shrink-0" />;
  }
  return (
    <span className="w-4 h-4 rounded bg-canvas border border-hairline shrink-0 flex items-center justify-center text-[8px] font-bold text-muted">
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

interface Props {
  options: Option[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  addLabel?: string;
  onAddClick?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  // See PortalDropdownPanel below — opt-in for callers rendering this Select inside an
  // overflow-clipped ancestor (e.g. ImportEditGrid's overflow-x-auto table). Defaults to
  // false so every other call site keeps its existing absolute-positioned behavior.
  usePortal?: boolean;
}

export function DropdownPanel({ children, className = 'w-full mt-1.5 origin-top' }: { children: React.ReactNode; className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className={`absolute z-20 ${className} bg-surface border border-hairline rounded-2xl shadow-xl flex flex-col max-h-64 overflow-hidden transition-all duration-150 ease-out ${
      visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    }`}>
      {children}
    </div>
  );
}

// Portal-based variant of DropdownPanel — for a dropdown anchor that sits inside an
// overflow-x-auto (or any overflow-clipped) ancestor. Per CSS, setting overflow-x without
// overflow-y still computes overflow-y to 'auto' too, so such a container is an implicit
// vertical clip ancestor that cuts off a position:absolute dropdown near its bottom edge.
// Renders into document.body with position:fixed coordinates computed from the anchor's
// own getBoundingClientRect() instead — same technique as KolsPage.tsx's BrandHoverChip,
// the pre-existing pattern in this codebase for this exact problem.
export function PortalDropdownPanel({ anchorRef, width = 256, children }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  width?: number;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const panelHeight = 256; // matches max-h-64 below
    const above = r.bottom + panelHeight > window.innerHeight && r.top > panelHeight;
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setStyle(above
      ? { position: 'fixed', bottom: window.innerHeight - r.top + 6, left, width, zIndex: 50 }
      : { position: 'fixed', top: r.bottom + 6, left, width, zIndex: 50 });
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [anchorRef, width]);
  if (!style) return null;
  return createPortal(
    // data-import-dropdown-portal: read by callers' outside-click handlers — this panel is
    // portaled to document.body, outside the anchor's own subtree, so a plain
    // `ref.contains(e.target)` check would treat every click inside the panel as "outside"
    // and close it before the option's own onClick ever fires.
    <div data-import-dropdown-portal style={style} className={`bg-surface border border-hairline rounded-2xl shadow-xl flex flex-col max-h-64 overflow-hidden transition-all duration-150 ease-out ${
      visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    }`}>
      {children}
    </div>,
    document.body,
  );
}

export default function Select({
  options, value, onChange, placeholder, addLabel, onAddClick, disabled,
  size = 'md', className = '', usePortal = false,
}: Props) {
  const { t } = useTranslation();
  const effectivePlaceholder = placeholder ?? t('common.selectPlaceholder');
  const effectiveAddLabel = addLabel ?? t('common.addNew');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => String(o.id) === value);

  useEffect(() => {
    // usePortal: the panel renders outside containerRef's subtree (into document.body),
    // so a plain containerRef.contains(e.target) check would treat every click inside the
    // portaled panel as "outside" and close it before the option's own onClick ever fires.
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (containerRef.current && !containerRef.current.contains(target) && !target.closest('[data-import-dropdown-portal]')) setOpen(false);
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, []);

  const padding = size === 'sm' ? 'px-3 py-1.5' : 'px-3 py-2';

  const panelContent = (
    <>
      <div className="overflow-y-auto flex-1">
        {options.length === 0 && (
          <div className="px-3 py-3 text-sm text-muted">{t('common.noItems')}</div>
        )}
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            className={[
              'w-full text-left px-3 py-2.5 text-sm hover:bg-canvas border-b border-hairline last:border-0 transition-colors',
              String(o.id) === value ? 'text-accent font-medium bg-accent/5' : 'text-ink',
            ].join(' ')}
            onClick={() => { onChange(String(o.id)); setOpen(false); }}
          >
            <span className="flex items-center gap-2">
              {o.iconUrl !== undefined && <OptionIcon url={o.iconUrl} label={o.label} />}
              {o.label}
            </span>
          </button>
        ))}
      </div>
      {onAddClick && (
        <button
          type="button"
          className="w-full text-left px-3 py-2.5 text-accent hover:bg-canvas font-medium text-sm border-t border-hairline flex-shrink-0 flex items-center gap-1.5 transition-colors"
          onClick={() => { setOpen(false); onAddClick(); }}
        >
          <Plus size={13} />
          {effectiveAddLabel}
        </button>
      )}
    </>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={[
          `w-full flex items-center justify-between ${padding} rounded-xl text-sm text-left transition-all duration-150`,
          disabled
            ? 'bg-canvas border border-hairline text-muted cursor-not-allowed opacity-60'
            : 'bg-input-bg border border-input-border text-ink hover:border-accent/40 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent',
          open ? 'ring-2 ring-accent border-accent/30 shadow-sm' : '',
        ].join(' ')}
      >
        <span className={`flex items-center gap-1.5 min-w-0 ${selected ? 'text-ink' : 'text-muted'}`}>
          {selected && selected.iconUrl !== undefined && <OptionIcon url={selected.iconUrl} label={selected.label} />}
          <span className="truncate">{selected ? selected.label : effectivePlaceholder}</span>
        </span>
        <ChevronDown size={14} className={`text-muted transition-transform duration-200 flex-shrink-0 ml-1.5 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (usePortal
        ? <PortalDropdownPanel anchorRef={containerRef}>{panelContent}</PortalDropdownPanel>
        : <DropdownPanel>{panelContent}</DropdownPanel>
      )}
    </div>
  );
}
