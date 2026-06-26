import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, ExternalLink, Tag } from 'lucide-react';
import type { KolDirectoryRow, CommercialTerm, ContactInfo, KolPlatformAccount, KolPlatformsBundle, Platform, KolPost, KolHireHistoryItem } from '../api/index.js';
import { updateKol, getKolTerms, createKolTerm, deleteKolTerm, getDropdowns, addKolPlatform, updateKolPlatform, deleteKolPlatform, getKolPosts, getKolHireHistory } from '../api/index.js';
import { useModalTransition } from '../hooks/useModalTransition.js';
import Select from './Select.js';
import PlatformLogo from './PlatformLogo.js';
import BrandLogo from './BrandLogo.js';
import { numberLocale } from '../i18n/locale.js';

type Props = {
  kol: KolDirectoryRow;
  onClose: () => void;
  onUpdated: (updated: Partial<KolDirectoryRow>) => void;
};

const inputCls = [
  'w-full px-3 py-2 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent',
].join(' ');
const labelCls = 'block text-xs font-medium text-muted mb-1 tracking-wide uppercase';

const PRICING_TYPES = ['single_cooperation', 'contracted_package', 'pure_exchange', 'commission'] as const;

function formatPrice(v: string | null) {
  if (!v) return '—';
  return Number(v).toLocaleString(numberLocale()) + ' ฿';
}

// ─── Profile Tab ────────────────────────────────────────────
function ProfileTab({ kol, onUpdated }: { kol: KolDirectoryRow; onUpdated: (u: Partial<KolDirectoryRow>) => void }) {
  const { t } = useTranslation();
  const [contact, setContact] = useState<ContactInfo>(kol.contact_info ?? {});
  const [selling, setSelling] = useState(kol.main_selling_points ?? '');
  const [tags, setTags] = useState<string[]>(kol.custom_tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function addTag() {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) setTags(prev => [...prev, tag]);
    setTagInput('');
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(x => x !== tag));
  }

  async function handleSave() {
    setSaving(true); setError(''); setSuccess(false);
    try {
      const res = await updateKol(kol.id, {
        custom_tags: tags,
        main_selling_points: selling || null,
        contact_info: (contact.email || contact.whatsapp || contact.line || contact.other) ? contact : null,
      });
      onUpdated({
        custom_tags: res.custom_tags,
        main_selling_points: res.main_selling_points,
        contact_info: res.contact_info,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Contact Info */}
      <div>
        <p className={labelCls}>Contact Info</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-muted mb-0.5 block">Email</label>
            <input type="email" value={contact.email ?? ''} placeholder="email@example.com"
              onChange={e => setContact(c => ({ ...c, email: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] text-muted mb-0.5 block">WhatsApp</label>
            <input type="text" value={contact.whatsapp ?? ''} placeholder="+66..."
              onChange={e => setContact(c => ({ ...c, whatsapp: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] text-muted mb-0.5 block">Line</label>
            <input type="text" value={contact.line ?? ''} placeholder="Line ID"
              onChange={e => setContact(c => ({ ...c, line: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] text-muted mb-0.5 block">{t('kolDetail.otherContact')}</label>
            <input type="text" value={contact.other ?? ''} placeholder="..."
              onChange={e => setContact(c => ({ ...c, other: e.target.value }))} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Main Selling Points */}
      <div>
        <label className={labelCls}>Main Selling Points</label>
        <textarea
          rows={3}
          value={selling}
          onChange={e => setSelling(e.target.value)}
          placeholder={t('kolDetail.mainSellingPointsPlaceholder')}
          className={inputCls + ' resize-none'}
        />
      </div>

      {/* Custom Tags */}
      <div>
        <label className={labelCls}>Custom Tags</label>
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
          {tags.map(tag => (
            <span key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[11px] rounded-full">
              <Tag size={9} />
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500 transition-colors">
                <X size={9} />
              </button>
            </span>
          ))}
          {tags.length === 0 && <span className="text-xs text-muted">{t('kolDetail.noTags')}</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder={t('kolDetail.tagInputPlaceholder')}
            className={inputCls + ' flex-1'}
          />
          <button type="button" onClick={addTag}
            className="px-3 py-2 rounded-lg border border-hairline text-sm text-muted hover:text-ink transition-colors">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Audience Tags (read-only) */}
      {(kol.audience_tags?.length ?? 0) > 0 && (
        <div>
          <label className={labelCls}>{t('kolDetail.audienceTagsAuto')}</label>
          <div className="flex flex-wrap gap-1.5">
            {kol.audience_tags.map(tag => (
              <span key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-canvas border border-hairline text-muted text-[11px] rounded-full">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        {success && <span className="text-xs text-green-600 font-medium">{t('kolDetail.saved')}</span>}
        <button type="button" onClick={handleSave} disabled={saving}
          className="ml-auto px-5 py-2 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 active:scale-95 transition-all">
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ─── Posts Tab — every placement with an actual post link ───────────────
function PostsTab({ kol }: { kol: KolDirectoryRow }) {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<KolPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getKolPosts(kol.id).then(setPosts).finally(() => setLoading(false));
  }, [kol.id]);

  if (loading) return (
    <div className="py-10 flex justify-center">
      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (posts.length === 0) {
    return <p className="text-sm text-muted text-center py-6">{t('kolDetail.noPostsYet')}</p>;
  }

  return (
    <div className="space-y-2.5">
      {posts.map(post => {
        const subtitle = post.products?.model_code
          ?? (post.stores ? [post.stores.name, post.stores.branch].filter(Boolean).join(' · ') : null);
        return (
          <a key={post.id} href={post.post_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 bg-canvas border border-hairline rounded-xl px-3.5 py-2.5 hover:border-accent/40 transition-colors group">
            <BrandLogo name={post.brands.name} logoUrl={post.brands.logo_url} size={28} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium text-ink">{post.brands.name}</span>
                {post.platforms && <PlatformLogo name={post.platforms.name} size={14} />}
                {post.campaigns && (
                  <span className="text-[10px] px-1.5 py-px bg-accent/10 text-accent rounded-full">{post.campaigns.code}</span>
                )}
              </div>
              <div className="text-xs text-muted mt-0.5 truncate">
                {[subtitle, post.publication_date ? new Date(post.publication_date).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : null]
                  .filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <ExternalLink size={14} className="text-muted group-hover:text-accent transition-colors shrink-0" />
          </a>
        );
      })}
    </div>
  );
}

// ─── Commercial Terms Tab ────────────────────────────────────
function TermsTab({ kol }: { kol: KolDirectoryRow }) {
  const { t } = useTranslation();
  const [terms, setTerms] = useState<CommercialTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<{ id: number; name: string; logo_url: string | null }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    pricing_type: 'single_cooperation',
    brand_id: '',
    single_post_price: '',
    package_price: '',
    multi_platform_price: '',
    is_barter: false,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getKolTerms(kol.id).then(setTerms).finally(() => setLoading(false));
    getDropdowns().then(d => setBrands(d.brands));
  }, [kol.id]);

  async function handleCreate() {
    if (!form.pricing_type) return;
    setSaving(true); setError('');
    try {
      const term = await createKolTerm(kol.id, {
        brand_id: form.brand_id ? Number(form.brand_id) : null,
        pricing_type: form.pricing_type,
        single_post_price: form.single_post_price || undefined,
        package_price: form.package_price || undefined,
        multi_platform_price: form.multi_platform_price || undefined,
        is_barter: form.is_barter,
        notes: form.notes || undefined,
      });
      setTerms(prev => [term, ...prev]);
      setShowForm(false);
      setForm({ pricing_type: 'single_cooperation', brand_id: '', single_post_price: '', package_price: '', multi_platform_price: '', is_barter: false, notes: '' });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(termId: number) {
    if (!confirm(t('kolDetail.confirmDeleteTerm'))) return;
    await deleteKolTerm(termId);
    setTerms(prev => prev.filter(term => term.id !== termId));
  }

  if (loading) return (
    <div className="py-10 flex justify-center">
      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-3">
      {terms.length === 0 && !showForm && (
        <p className="text-sm text-muted text-center py-6">{t('kolDetail.noTermsYet')}</p>
      )}

      {terms.map(term => (
        <div key={term.id} className="bg-canvas border border-hairline rounded-xl px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink">{t(`pricingType.${term.pricing_type}`, { defaultValue: term.pricing_type })}</span>
                {term.is_barter && (
                  <span className="text-[10px] px-1.5 py-px bg-orange-500/10 text-orange-600 rounded-full font-medium">Barter</span>
                )}
                {term.brands && (
                  <span className="text-[10px] px-1.5 py-px bg-accent/10 text-accent rounded-full">{term.brands.name}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                {term.single_post_price && (
                  <span className="text-xs text-muted">{t('kolDetail.perPost')} <span className="text-ink font-medium font-mono">{formatPrice(term.single_post_price)}</span></span>
                )}
                {term.package_price && (
                  <span className="text-xs text-muted">{t('kolDetail.packageLabel')} <span className="text-ink font-medium font-mono">{formatPrice(term.package_price)}</span></span>
                )}
                {term.multi_platform_price && (
                  <span className="text-xs text-muted">Multi-plat <span className="text-ink font-medium font-mono">{formatPrice(term.multi_platform_price)}</span></span>
                )}
              </div>
              {term.notes && <p className="text-xs text-muted mt-1">{term.notes}</p>}
            </div>
            <button onClick={() => handleDelete(term.id)}
              className="text-muted hover:text-red-500 transition-colors p-1 shrink-0">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}

      {showForm && (
        <div className="bg-canvas border border-accent/30 rounded-xl px-4 py-4 space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">{t('kolDetail.addNewTerm')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>{t('kolDetail.pricingTypeLabel')}</label>
              <Select
                options={PRICING_TYPES.map(k => ({ id: k, label: t(`pricingType.${k}`) }))}
                value={form.pricing_type}
                onChange={v => setForm(f => ({ ...f, pricing_type: v }))}
              />
            </div>
            <div>
              <label className={labelCls}>Brand</label>
              <Select
                options={[{ id: '', label: t('common.allBrands') }, ...brands.map(b => ({ id: b.id, label: b.name, iconUrl: b.logo_url }))]}
                value={form.brand_id}
                onChange={v => setForm(f => ({ ...f, brand_id: v }))}
              />
            </div>
            <div>
              <label className={labelCls}>{t('kolDetail.pricePerPost')}</label>
              <input type="number" min="0" value={form.single_post_price}
                onChange={e => setForm(f => ({ ...f, single_post_price: e.target.value }))} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('kolDetail.packagePrice')}</label>
              <input type="number" min="0" value={form.package_price}
                onChange={e => setForm(f => ({ ...f, package_price: e.target.value }))} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('kolDetail.multiPlatformPrice')}</label>
              <input type="number" min="0" value={form.multi_platform_price}
                onChange={e => setForm(f => ({ ...f, multi_platform_price: e.target.value }))} placeholder="0" className={inputCls} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="is_barter" checked={form.is_barter}
                onChange={e => setForm(f => ({ ...f, is_barter: e.target.checked }))}
                className="w-4 h-4 accent-accent cursor-pointer" />
              <label htmlFor="is_barter" className="text-sm text-ink cursor-pointer">Barter</label>
            </div>
          </div>
          <div>
            <label className={labelCls}>{t('kolDetail.notesLabel')}</label>
            <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="..." className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-1.5 border border-hairline rounded-full text-sm text-muted hover:text-ink transition-colors">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-all">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}
          className="w-full py-2 border border-dashed border-hairline rounded-xl text-sm text-muted hover:text-ink hover:border-ink/30 transition-colors flex items-center justify-center gap-1.5">
          <Plus size={13} />
          {t('kolDetail.addNewTerm')}
        </button>
      )}
    </div>
  );
}

// ─── Platform Tab ────────────────────────────────────────────
// One card per platform account this kol has, each independently editable —
// follower_count especially, since that's the field that genuinely changes
// often (the tier trigger fires automatically on the DB side either way).
function PlatformCard({ p, canDelete, onChanged }: { p: KolPlatformAccount; canDelete: boolean; onChanged: (b: KolPlatformsBundle) => void }) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState(p.handle);
  const [follower, setFollower] = useState(p.follower_count != null ? String(p.follower_count) : '');
  const [profileUrl, setProfileUrl] = useState(p.profile_url ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dirty = handle !== p.handle
    || follower !== (p.follower_count != null ? String(p.follower_count) : '')
    || profileUrl !== (p.profile_url ?? '');

  async function run(body: Parameters<typeof updateKolPlatform>[1]) {
    setSaving(true); setError('');
    try {
      onChanged(await updateKolPlatform(p.id, body));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(t('kolDetail.confirmDeletePlatform', { platform: p.platform_name, handle: p.handle }))) return;
    setSaving(true); setError('');
    try {
      onChanged(await deleteKolPlatform(p.id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
      setSaving(false);
    }
  }

  return (
    <div className="bg-canvas border border-hairline rounded-xl px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlatformLogo name={p.platform_name} size={20} />
          {p.avatar_url && <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />}
          <span className="text-sm font-semibold text-ink">{p.platform_name}</span>
          {p.is_primary ? (
            <span className="text-[10px] px-1.5 py-px bg-accent/10 text-accent rounded-full font-medium">{t('kolDetail.primary')}</span>
          ) : (
            <button type="button" onClick={() => run({ is_primary: true })} disabled={saving}
              className="text-[10px] px-1.5 py-px border border-hairline rounded-full text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-50">
              {t('kolDetail.setAsPrimary')}
            </button>
          )}
        </div>
        <button type="button" onClick={handleDelete} disabled={saving || !canDelete}
          title={!canDelete ? t('kolDetail.minOnePlatform') : t('kolDetail.deleteThisPlatform')}
          className="text-muted hover:text-red-500 disabled:opacity-30 disabled:hover:text-muted transition-colors p-1">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2">
          <label className="text-[11px] text-muted mb-0.5 block">Handle</label>
          <input type="text" value={handle} onChange={e => setHandle(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-muted mb-0.5 block">Followers</label>
          <input type="number" min="0" value={follower} onChange={e => setFollower(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] text-muted mb-0.5 block">Profile URL</label>
          <input type="text" value={profileUrl} onChange={e => setProfileUrl(e.target.value)} placeholder="https://..." className={inputCls} />
        </div>
      </div>
      <p className="text-[11px] text-muted">{t('kolDetail.followerUpdateHint')}</p>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {dirty && (
        <button
          type="button"
          disabled={saving}
          onClick={() => run({
            handle: handle.trim(),
            follower_count: follower.trim() === '' ? null : Number(follower),
            profile_url: profileUrl.trim() || null,
          })}
          className="w-full py-1.5 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-all">
          {saving ? t('common.saving') : t('common.save')}
        </button>
      )}
    </div>
  );
}

function PlatformTab({ kol, onUpdated }: { kol: KolDirectoryRow; onUpdated: (u: Partial<KolDirectoryRow>) => void }) {
  const { t } = useTranslation();
  const [platforms, setPlatforms] = useState<KolPlatformAccount[]>(kol.platforms);
  const [allPlatforms, setAllPlatforms] = useState<Platform[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ platform_id: '', handle: '', follower_count: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { getDropdowns().then(d => setAllPlatforms(d.platforms)); }, []);

  function applyBundle(bundle: KolPlatformsBundle) {
    setPlatforms(bundle.platforms);
    onUpdated({
      platforms: bundle.platforms,
      handle: bundle.handle,
      follower_count: bundle.follower_count,
      avatar_url: bundle.avatar_url,
      profile_url: bundle.profile_url,
      platform: bundle.platform,
    });
  }

  async function handleAdd() {
    if (!form.handle.trim()) { setError(t('kolDetail.handleRequired')); return; }
    setSaving(true); setError('');
    try {
      const bundle = await addKolPlatform(kol.id, {
        platform_id: form.platform_id ? Number(form.platform_id) : undefined,
        handle: form.handle.trim(),
        follower_count: form.follower_count ? Number(form.follower_count) : undefined,
      });
      applyBundle(bundle);
      setShowForm(false);
      setForm({ platform_id: '', handle: '', follower_count: '' });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {platforms.map(p => (
        <PlatformCard key={p.id} p={p} canDelete={platforms.length > 1} onChanged={applyBundle} />
      ))}

      {showForm && (
        <div className="bg-canvas border border-accent/30 rounded-xl px-4 py-4 space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">{t('kolDetail.addNewPlatform')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Platform</label>
              <Select
                options={allPlatforms.map(p => ({ id: p.id, label: p.name }))}
                value={form.platform_id}
                onChange={v => setForm(f => ({ ...f, platform_id: v }))}
              />
            </div>
            <div>
              <label className={labelCls}>Followers</label>
              <input type="number" min="0" value={form.follower_count}
                onChange={e => setForm(f => ({ ...f, follower_count: e.target.value }))} placeholder="0" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Handle *</label>
              <input type="text" value={form.handle}
                onChange={e => setForm(f => ({ ...f, handle: e.target.value }))} placeholder="@username" className={inputCls} />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setShowForm(false); setError(''); }}
              className="px-4 py-1.5 border border-hairline rounded-full text-sm text-muted hover:text-ink transition-colors">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handleAdd} disabled={saving}
              className="px-4 py-1.5 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-all">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}
          className="w-full py-2 border border-dashed border-hairline rounded-xl text-sm text-muted hover:text-ink hover:border-ink/30 transition-colors flex items-center justify-center gap-1.5">
          <Plus size={13} />
          {t('kolDetail.addNewPlatform')}
        </button>
      )}
    </div>
  );
}

// ─── Hire History Tab ────────────────────────────────────────
// Shows brand-scoped placement cost timeline (planned + posted, no cancelled)
function HireHistoryTab({ kol }: { kol: KolDirectoryRow }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<KolHireHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getKolHireHistory(kol.id).then(setItems).finally(() => setLoading(false));
  }, [kol.id]);

  if (loading) return (
    <div className="py-10 flex justify-center">
      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (items.length === 0) {
    return <p className="text-sm text-muted text-center py-6">{t('kolDetail.noHireHistory')}</p>;
  }

  return (
    <div className="space-y-2.5">
      {items.map(item => {
        const subtitle = item.products?.model_code
          ?? (item.stores ? [item.stores.name, item.stores.branch].filter(Boolean).join(' · ') : null);
        const isPosted = item.status === 'posted';
        const price = item.final_price ? Number(item.final_price) : null;
        const paid = item.pay_amount ? Number(item.pay_amount) : null;
        const hasPay = isPosted && item.payment_type === 'paid' && paid != null;
        const payDiffers = hasPay && price != null && paid !== price;
        return (
          <div key={item.id}
            className="flex items-start gap-3 bg-canvas border border-hairline rounded-xl px-3.5 py-2.5">
            <div className="mt-0.5 shrink-0"><BrandLogo name={item.brands.name} logoUrl={item.brands.logo_url} size={28} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium text-ink">{item.brands.name}</span>
                {item.platforms && <PlatformLogo name={item.platforms.name} size={14} />}
                {item.campaigns && (
                  <span className="text-[10px] px-1.5 py-px bg-accent/10 text-accent rounded-full">{item.campaigns.code}</span>
                )}
              </div>
              {subtitle && <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p>}
              {isPosted && item.publication_date && (
                <p className="text-xs text-muted">
                  {new Date(item.publication_date).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
            <div className="text-right shrink-0 space-y-0.5">
              <span className={`inline-block text-[10px] font-medium px-2 py-px rounded-full ${
                isPosted ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                         : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
              }`}>
                {isPosted ? 'Posted' : 'Planned'}
              </span>
              <p className="text-[11px] text-muted">
                {item.payment_type === 'barter' ? 'Barter' : item.payment_type === 'free' ? 'Free' : 'Paid'}
              </p>
              {price != null && (
                <p className="text-xs font-mono font-semibold text-ink">{price.toLocaleString(numberLocale())} ฿</p>
              )}
              {payDiffers && (
                <p className="text-[10px] font-mono text-muted">{t('kolDetail.paidAmount')}: {paid!.toLocaleString(numberLocale())} ฿</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Modal ──────────────────────────────────────────────
export default function KolDetailModal({ kol, onClose, onUpdated }: Props) {
  const { t } = useTranslation();
  const { closed, requestClose } = useModalTransition(onClose);
  const [tab, setTab] = useState<'profile' | 'platform' | 'hire-history' | 'posts' | 'terms'>('profile');
  const [localKol, setLocalKol] = useState(kol);

  function handleUpdated(partial: Partial<KolDirectoryRow>) {
    const merged = { ...localKol, ...partial };
    setLocalKol(merged);
    onUpdated(partial);
  }

  const formatFollower = (n: number | null) => {
    if (!n) return null;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  };

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
    }`;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 transition-opacity duration-200 ${closed ? 'opacity-0' : 'opacity-100'}`}
      onClick={requestClose}
    >
      <div className={`bg-surface border border-hairline rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col transition-all duration-200 ${closed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-hairline shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {localKol.profile_url ? (
                <a href={localKol.profile_url} target="_blank" rel="noopener noreferrer"
                  className="font-semibold text-ink hover:text-accent transition-colors inline-flex items-center gap-1">
                  {localKol.handle}
                  <ExternalLink size={12} />
                </a>
              ) : (
                <span className="font-semibold text-ink">{localKol.handle}</span>
              )}
              {localKol.follower_count && (
                <span className="text-[11px] text-muted bg-canvas border border-hairline px-1.5 py-px rounded-md tabular-nums font-mono">
                  {formatFollower(localKol.follower_count)}
                </span>
              )}
              {localKol.platform && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                  <PlatformLogo name={localKol.platform.name} size={14} />
                  {localKol.platform.name}
                </span>
              )}
            </div>
            {localKol.gen_name && <p className="text-xs text-muted mt-0.5">{localKol.gen_name}</p>}
          </div>
          <button type="button" onClick={requestClose}
            className="text-muted hover:text-ink hover:bg-canvas rounded-lg p-1 transition-colors ml-3 shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-hairline px-4 shrink-0 overflow-x-auto">
          <button className={`${tabCls(tab === 'profile')} whitespace-nowrap`} onClick={() => setTab('profile')}>{t('kolDetail.tabProfile')}</button>
          <button className={`${tabCls(tab === 'platform')} whitespace-nowrap`} onClick={() => setTab('platform')}>Platform</button>
          <button className={`${tabCls(tab === 'hire-history')} whitespace-nowrap`} onClick={() => setTab('hire-history')}>{t('kolDetail.tabHireHistory')}</button>
          <button className={`${tabCls(tab === 'posts')} whitespace-nowrap`} onClick={() => setTab('posts')}>{t('kolDetail.tabPosts')}</button>
          <button className={`${tabCls(tab === 'terms')} whitespace-nowrap`} onClick={() => setTab('terms')}>{t('kolDetail.tabTerms')}</button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {tab === 'profile' && <ProfileTab kol={localKol} onUpdated={handleUpdated} />}
          {tab === 'platform' && <PlatformTab kol={localKol} onUpdated={handleUpdated} />}
          {tab === 'hire-history' && <HireHistoryTab kol={localKol} />}
          {tab === 'posts' && <PostsTab kol={localKol} />}
          {tab === 'terms' && <TermsTab kol={localKol} />}
        </div>
      </div>
    </div>
  );
}
