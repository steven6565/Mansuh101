import { useMemo } from 'react';
import { useStore } from '../store.jsx';
import LogTerminal from '../components/LogTerminal.jsx';
import { Dot } from '../components/ui.jsx';

export default function LogsPage() {
  const { logs, connected } = useStore();
  const counts = useMemo(() => ({
    info: logs.filter((log) => log.level === 'info').length,
    warn: logs.filter((log) => log.level === 'warn').length,
    error: logs.filter((log) => log.level === 'error').length,
  }), [logs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">Event logs</h1>
          <p className="mt-1 text-xs text-slate-500">
            Full server-side event stream — navigation, HTTP, screenshots, errors and operator actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-slate-400">
            <Dot tone={connected ? 'emerald' : 'rose'} pulse={connected} /> {connected ? 'Socket connected' : 'Disconnected'}
          </span>
          <span className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px] text-slate-400">
            {logs.length} buffered
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <LevelChip label="Info" value={counts.info} tone="text-blue-300" />
        <LevelChip label="Warnings" value={counts.warn} tone="text-amber-300" />
        <LevelChip label="Errors" value={counts.error} tone="text-rose-300" />
      </div>

      <LogTerminal mode="full" />
    </div>
  );
}

function LevelChip({ label, value, tone }) {
  return (
    <div className="card flex items-center justify-between px-4 py-3">
      <span className="label">{label}</span>
      <span className={`font-mono text-lg ${tone}`}>{value}</span>
    </div>
  );
}
