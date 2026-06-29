import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutList, Plus, Moon, Sun, Users, ShieldOff, BookUser, Package, LayoutDashboard, Boxes, ChevronDown, LogOut, Menu, PieChart, CalendarDays } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import LoginPage from './pages/LoginPage.js';
import UserAvatar from './components/UserAvatar.js';
import LanguageSwitcher from './components/LanguageSwitcher.js';
import { roleLabel } from './lib/roleLabels.js';

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
const ProductDashboardPage = lazy(() => import('./pages/ProductDashboardPage.js'));
const MarketingDashboardPage = lazy(() => import('./pages/MarketingDashboardPage.js'));
const CalendarPage = lazy(() => import('./pages/CalendarPage.js'));
const PlacementDetailPage = lazy(() => import('./pages/PlacementDetailPage.js'));

const Spinner = (
  <div className="flex items-center justify-center min-h-screen bg-canvas">
    <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

// No standalone "home" page — landing destination depends on role: admin/manager
// go straight to the analytics Dashboard, everyone else goes to the Placements list.
function homePathFor(role?: string) {
  if (role === 'admin' || role === 'manager') return '/dashboard';
  if (role === 'marketing') return '/marketing';
  return '/placements';
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
  const { t } = useTranslation();
  const { appUser, signOut, deactivated } = useAuth();
  const location = useLocation();
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  const dashboardSectionActive = location.pathname.startsWith('/dashboard');
  const [dashboardOpen, setDashboardOpen] = useState(dashboardSectionActive);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (dashboardSectionActive) setDashboardOpen(true);
  }, [dashboardSectionActive]);

  // Mobile off-canvas drawer — closed by default, closes itself on every navigation
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileNavOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

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
            <h2 className="text-base font-semibold text-ink mb-1">{t('deactivated.title')}</h2>
            <p className="text-sm text-muted mb-6">{t('deactivated.message')}</p>
            <button
              onClick={signOut}
              className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-full active:scale-95 transition-all"
            >
              {t('common.signOut')}
            </button>
          </div>
        </div>
      )}
      {/* Mobile top bar — hidden on lg+ where the sidebar is always visible */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 bg-black h-12 px-3">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="text-white/70 hover:text-white p-2 -ml-1 rounded-lg hover:bg-white/5 transition-colors"
          aria-label={t('common.openMenu')}
        >
          <Menu size={20} />
        </button>
        <Link to="/" className="text-white text-sm font-semibold tracking-tight">KOL System</Link>
        <Link
          to="/placements/new"
          className="text-white/70 hover:text-white p-2 -mr-1 rounded-lg hover:bg-white/5 transition-colors"
          aria-label={t('nav.addPlacement')}
        >
          <Plus size={20} />
        </Link>
      </div>

      {/* Backdrop behind the mobile drawer */}
      {mobileNavOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="flex">
        <aside
          className={`bg-black flex flex-col shrink-0 z-50 fixed left-0 top-0 h-screen w-64 transition-transform duration-200 lg:sticky lg:top-0 lg:w-56 lg:translate-x-0 ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Link to="/" className="text-white text-sm font-semibold tracking-tight px-4 h-11 flex items-center shrink-0">
            KOL System
          </Link>

          <div className="px-3 mb-2">
            <Link
              to="/placements/new"
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover active:scale-95 transition-all"
            >
              <Plus size={14} />
              {t('nav.addPlacement')}
            </Link>
          </div>

          <nav className="flex-1 px-3 flex flex-col gap-0.5 overflow-y-auto">
            <NavLink to="/placements" className={navLinkCls}>
              <LayoutList size={15} />
              {t('nav.placements')}
            </NavLink>
            <NavLink to="/calendar" className={navLinkCls}>
              <CalendarDays size={15} />
              {t('nav.calendar')}
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
              <div>
                <button
                  type="button"
                  onClick={() => setDashboardOpen(o => !o)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    dashboardSectionActive ? 'text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <LayoutDashboard size={15} />
                  <span className="flex-1 text-left">Dashboard</span>
                  <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${dashboardOpen ? 'rotate-180' : ''}`} />
                </button>
                {dashboardOpen && (
                  <div className="flex flex-col gap-0.5 mt-0.5 ml-[13px] pl-3 border-l border-white/10">
                    <NavLink to="/dashboard" end className={navLinkCls}>
                      <LayoutDashboard size={14} />
                      KOL
                    </NavLink>
                    <NavLink to="/dashboard/products" className={navLinkCls}>
                      <Boxes size={14} />
                      {t('nav.dashboardProducts')}
                    </NavLink>
                  </div>
                )}
              </div>
            )}
            <NavLink to="/marketing" className={navLinkCls}>
              <PieChart size={15} />
              {t('nav.marketingDashboard')}
            </NavLink>
            {appUser?.role === 'admin' && (
              <NavLink to="/admin/users" className={navLinkCls}>
                <Users size={15} />
                {t('nav.users')}
              </NavLink>
            )}
          </nav>

          {appUser && (
            <div className="px-3 py-3 border-t border-white/10 shrink-0">
              <div className="flex items-center gap-2.5">
                <UserAvatar name={appUser.full_name} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{appUser.full_name}</div>
                  <div className="text-white/50 text-[11px] truncate">{roleLabel(t, appUser.role)}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <LanguageSwitcher openUp />
                  <button
                    onClick={toggleDark}
                    className="text-white/50 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
                    aria-label={t('common.toggleDarkMode')}
                  >
                    {dark ? <Sun size={14} /> : <Moon size={14} />}
                  </button>
                  <button
                    onClick={signOut}
                    className="text-white/50 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
                    aria-label={t('common.signOut')}
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
          <Route path="/placements/:id" element={
            <ProtectedRoute>
              <Layout><PlacementDetailPage /></Layout>
            </ProtectedRoute>
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
          <Route path="/calendar" element={
            <ProtectedRoute>
              <Layout><CalendarPage /></Layout>
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
          <Route path="/dashboard/products" element={
            <ProtectedRoute>
              <RequireManagerOrAdmin>
                <Layout><ProductDashboardPage /></Layout>
              </RequireManagerOrAdmin>
            </ProtectedRoute>
          } />
          <Route path="/marketing" element={
            <ProtectedRoute>
              <Layout><MarketingDashboardPage /></Layout>
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
