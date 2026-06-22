import { useState, useEffect, useRef } from 'react';
import { Users, Plus, Copy, Check, Eye, EyeOff, RefreshCw, Pencil, Tag, X, Check as CheckIcon } from 'lucide-react';
import {
  getAdminUsers, createAdminUser, updateAdminUser, resetUserPassword,
  getAdminBrands, createAdminBrand, updateAdminBrand,
  type AdminUser, type Brand,
} from '../api/index.js';
import Modal from '../components/Modal.js';
import Toast from '../components/Toast.js';
import Select from '../components/Select.js';
import UserAvatar from '../components/UserAvatar.js';
import { getCached, setCached } from '../lib/swrCache.js';
import { ROLE_LABELS } from '../lib/roleLabels.js';

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

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function CopyButton({ text, copyKey }: { text: string; copyKey: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={handleCopy}
      className="text-muted hover:text-accent transition-colors flex-shrink-0" title="คัดลอก" key={copyKey}>
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  );
}

export default function AdminUsersPage() {
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

  // Brand panel state
  const [showBrandsPanel, setShowBrandsPanel] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandLoading, setNewBrandLoading] = useState(false);
  const [newBrandError, setNewBrandError] = useState('');
  const [editingBrandId, setEditingBrandId] = useState<number | null>(null);
  const [editBrandName, setEditBrandName] = useState('');
  const [editBrandLoading, setEditBrandLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
    if (selectedBrandIds.length === 0) { setCreateError('กรุณาเลือกอย่างน้อย 1 แบรนด์'); return; }
    setCreateLoading(true);
    try {
      await createAdminUser({ ...form, brand_ids: selectedBrandIds });
      setCreatedInfo({ name: form.full_name, email: form.email, password: form.password });
      setForm({ email: '', full_name: '', role: 'marketing', password: generatePassword() });
      setSelectedBrandIds([]);
      await load();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
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
    setToast(`กำลังบันทึก...`);
    try {
      await updateAdminUser(user.id, { is_active: next });
      setToast(`${user.full_name}: ${next ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}แล้ว`);
    } catch (err: unknown) {
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: user.is_active } : u));
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetLoading(true);
    try {
      await resetUserPassword(resetTarget.id, resetPwd);
      setToast(`รีเซ็ตรหัสผ่านของ ${resetTarget.full_name} แล้ว`);
      setResetTarget(null);
      setResetPwd('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
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
    setSavingUserBrands(true);
    try {
      const updated = await updateAdminUser(userId, { brand_ids: editingUserBrandIds });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, user_brands: updated.user_brands } : u));
      setToast('อัปเดตแบรนด์แล้ว');
      setEditingUserBrandsId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSavingUserBrands(false);
    }
  }

  // --- Brand handlers ---
  async function handleCreateBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!newBrandName.trim()) return;
    setNewBrandError('');
    setNewBrandLoading(true);
    try {
      const brand = await createAdminBrand(newBrandName.trim());
      setBrands(prev => [...prev, brand].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedBrandIds([]);
      setNewBrandName('');
      setToast(`เพิ่มแบรนด์ "${brand.name}" สำเร็จแล้ว`);
    } catch (err: unknown) {
      setNewBrandError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setNewBrandLoading(false);
    }
  }

  async function handleSaveEditBrand(brand: Brand) {
    if (!editBrandName.trim() || editBrandName.trim() === brand.name) {
      setEditingBrandId(null);
      return;
    }
    setEditBrandLoading(true);
    try {
      const updated = await updateAdminBrand(brand.id, { name: editBrandName.trim() });
      setBrands(prev => prev.map(b => b.id === updated.id ? updated : b).sort((a, b) => a.name.localeCompare(b.name)));
      setToast(`เปลี่ยนชื่อแบรนด์เป็น "${updated.name}" แล้ว`);
      setEditingBrandId(null);
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setEditBrandLoading(false);
    }
  }

  async function handleToggleBrandActive(brand: Brand) {
    const next = !brand.active;
    setBrands(prev => prev.map(b => b.id === brand.id ? { ...b, active: next } : b));
    setToast(`กำลังบันทึก...`);
    try {
      await updateAdminBrand(brand.id, { active: next });
      setToast(`${brand.name}: ${next ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}แล้ว`);
    } catch (err: unknown) {
      setBrands(prev => prev.map(b => b.id === brand.id ? { ...b, active: brand.active } : b));
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    }
  }

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-8">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* Users section */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
            <Users size={18} className="text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink tracking-tight">จัดการผู้ใช้</h1>
            <p className="text-xs text-muted">{users.length} บัญชี</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-xs font-medium rounded-full hover:bg-accent-hover active:scale-95 transition-all">
          <Plus size={13} />
          เพิ่มผู้ใช้
        </button>
      </div>

      <div className="bg-surface border border-hairline rounded-2xl overflow-hidden">
        {tableLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">ชื่อ</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">อีเมล</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">บทบาท</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">แบรนด์</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted tracking-wide uppercase">สถานะ</th>
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
                  <td className="px-4 py-3 text-muted font-mono text-xs">{user.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ROLE_STYLE[user.role] ?? 'bg-canvas text-muted'}`}>
                      {ROLE_LABELS[user.role] ?? user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.role !== 'marketing' ? <span className="text-xs text-muted">—</span> : editingUserBrandsId === user.id ? (
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
                          ? <span className="text-xs text-muted">—</span>
                          : user.user_brands.map(ub => (
                            <span key={ub.brands.id} className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-canvas border border-hairline text-ink">
                              {ub.brands.name}
                            </span>
                          ))
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
                      {user.is_active ? 'ใช้งาน' : 'ปิด'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setResetTarget(user); setResetPwd(generatePassword()); }}
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent whitespace-nowrap transition-colors" title="รีเซ็ตรหัสผ่าน">
                      <RefreshCw size={11} />
                      รหัสผ่าน
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Brands FAB + floating panel */}
      <div ref={panelRef} className="fixed bottom-6 right-6 flex flex-col items-end gap-2 z-20">
        {/* Panel */}
        {showBrandsPanel && (
          <div className="w-72 bg-surface border border-hairline rounded-2xl shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
              <span className="text-sm font-semibold text-ink">แบรนด์ ({brands.length})</span>
              <button onClick={() => { setShowBrandsPanel(false); setEditingBrandId(null); }}
                className="text-muted hover:text-ink transition-colors">
                <X size={15} />
              </button>
            </div>

            {/* Brand list */}
            <div className="max-h-64 overflow-y-auto">
              {brands.length === 0 ? (
                <p className="text-xs text-muted text-center py-6">ยังไม่มีแบรนด์</p>
              ) : (
                brands.map(brand => (
                  <div key={brand.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-hairline last:border-0 hover:bg-canvas transition-colors">
                    {editingBrandId === brand.id ? (
                      <>
                        <input
                          autoFocus
                          value={editBrandName}
                          onChange={e => setEditBrandName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSaveEditBrand(brand); }
                            if (e.key === 'Escape') setEditingBrandId(null);
                          }}
                          className="flex-1 px-2 py-1 text-xs rounded-lg bg-input-bg border border-input-border text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                        <button onClick={() => handleSaveEditBrand(brand)} disabled={editBrandLoading}
                          className="text-accent hover:text-accent-hover disabled:opacity-50 transition-colors">
                          <CheckIcon size={13} />
                        </button>
                        <button onClick={() => setEditingBrandId(null)} className="text-muted hover:text-ink transition-colors">
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <>
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
                          {brand.active ? 'เปิด' : 'ปิด'}
                        </button>
                        <button
                          onClick={() => { setEditingBrandId(brand.id); setEditBrandName(brand.name); }}
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
              <form onSubmit={handleCreateBrand} className="flex gap-2">
                <input
                  type="text"
                  value={newBrandName}
                  onChange={e => { setNewBrandName(e.target.value); setNewBrandError(''); }}
                  placeholder="ชื่อแบรนด์ใหม่"
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-input-bg border border-input-border text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30 transition-colors"
                />
                <button type="submit" disabled={!newBrandName.trim() || newBrandLoading}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 active:scale-95 transition-all">
                  <Plus size={11} />
                  เพิ่ม
                </button>
              </form>
              {newBrandError && <p className="text-xs text-red-500 mt-1">{newBrandError}</p>}
            </div>
          </div>
        )}

        {/* FAB */}
        <button
          onClick={() => { setShowBrandsPanel(v => !v); setEditingBrandId(null); setNewBrandName(''); setNewBrandError(''); }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all active:scale-95 ${
            showBrandsPanel
              ? 'bg-purple-700 text-white'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          <Tag size={15} />
          แบรนด์
        </button>
      </div>

      {/* Create user modal */}
      {showCreate && (
        <Modal title="เพิ่มผู้ใช้ใหม่" onClose={() => setShowCreate(false)}>
          {createdInfo ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl p-4">
                <p className="text-sm font-medium text-green-800 dark:text-green-400 mb-0.5">สร้างบัญชีสำเร็จ</p>
                <p className="text-sm text-green-700 dark:text-green-500">{createdInfo.name}</p>
                <p className="text-xs text-green-600 dark:text-green-600 font-mono">{createdInfo.email}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1.5 font-medium uppercase tracking-wide">รหัสผ่านชั่วคราว</p>
                <div className="flex items-center gap-2 bg-canvas border border-hairline rounded-xl px-3 py-2.5">
                  <span className="flex-1 font-mono text-sm text-ink tracking-wider select-all">{createdInfo.password}</span>
                  <CopyButton text={createdInfo.password} copyKey="created" />
                </div>
                <p className="text-xs text-muted mt-1.5">ระบบจะบังคับให้เปลี่ยนรหัสผ่านเมื่อล็อกอินครั้งแรก</p>
              </div>
              <button onClick={() => setShowCreate(false)}
                className="w-full py-2 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover active:scale-95 transition-all">
                ปิด
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">อีเมล <span className="text-red-400 normal-case">*</span></label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="user@example.com" className={inputCls} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">ชื่อในระบบ <span className="text-red-400 normal-case">*</span></label>
                <input type="text" value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="ชื่อ" className={inputCls} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">บทบาท</label>
                <Select
                  options={[
                    { id: 'marketing', label: 'ทีม Marketing' },
                    { id: 'manager', label: 'ผู้จัดการ' },
                    { id: 'admin', label: 'ผู้ดูแลระบบ' },
                  ]}
                  value={form.role}
                  onChange={v => setForm(f => ({ ...f, role: v }))}
                />
              </div>
              {brands.filter(b => b.active).length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">แบรนด์ที่เข้าถึงได้ <span className="text-red-400 normal-case">*</span></label>
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
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted tracking-wide uppercase">รหัสผ่านชั่วคราว <span className="text-red-400 normal-case">*</span></label>
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}
                    className="text-xs text-accent hover:text-accent-hover transition-colors">
                    สุ่มใหม่
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
                  {createLoading ? 'กำลังสร้าง...' : 'สร้างบัญชี'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 py-2 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                  ยกเลิก
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <Modal title={`รีเซ็ตรหัสผ่าน — ${resetTarget.full_name}`}
          onClose={() => { setResetTarget(null); setResetPwd(''); }}>
          <form onSubmit={handleResetPassword} className="space-y-3">
            <p className="text-sm text-muted">ผู้ใช้จะถูกบังคับให้เปลี่ยนรหัสผ่านเมื่อล็อกอินครั้งถัดไป</p>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted tracking-wide uppercase">รหัสผ่านใหม่</label>
                <button type="button" onClick={() => setResetPwd(generatePassword())}
                  className="text-xs text-accent hover:text-accent-hover transition-colors">
                  สุ่มใหม่
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
                {resetLoading ? 'กำลังรีเซ็ต...' : 'รีเซ็ตรหัสผ่าน'}
              </button>
              <button type="button" onClick={() => { setResetTarget(null); setResetPwd(''); }}
                className="flex-1 py-2 border border-hairline text-ink text-sm rounded-full hover:bg-canvas active:scale-95 transition-all">
                ยกเลิก
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
