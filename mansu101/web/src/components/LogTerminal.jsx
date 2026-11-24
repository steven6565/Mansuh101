import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { formatClock } from '../lib/format.js';
import { LOG_LEVEL_CLASS } from '../lib/format.js';
import { Dot } from './ui.jsx';
import { Terminal, Trash, Download, Search, ArrowUpRight } from './Icons.jsx';

const LEVELS = [
  { id: 'all', label: 'All' },
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Warn' },
  { id: 'error', label: 'Error' },
];

export default function LogTerminal({ mode = 'compact', onOpenLogs }) {
  const { logs, connected, clearLogs } = useStore();
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const scrollRef = useRef(null);
  const full = mode === 'full';

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (level === 'error' && log.level !== 'error') return false;
      if (level === 'warn' && !['warn', 'error'].includes(log.level)) return false;
      if (level === 'info' && log.level === 'error') return false;
      if (query && !String(log.message).toLowerCase().includes(query)) return false;
      return true;
    });
  }, [logs, level, search]);

  const visible = full ? filtered : filtered.slice(-160);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible.length, autoScroll]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  };

  const downloadLogs = () => {
    const text = visible
      .map((log) => `[${formatClock(log.at)}] ${String(log.level).toUpperCase()} ${log.message}`)
      .join('\n');
    const blob = new Blob([text || 'No log entries'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mansu101-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-black/20 px-3 py-2">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500/70" />
            <span className="h-2 w-2 rounded-full bg-amber-500/70" />
            <span className="h-2 w-2 rounded-full bg-emerald-500/70" />
          </div>
          <div className="flex items-center gap-1.5">
            <Terminal size={12} className="text-slate-500" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Live event stream</span>
          </div>
          <span className="hidden items-center gap-1.5 sm:flex">
            <Dot tone={connected ? 'emerald' : 'rose'} pulse={connected} />
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>
              {connected ? 'streaming' : 'offline'}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-md border border-white/[0.06] bg-white/[0.02] p-0.5">
            {LEVELS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLevel(item.id)}
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition ${level === item.id ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {full && (
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter logs…"
                className="h-6 w-32 rounded-md border border-white/[0.06] bg-black/30 pl-6 pr-2 text-[10px] text-slate-300 outline-none placeholder:text-slate-600 focus:border-violet-500/40 sm:w-44"
              />
            </div>
          )}
          <button type="button" className="btn-icon !h-6 !w-6" onClick={downloadLogs} title="Download visible logs">
            <Download size={11} />
          </button>
          <button
            type="button"
            className={`btn-icon !h-6 !w-6 ${confirming ? '!text-rose-300' : ''}`}
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                setTimeout(() => setConfirming(false), 3500);
              } else {
                clearLogs();
                setConfirming(false);
              }
            }}
            title={confirming ? 'Click again to clear all logs' : 'Clear log buffer'}
          >
            <Trash size={11} />
          </button>
          {!full && onOpenLogs && (
            <button type="button" onClick={onOpenLogs} className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-violet-300 transition hover:text-violet-200">
              Full view <ArrowUpRight size={10} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`terminal overflow-y-auto bg-[#05050b] px-3 py-2.5 ${full ? 'h-[calc(100vh-15rem)] min-h-[320px]' : 'h-[236px]'}`}
      >
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
            <Terminal size={18} className="text-slate-700" />
            <p className="text-[11px] text-slate-600">Waiting for server events…</p>
            <p className="text-[9px] text-slate-700">Launch a run to stream browser activity from the VPS.</p>
          </div>
        ) : (
          <div className="space-y-[3px]">
            {visible.map((log, index) => (
              <div key={`${log.at}-${index}`} className="group flex gap-2 rounded px-1 py-0.5 hover:bg-white/[0.025]">
                <span className="shrink-0 text-slate-600">[{formatClock(log.at)}]</span>
                <span className={`min-w-0 flex-1 break-words ${LOG_LEVEL_CLASS[log.level] ?? 'text-slate-300'}`}>
                  {log.message}
                </span>
                {log.sessionId && (
                  <span className="hidden shrink-0 rounded bg-white/[0.04] px-1 text-[8px] text-slate-600 sm:inline">
                    {log.type}
                  </span>
                )}
              </div>
            ))}
            {connected && (
              <div className="flex items-center gap-1.5 pt-1 text-violet-400/70">
                <span className="text-[10px]">$</span>
                <span className="inline-block h-3 w-1.5 animate-blink bg-violet-400/70" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/20 px-3 py-1.5 text-[9px] text-slate-600">
        <span>{filtered.length} event(s) · auto-scroll {autoScroll ? 'on' : 'paused'}</span>
        <span className="font-mono">{logs.length ? formatClock(logs[logs.length - 1].at) : '—'}</span>
      </div>
    </section>
  );
}
