import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutList } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import LanguageSwitcher from '../components/LanguageSwitcher.js';

const inputCls = [
  'w-full px-3 py-2.5 rounded-xl text-sm transition-colors',
  'bg-input-bg border border-input-border text-ink placeholder:text-muted',
  'focus:outline-none focus:ring-2 focus:ring-accent hover:border-accent/30',
].join(' ');

export default function LoginPage() {
  const { t } = useTranslation();
  const { signInWithEmail, deactivated } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  function triggerShake() {
    setShake(false);
    requestAnimationFrame(() => { requestAnimationFrame(() => setShake(true)); });
    setTimeout(() => setShake(false), 500);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmail(email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('login.genericError');
      setError(msg.includes('Invalid login credentials') ? t('login.invalidCredentials') : msg);
      triggerShake();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 relative">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher variant="light" />
      </div>
      <div className={`bg-surface border border-hairline rounded-xl w-full max-w-sm p-8 ${shake ? 'shake' : ''}`}>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-11 h-11 bg-accent/10 rounded-xl mb-4">
            <LayoutList size={20} className="text-accent" />
          </div>
          <h1 className="text-xl font-semibold text-ink tracking-tight">KOL System</h1>
          <p className="text-sm text-muted mt-1">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">{t('login.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputCls}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5 tracking-wide uppercase">{t('login.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
              required
            />
          </div>

          {deactivated && !error && (
            <p className="text-sm text-red-500 bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2">
              {t('login.deactivatedMessage')}
            </p>
          )}
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
            {loading ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>
      </div>
    </div>
  );
}
