import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { useNow } from '../lib/hooks.js';
import { Modal, SectionHeading, EmptyState } from './ui.jsx';
import { SessionCard, SessionDetails } from './SessionCard.jsx';
import { Monitor, Layers, Play, Eye } from './Icons.jsx';

const ACTIVE = new Set(['starting', 'navigating', 'loaded']);

export default function SessionsPanel() {
  const { sessions, stats, closeSession, runAction, busyAction } = useStore();
  const [filter, setFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const now = useNow(1000);

  const filtered = useMemo(() => {
    if (filter === 'active') return sessions.filter((session) => ACTIVE.has(session.status));
    if (filter === 'failed') return sessions.filter((session) => session.status === 'failed');
    if (filter === 'pending') return sessions.filter((session) => session.status === 'queued');
    return sessions;
  }, [sessions, filter]);

  const ordered = useMemo(() => {
    const active = filtered.filter((session) => ACTIVE.has(session.status));
    const rest = filtered
      .filter((session) => !ACTIVE.has(session.status))
      .sort((a, b) => String(b.finishedAt ?? b.createdAt).localeCompare(String(a.finishedAt ?? a.createdAt)));
    return [...active, ...rest];
  }, [filtered]);

  const limit = showAll ? 60 : 9;
  const visible = ordered.slice(0, limit);
  const selected = selectedId ? sessions.find((session) => session.id === selectedId) : null;

  const filters = [
    { id: 'all', label: 'All', count: sessions.length },
    { id: 'active', label: 'Active', count: stats.activeSessions },
    { id: 'failed', label: 'Failed', count: sessions.filter((s) => s.status === 'failed').length },
    { id: 'pending', label: 'Queued', count: sessions.filter((s) => s.status === 'queued').length },
  ];

  return (
    <section>
      <SectionHeading
        icon={Monitor}
        title="Browser monitoring"
        subtitle="Live remote Chromium tabs, screenshots and page diagnostics"
        right={
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${filter === item.id ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {item.label}
                <span className="ml-1 font-mono text-[9px] opacity-70">{item.count}</span>
              </button>
            ))}
          </div>
        }
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No browser sessions yet"
          description="Start a run and MANSU101 will launch a fresh isolated Chromium context for every enabled URL. Screenshots, titles, HTTP codes, JS errors and network failures stream in here."
          action={(
            <button type="button" className="btn-primary" onClick={() => runAction('start')} disabled={Boolean(busyAction)}>
              <Play size={14} /> Start first run
            </button>
          )}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Eye}
          title={`No ${filter} sessions`}
          description="Switch the filter or start another run to see remote tabs here."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                now={now}
                onExpand={(item) => setSelectedId(item.id)}
                onClose={closeSession}
              />
            ))}
          </div>
          {ordered.length > limit && (
            <div className="mt-3 text-center">
              <button type="button" className="btn-ghost" onClick={() => setShowAll(true)}>
                Show {Math.min(60, ordered.length) - limit} more session(s)
              </button>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={`Session · tab ${selected?.tabIndex ?? ''}`}
        subtitle={selected?.url}
        width="max-w-5xl"
      >
        <SessionDetails session={selected} />
      </Modal>
    </section>
  );
}
