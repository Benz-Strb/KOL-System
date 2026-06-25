import { useState, useEffect, useRef } from 'react';
import { Languages, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownPanel } from './Select.js';
import { setLanguage, LANGUAGES, type AppLanguage } from '../i18n/index.js';

// Language names are shown in their own script regardless of the active UI
// language (a Chinese user picking the switcher should still see "ไทย", not
// a translated version of "Thai") — this is the standard convention for
// language pickers, so these are NOT i18n keys.
const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  th: 'ไทย',
  en: 'English',
  zh: '中文',
};

interface Props {
  variant?: 'dark' | 'light';
  openUp?: boolean;
}

export default function LanguageSwitcher({ variant = 'dark', openUp = false }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current: AppLanguage = LANGUAGES.includes(i18n.language as AppLanguage) ? (i18n.language as AppLanguage) : 'th';

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

  const triggerCls = variant === 'dark'
    ? 'text-white/50 hover:text-white hover:bg-white/5'
    : 'text-muted hover:text-ink hover:bg-canvas';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={t('common.selectLanguage')}
        className={`transition-colors p-1.5 rounded-lg ${triggerCls}`}
      >
        <Languages size={14} />
      </button>
      {open && (
        <DropdownPanel className={`w-32 right-0 ${openUp ? 'bottom-full mb-1.5 origin-bottom' : 'mt-1.5 origin-top'}`}>
          <div className="flex flex-col">
            {LANGUAGES.map(lang => (
              <button
                key={lang}
                type="button"
                onClick={() => { setLanguage(lang); setOpen(false); }}
                className={[
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-canvas transition-colors',
                  lang === current ? 'text-accent font-medium bg-accent/5' : 'text-ink',
                ].join(' ')}
              >
                {LANGUAGE_LABELS[lang]}
                {lang === current && <Check size={13} />}
              </button>
            ))}
          </div>
        </DropdownPanel>
      )}
    </div>
  );
}
