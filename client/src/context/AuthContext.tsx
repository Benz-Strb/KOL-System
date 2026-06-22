import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.js';
import { setAuthToken, setDeactivatedHandler, API_BASE_URL, type AppUser } from '../api/index.js';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  signingIn: boolean;
  mustChangePassword: boolean;
  deactivated: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [deactivated, setDeactivated] = useState(false);

  useEffect(() => {
    setDeactivatedHandler(() => setDeactivated(true));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthToken(data.session?.access_token ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthToken(session?.access_token ?? null);
      if (!session) setAppUser(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch appUser from users table when session changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!session?.user.id) { setAppUser(null); return; }
    fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async r => {
        if (r.status === 403) {
          setDeactivated(true);
          await supabase.auth.signOut();
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(u => setAppUser(u))
      .catch(() => setAppUser(null));
    // intentionally keyed on user id only — re-fetching on every access_token
    // refresh (Supabase auto-refreshes hourly) would refetch the same user for no reason
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const mustChangePassword = session?.user.user_metadata?.must_change_password === true;

  const signInWithEmail = async (email: string, password: string) => {
    setDeactivated(false);
    setSigningIn(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // ตรวจสอบสถานะ active ก่อนให้เข้าระบบ
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.session!.access_token}` },
      });
      if (res.status === 403) {
        await supabase.auth.signOut();
        setDeactivated(true);
        throw new Error('บัญชีนี้ถูกปิดใช้งานแล้ว — กรุณาติดต่อผู้ดูแลระบบ');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      appUser,
      loading,
      signingIn,
      mustChangePassword,
      deactivated,
      signInWithEmail,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
