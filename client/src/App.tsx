import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { LayoutList, Plus, Moon, Sun, Users, ShieldOff, BookUser, Package, LayoutDashboard, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import LoginPage from './pages/LoginPage.js';
import UserAvatar from './components/UserAvatar.js';
import { ROLE_LABELS } from './lib/roleLabels.js';

// Code-split everything behind login — keeps the initial bundle (login page)
// small and defers heavy per-page deps (recharts, exceljs-adjacent import UI) until visited.
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage.js'));
const NewPlacementPage = lazy(() => import('./pages/NewPlacementPage.js'));
const ImportPlacementsPage = lazy(() => import('./pages/ImportPlacementsPage.js'));
const PlacementsPage = lazy(() => import('./pages/PlacementsPage.js'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage.js'));
const KolsPage = lazy(() => import('./pages/KolsPage.js'));
const SamplesPage = lazy(() => import('./pages/SamplesPage.js'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.js'));

const Spinner = (
  <div className="flex items-center justify-center min-h-screen bg-canvas">
    <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

// No standalone "home" page — landing destination depends on role: admin/manager
// go straight to the analytics Dashboard, everyone else goes to the Placements list.
function homePathFor(role?: string) {
  return role === 'admin' || role === 'manager' ? '/dashboard' : '/placements';
}

// Redirects to the role-appropriate home (or /change-password) when already logged in
function LoginRoute() {
  const { session, loading, mustChangePassword, signingIn, deactivated, appUser } = useAuth();
  if (loading) return Spinner;
  if (session && !signingIn && !deactivated) {
    if (mustChangePassword) return <Navigate to="/change-password" replace />;
    if (!appUser) return Spinner; // wait for role to resolve before deciding where to land
    return <Navigate to={homePathFor(appUser.role)} replace />;
  }
  return <LoginPage />;
}

// Catches the bare root path ("/") and any unmatched URL while logged in —
// redirects to the role-appropriate home instead of showing a page of its own.
function RoleHome() {
  const { appUser } = useAuth();
  if (!appUser) return Spinner;
  return <Navigate to={homePathFor(appUser.role)} replace />;
}

// Requires login + must NOT have mustChangePassword (redirects to /change-password if true)
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, mustChangePassword } = useAuth();
  if (loading) return Spinner;
  if (!session) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

// Requires login only — for /change-password itself
function RequireSession({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return Spinner;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Admin role guard (must be inside ProtectedRoute)
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuth();
  if (!appUser) return Spinner;
  if (appUser.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Manager or admin role guard (must be inside ProtectedRoute)
function RequireManagerOrAdmin({ children }: { children: React.ReactNode }) {
  const { appUser } = useAuth();
  if (!appUser) return Spinner;
  if (appUser.role !== 'admin' && appUser.role !== 'manager') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const { appUser, signOut, deactivated } = useAuth();
  const location = useLocation();
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  const navLinkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-white/10 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'
    }`;

  return (
    <div className="min-h-screen bg-canvas">
      {deactivated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-surface border border-hairline rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-red-500/10 rounded-2xl mb-4">
              <ShieldOff size={22} className="text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-ink mb-1">บัญชีถูกปิดใช้งาน</h2>
            <p className="text-sm text-muted mb-6">กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานบัญชีของคุณอีกครั้ง</p>
            <button
              onClick={signOut}
              className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-full active:scale-95 transition-all"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
      <div className="flex">
        <aside className="w-56 shrink-0 bg-black sticky top-0 h-screen flex flex-col">
          <Link to="/" className="text-white text-sm font-semibold tracking-tight px-4 h-11 flex items-center shrink-0">
            KOL System
          </Link>

          <div className="px-3 mb-2">
            <Link
              to="/placements/new"
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover active:scale-95 transition-all"
            >
              <Plus size={14} />
              เพิ่ม Placement
            </Link>
          </div>

          <nav className="flex-1 px-3 flex flex-col gap-0.5 overflow-y-auto">
            <NavLink to="/placements" className={navLinkCls}>
              <LayoutList size={15} />
              รายการ
            </NavLink>
            <NavLink to="/kols" className={navLinkCls}>
              <BookUser size={15} />
              KOL
            </NavLink>
            <NavLink to="/samples" className={navLinkCls}>
              <Package size={15} />
              Sample
            </NavLink>
            {(appUser?.role === 'admin' || appUser?.role === 'manager') && (
              <NavLink to="/dashboard" className={navLinkCls}>
                <LayoutDashboard size={15} />
                Dashboard
              </NavLink>
            )}
            {appUser?.role === 'admin' && (
              <NavLink to="/admin/users" className={navLinkCls}>
                <Users size={15} />
                ผู้ใช้
              </NavLink>
            )}
          </nav>

          {appUser && (
            <div className="px-3 py-3 border-t border-white/10 shrink-0">
              <div className="flex items-center gap-2.5">
                <UserAvatar name={appUser.full_name} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{appUser.full_name}</div>
                  <div className="text-white/50 text-[11px] truncate">{ROLE_LABELS[appUser.role] ?? appUser.role}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={toggleDark}
                    className="text-white/50 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
                    aria-label="Toggle dark mode"
                  >
                    {dark ? <Sun size={14} /> : <Moon size={14} />}
                  </button>
                  <button
                    onClick={signOut}
                    className="text-white/50 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
                    aria-label="ออกจากระบบ"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
        <main className="flex-1 min-w-0">
          <div key={location.pathname} className="page-fade">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={Spinner}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/change-password" element={
            <RequireSession>
              <ChangePasswordPage />
            </RequireSession>
          } />
          <Route path="/placements" element={
            <ProtectedRoute>
              <Layout><PlacementsPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/placements/new" element={
            <ProtectedRoute>
              <Layout><NewPlacementPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/placements/import" element={
            <ProtectedRoute>
              <Layout><ImportPlacementsPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/kols" element={
            <ProtectedRoute>
              <Layout><KolsPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/samples" element={
            <ProtectedRoute>
              <Layout><SamplesPage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <RequireManagerOrAdmin>
                <Layout><DashboardPage /></Layout>
              </RequireManagerOrAdmin>
            </ProtectedRoute>
          } />
          <Route path="/admin/users" element={
            <ProtectedRoute>
              <RequireAdmin>
                <Layout><AdminUsersPage /></Layout>
              </RequireAdmin>
            </ProtectedRoute>
          } />
          <Route path="/*" element={
            <ProtectedRoute>
              <RoleHome />
            </ProtectedRoute>
          } />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
