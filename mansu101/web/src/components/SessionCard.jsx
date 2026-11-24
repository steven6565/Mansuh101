import { useState } from 'react';
import {
  Camera, Eye, X, Alert, Globe, Clock, Layers, Activity,
} from './Icons.jsx';
import { StatusPill, ProgressBar } from './ui.jsx';
import {
  elapsed, formatDateTime, formatDuration, hostname, truncate, STATUS_META,
} from '../lib/format.js';

const ACTIVE = new Set(['starting', 'navigating', 'loaded']);

export function SessionCard({ session, now, onExpand, onClose }) {
  const [imageFailed, setImageFailed] = useState(false);
  const active = ACTIVE.has(session.status);
  const duration = session.finishedAt
    ? session.durationMs
    : session.startedAt
      ? elapsed(session.startedAt, null, now)
      : null;
  const screenshotUrl = session.screenshot
    ? `/api/screenshots/${session.screenshot}?v=${session.screenshotVersion ?? ''}`
    : null;
  const jsErrors = session.errors?.length ?? 0;
  const netFails = session.networkFailures?.length ?? 0;

  return (
    <article className={`card-tight group flex flex-col overflow-hidden transition hover:border-white/[0.13] ${active ? 'ring-1 ring-inset ring-violet-500/20' : ''}`}>
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.05] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 min-w-5 items-center justify-center rounded bg-white/[0.06] px-1 font-mono text-[10px] text-slate-400">
            {String(session.tabIndex).padStart(2, '0')}
          </span>
          <StatusPill status={session.status} />
          {session.httpStatus != null && (
            <span className={`font-mono text-[10px] ${session.httpStatus < 400 ? 'text-emerald-300/80' : 'text-rose-300'}`}>
              {session.httpStatus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500" title="Session duration">
            <Clock size={10} /> {formatDuration(duration)}
          </span>
          <button type="button" className="btn-icon !h-6 !w-6" onClick={() => onExpand(session)} title="Inspect session">
            <Eye size={12} />
          </button>
          {active && (
            <button type="button" className="btn-icon !h-6 !w-6 hover:!text-rose-300" onClick={() => onClose(session.id)} title="Close this tab">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <button type="button" onClick={() => onExpand(session)} className="screenshot-frame m-2 mb-0 aspect-[16/10] text-left">
        {screenshotUrl && !imageFailed ? (
          <img
            src={screenshotUrl}
            alt={`Screenshot of ${hostname(session.url)}`}
            className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.015]"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.12),transparent_70%)]">
            {active ? (
              <>
                <div className="relative h-8 w-12 overflow-hidden rounded border border-white/10">
                  <div className="absolute inset-x-0 h-4 animate-scan bg-gradient-to-b from-transparent via-violet-400/30 to-transparent" />
                </div>
                <span className="text-[10px] uppercase tracking-widest text-slate-500">{session.stage ?? 'Working…'}</span>
              </>
            ) : (
              <>
                <Camera size={18} className="text-slate-600" />
                <span className="text-[10px] uppercase tracking-widest text-slate-600">
                  {session.status === 'queued' ? 'Awaiting slot' : 'No screenshot'}
                </span>
              </>
            )}
          </div>
        )}
        {session.title && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-1.5 pt-6">
            <p className="truncate text-[10px] text-slate-300">{session.title}</p>
          </div>
        )}
        {active && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-violet-300 backdrop-blur">
            <span className="h-1 w-1 animate-pulse rounded-full bg-violet-400" /> live
          </span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col px-3 pb-3 pt-2">
        <p className="truncate text-[11px] font-medium text-slate-200" title={session.url}>
          {session.finalUrl && session.finalUrl !== session.url ? truncate(hostname(session.finalUrl), 24) : truncate(hostname(session.url), 24)}
          <span className="ml-1 text-slate-600">·</span>
          <span className="ml-1 font-mono text-[9px] text-slate-500">tab {session.tabIndex}</span>
        </p>
        {session.url && (
          <p className="mt-0.5 truncate font-mono text-[9px] text-slate-600" title={session.url}>{session.url}</p>
        )}

        {active && (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[9px] text-slate-500">
              <span className="truncate">{session.stage ?? STATUS_META[session.status]?.label}</span>
              <span className="font-mono">{session.progress ?? 0}%</span>
            </div>
            <ProgressBar value={session.progress ?? 0} tone={session.status === 'loaded' ? 'cyan' : 'violet'} />
          </div>
        )}

        {session.error && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-400/15 bg-rose-500/[0.06] px-2 py-1.5 text-[10px] leading-snug text-rose-300" title={session.error}>
            <Alert size={11} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{truncate(session.error, 120)}</span>
          </p>
        )}

        <div className="mt-auto flex items-center gap-3 border-t border-white/[0.04] pt-2 text-[10px] text-slate-500">
          <span className={`flex items-center gap-1 ${jsErrors ? 'text-amber-300' : ''}`} title="JavaScript errors">
            <Activity size={10} /> {jsErrors}
          </span>
          <span className={`flex items-center gap-1 ${netFails ? 'text-amber-300' : ''}`} title="Network failures">
            <Globe size={10} /> {netFails}
          </span>
          <span className="ml-auto flex items-center gap-1 font-mono">
            {session.finishedAt ? formatDateTime(session.finishedAt).split(', ')[1] : session.startedAt ? 'running' : '—'}
          </span>
        </div>
      </div>
    </article>
  );
}

export function SessionDetails({ session }) {
  if (!session) return null;
  const screenshotUrl = session.screenshot ? `/api/screenshots/${session.screenshot}?v=${session.screenshotVersion ?? ''}` : null;
  return (
    <div className="space-y-4">
      <div className="screenshot-frame aspect-video bg-black/40">
        {screenshotUrl ? (
          <img src={screenshotUrl} alt="Remote page screenshot" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">Screenshot not available</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={session.status} />
        {session.httpStatus != null && (
          <span className="pill bg-white/[0.05] font-mono text-slate-300 ring-1 ring-inset ring-white/10">HTTP {session.httpStatus}</span>
        )}
        <span className="pill bg-white/[0.04] font-mono text-slate-400 ring-1 ring-inset ring-white/[0.08]">
          <Clock size={10} /> {formatDuration(session.durationMs)}
        </span>
        <span className="pill bg-white/[0.04] font-mono text-slate-400 ring-1 ring-inset ring-white/[0.08]">
          <Layers size={10} /> tab {session.tabIndex}
        </span>
        {session.errorCode && (
          <span className="pill bg-rose-500/10 font-mono text-rose-300 ring-1 ring-inset ring-rose-400/20">{session.errorCode}</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Detail label="Target URL" value={session.url} mono />
        <Detail label="Final URL" value={session.finalUrl || session.url} mono />
        <Detail label="Page title" value={session.title || '—'} />
        <Detail label="Started" value={session.startedAt ? formatDateTime(session.startedAt) : '—'} />
        <Detail label="Finished" value={session.finishedAt ? formatDateTime(session.finishedAt) : '—'} />
        <Detail label="Attempts" value={session.attempts ?? 0} />
      </div>

      {session.error && (
        <div className="rounded-lg border border-rose-400/20 bg-rose-500/[0.06] p-3">
          <p className="label mb-1 text-rose-300/80">Error</p>
          <p className="text-xs text-rose-200">{session.error}</p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <LogList title={`JavaScript errors (${session.errors?.length ?? 0})`} items={(session.errors ?? []).map((error) => ({ time: error.at, text: error.message }))} empty="No JavaScript errors captured" />
        <LogList
          title={`Network failures (${session.networkFailures?.length ?? 0})`}
          items={(session.networkFailures ?? []).map((failure) => ({
            time: failure.at,
            text: failure.status ? `HTTP ${failure.status} · ${failure.url}` : `${failure.error} · ${failure.url}`,
          }))}
          empty="No failed requests captured"
        />
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
      <p className="label !text-[9px]">{label}</p>
      <p className={`mt-1 break-all text-[11px] text-slate-300 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function LogList({ title, items, empty }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20">
      <p className="border-b border-white/[0.05] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <div className="max-h-44 overflow-y-auto p-2">
        {items.length ? (
          <ul className="space-y-1.5">
            {items.map((item, index) => (
              <li key={`${item.time}-${index}`} className="rounded bg-white/[0.02] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-400">
                {item.time && <span className="mr-1.5 text-slate-600">{new Date(item.time).toLocaleTimeString('en-GB', { hour12: false })}</span>}
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-3 text-center text-[11px] text-slate-600">{empty}</p>
        )}
      </div>
    </div>
  );
}
