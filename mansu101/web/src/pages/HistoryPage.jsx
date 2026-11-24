import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../store.jsx';
import { formatDateTime, formatDuration, hostname } from '../lib/format.js';
import { Modal, SectionHeading, StatusPill, EmptyState } from '../components/ui.jsx';
import { History, Refresh, Download, External, Alert, Check, Layers, Clock, Trash } from '../components/Icons.jsx';

function runDuration(run) {
  if (!run?.startedAt) return null;
  return new Date(run.finishedAt ?? Date.now()).getTime() - new Date(run.startedAt).getTime();
}

export default function HistoryPage() {
  const { toast, clearHistory, engine } = useStore();
  const [runs, setRuns] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const limit = 20;
  const runActive = ['running', 'paused', 'stopping'].includes(engine);

  const load = useCallback(async (nextOffset = 0, append = false) => {
    setLoading(true);
    try {
      const result = await api(`/runs?limit=${limit}&offset=${nextOffset}`);
      setTotal(result.total);
      setOffset(nextOffset);
      setRuns((previous) => (append ? [...previous, ...result.runs] : result.runs));
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = async (run) => {
    setDetailLoading(true);
    setDetail({ run, sessions: [], events: [] });
    try {
      const result = await api(`/runs/${run.id}`);
      setDetail(result);
    } catch (error) {
      toast(error.message, 'error');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const confirmClearHistory = async () => {
    setClearing(true);
    await clearHistory();
    setClearing(false);
    setConfirmingClear(false);
    setRuns([]);
    setTotal(0);
    setOffset(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">Run history</h1>
          <p className="mt-1 text-xs text-slate-500">
            Persisted in the database — survives restarts and phone disconnects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <button
              type="button"
              className="btn-danger !py-1.5 !text-[11px]"
              onClick={() => setConfirmingClear(true)}
              disabled={runActive}
              title={runActive ? 'Stop the active run first' : 'Delete all stored runs, sessions, events and screenshots'}
            >
              <Trash size={12} /> Clear history
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={() => load(0, false)} disabled={loading}>
            <Refresh size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="px-4 pt-4">
          <SectionHeading
            icon={History}
            title="Automation runs"
            subtitle={`${total} stored run(s)`}
            right={<span className="font-mono text-[10px] text-slate-600">retention controlled by RETENTION_DAYS</span>}
          />
        </div>
        {runs.length === 0 && !loading ? (
          <div className="p-4">
            <EmptyState
              icon={History}
              title="No runs recorded yet"
              description="Completed, stopped and interrupted runs are stored automatically with per-session details and events."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead>
                <tr className="border-y border-white/[0.06] bg-black/15 text-[9px] uppercase tracking-[0.14em] text-slate-500">
                  <th className="px-4 py-2 font-semibold">Run</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Started</th>
                  <th className="px-3 py-2 font-semibold">Duration</th>
                  <th className="px-3 py-2 text-center font-semibold">URLs</th>
                  <th className="px-3 py-2 text-center font-semibold">Success</th>
                  <th className="px-3 py-2 text-center font-semibold">Failed</th>
                  <th className="px-4 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {runs.map((run) => (
                  <tr key={run.id} className="transition hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-mono text-slate-300">{run.id.slice(0, 8)}</td>
                    <td className="px-3 py-2.5"><StatusPill status={run.status} /></td>
                    <td className="px-3 py-2.5 text-slate-400">{formatDateTime(run.startedAt)}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">{formatDuration(runDuration(run))}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-slate-300">{run.totals?.total ?? 0}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-emerald-300/80">{run.totals?.succeeded ?? 0}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-rose-300/80">{run.totals?.failed ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button type="button" className="btn-ghost !px-2 !py-1 !text-[10px]" onClick={() => openDetail(run)}>
                          View
                        </button>
                        <a className="btn-icon !h-6 !w-6" href={`/api/reports/export?format=csv&runId=${run.id}`} title="Export CSV">
                          <Download size={12} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <p className="border-t border-white/[0.05] px-4 py-3 text-center text-[10px] text-slate-600">Loading runs…</p>}
          </div>
        )}
        {runs.length < total && (
          <div className="border-t border-white/[0.06] px-4 py-3 text-center">
            <button type="button" className="btn-ghost !text-[11px]" onClick={() => load(offset + limit, true)} disabled={loading}>
              Load more runs
            </button>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="Run report"
        subtitle={detail?.run ? `${detail.run.id} · ${formatDateTime(detail.run.startedAt)}` : ''}
        width="max-w-6xl"
        footer={detail?.run && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-600">Exports include every session, diagnostic and timestamp.</span>
            <div className="flex gap-2">
              <a className="btn-ghost !py-1.5 !text-[11px]" href={`/api/reports/export?format=csv&runId=${detail.run.id}`}>
                <Download size={12} /> CSV
              </a>
              <a className="btn-ghost !py-1.5 !text-[11px]" href={`/api/reports/export?format=json&runId=${detail.run.id}&events=1`}>
                <Download size={12} /> JSON + events
              </a>
            </div>
          </div>
        )}
      >
        {detailLoading ? (
          <p className="py-10 text-center text-xs text-slate-500">Loading run details…</p>
        ) : detail?.run ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat icon={Layers} label="Total URLs" value={detail.run.totals?.total ?? 0} />
              <MiniStat icon={Check} label="Succeeded" value={detail.run.totals?.succeeded ?? 0} tone="text-emerald-300" />
              <MiniStat icon={Alert} label="Failed" value={detail.run.totals?.failed ?? 0} tone="text-rose-300" />
              <MiniStat icon={Clock} label="Duration" value={formatDuration(runDuration(detail.run))} />
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
              <table className="w-full min-w-[640px] text-left text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/20 text-[9px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">URL</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">HTTP</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Diagnostics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {detail.sessions.map((session) => (
                    <tr key={session.id}>
                      <td className="px-3 py-2 font-mono text-slate-600">{session.tabIndex}</td>
                      <td className="max-w-[240px] px-3 py-2">
                        <p className="truncate text-slate-300" title={session.url}>{hostname(session.url)}</p>
                        <p className="truncate font-mono text-[9px] text-slate-600">{session.url}</p>
                      </td>
                      <td className="px-3 py-2"><StatusPill status={session.status} /></td>
                      <td className={`px-3 py-2 font-mono ${session.httpStatus && session.httpStatus >= 400 ? 'text-rose-300' : 'text-slate-400'}`}>
                        {session.httpStatus ?? '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-400">{formatDuration(session.durationMs)}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {session.errors?.length ? `${session.errors.length} JS` : '0 JS'}
                        {' · '}
                        {session.networkFailures?.length ? `${session.networkFailures.length} net` : '0 net'}
                        {session.error && <span className="ml-1 text-rose-300/80" title={session.error}>· error</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {detail.sessions.some((session) => session.screenshot) && (
              <div>
                <p className="label mb-2">Captured screenshots</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {detail.sessions.filter((session) => session.screenshot).slice(0, 6).map((session) => (
                    <a
                      key={session.id}
                      href={`/api/screenshots/${session.screenshot}`}
                      target="_blank"
                      rel="noreferrer"
                      className="screenshot-frame group aspect-video"
                    >
                      <img src={`/api/screenshots/${session.screenshot}`} alt={session.url} className="h-full w-full object-cover object-top" loading="lazy" />
                      <span className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent p-2 text-[9px] text-slate-300 opacity-0 transition group-hover:opacity-100">
                        tab {session.tabIndex} · {hostname(session.url)} <External size={10} className="ml-1" />
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmingClear}
        onClose={() => (clearing ? null : setConfirmingClear(false))}
        title="Clear run history?"
        subtitle="This permanently deletes stored runs, sessions, events and screenshots."
        width="max-w-lg"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost !py-1.5 !text-[11px]" onClick={() => setConfirmingClear(false)} disabled={clearing}>
              Cancel
            </button>
            <button type="button" className="btn-danger !py-1.5 !text-[11px]" onClick={confirmClearHistory} disabled={clearing}>
              <Trash size={12} /> {clearing ? 'Clearing…' : 'Delete history'}
            </button>
          </div>
        )}
      >
        <div className="space-y-3 text-xs leading-relaxed text-slate-400">
          <p>
            {total} stored run(s) will be removed, along with every session record,
            diagnostic event and screenshot file they produced.
          </p>
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] text-amber-200">
            Your URL queue, automation settings and login sessions are kept. Export any report you still need first —
            this cannot be undone.
          </div>
          {runActive && (
            <p className="text-[11px] text-rose-300">Stop the active run before clearing history.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, tone = 'text-slate-200' }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
        <Icon size={10} /> {label}
      </div>
      <p className={`mt-1 font-mono text-sm ${tone}`}>{value}</p>
    </div>
  );
}
