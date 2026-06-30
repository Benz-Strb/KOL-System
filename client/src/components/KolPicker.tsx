import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Plus, Users } from 'lucide-react';
import { searchKols, createKol, type KolResult, type Platform } from '../api/index.js';
import Modal from './Modal.js';
import Select, { DropdownPanel } from './Select.js';
import PlatformLogo from './PlatformLogo.js';

// Small logo chips listing every platform a kol has (not just primary) —
// enough to see at a glance "this one has TikTok + Instagram" while picking.
function PlatformChips({ platforms, className }: { platforms: KolResult['platforms']; className?: string }) {
  if (platforms.length === 0) return null;
  return (
    <div className={`flex items-center gap-1 flex-wrap ${className ?? ''}`}>
      {platforms.map(p => <PlatformLogo key={p.id} name={p.platform_name} size={16} />)}
    </div>
  );
}

interface Props {
  value: KolResult | null;
  onChange: (kol: KolResult | null) => void;
  platforms: Platform[];
  onAdded?: (handle: string) => void;
}

const inputCls = [
  'w-full px-3 py-2 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30',
].join(' ');
const labelCls = 'block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase';

export default function KolPicker({ value, onChange, platforms, onAdded }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newKol, setNewKol] = useState({ handle: '', gen_name: '', platform_id: '', follower_count: '' });
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchKols(query);
        if (searchSeq.current !== seq) return; // a newer keystroke already started a fetch
        setResults(r);
      } finally {
        if (searchSeq.current === seq) setLoading(false);
      }
    }, query.length === 0 ? 0 : 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, []);

  function selectKol(kol: KolResult) { onChange(kol); setQuery(''); setOpen(false); }
  function clear() { onChange(null); setQuery(''); setShowAddForm(false); }

  async function handleAddKol() {
    if (!newKol.handle.trim()) { setAddError(t('kolPicker.handleRequired')); return; }
    setAddError(''); setAddLoading(true);
    try {
      const created = await createKol({
        handle: newKol.handle.trim(),
        gen_name: newKol.gen_name.trim() || undefined,
        platform_id: newKol.platform_id ? Number(newKol.platform_id) : undefined,
        follower_count: newKol.follower_count ? Number(newKol.follower_count) : undefined,
      });
      onAdded?.(created.handle);
      selectKol(created);
      setShowAddForm(false); setAddError('');
      setNewKol({ handle: '', gen_name: '', platform_id: '', follower_count: '' });
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setAddLoading(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 bg-accent/5 border border-accent/20 rounded-xl">
        <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
          <Users size={13} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink text-sm tracking-tight">{value.handle}</div>
          {value.gen_name && <div className="text-xs text-muted truncate">{value.gen_name}</div>}
          {value.follower_count != null && (
            <div className="text-xs text-muted tabular-nums">{value.follower_count.toLocaleString()} followers</div>
          )}
          <PlatformChips platforms={value.platforms} className="mt-1" />
        </div>
        <button type="button" onClick={clear} className="text-muted hover:text-red-400 transition-colors flex-shrink-0">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={dropdownRef} className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder={t('kolPicker.searchPlaceholder')}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full pl-8 pr-3 py-2 rounded-full text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors"
        />
        {open && (
          <DropdownPanel>
            <div className="overflow-y-auto flex-1">
              {loading && (
                <div className="px-3 py-3 text-sm text-muted flex items-center gap-2">
                  <div className="w-3 h-3 border border-muted border-t-accent rounded-full animate-spin" />
                  {t('kolPicker.searching')}
                </div>
              )}
              {!loading && results.length === 0 && (
                <div className="px-3 py-3 text-sm text-muted">{t('kolPicker.noResults')}</div>
              )}
              {!loading && results.map(kol => (
                <button
                  key={kol.id}
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover:bg-canvas border-b border-hairline last:border-0 transition-colors"
                  onClick={() => selectKol(kol)}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-ink text-sm">{kol.handle}</span>
                      {kol.gen_name && <span className="text-sm text-muted ml-1.5">{kol.gen_name}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {kol.follower_count != null && (
                        <span className="text-xs text-muted tabular-nums">{kol.follower_count.toLocaleString()}</span>
                      )}
                      <PlatformChips platforms={kol.platforms} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {!showAddForm && (
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 text-accent hover:bg-canvas text-sm border-t border-hairline flex-shrink-0 flex items-center gap-1.5 font-medium transition-colors"
                onClick={() => { setShowAddForm(true); setNewKol(k => ({ ...k, handle: query })); }}
              >
                <Plus size={13} />
                {t('kolPicker.addNewKol')}{query ? ` "${query}"` : ''}
              </button>
            )}
          </DropdownPanel>
        )}
      </div>

      {showAddForm && (
        <Modal title={t('kolPicker.addNewKol')} onClose={() => { setShowAddForm(false); setAddError(''); setNewKol({ handle: '', gen_name: '', platform_id: '', follower_count: '' }); }}>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Handle / Username <span className="text-red-400 normal-case">*</span></label>
              <input type="text" placeholder="@username" value={newKol.handle}
                onChange={e => setNewKol(k => ({ ...k, handle: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('kolPicker.genName')}</label>
              <input type="text" placeholder={t('kolPicker.genNamePlaceholder')} value={newKol.gen_name}
                onChange={e => setNewKol(k => ({ ...k, gen_name: e.target.value }))} className={inputCls} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Platform</label>
                <Select
                  options={platforms.map(p => ({ id: p.id, label: p.name }))}
                  value={newKol.platform_id}
                  onChange={v => setNewKol(k => ({ ...k, platform_id: v }))}
                />
              </div>
              <div>
                <label className={labelCls}>Followers</label>
                <input type="number" placeholder="0" value={newKol.follower_count}
                  onChange={e => setNewKol(k => ({ ...k, follower_count: e.target.value }))} className={inputCls} />
              </div>
            </div>
            {addError && <p className="text-red-500 text-sm">{addError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={handleAddKol} disabled={addLoading}
                className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover active:scale-95 disabled:opacity-50 transition-all">
                {addLoading ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" onClick={() => { setShowAddForm(false); setAddError(''); setNewKol({ handle: '', gen_name: '', platform_id: '', follower_count: '' }); }}
                className="flex-1 py-2 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
