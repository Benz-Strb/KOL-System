import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.js';

const inputCls = [
  'w-full px-3 py-2.5 rounded-xl text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30',
].join(' ');

export default function ChangePasswordPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (password !== confirm) { setError('รหัสผ่านไม่ตรงกัน'); return; }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (updateError) throw updateError;
      await supabase.auth.refreshSession();
      navigate('/placements', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="bg-surface border border-hairline rounded-2xl w-full max-w-sm p-8 shadow-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-11 h-11 bg-amber-500/10 rounded-xl mb-4">
            <KeyRound size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">ตั้งรหัสผ่านใหม่</h1>
          <p className="text-sm text-muted mt-1">กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งานระบบ</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">รหัสผ่านใหม่</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="อย่างน้อย 8 ตัวอักษร"
              className={inputCls}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">ยืนยันรหัสผ่าน</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="กรอกรหัสผ่านอีกครั้ง"
              className={inputCls}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent text-white text-sm font-medium rounded-full hover:bg-accent-hover disabled:opacity-60 active:scale-95 transition-all mt-1"
          >
            {loading ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่าน'}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="w-full py-2 text-muted text-xs hover:text-ink transition-colors"
          >
            ออกจากระบบ
          </button>
        </form>
      </div>
    </div>
  );
}
