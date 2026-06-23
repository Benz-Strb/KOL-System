import { useState, useEffect, useRef } from 'react';
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
}

export function DropdownPanel({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className={`absolute z-20 w-full mt-1.5 bg-surface border border-hairline rounded-2xl shadow-xl flex flex-col max-h-64 overflow-hidden origin-top transition-all duration-150 ease-out ${
      visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    }`}>
      {children}
    </div>
  );
}

export default function Select({
  options, value, onChange, placeholder = 'เลือก...', addLabel = 'เพิ่มใหม่', onAddClick, disabled,
  size = 'md', className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => String(o.id) === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
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
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <ChevronDown size={14} className={`text-muted transition-transform duration-200 flex-shrink-0 ml-1.5 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <DropdownPanel>
          <div className="overflow-y-auto flex-1">
            {options.length === 0 && (
              <div className="px-3 py-3 text-sm text-muted">ไม่มีรายการ</div>
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
              {addLabel}
            </button>
          )}
        </DropdownPanel>
      )}
    </div>
  );
}
