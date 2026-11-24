import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { Card, EmptyState, ErrorState, SearchInput, Notice } from '../components/ui.jsx';
import { Activity as ActivityIcon, Refresh, Info } from '../components/Icons.jsx';
import { formatDateTime, relativeTime, TONE_CLASS } from '../lib/format.js';

const TYPES = ['all', 'system', 'scheduler', 'audit', 'integration', 'report', 'campaign', 'content', 'settings', 'security', 'api'];

export default function Activity() {
  const { activity: liveEvents, connected, toast } = useApp();
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [merged, setMerged] = useState([]);

  const list = useApi('/activity?limit=300');

  useEffect(() => {
    if (list.data?.events) setMerged(list.data.events);
  }, [list.data]);

  // Real-time events are prepended as they arrive; duplicates are ignored.
  useEffect(() => {
    if (!liveEvents.length) return;
    setMerged((previous) => {
      const seen = new Set(previous.map((event) => `${event.at}-${event.message}`));
      const fresh = liveEvents.filter((event) => !seen.has(`${event.at}-${event.message}`));
      return fresh.length ? [...fresh, ...previous].slice(0, 500) : previous;
    });
  }, [liveEvents]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return merged
      .filter((event) => type === 'all' || event.type === type)
      .filter((event) => !needle || String(event.message).toLowerCase().includes(needle));
  }, [merged, type, search]);

  return (
    <div className="space-y-4">
      <Notice tone="info" icon={Info} title="Immutable activity trail">
        Every sync, crawl, report and scheduler transition is logged with a timestamp. Entries stream live
        over Socket.IO while this page is open and are read from the database on load.
      </Notice>

      <Card
        title="Activity"
        description={`${merged.length} event(s) retained · live stream ${connected ? 'connected' : 'disconnected'}`}
        icon={ActivityIcon}
        actions={
          <button type="button" className="btn-secondary btn-sm" onClick={() => list.refetch()} disabled={list.loading}>
            <Refresh size={12} className={list.loading ? 'animate-spin' : ''} /> Reload
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {TYPES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize transition ${
                  type === value ? 'bg-brand-600 text-white' : 'bg-sunken text-muted hover:text-ink'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search events…" className="w-[176px]" />
        </div>

        {list.loading && !merged.length ? (
          <div className="space-y-1.5">
            {Array.from({ length: 10 }).map((_, index) => <div key={index} className="h-7 skeleton" />)}
          </div>
        ) : list.error && !merged.length ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : !filtered.length ? (
          <EmptyState
            compact
            icon={ActivityIcon}
            title={merged.length ? 'No events match this filter' : 'No activity yet'}
            description={merged.length
              ? 'Try another type or clear the search.'
              : 'Connect Google, run an audit or schedule a job — each action is recorded here.'}
          />
        ) : (
          <ol className="space-y-0.5">
            {filtered.map((event, index) => (
              <li
                key={`${event.at}-${index}`}
                className="flex items-start gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-sunken"
              >
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    event.level === 'error' ? 'bg-negative'
                      : event.level === 'warn' ? 'bg-warning'
                        : event.level === 'success' ? 'bg-positive' : 'bg-info'
                  }`}
                />
                <span className="w-[86px] shrink-0 font-mono text-[10px] tabular-nums text-faint" title={formatDateTime(event.at)}>
                  {relativeTime(event.at)}
                </span>
                <span className="w-[76px] shrink-0">
                  <span className={`pill ${TONE_CLASS.neutral} text-[9.5px] capitalize`}>{event.type ?? 'system'}</span>
                </span>
                <span className={`min-w-0 flex-1 text-[11.5px] leading-relaxed ${event.level === 'error' ? 'text-negative' : 'text-ink'}`}>
                  {event.message}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
