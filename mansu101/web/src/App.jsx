import { useCallback, useEffect, useState } from 'react';
import { api, post } from './lib/api.js';
import { StoreProvider, useStore } from './store.jsx';
import Login from './components/Login.jsx';
import Header from './components/Header.jsx';
import VncModal from './components/VncModal.jsx';
import { Logomark } from './components/Brand.jsx';
import { ToastStack } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import UrlsPage from './pages/UrlsPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import LogsPage from './pages/LogsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <Logomark size={48} className="animate-pulse-soft" />
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">MANSU101</p>
        <p className="mt-1 text-[11px] text-slate-600">Connecting to automation engine…</p>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.85fr_1fr]">
        <div className="card h-64 animate-pulse bg-white/[0.015]" />
        <div className="card h-64 animate-pulse bg-white/[0.015]" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="card h-24 animate-pulse bg-white/[0.015]" />
        ))}
      </div>
      <div className="card h-64 animate-pulse bg-white/[0.015]" />
    </div>
  );
}

function Shell({ onLogout }) {
  const { loaded, toasts, dismissToast } = useStore();
  const [tab, setTab] = useState('dashboard');
  const [vncOpen, setVncOpen] = useState(false);

  const openVnc = useCallback(() => setVncOpen(true), []);

  let page = null;
  if (!loaded) page = <LoadingShell />;
  else if (tab === 'dashboard') page = <Dashboard onTabChange={setTab} onOpenVnc={openVnc} />;
  else if (tab === 'urls') page = <UrlsPage />;
  else if (tab === 'history') page = <HistoryPage />;
  else if (tab === 'logs') page = <LogsPage />;
  else if (tab === 'settings') page = <SettingsPage onOpenVnc={openVnc} />;

  return (
    <div className="flex min-h-screen flex-col">
      <Header activeTab={tab} onTabChange={setTab} onLogout={onLogout} />
      <main className="mx-auto w-full max-w-[1640px] flex-1 px-3 py-4 sm:px-4 lg:px-6 lg:py-5">
        <div key={tab} className="animate-fade-in">{page}</div>
      </main>
      <footer className="border-t border-white/[0.05] px-4 py-3">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
          <span>MANSU101 v1.0 · Remote Chromium automation · all metrics streamed from the VPS engine</span>
          <span className="flex items-center gap-2 font-mono">
            <span className="h-1 w-1 rounded-full bg-emerald-400" /> Puppeteer · Socket.IO · SQLite
          </span>
        </div>
      </footer>
      <VncModal open={vncOpen} onClose={() => setVncOpen(false)} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState('checking');

  const handleUnauthorized = useCallback(() => setAuth('none'), []);

  useEffect(() => {
    window.addEventListener('mansu:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('mansu:unauthorized', handleUnauthorized);
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
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    setAuth('none');
  }, []);

  if (auth === 'checking') return <Splash />;
  if (auth === 'none') return <Login onSuccess={() => setAuth('authenticated')} />;

  return (
    <StoreProvider onUnauthorized={handleUnauthorized}>
      <Shell onLogout={logout} />
    </StoreProvider>
  );
}
