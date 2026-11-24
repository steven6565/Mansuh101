import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { AppProvider, useApp } from './store.jsx';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import SiteModal from './components/SiteModal.jsx';
import { Logomark } from './components/Brand.jsx';
import { Toasts, ErrorState } from './components/ui.jsx';

import Dashboard from './pages/Dashboard.jsx';
import SearchConsole from './pages/SearchConsole.jsx';
import Analytics from './pages/Analytics.jsx';
import Keywords from './pages/Keywords.jsx';
import Audit from './pages/Audit.jsx';
import Content from './pages/Content.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Reports from './pages/Reports.jsx';
import Automation from './pages/Automation.jsx';
import Integrations from './pages/Integrations.jsx';
import SettingsPage from './pages/Settings.jsx';
import ActivityPage from './pages/Activity.jsx';

const PAGES = {
  dashboard: Dashboard,
  'search-console': SearchConsole,
  analytics: Analytics,
  keywords: Keywords,
  audit: Audit,
  content: Content,
  campaigns: Campaigns,
  reports: Reports,
  automation: Automation,
  integrations: Integrations,
  settings: SettingsPage,
  activity: ActivityPage,
};

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface">
      <Logomark size={44} className="animate-pulse" />
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-faint">Visitor</p>
        <p className="mt-1 text-[11px] text-muted">Loading your workspace…</p>
      </div>
    </div>
  );
}

function BootError({ error, onRetry }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6">
      <ErrorState error={error} onRetry={onRetry} />
    </div>
  );
}

function Shell() {
  const { boot, bootError, loadingBoot, refreshBoot, toasts, dismissToast } = useApp();
  const [page, setPage] = useState(() => (window.location.hash ? window.location.hash.slice(1) : 'dashboard'));
  const [mobileNav, setMobileNav] = useState(false);
  const [siteModal, setSiteModal] = useState(false);

  const navigate = useCallback((next) => {
    setPage(next);
    setMobileNav(false);
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const next = window.location.hash.slice(1);
      if (next && PAGES[next]) setPage(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = boot?.app?.name ? `${boot.app.name} · Organic growth` : 'Visitor';
  }, [boot]);

  const Page = PAGES[page] ?? Dashboard;

  return (
    <div className="flex min-h-screen bg-surface">
      <div className="hidden lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar active={page} onNavigate={navigate} />
        </div>
      </div>

      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 h-full animate-rise">
            <Sidebar active={page} onNavigate={navigate} onClose={() => setMobileNav(false)} mobile />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          page={page}
          onNavigate={navigate}
          onOpenMobileNav={() => setMobileNav(true)}
          onAddSite={() => setSiteModal(true)}
        />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-4 sm:px-4 lg:px-6 lg:py-5">
          {bootError && !boot ? (
            <BootError error={bootError} onRetry={refreshBoot} />
          ) : loadingBoot && !boot ? (
            <SkeletonPage />
          ) : (
            <div key={page} className="animate-fade-in">
              <Page onNavigate={navigate} onAddSite={() => setSiteModal(true)} />
            </div>
          )}
        </main>

        <footer className="mt-auto border-t border-line px-4 py-3">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 text-[10px] text-faint">
            <span>
              {boot?.app?.name ?? 'Visitor'} {boot?.app?.version ?? ''} · Organic SEO & website growth
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono">Search Console · GA4 · technical audits</span>
              <span className="h-1 w-1 rounded-full bg-positive" />
            </span>
          </div>
        </footer>
      </div>

      <SiteModal
        open={siteModal}
        onClose={() => setSiteModal(false)}
        onCreated={(site) => { navigate('dashboard'); }}
      />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function SkeletonPage() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="card h-[102px] skeleton" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="card h-72 skeleton" />
        <div className="card h-72 skeleton" />
      </div>
      <div className="card h-56 skeleton" />
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState('checking');

  const handleUnauthorized = useCallback(() => setAuth('none'), []);

  useEffect(() => {
    const listener = () => handleUnauthorized();
    window.addEventListener('visitor:unauthorized', listener);
    return () => window.removeEventListener('visitor:unauthorized', listener);
  }, [handleUnauthorized]);

  useEffect(() => {
    let cancelled = false;
    api('/auth/me')
      .then((result) => {
        if (!cancelled) setAuth(result.authenticated || result.authDisabled ? 'authenticated' : 'none');
      })
      .catch(() => {
        if (!cancelled) setAuth('none');
      });
    return () => { cancelled = true; };
  }, []);

  if (auth === 'checking') return <Splash />;
  if (auth === 'none') return <Login onSuccess={() => setAuth('authenticated')} />;

  return (
    <AppProvider onUnauthorized={handleUnauthorized}>
      <Shell />
    </AppProvider>
  );
}
