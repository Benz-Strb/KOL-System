import { useState, useEffect } from 'react';
import { X, Plus, Trash2, ExternalLink, Tag } from 'lucide-react';
import type { KolDirectoryRow, CommercialTerm, ContactInfo } from '../api/index.js';
import { updateKol, getKolTerms, createKolTerm, deleteKolTerm, getDropdowns } from '../api/index.js';
import { useModalTransition } from '../hooks/useModalTransition.js';
import Select from './Select.js';

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

const PRICING_TYPE_LABELS: Record<string, string> = {
  single_cooperation: 'โพสต์เดี่ยว',
  contracted_package: 'แพ็คเกจสัญญา',
  pure_exchange: 'แลกสินค้า',
  commission: 'ค่าคอมมิชชั่น',
};

function formatPrice(v: string | null) {
  if (!v) return '—';
  return Number(v).toLocaleString('th-TH') + ' ฿';
}

// ─── Profile Tab ────────────────────────────────────────────
function ProfileTab({ kol, onUpdated }: { kol: KolDirectoryRow; onUpdated: (u: Partial<KolDirectoryRow>) => void }) {
  const [contact, setContact] = useState<ContactInfo>(kol.contact_info ?? {});
  const [selling, setSelling] = useState(kol.main_selling_points ?? '');
  const [tags, setTags] = useState<string[]>(kol.custom_tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [follower, setFollower] = useState(kol.follower_count != null ? String(kol.follower_count) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t));
  }

  async function handleSave() {
    setSaving(true); setError(''); setSuccess(false);
    try {
      const res = await updateKol(kol.id, {
        custom_tags: tags,
        main_selling_points: selling || null,
        contact_info: (contact.email || contact.whatsapp || contact.line || contact.other) ? contact : null,
        follower_count: follower.trim() === '' ? null : Number(follower),
      });
      onUpdated({
        custom_tags: res.custom_tags,
        main_selling_points: res.main_selling_points,
        contact_info: res.contact_info,
        follower_count: res.follower_count,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Follower Count */}
      <div>
        <label className={labelCls}>จำนวนผู้ติดตาม</label>
        <input
          type="number"
          min="0"
          value={follower}
          onChange={e => setFollower(e.target.value)}
          placeholder="เช่น 12000"
          className={inputCls + ' max-w-[180px]'}
        />
        <p className="text-[11px] text-muted mt-1">อัปเดตได้เลยถ้าจำนวนเปลี่ยนแปลง — ระดับ Tier จะคำนวณใหม่อัตโนมัติ</p>
      </div>

      {/* Contact Info */}
      <div>
        <p className={labelCls}>Contact Info</p>
        <div className="grid grid-cols-2 gap-2">
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
            <label className="text-[11px] text-muted mb-0.5 block">อื่นๆ</label>
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
          placeholder="จุดเด่นของ KOL เช่น Beauty, Tech, Lifestyle..."
          className={inputCls + ' resize-none'}
        />
      </div>

      {/* Custom Tags */}
      <div>
        <label className={labelCls}>Custom Tags</label>
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
          {tags.map(t => (
            <span key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[11px] rounded-full">
              <Tag size={9} />
              {t}
              <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500 transition-colors">
                <X size={9} />
              </button>
            </span>
          ))}
          {tags.length === 0 && <span className="text-xs text-muted">ยังไม่มี tag</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder="พิมพ์ tag แล้ว Enter"
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
          <label className={labelCls}>Audience Tags (ระบบติดอัตโนมัติ)</label>
          <div className="flex flex-wrap gap-1.5">
            {kol.audience_tags.map(t => (
              <span key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-canvas border border-hairline text-muted text-[11px] rounded-full">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        {success && <span className="text-xs text-green-600 font-medium">บันทึกแล้ว</span>}
        <button type="button" onClick={handleSave} disabled={saving}
          className="ml-auto px-5 py-2 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 active:scale-95 transition-all">
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>
    </div>
  );
}

// ─── Commercial Terms Tab ────────────────────────────────────
function TermsTab({ kol }: { kol: KolDirectoryRow }) {
  const [terms, setTerms] = useState<CommercialTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([]);
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
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(termId: number) {
    if (!confirm('ลบเงื่อนไขนี้?')) return;
    await deleteKolTerm(termId);
    setTerms(prev => prev.filter(t => t.id !== termId));
  }

  if (loading) return (
    <div className="py-10 flex justify-center">
      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-3">
      {terms.length === 0 && !showForm && (
        <p className="text-sm text-muted text-center py-6">ยังไม่มีเงื่อนไขราคา</p>
      )}

      {terms.map(t => (
        <div key={t.id} className="bg-canvas border border-hairline rounded-xl px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink">{PRICING_TYPE_LABELS[t.pricing_type] ?? t.pricing_type}</span>
                {t.is_barter && (
                  <span className="text-[10px] px-1.5 py-px bg-orange-500/10 text-orange-600 rounded-full font-medium">Barter</span>
                )}
                {t.brands && (
                  <span className="text-[10px] px-1.5 py-px bg-accent/10 text-accent rounded-full">{t.brands.name}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                {t.single_post_price && (
                  <span className="text-xs text-muted">ต่อโพสต์ <span className="text-ink font-medium">{formatPrice(t.single_post_price)}</span></span>
                )}
                {t.package_price && (
                  <span className="text-xs text-muted">แพ็คเกจ <span className="text-ink font-medium">{formatPrice(t.package_price)}</span></span>
                )}
                {t.multi_platform_price && (
                  <span className="text-xs text-muted">Multi-plat <span className="text-ink font-medium">{formatPrice(t.multi_platform_price)}</span></span>
                )}
              </div>
              {t.notes && <p className="text-xs text-muted mt-1">{t.notes}</p>}
            </div>
            <button onClick={() => handleDelete(t.id)}
              className="text-muted hover:text-red-500 transition-colors p-1 shrink-0">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}

      {showForm && (
        <div className="bg-canvas border border-accent/30 rounded-xl px-4 py-4 space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">เพิ่มเงื่อนไขใหม่</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>รูปแบบ *</label>
              <Select
                options={Object.entries(PRICING_TYPE_LABELS).map(([k, v]) => ({ id: k, label: v }))}
                value={form.pricing_type}
                onChange={v => setForm(f => ({ ...f, pricing_type: v }))}
              />
            </div>
            <div>
              <label className={labelCls}>Brand</label>
              <Select
                options={[{ id: '', label: 'ทุก Brand' }, ...brands.map(b => ({ id: b.id, label: b.name }))]}
                value={form.brand_id}
                onChange={v => setForm(f => ({ ...f, brand_id: v }))}
              />
            </div>
            <div>
              <label className={labelCls}>ราคา/โพสต์ (฿)</label>
              <input type="number" min="0" value={form.single_post_price}
                onChange={e => setForm(f => ({ ...f, single_post_price: e.target.value }))} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>แพ็คเกจ (฿)</label>
              <input type="number" min="0" value={form.package_price}
                onChange={e => setForm(f => ({ ...f, package_price: e.target.value }))} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Multi-platform (฿)</label>
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
            <label className={labelCls}>หมายเหตุ</label>
            <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="..." className={inputCls} />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-1.5 border border-hairline rounded-full text-sm text-muted hover:text-ink transition-colors">
              ยกเลิก
            </button>
            <button type="button" onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-all">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}
          className="w-full py-2 border border-dashed border-hairline rounded-xl text-sm text-muted hover:text-ink hover:border-ink/30 transition-colors flex items-center justify-center gap-1.5">
          <Plus size={13} />
          เพิ่มเงื่อนไขใหม่
        </button>
      )}
    </div>
  );
}

// ─── Main Modal ──────────────────────────────────────────────
export default function KolDetailModal({ kol, onClose, onUpdated }: Props) {
  const { closed, requestClose } = useModalTransition(onClose);
  const [tab, setTab] = useState<'profile' | 'terms'>('profile');
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
                <span className="text-[11px] text-muted bg-canvas border border-hairline px-1.5 py-px rounded-md tabular-nums">
                  {formatFollower(localKol.follower_count)}
                </span>
              )}
              {localKol.platform && (
                <span className="text-[11px] text-muted">{localKol.platform.name}</span>
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
        <div className="flex border-b border-hairline px-4 shrink-0">
          <button className={tabCls(tab === 'profile')} onClick={() => setTab('profile')}>โปรไฟล์</button>
          <button className={tabCls(tab === 'terms')} onClick={() => setTab('terms')}>ราคา / เงื่อนไข</button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {tab === 'profile'
            ? <ProfileTab kol={localKol} onUpdated={handleUpdated} />
            : <TermsTab kol={localKol} />
          }
        </div>
      </div>
    </div>
  );
}
