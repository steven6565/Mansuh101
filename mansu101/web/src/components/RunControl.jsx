import { useState } from 'react';
import { useStore } from '../store.jsx';
import { useNow } from '../lib/hooks.js';
import { elapsed, formatClock, formatDateTime, formatDuration, hostname } from '../lib/format.js';
import { StatusPill, Dot, ProgressBar, Ring } from './ui.jsx';
import {
  Play, Pause, Stop, Restart, Download, Globe, Clock, Layers, Monitor,
  Settings, Eye,
} from './Icons.jsx';

const RUNNING = new Set(['running', 'paused', 'stopping']);

export default function RunControl({ onOpenSettings, onOpenVnc }) {
  const {
    run, engine, totals, stats, busyAction, runAction, urls, vncUrl, browser, toast,
  } = useStore();
  const now = useNow(1000);
  const [exporting, setExporting] = useState(false);

  const active = RUNNING.has(engine);
  const paused = engine === 'paused';
  const stopping = engine === 'stopping';
  const startable = !active && !busyAction;
  const enabledUrls = urls.filter((url) => url.enabled).length;
  const duration = run?.startedAt ? elapsed(run.startedAt, run.finishedAt, now) : null;
  const progress = totals.total ? Math.round(((totals.completed ?? 0) / totals.total) * 100) : 0;
  const current = stats.current;
  const httpStatus = current?.httpStatus ?? stats.lastFinished?.httpStatus;
  const progressTone = (totals.failed ?? 0) > 0 && totals.completed === totals.total ? 'amber' : 'violet';

  const exportUrl = run?.id
    ? `/api/reports/export?format=json&runId=${run.id}`
    : '/api/reports/export?format=json';

  const downloadReport = () => {
    if (!run?.id) {
      toast('No run to export yet — start a run first', 'warn');
      return;
    }
    setExporting(true);
    const anchor = document.createElement('a');
    anchor.href = exportUrl;
    anchor.download = '';
    anchor.click();
    setTimeout(() => setExporting(false), 1200);
  };

  return (
    <section className="card relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-fade opacity-40" />
      <div className="relative p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={engine} />
              {run?.id && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  run {run.id.slice(0, 8)}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Dot tone={browser.status === 'online' ? 'emerald' : browser.status === 'error' ? 'rose' : 'slate'} />
                {browser.status === 'online' ? 'Chromium connected' : browser.status === 'error' ? 'Browser error' : 'Chromium idle'}
              </span>
            </div>
            <h1 className="mt-2.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {active
                ? paused
                  ? 'Automation paused'
                  : stopping
                    ? 'Stopping automation…'
                    : `Testing ${totals.completed ?? 0} of ${totals.total ?? 0} URLs`
                : run?.status === 'completed'
                  ? 'Run complete'
                  : run?.status === 'stopped'
                    ? 'Run stopped'
                    : run?.status === 'interrupted'
                      ? 'Previous run interrupted'
                      : 'Ready to automate'}
              <span className="ml-2 align-middle text-sm font-normal text-slate-500">
                {active ? `${progress}%` : run ? `${totals.succeeded ?? 0} succeeded · ${totals.failed ?? 0} failed` : `${enabledUrls} URL${enabledUrls === 1 ? '' : 's'} ready`}
              </span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!active ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => runAction('start')}
                disabled={!startable || enabledUrls === 0}
                title={enabledUrls === 0 ? 'Add or enable URLs first' : 'Start automation run'}
              >
                <Play size={14} />
                {busyAction === 'start' ? 'Starting…' : 'Start run'}
              </button>
            ) : paused ? (
              <button type="button" className="btn-primary" onClick={() => runAction('resume')} disabled={Boolean(busyAction)}>
                <Play size={14} /> Resume
              </button>
            ) : (
              <button type="button" className="btn-warn" onClick={() => runAction('pause')} disabled={Boolean(busyAction) || stopping}>
                <Pause size={14} /> Pause
              </button>
            )}
            {active && (
              <button type="button" className="btn-danger" onClick={() => runAction('stop')} disabled={Boolean(busyAction) || stopping}>
                <Stop size={14} /> {stopping ? 'Stopping…' : 'Stop'}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => runAction('restart')}
              disabled={Boolean(busyAction) || stopping}
              title="Stop the current run and start a fresh one"
            >
              <Restart size={14} /> Restart
            </button>
            <a
              className="btn-ghost"
              href={exportUrl}
              download
              onClick={(event) => {
                event.preventDefault();
                downloadReport();
              }}
              title="Download this run's report"
              aria-disabled={!run?.id}
            >
              <Download size={14} /> <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export'}</span>
            </a>
            <button
              type="button"
              className="btn-icon !h-9 !w-9"
              onClick={onOpenSettings}
              title="Automation settings"
            >
              <Settings size={15} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Globe size={12} className="text-violet-300" />
                <span className="label !text-[9px]">Current URL</span>
              </span>
              <span className="font-mono text-slate-500">{totals.completed ?? 0} / {totals.total ?? enabledUrls}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-200" title={current?.url ?? stats.lastFinished?.url ?? 'No URL active'}>
                {current?.url ?? stats.lastFinished?.url ?? 'No URL has been processed yet'}
              </p>
              {httpStatus !== null && httpStatus !== undefined && (
                <span className={`pill font-mono ${httpStatus < 400 ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/20' : 'bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-400/20'}`}>
                  HTTP {httpStatus}
                </span>
              )}
              {current?.title && (
                <span className="hidden max-w-[320px] truncate text-[11px] text-slate-500 sm:inline" title={current.title}>
                  {current.title}
                </span>
              )}
            </div>
            <ProgressBar value={progress} tone={progressTone} className="mt-3" />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric icon={Clock} label="Started" value={run?.startedAt ? formatClock(run.startedAt) : '—'} sub={run?.startedAt ? formatDateTime(run.startedAt).split(',')[0] : 'not started'} />
              <Metric icon={Clock} label="Duration" value={duration !== null ? formatDuration(duration) : '—'} sub={run?.finishedAt ? 'finished' : active ? 'running now' : 'idle'} />
              <Metric icon={Layers} label="Active tabs" value={`${stats.activeTabs}`} sub={`${totals.queued ?? 0} queued`} />
              <Metric icon={Monitor} label="Browser" value={browser.status === 'online' ? 'Online' : browser.status === 'launching' ? 'Launching' : browser.status === 'error' ? 'Error' : 'Offline'} sub={browser.activeContexts ? `${browser.activeContexts} context(s)` : 'no contexts'} />
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 lg:w-[260px]">
            <Ring value={progress} size={64} tone={progressTone}>
              <span className="text-sm font-semibold text-white">{progress}%</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="label">Queue outcome</div>
              <div className="mt-2 space-y-1.5 text-[11px]">
                <OutcomeRow colour="bg-emerald-400" label="Succeeded" value={totals.succeeded ?? 0} />
                <OutcomeRow colour="bg-rose-400" label="Failed" value={totals.failed ?? 0} />
                <OutcomeRow colour="bg-amber-400" label="Stopped" value={totals.stopped ?? 0} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <Layers size={12} /> {totals.total ?? 0} total
          </span>
          <span className="text-slate-700">·</span>
          <span>{totals.queued ?? 0} queued</span>
          <span className="text-slate-700">·</span>
          <span>{stats.activeSessions} active session(s)</span>
          {current?.url && (
            <>
              <span className="text-slate-700">·</span>
              <span className="truncate">on {hostname(current.url)}</span>
            </>
          )}
          {vncUrl && (
            <>
              <span className="text-slate-700">·</span>
              <button type="button" onClick={onOpenVnc} className="inline-flex items-center gap-1 text-violet-300 transition hover:text-violet-200">
                <Eye size={12} /> Open remote desktop
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value, sub }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Icon size={10} /> {label}
      </div>
      <div className="mt-1 truncate text-[13px] font-semibold text-slate-100">{value}</div>
      <div className="truncate text-[10px] text-slate-600">{sub}</div>
    </div>
  );
}

function OutcomeRow({ colour, label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${colour}`} /> {label}
      </span>
      <span className="font-mono text-slate-200">{value}</span>
    </div>
  );
}
