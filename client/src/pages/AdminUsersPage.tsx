import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Plus, Copy, Check, Eye, EyeOff, RefreshCw, Pencil, Tag, X, Check as CheckIcon, ImagePlus } from 'lucide-react';
import {
  getAdminUsers, createAdminUser, updateAdminUser, resetUserPassword,
  getAdminBrands, createAdminBrand, updateAdminBrand, uploadBrandLogo,
  clearDropdownCache,
  type AdminUser, type Brand,
} from '../api/index.js';
import Modal from '../components/Modal.js';
import Toast from '../components/Toast.js';
import Select from '../components/Select.js';
import UserAvatar from '../components/UserAvatar.js';
import BrandLogo from '../components/BrandLogo.js';
import { getCached, setCached, isFresh, invalidateCachePrefix } from '../lib/swrCache.js';
import { roleLabel } from '../lib/roleLabels.js';

const ROLE_ORDER: Record<string, number> = { admin: 0, manager: 1, marketing: 2 };

const ROLE_STYLE: Record<string, string> = {
  admin: 'bg-red-100 text-red-800 ring-1 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/25',
  marketing: 'bg-blue-100 text-blue-800 ring-1 ring-blue-200 dark:bg-accent/15 dark:text-accent-bright dark:ring-accent/25',
  manager: 'bg-purple-100 text-purple-800 ring-1 ring-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:ring-purple-500/25',
};

const inputCls = [
  'w-full px-3 py-2 rounded-lg text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30',
].join(' ');

const ALLOWED_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_LOGO_SIZE = 2 * 1024 * 1024;

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const brandChipCls = 'inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-canvas border border-hairline text-ink whitespace-nowrap';

// "+N" chip ท้ายรายการแบรนด์ — hover แล้วโชว์ชื่อแบรนด์ทั้งหมด
// ใช้ position:fixed (ไม่ใช่ absolute) เพราะตาราง users ครอบด้วย overflow-hidden/auto
// popover แบบ absolute จะโดน clip ที่ขอบตาราง
function OverflowBrands({ names, shown }: { names: string[]; shown: number }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-canvas border border-hairline text-muted cursor-default whitespace-nowrap"
      onMouseEnter={e => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: r.left, y: r.bottom + 4 });
      }}
      onMouseLeave={() => setPos(null)}
    >
      +{names.length - shown}
      {pos && (
        <span
          className="fixed z-50 flex flex-col gap-1 bg-surface border border-hairline rounded-xl shadow-lg px-3 py-2"
          style={{ left: pos.x, top: pos.y }}
        >
          {names.map(n => <span key={n} className="text-xs text-ink whitespace-nowrap">{n}</span>)}
        </span>
      )}
    </span>
  );
}

function CopyButton({ text, copyKey }: { text: string; copyKey: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={handleCopy}
      className="text-muted hover:text-accent transition-colors flex-shrink-0" title={t('adminUsers.copy')} key={copyKey}>
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  );
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Edit user brands state
  const [editingUserBrandsId, setEditingUserBrandsId] = useState<number | null>(null);
  const [editingUserBrandIds, setEditingUserBrandIds] = useState<number[]>([]);
  const [savingUserBrands, setSavingUserBrands] = useState(false);

  // Edit email state
  const [editingEmailId, setEditingEmailId] = useState<number | null>(null);
  const [editingEmail, setEditingEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Brand panel state
  const [showBrandsPanel, setShowBrandsPanel] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandLogoUrl, setNewBrandLogoUrl] = useState('');
  const [newBrandLoading, setNewBrandLoading] = useState(false);
  const [newBrandError, setNewBrandError] = useState('');
  const [newLogoUploading, setNewLogoUploading] = useState(false);
  const [newLogoError, setNewLogoError] = useState<string | null>(null);
  const [editingBrandId, setEditingBrandId] = useState<number | null>(null);
  const [editBrandName, setEditBrandName] = useState('');
  const [editBrandLogoUrl, setEditBrandLogoUrl] = useState('');
  const [editBrandLoading, setEditBrandLoading] = useState(false);
  const [editLogoUploading, setEditLogoUploading] = useState(false);
  const [editLogoError, setEditLogoError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const newLogoInputRef = useRef<HTMLInputElement>(null);
  const editLogoInputRef = useRef<HTMLInputElement>(null);

  // Create user form state
  const [form, setForm] = useState({ email: '', full_name: '', role: 'marketing', password: generatePassword() });
  const [selectedBrandIds, setSelectedBrandIds] = useState<number[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdInfo, setCreatedInfo] = useState<{ name: string; email: string; password: string } | null>(null);

  useEffect(() => {
    load();
    getAdminBrands().then(b => {
      setBrands(b);
      setSelectedBrandIds([]);
    }).catch(() => {});
    // run once on mount only — `load` is a plain function recreated every render,
    // including it here would re-run the effect on every render instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close panel on outside click
  useEffect(() => {
    if (!showBrandsPanel) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowBrandsPanel(false);
        setEditingBrandId(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBrandsPanel]);

  function sortUsers(data: AdminUser[]) {
    return data.sort((a, b) => {
      const activeA = a.is_active ? 0 : 1;
      const activeB = b.is_active ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      return (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99);
    });
  }

  async function load() {
    const cacheKey = 'admin-users';
    const cached = getCached<AdminUser[]>(cacheKey);
    if (cached) {
      setUsers(sortUsers(cached));
      setTableLoading(false);
      if (isFresh(cacheKey)) return; // data is still fresh — skip the background refetch
    } else {
      setTableLoading(true);
    }
    try {
      const data = await getAdminUsers();
      setCached(cacheKey, data);
      setUsers(sortUsers(data));
    }
    finally { setTableLoading(false); }
  }

  // --- User handlers ---
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    // marketing ต้องมีแบรนด์เสมอ — manager/admin ว่างได้ (manager ว่าง = เห็นทุกแบรนด์)
    if (form.role === 'marketing' && selectedBrandIds.length === 0) { setCreateError(t('adminUsers.brandRequired')); return; }
    setCreateLoading(true);
    try {
      const created = await createAdminUser({ ...form, brand_ids: selectedBrandIds });
      setCreatedInfo({ name: form.full_name, email: form.email, password: form.password });
      setForm({ email: '', full_name: '', role: 'marketing', password: generatePassword() });
      setSelectedBrandIds([]);
      setUsers(prev => sortUsers([...prev, created]));
      invalidateCachePrefix('admin-users');
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setCreateLoading(false);
    }
  }

  function toggleBrand(id: number) {
    setSelectedBrandIds(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  }

  async function handleToggleUser(user: AdminUser) {
    const next = !user.is_active;
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: next } : u));
    setToast(t('common.saving'));
    try {
      await updateAdminUser(user.id, { is_active: next });
      setToast(`${user.full_name}: ${next ? t('adminUsers.activated') : t('adminUsers.deactivated')}`);
      invalidateCachePrefix('admin-users');
    } catch (err: unknown) {
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: user.is_active } : u));
      setToast(err instanceof Error ? err.message : t('common.saveFailed'));
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetLoading(true);
    try {
      await resetUserPassword(resetTarget.id, resetPwd);
      setToast(t('adminUsers.passwordResetFor', { name: resetTarget.full_name }));
      setResetTarget(null);
      setResetPwd('');
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setResetLoading(false);
    }
  }

  function openCreate() {
    setShowCreate(true);
    setCreatedInfo(null);
    setCreateError('');
    setForm({ email: '', full_name: '', role: 'marketing', password: generatePassword() });
    setSelectedBrandIds(brands.filter(b => b.active).map(b => b.id));
    setShowPassword(false);
  }

  async function handleSaveUserBrands(userId: number) {
    const target = users.find(u => u.id === userId);
    if (target?.role === 'marketing' && editingUserBrandIds.length === 0) {
      setToast(t('adminUsers.brandRequired'));
      return;
    }
    const prevUsers = users;
    setSavingUserBrands(true);
    try {
      const updated = await updateAdminUser(userId, { brand_ids: editingUserBrandIds });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, user_brands: updated.user_brands } : u));
      setToast(t('adminUsers.brandsUpdated'));
      setEditingUserBrandsId(null);
      invalidateCachePrefix('admin-users');
    } catch (err: unknown) {
      setUsers(prevUsers);
      setToast(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setSavingUserBrands(false);
    }
  }

  async function handleSaveEmail(userId: number) {
    const trimmed = editingEmail.trim().toLowerCase();
    if (!trimmed) return;
    const prevUsers = users;
    // optimistic apply
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, email: trimmed } : u));
    setEditingEmailId(null);
    setSavingEmail(true);
    try {
      await updateAdminUser(userId, { email: trimmed });
      setToast(t('adminUsers.emailUpdated'));
      invalidateCachePrefix('admin-users');
    } catch (err: unknown) {
      setUsers(prevUsers);
      setEditingEmailId(userId);
      setToast(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setSavingEmail(false);
    }
  }

  // --- Brand handlers ---
  async function handleNewLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target) return;
    e.target.value = '';
    if (!file) return;

    setNewLogoError(null);
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setNewLogoError(t('addModel.invalidImageType'));
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setNewLogoError(t('addModel.imageTooLarge'));
      return;
    }

    setNewLogoUploading(true);
    try {
      const { url } = await uploadBrandLogo(file);
      setNewBrandLogoUrl(url);
    } catch {
      setNewLogoError(t('addModel.uploadError'));
    } finally {
      setNewLogoUploading(false);
    }
  }

  async function handleEditLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target) return;
    e.target.value = '';
    if (!file) return;

    setEditLogoError(null);
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setEditLogoError(t('addModel.invalidImageType'));
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setEditLogoError(t('addModel.imageTooLarge'));
      return;
    }

    setEditLogoUploading(true);
    try {
      const { url } = await uploadBrandLogo(file);
      setEditBrandLogoUrl(url);
    } catch {
      setEditLogoError(t('addModel.uploadError'));
    } finally {
      setEditLogoUploading(false);
    }
  }

  async function handleCreateBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!newBrandName.trim()) return;
    setNewBrandError('');
    setNewBrandLoading(true);
    try {
      const brand = await createAdminBrand(newBrandName.trim(), newBrandLogoUrl.trim() || undefined);
      setBrands(prev => [...prev, brand].sort((a, b) => a.name.localeCompare(b.name)));
      clearDropdownCache(); // bust cache so NewPlacementPage sees the new brand immediately
      setSelectedBrandIds([]);
      setNewBrandName('');
      setNewBrandLogoUrl('');
      setNewLogoError(null);
      setToast(t('adminUsers.brandAdded', { name: brand.name }));
    } catch (err: unknown) {
      setNewBrandError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setNewBrandLoading(false);
    }
  }

  async function handleSaveEditBrand(brand: Brand) {
    const trimmedName = editBrandName.trim();
    const trimmedLogo = editBrandLogoUrl.trim();
    const nameChanged = !!trimmedName && trimmedName !== brand.name;
    const logoChanged = trimmedLogo !== (brand.logo_url ?? '');
    if (!nameChanged && !logoChanged) {
      setEditingBrandId(null);
      return;
    }
    const prevBrands = brands;
    // optimistic apply
    const optimisticBrand = { ...brand, ...(nameChanged ? { name: trimmedName } : {}), ...(logoChanged ? { logo_url: trimmedLogo || null } : {}) };
    setBrands(prev => prev.map(b => b.id === brand.id ? optimisticBrand : b).sort((a, b) => a.name.localeCompare(b.name)));
    setEditingBrandId(null);
    setEditBrandLoading(true);
    try {
      const updated = await updateAdminBrand(brand.id, {
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(logoChanged ? { logo_url: trimmedLogo || null } : {}),
      });
      setBrands(prev => prev.map(b => b.id === updated.id ? updated : b).sort((a, b) => a.name.localeCompare(b.name)));
      setToast(t('adminUsers.brandSaved', { name: updated.name }));
    } catch (err: unknown) {
      setBrands(prevBrands);
      setToast(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setEditBrandLoading(false);
    }
  }

  async function handleToggleBrandActive(brand: Brand) {
    const next = !brand.active;
    setBrands(prev => prev.map(b => b.id === brand.id ? { ...b, active: next } : b));
    setToast(t('common.saving'));
    try {
      await updateAdminBrand(brand.id, { active: next });
      setToast(`${brand.name}: ${next ? t('adminUsers.activated') : t('adminUsers.deactivated')}`);
    } catch (err: unknown) {
      setBrands(prev => prev.map(b => b.id === brand.id ? { ...b, active: brand.active } : b));
      setToast(err instanceof Error ? err.message : t('common.saveFailed'));
    }
  }

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-8">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* Users section */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
            <Users size={18} className="text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink tracking-tight">{t('adminUsers.pageTitle')}</h1>
            <p className="text-xs text-muted">{t('adminUsers.accountCount', { count: users.length })}</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-xs font-medium rounded-full hover:bg-accent-hover active:scale-95 transition-all">
          <Plus size={13} />
          {t('adminUsers.addUser')}
        </button>
      </div>

      <div className="bg-surface border border-hairline rounded-xl overflow-hidden">
        {tableLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">{t('adminUsers.colName')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">{t('adminUsers.colEmail')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">{t('adminUsers.colRole')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">{t('adminUsers.colBrand')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">{t('adminUsers.colStatus')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-hairline last:border-0 hover:bg-canvas transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={user.full_name} />
                      <span className="font-medium text-ink">{user.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingEmailId === user.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          type="email"
                          value={editingEmail}
                          onChange={e => setEditingEmail(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSaveEmail(user.id); }
                            if (e.key === 'Escape') setEditingEmailId(null);
                          }}
                          placeholder="email@example.com"
                          className="px-2 py-1 text-xs rounded-lg bg-input-bg border border-input-border text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent w-48"
                        />
                        <button onClick={() => handleSaveEmail(user.id)} disabled={savingEmail}
                          className="text-accent hover:text-accent-hover disabled:opacity-50 transition-colors">
                          <CheckIcon size={13} />
                        </button>
                        <button onClick={() => setEditingEmailId(null)} className="text-muted hover:text-ink transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group">
                        <span className="text-muted font-mono text-xs">{user.email ?? <span className="italic">—</span>}</span>
                        <button
                          onClick={() => { setEditingEmailId(user.id); setEditingEmail(user.email ?? ''); }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all">
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ROLE_STYLE[user.role] ?? 'bg-canvas text-muted'}`}>
                      {roleLabel(t, user.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.role === 'admin' ? <span className="text-xs text-muted">—</span> : editingUserBrandsId === user.id ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {brands.filter(b => b.active).map(b => (
                          <label key={b.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium cursor-pointer transition-all ${
                            editingUserBrandIds.includes(b.id)
                              ? 'bg-accent/10 border-accent text-accent'
                              : 'bg-canvas border-hairline text-muted hover:border-accent/40'
                          }`}>
                            <input type="checkbox" className="sr-only"
                              checked={editingUserBrandIds.includes(b.id)}
                              onChange={() => setEditingUserBrandIds(prev =>
                                prev.includes(b.id) ? prev.filter(id => id !== b.id) : [...prev, b.id]
                              )} />
                            {b.name}
                          </label>
                        ))}
                        <button onClick={() => handleSaveUserBrands(user.id)} disabled={savingUserBrands}
                          className="text-accent hover:text-accent-hover disabled:opacity-50 transition-colors">
                          <CheckIcon size={13} />
                        </button>
                        <button onClick={() => setEditingUserBrandsId(null)} className="text-muted hover:text-ink transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1 group">
                        {user.user_brands.length === 0
                          ? <span className="text-xs text-muted">{user.role === 'manager' ? t('adminUsers.allBrands') : '—'}</span>
                          : (
                            <>
                              {user.user_brands.slice(0, 2).map(ub => (
                                <span key={ub.brands.id} className={brandChipCls}>
                                  {ub.brands.name}
                                </span>
                              ))}
                              {user.user_brands.length > 2 && (
                                <OverflowBrands names={user.user_brands.map(ub => ub.brands.name)} shown={2} />
                              )}
                            </>
                          )
                        }
                        <button
                          onClick={() => {
                            setEditingUserBrandsId(user.id);
                            setEditingUserBrandIds(user.user_brands.map(ub => ub.brands.id));
                          }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all ml-0.5">
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggleUser(user)}
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                        user.is_active
                          ? 'bg-green-100 text-green-800 ring-1 ring-green-200 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/25 hover:opacity-80'
                          : 'bg-canvas text-muted border border-hairline hover:bg-surface'
                      }`}>
                      {user.is_active ? t('adminUsers.active') : t('adminUsers.inactive')}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setResetTarget(user); setResetPwd(generatePassword()); }}
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent whitespace-nowrap transition-colors" title={t('adminUsers.resetPassword')}>
                      <RefreshCw size={11} />
                      {t('adminUsers.passwordLabel')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Brands FAB + floating panel */}
      <div ref={panelRef} className="fixed bottom-6 right-6 flex flex-col items-end gap-2 z-20">
        {/* Panel */}
        {showBrandsPanel && (
          <div className="w-72 bg-surface border border-hairline rounded-2xl shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
              <span className="text-sm font-semibold text-ink">{t('adminUsers.brandsPanelTitle', { count: brands.length })}</span>
              <button onClick={() => { setShowBrandsPanel(false); setEditingBrandId(null); setNewLogoError(null); }}
                className="text-muted hover:text-ink transition-colors">
                <X size={15} />
              </button>
            </div>

            {/* Brand list */}
            <div className="max-h-64 overflow-y-auto">
              {brands.length === 0 ? (
                <p className="text-xs text-muted text-center py-6">{t('adminUsers.noBrandsYet')}</p>
              ) : (
                brands.map(brand => (
                  <div key={brand.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-hairline last:border-0 hover:bg-canvas transition-colors">
                    {editingBrandId === brand.id ? (
                      <>
                        <div className="flex-1 flex flex-col gap-1.5">
                          <input
                            autoFocus
                            value={editBrandName}
                            onChange={e => setEditBrandName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); handleSaveEditBrand(brand); }
                              if (e.key === 'Escape') { setEditingBrandId(null); setEditLogoError(null); }
                            }}
                            placeholder={t('adminUsers.brandNamePlaceholder')}
                            className="px-2 py-1 text-xs rounded-lg bg-input-bg border border-input-border text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                          <div className="flex items-center gap-2">
                            <input
                              ref={editLogoInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={handleEditLogoChange}
                              className="hidden"
                            />
                            {editLogoUploading ? (
                              <div className="w-6 h-6 rounded border border-hairline flex items-center justify-center shrink-0">
                                <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                              </div>
                            ) : editBrandLogoUrl ? (
                              <div className="flex items-center gap-1">
                                <img src={editBrandLogoUrl} alt="" className="w-6 h-6 rounded object-cover border border-hairline shrink-0" />
                                <button type="button" onClick={() => setEditBrandLogoUrl('')}
                                  className="text-muted hover:text-red-500 transition-colors shrink-0">
                                  <X size={10} />
                                </button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => editLogoInputRef.current?.click()}
                                className="w-6 h-6 rounded border border-dashed border-input-border flex items-center justify-center text-muted hover:border-accent/40 hover:text-ink transition-colors shrink-0">
                                <ImagePlus size={11} />
                              </button>
                            )}
                            {editLogoError && <span className="text-[10px] text-red-500">{editLogoError}</span>}
                          </div>
                        </div>
                        <button onClick={() => handleSaveEditBrand(brand)} disabled={editBrandLoading || editLogoUploading}
                          className="text-accent hover:text-accent-hover disabled:opacity-50 transition-colors shrink-0">
                          <CheckIcon size={13} />
                        </button>
                        <button onClick={() => { setEditingBrandId(null); setEditLogoError(null); }} className="text-muted hover:text-ink transition-colors shrink-0">
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <BrandLogo name={brand.name} logoUrl={brand.logo_url} size={20} />
                        <span className={`flex-1 text-sm ${brand.active ? 'text-ink' : 'text-muted line-through'}`}>
                          {brand.name}
                        </span>
                        <button
                          onClick={() => handleToggleBrandActive(brand)}
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full transition-colors flex-shrink-0 ${
                            brand.active
                              ? 'bg-green-100 text-green-800 ring-1 ring-green-200 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/25 hover:opacity-80'
                              : 'bg-canvas text-muted border border-hairline hover:bg-surface'
                          }`}>
                          {brand.active ? t('adminUsers.brandOn') : t('adminUsers.brandOff')}
                        </button>
                        <button
                          onClick={() => { setEditingBrandId(brand.id); setEditBrandName(brand.name); setEditBrandLogoUrl(brand.logo_url ?? ''); setEditLogoError(null); }}
                          className="text-muted hover:text-accent transition-colors flex-shrink-0">
                          <Pencil size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Add brand form */}
            <div className="px-4 py-3 border-t border-hairline">
              <form onSubmit={handleCreateBrand} className="flex flex-col gap-1.5">
                <input
                  type="text"
                  value={newBrandName}
                  onChange={e => { setNewBrandName(e.target.value); setNewBrandError(''); }}
                  placeholder={t('adminUsers.newBrandNamePlaceholder')}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors"
                />
                <input
                  ref={newLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleNewLogoChange}
                  className="hidden"
                />
                {newBrandLogoUrl ? (
                  <div className="flex items-center gap-2">
                    <img src={newBrandLogoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-hairline shrink-0" />
                    <button type="button" onClick={() => { setNewBrandLogoUrl(''); setNewLogoError(null); }}
                      className="text-xs text-muted hover:text-red-500 transition-colors flex items-center gap-1">
                      <X size={11} />
                      {t('addModel.removeImage')}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => newLogoInputRef.current?.click()} disabled={newLogoUploading}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-input-border text-xs text-muted hover:border-accent/40 hover:text-ink disabled:opacity-60 transition-colors">
                    <ImagePlus size={12} />
                    {newLogoUploading ? t('addModel.uploading') : t('addModel.chooseImage')}
                  </button>
                )}
                {newLogoError && <p className="text-xs text-red-500">{newLogoError}</p>}
                <button type="submit" disabled={!newBrandName.trim() || newBrandLoading || newLogoUploading}
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 active:scale-95 transition-all">
                  <Plus size={11} />
                  {t('adminUsers.add')}
                </button>
              </form>
              {newBrandError && <p className="text-xs text-red-500 mt-1">{newBrandError}</p>}
            </div>
          </div>
        )}

        {/* FAB */}
        <button
          onClick={() => { setShowBrandsPanel(v => !v); setEditingBrandId(null); setNewBrandName(''); setNewBrandError(''); setNewLogoError(null); }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all active:scale-95 ${
            showBrandsPanel
              ? 'bg-purple-700 text-white'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          <Tag size={15} />
          {t('adminUsers.brandsFab')}
        </button>
      </div>

      {/* Create user modal */}
      {showCreate && (
        <Modal title={t('adminUsers.createUserTitle')} onClose={() => setShowCreate(false)}>
          {createdInfo ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl p-4">
                <p className="text-sm font-medium text-green-800 dark:text-green-400 mb-0.5">{t('adminUsers.accountCreated')}</p>
                <p className="text-sm text-green-700 dark:text-green-500">{createdInfo.name}</p>
                <p className="text-xs text-green-600 dark:text-green-600 font-mono">{createdInfo.email}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1.5 font-medium uppercase tracking-wide">{t('adminUsers.tempPassword')}</p>
                <div className="flex items-center gap-2 bg-canvas border border-hairline rounded-xl px-3 py-2.5">
                  <span className="flex-1 font-mono text-sm text-ink tracking-wider select-all">{createdInfo.password}</span>
                  <CopyButton text={createdInfo.password} copyKey="created" />
                </div>
                <p className="text-xs text-muted mt-1.5">{t('adminUsers.mustChangeOnLogin')}</p>
              </div>
              <button onClick={() => setShowCreate(false)}
                className="w-full py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover active:scale-95 transition-all">
                {t('common.close')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">{t('adminUsers.emailLabel')} <span className="text-red-400 normal-case">*</span></label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="user@example.com" className={inputCls} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">{t('adminUsers.nameLabel')} <span className="text-red-400 normal-case">*</span></label>
                <input type="text" value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder={t('adminUsers.namePlaceholder')} className={inputCls} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">{t('adminUsers.roleLabel')}</label>
                <Select
                  options={[
                    { id: 'marketing', label: t('roles.marketing') },
                    { id: 'manager', label: t('roles.manager') },
                    { id: 'admin', label: t('roles.admin') },
                  ]}
                  value={form.role}
                  onChange={v => setForm(f => ({ ...f, role: v }))}
                />
              </div>
              {brands.filter(b => b.active).length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">{t('adminUsers.accessibleBrands')} {form.role === 'marketing' && <span className="text-red-400 normal-case">*</span>}</label>
                  <div className="flex flex-wrap gap-2">
                    {brands.filter(b => b.active).map(b => (
                      <label key={b.id} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-all ${
                        selectedBrandIds.includes(b.id)
                          ? 'bg-accent/10 border-accent text-accent'
                          : 'bg-canvas border-hairline text-muted hover:border-accent/40'
                      }`}>
                        <input type="checkbox" className="sr-only"
                          checked={selectedBrandIds.includes(b.id)}
                          onChange={() => toggleBrand(b.id)} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                  {form.role === 'manager' && (
                    <p className="text-xs text-muted mt-1.5">{t('adminUsers.managerAllBrandsHint')}</p>
                  )}
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted tracking-wide uppercase">{t('adminUsers.tempPassword')} <span className="text-red-400 normal-case">*</span></label>
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}
                    className="text-xs text-accent hover:text-accent-hover transition-colors">
                    {t('adminUsers.regenerate')}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className={inputCls + ' pr-9'}
                    required minLength={6}
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {createError && (
                <p className="text-sm text-red-500 bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2">
                  {createError}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={createLoading}
                  className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover disabled:opacity-60 active:scale-95 transition-all">
                  {createLoading ? t('adminUsers.creating') : t('adminUsers.createAccount')}
                </button>
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 py-2 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <Modal title={t('adminUsers.resetPasswordTitle', { name: resetTarget.full_name })}
          onClose={() => { setResetTarget(null); setResetPwd(''); }}>
          <form onSubmit={handleResetPassword} className="space-y-3">
            <p className="text-sm text-muted">{t('adminUsers.mustChangeNextLogin')}</p>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted tracking-wide uppercase">{t('adminUsers.newPasswordLabel')}</label>
                <button type="button" onClick={() => setResetPwd(generatePassword())}
                  className="text-xs text-accent hover:text-accent-hover transition-colors">
                  {t('adminUsers.regenerate')}
                </button>
              </div>
              <div className="flex items-center gap-2 bg-canvas border border-hairline rounded-xl px-3 py-2.5">
                <span className="flex-1 font-mono text-sm text-ink tracking-wider select-all">{resetPwd}</span>
                <CopyButton text={resetPwd} copyKey={`reset-${resetTarget.id}`} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={resetLoading}
                className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover disabled:opacity-60 active:scale-95 transition-all">
                {resetLoading ? t('adminUsers.resetting') : t('adminUsers.resetPassword')}
              </button>
              <button type="button" onClick={() => { setResetTarget(null); setResetPwd(''); }}
                className="flex-1 py-2 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
