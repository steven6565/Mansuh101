import { useEffect, useState } from 'react';
import { Brand } from './Brand.jsx';
import {
  Dashboard,
  Search,
  Chart,
  Sparkles,
  ClipboardCheck,
  FileText,
  Megaphone,
  Clock,
  Plug,
  Settings,
  Activity,
  Menu,
  X,
  ChevronRight,
  Shield,
} from './Icons.jsx';
import { useApp } from '../store.jsx';

export const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: Dashboard }],
  },
  {
    label: 'Search performance',
    items: [
      { id: 'search-console', label: 'Search Console', icon: Search },
      { id: 'analytics', label: 'Analytics', icon: Chart },
      { id: 'keywords', label: 'Keywords', icon: Sparkles },
    ],
  },
  {
    label: 'Growth',
    items: [
      { id: 'audit', label: 'Site audit', icon: ClipboardCheck },
      { id: 'content', label: 'Content', icon: FileText },
      { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'reports', label: 'Reports', icon: FileText },
      { id: 'automation', label: 'Automation', icon: Clock },
      { id: 'integrations', label: 'Integrations', icon: Plug },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function Sidebar({ active, onNavigate, onClose, mobile = false }) {
  const { boot, connected, scheduler } = useApp();
  const [version, setVersion] = useState(null);

  useEffect(() => {
    setVersion(boot?.app?.version ?? null);
  }, [boot]);

  return (
    <aside
      className={`flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-elevated ${
        mobile ? 'shadow-pop' : ''
      }`}
    >
      <div className="flex h-14 items-center justify-between px-3.5">
        <button type="button" onClick={() => onNavigate('dashboard')} className="rounded-lg text-left">
          <Brand />
        </button>
        {mobile && (
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close navigation">
            <X size={16} />
          </button>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 pb-4 pt-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-faint">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`nav-item w-full ${active === item.id ? 'nav-item-active' : ''}`}
                    aria-current={active === item.id ? 'page' : undefined}
                  >
                    <item.icon size={15} className="shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {active === item.id && <ChevronRight size={12} className="opacity-60" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <button
          type="button"
          onClick={() => onNavigate('activity')}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
            active === 'activity' ? 'bg-sunken text-ink' : 'text-muted hover:bg-sunken hover:text-ink'
          }`}
        >
          <Activity size={13} />
          <span className="flex-1 text-left">Activity log</span>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-positive' : 'bg-negative'}`} />
        </button>
        <div className="mt-2 flex items-center justify-between px-2 text-[10px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Shield size={11} />
            {scheduler?.enabled ? 'Scheduler on' : 'Scheduler off'}
          </span>
          <span className="font-mono">v{version ?? '—'}</span>
        </div>
      </div>
    </aside>
  );
}

export function MobileNavTrigger({ onClick }) {
  return (
    <button type="button" className="btn-icon lg:hidden" onClick={onClick} aria-label="Open navigation">
      <Menu size={17} />
    </button>
  );
}
