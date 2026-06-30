import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';

export type ExportLang = 'th' | 'en' | 'zh';

const LANG_OPTIONS: { lang: ExportLang; label: string }[] = [
  { lang: 'th', label: 'ไทย' },
  { lang: 'en', label: 'English' },
  { lang: 'zh', label: '中文' },
];

interface Props {
  label: string;
  onPick: (lang: ExportLang) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export default function ExportLangMenu({ label, onPick, disabled = false, icon }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  function handlePick(lang: ExportLang) {
    setOpen(false);
    onPick(lang);
  }

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#217346] text-white hover:bg-[#1a5c38] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        {icon ?? <Download size={12} />}
        {label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-50 min-w-[110px] bg-surface border border-hairline rounded-xl shadow-lg overflow-hidden">
          {LANG_OPTIONS.map(({ lang, label: langLabel }) => (
            <button
              key={lang}
              type="button"
              onClick={() => handlePick(lang)}
              className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-canvas transition-colors"
            >
              {langLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
