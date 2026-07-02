import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalTransition } from '../hooks/useModalTransition.js';
import Select from './Select.js';
import { createKol, clearDropdownCache, ApiError } from '../api/index.js';

// A duplicate-handle KOL as returned by POST /api/kols's 409 body (see
// server/src/routes/kols.ts around line 605): `{ error, kol: { id, handle, follower_count } }`.
export type ExistingKol = { id: number; handle: string; follower_count: number | null };

// What onCreated actually receives — ExistingKol plus platform_id, which is only reliably
// known on the fresh-create path (the platform picked in this form). The 409 body doesn't
// carry it, so the "use existing" path always passes null — see handleUseExisting() below.
export type CreatedKol = ExistingKol & { platform_id: number | null };

interface Props {
  onClose: () => void;
  prefillHandle: string;
  // Platform/Follower the user already typed on the import row this modal was opened
  // from — carried over so they don't have to retype data they already entered in Excel.
  // Both optional since the modal is also reachable from contexts with no source row.
  prefillPlatformId?: string;
  prefillFollowerCount?: string;
  platforms: { id: number; name: string }[];
  // Fires both on a fresh create AND when the user picks "use existing" after a
  // duplicate-handle conflict — either way the caller gets back a kol to merge
  // into its own lookups, so it only needs to handle one success path.
  onCreated: (kol: CreatedKol) => void;
}

// Structurally mirrors AddModelModal.tsx's modal chrome (backdrop/panel transition,
// header X button, footer Cancel/Save) — see that file for the pattern this copies.
// Field set borrowed from KolPicker.tsx's inline "add KOL" form (handle, gen_name,
// platform_id, follower_count) — content_category is intentionally omitted here (Phase 5
// scope trim, see CLAUDE.md/plan §8.2): KolPicker's own add-KOL form doesn't plumb it
// either, and adding a dedicated lookup fetch just for this one optional field wasn't
// worth the extra scope for the import-grid flow.
export default function AddKolModal({ onClose, prefillHandle, prefillPlatformId, prefillFollowerCount, platforms, onCreated }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);

  const [handle, setHandle] = useState(prefillHandle);
  const [genName, setGenName] = useState('');
  const [platformId, setPlatformId] = useState(prefillPlatformId ?? '');
  const [followerCount, setFollowerCount] = useState(prefillFollowerCount ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [duplicateKol, setDuplicateKol] = useState<ExistingKol | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    setDuplicateKol(null);
    try {
      const created = await createKol({
        handle: handle.trim(),
        gen_name: genName.trim() || undefined,
        platform_id: platformId ? Number(platformId) : undefined,
        follower_count: followerCount ? Number(followerCount) : undefined,
      });
      clearDropdownCache();
      onCreated({
        id: created.id,
        handle: created.handle,
        follower_count: created.follower_count,
        platform_id: platformId ? Number(platformId) : null,
      });
      requestClose();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { kol?: ExistingKol };
        if (body.kol) setDuplicateKol(body.kol);
        else setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : t('common.error'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleUseExisting() {
    if (!duplicateKol) return;
    clearDropdownCache();
    // platform_id: null — the 409 body doesn't include it (see ExistingKol above), but this
    // KOL already existed before this import session started, so it's already present in
    // ImportEditGrid's lookups.kols (fetched at file-validate time) with its real platform_id;
    // this null entry is a harmless duplicate that lookups there never resolve to first.
    onCreated({ ...duplicateKol, platform_id: null });
    requestClose();
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div
        className={`bg-surface border border-hairline rounded-2xl shadow-xl w-full max-w-md p-6 transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-ink">{t('addKol.addKolTitle')}</h3>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Handle */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Handle / Username <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={handle}
              onChange={e => { setHandle(e.target.value); setDuplicateKol(null); setErrorMsg(''); }}
              placeholder="@username"
              className="w-full px-3 py-2 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            {!handle.trim() && (
              <p className="text-xs text-muted mt-1">{t('kolPicker.handleRequired')}</p>
            )}
          </div>

          {/* ชื่อจริง / ชื่อที่รู้จัก */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              {t('kolPicker.genName')}
            </label>
            <input
              type="text"
              value={genName}
              onChange={e => setGenName(e.target.value)}
              placeholder={t('kolPicker.genNamePlaceholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* Platform + Followers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Platform</label>
              <Select
                options={platforms.map(p => ({ id: p.id, label: p.name }))}
                value={platformId}
                onChange={setPlatformId}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Followers</label>
              <input
                type="number"
                value={followerCount}
                onChange={e => setFollowerCount(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg text-sm bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {duplicateKol && (
            <div className="text-xs text-yellow-700 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5 space-y-1.5">
              <p>{t('addKol.duplicateError', { handle: duplicateKol.handle })}</p>
              <button type="button" onClick={handleUseExisting}
                className="text-accent hover:text-accent-hover font-medium transition-colors">
                {t('addKol.useExisting')}
              </button>
            </div>
          )}
          {errorMsg && !duplicateKol && <p className="text-xs text-red-500">{errorMsg}</p>}

          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={requestClose}
              className="px-4 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-canvas transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!handle.trim() || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover active:scale-95 disabled:opacity-50 transition-all"
            >
              <Plus size={14} />
              {submitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
