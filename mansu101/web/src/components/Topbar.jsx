import { useEffect, useRef, useState } from 'react';
import { useApp, RANGE_PRESETS } from '../store.jsx';
import { post, queryString } from '../lib/api.js';
import { relativeTime, hostOf } from '../lib/format.js';
import { Select } from './ui.jsx';
import {
  Sun,
  Moon,
  Refresh,
  ChevronDown,
  LogOut,
  Plus,
  Globe,
  Calendar,
  Alert,
  Check,
  Plug,
} from './Icons.jsx';

const PAGE_TITLES = {
  dashboard: { title: 'Dashboard', subtitle: 'Organic search and site traffic at a glance' },
  'search-console': { title: 'Search Console', subtitle: 'Queries, pages, countries and devices from Google' },
  analytics: { title: 'Analytics', subtitle: 'Google Analytics 4 sessions and acquisition' },
  keywords: { title: 'Keywords', subtitle: 'Tracked keywords, intent and measured performance' },
  audit: { title: 'Site audit', subtitle: 'Technical crawl of the pages you own' },
  content: { title: 'Content', subtitle: 'Briefs, gaps and internal link suggestions' },
  campaigns: { title: 'Campaigns', subtitle: 'UTM tracking and real GA4 attribution' },
  reports: { title: 'Reports', subtitle: 'Shareable snapshots of measured performance' },
  automation: { title: 'Automation', subtitle: 'Scheduled syncs, audits and reports' },
  integrations: { title: 'Integrations', subtitle: 'Search Console, Analytics and email delivery' },
  settings: { title: 'Settings', subtitle: 'Crawl limits, retention and security' },
  activity: { title: 'Activity', subtitle: 'Everything the platform has done, newest first' },
};

export default function Topbar({ page, onNavigate, onOpenMobileNav, onAddSite }) {
  const {
    boot, sites, activeSite, siteId, setSiteId, range, updateRange,
    theme, toggleTheme, logout, toast, refreshBoot,
  } = useApp();
  const [syncing, setSyncing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const meta = PAGE_TITLES[page] ?? { title: 'Visitor', subtitle: '' };
  const google = boot?.integrations?.google;
  const canSync = Boolean(activeSite && google?.status === 'connected');

  const sync = async () => {
    if (!activeSite) return;
    setSyncing(true);
    try {
      const result = await post(`/sites/${activeSite.id}/sync`, { days: Number(range.days) || 28 });
      const failed = Object.keys(result.errors ?? {});
      if (failed.length) {
        toast(`Synced ${Object.keys(result.results ?? {}).join(', ') || 'nothing'}; failed: ${failed.join(', ')}`, 'warn', 7000);
      } else {
        toast('Google data synced', 'success');
      }
      await refreshBoot();
      window.dispatchEvent(new CustomEvent('visitor:data-changed', { detail: { siteId: activeSite.id } }));
    } catch (error) {
      toast(error.message, 'error', 7000);
    } finally {
      setSyncing(false);
    }
  };

  const rangeValue = range.from && range.to ? 'custom' : String(range.days);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-4 lg:px-6">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="btn-icon lg:hidden"
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14.5px] font-semibold tracking-tight text-ink">{meta.title}</h1>
          <p className="hidden truncate text-[11px] text-muted sm:block">{meta.subtitle}</p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {sites.length > 0 ? (
            <div className="hidden items-center gap-1.5 sm:flex">
              <Globe size={13} className="shrink-0 text-faint" />
              <Select
                ariaLabel="Active site"
                className="w-[168px] !py-1.5 text-[12px]"
                value={siteId ?? ''}
                onChange={setSiteId}
                options={sites.map((site) => ({ value: site.id, label: hostOf(site.url) }))}
              />
            </div>
          ) : (
            <button type="button" className="btn-secondary btn-sm" onClick={onAddSite}>
              <Plus size={13} /> Add site
            </button>
          )}

          <div className="hidden items-center gap-1.5 md:flex">
            <Calendar size={13} className="shrink-0 text-faint" />
            <Select
              ariaLabel="Date range"
              className="w-[140px] !py-1.5 text-[12px]"
              value={rangeValue}
              onChange={(value) => {
                if (value === 'custom') return;
                updateRange({ days: Number(value), from: null, to: null });
              }}
              options={[
                ...RANGE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
                ...(rangeValue === 'custom' ? [{ value: 'custom', label: 'Custom range' }] : []),
              ]}
            />
          </div>

          <button
            type="button"
            onClick={sync}
            disabled={!canSync || syncing}
            className="btn-secondary btn-sm"
            title={canSync ? 'Sync Search Console and Analytics' : 'Connect Google to enable syncing'}
          >
            <Refresh size={13} className={syncing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync'}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn-icon"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="btn-icon gap-1"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/12 text-[10px] font-semibold text-brand-600 dark:text-brand-400">
                {(boot?.app?.name ?? 'V').slice(0, 1)}
              </span>
              <ChevronDown size={11} className="hidden text-faint sm:block" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+6px)] z-40 w-64 animate-rise overflow-hidden rounded-xl border border-line bg-elevated shadow-pop"
              >
                <div className="border-b border-line px-3.5 py-2.5">
                  <p className="text-[12px] font-semibold text-ink">{boot?.app?.name ?? 'Visitor'} {boot?.app?.version}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    {boot?.app?.authDisabled ? 'Authentication disabled' : 'Signed in as administrator'}
                  </p>
                </div>
                <div className="space-y-2 px-3.5 py-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <Plug size={12} /> Google
                    </span>
                    {google?.status === 'connected' ? (
                      <span className="inline-flex items-center gap-1 text-positive">
                        <Check size={11} /> {google.email ? google.email.split('@')[0] : 'connected'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-faint">
                        <Alert size={11} /> not connected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted">Last sync</span>
                    <span className="text-ink">{relativeTime(activeSite?.lastSyncAt)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted">Retention</span>
                    <span className="text-ink">{boot?.app?.retentionDays ?? '—'} days</span>
                  </div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onNavigate('integrations'); }}
                  className="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-[12px] text-muted transition hover:bg-sunken hover:text-ink"
                >
                  <Plug size={13} /> Integrations
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={logout}
                  className="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-[12px] text-muted transition hover:bg-sunken hover:text-ink"
                >
                  <LogOut size={13} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto border-t border-line/60 px-3 py-1.5 sm:hidden">
        <Select
          ariaLabel="Active site"
          className="w-[150px] !py-1 text-[11.5px]"
          value={siteId ?? ''}
          onChange={setSiteId}
          options={sites.length ? sites.map((site) => ({ value: site.id, label: hostOf(site.url) })) : [{ value: '', label: 'No sites yet' }]}
        />
        <Select
          ariaLabel="Date range"
          className="w-[126px] !py-1 text-[11.5px]"
          value={rangeValue === 'custom' ? '28' : rangeValue}
          onChange={(value) => updateRange({ days: Number(value), from: null, to: null })}
          options={RANGE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
        />
      </div>
    </header>
  );
}

export { queryString };
