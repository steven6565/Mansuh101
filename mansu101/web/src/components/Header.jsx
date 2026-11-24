import { useStore } from '../store.jsx';
import { Brand } from './Brand.jsx';
import { Dot } from './ui.jsx';
import {
  Activity, Globe, History, LogOut, Settings, Terminal, WifiOff,
} from './Icons.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'urls', label: 'URLs', icon: Globe },
  { id: 'history', label: 'History', icon: History },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Header({ activeTab, onTabChange, onLogout }) {
  const { connected, browser, health } = useStore();

  const browserTone = browser.status === 'online'
    ? 'emerald'
    : browser.status === 'launching'
      ? 'violet'
      : browser.status === 'error'
        ? 'rose'
        : 'slate';
  const browserLabel = browser.status === 'online'
    ? `Chromium ${browser.version ? browser.version.split('/')[1] ?? browser.version : 'online'}`
    : browser.status === 'launching'
      ? 'Launching'
      : browser.status === 'error'
        ? 'Browser error'
        : 'Browser offline';

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1640px] items-center justify-between gap-4 px-4 py-3 lg:px-6">
        <div className="flex items-center gap-5">
          <Brand />
          <nav className="hidden items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1 lg:flex">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`nav-pill ${activeTab === tab.id ? 'nav-pill-active' : ''}`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 sm:flex">
            {connected ? <Dot tone="emerald" pulse /> : <Dot tone="rose" />}
            <span className={`text-[11px] font-medium ${connected ? 'text-emerald-300' : 'text-rose-300'}`}>
              {connected ? 'LIVE' : 'RECONNECTING'}
            </span>
          </div>

          <div className="hidden items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 md:flex">
            <Dot tone={browserTone} pulse={browser.status === 'online'} />
            <span className="text-[11px] font-medium text-slate-300">{browserLabel}</span>
            {browser.activeContexts > 0 && (
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                {browser.activeContexts}
              </span>
            )}
          </div>

          {!connected && <WifiOff size={15} className="text-rose-400 sm:hidden" />}

          {health?.host && (
            <span className="hidden font-mono text-[10px] text-slate-600 xl:inline">{health.host}</span>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="btn-icon"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-t border-white/[0.05] px-3 py-1.5 lg:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`nav-pill shrink-0 !px-2.5 !py-1.5 !text-xs ${activeTab === tab.id ? 'nav-pill-active' : ''}`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  );
}
