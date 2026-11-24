import { useStore } from '../store.jsx';
import { formatDuration, hostname, STATUS_META } from '../lib/format.js';
import { EmptyState, SectionHeading } from './ui.jsx';
import { Activity, Check, Alert, Clock } from './Icons.jsx';

const BAR_COLOURS = {
  completed: '#34d399',
  failed: '#fb7185',
  stopped: '#fbbf24',
  interrupted: '#f59e0b',
  starting: '#a78bfa',
  navigating: '#60a5fa',
  loaded: '#22d3ee',
  queued: '#3f3f5a',
};

function DurationChart({ sessions }) {
  const finished = sessions.filter((session) => session.durationMs != null);
  const displayed = finished.slice(0, 60);
  const max = Math.max(1000, ...displayed.map((session) => session.durationMs));

  if (!displayed.length) {
    return (
      <EmptyState
        icon={Clock}
        title="No completed pages yet"
        description="Once the engine finishes tabs, per-page load durations appear here in real time."
      />
    );
  }

  const width = 640;
  const height = 190;
  const padding = { top: 10, right: 6, bottom: 22, left: 34 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const slot = chartWidth / Math.max(displayed.length, 1);
  const barWidth = Math.max(2, Math.min(16, slot * 0.62));

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[190px] w-full overflow-visible" role="img" aria-label="Page load duration by tab">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartHeight * ratio;
          return (
            <g key={ratio}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize="8" fill="#64748b">
                {formatDuration(max * (1 - ratio))}
              </text>
            </g>
          );
        })}
        {displayed.map((session, index) => {
          const ratio = Math.min(1, session.durationMs / max);
          const barHeight = Math.max(2, ratio * chartHeight);
          const x = padding.left + slot * index + (slot - barWidth) / 2;
          const y = padding.top + chartHeight - barHeight;
          const colour = BAR_COLOURS[session.status] ?? '#8b5cf6';
          return (
            <g key={session.id}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={Math.min(3, barWidth / 2)} fill={colour} opacity="0.9">
                <title>{`Tab ${session.tabIndex} · ${hostname(session.url)} · ${STATUS_META[session.status]?.label ?? session.status} · ${formatDuration(session.durationMs)}${session.httpStatus ? ` · HTTP ${session.httpStatus}` : ''}`}</title>
              </rect>
              {(displayed.length <= 16 || index % Math.ceil(displayed.length / 12) === 0) && (
                <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fontSize="8" fill="#475569">
                  {session.tabIndex}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <Legend colour="#34d399" label="Success" />
        <Legend colour="#fb7185" label="Failed" />
        <Legend colour="#fbbf24" label="Stopped" />
        <span className="ml-auto">tab # · hover bars for details</span>
      </div>
    </div>
  );
}

function Legend({ colour, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: colour }} /> {label}
    </span>
  );
}

function OutcomeChart({ sessions, totals }) {
  const buckets = [
    { key: 'success', label: 'Successful', colour: '#34d399', value: sessions.filter((s) => s.status === 'completed').length },
    { key: 'failed', label: 'Failed', colour: '#fb7185', value: sessions.filter((s) => s.status === 'failed').length },
    { key: 'stopped', label: 'Stopped', colour: '#fbbf24', value: sessions.filter((s) => ['stopped', 'interrupted'].includes(s.status)).length },
    {
      key: 'pending',
      label: 'Pending / active',
      colour: '#8b5cf6',
      value: sessions.filter((s) => ['queued', 'starting', 'navigating', 'loaded'].includes(s.status)).length,
    },
  ];
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
  const size = 152;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
          {total > 0 && buckets.filter((bucket) => bucket.value > 0).map((bucket) => {
            const length = (bucket.value / total) * circumference;
            const dash = `${Math.max(0, length - 3)} ${circumference - Math.max(0, length - 3)}`;
            const circle = (
              <circle
                key={bucket.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={bucket.colour}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            );
            offset += length;
            return circle;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-white">{totals.completed ?? 0}<span className="text-sm text-slate-500">/{totals.total ?? total}</span></span>
          <span className="text-[9px] uppercase tracking-[0.16em] text-slate-500">processed</span>
        </div>
      </div>
      <div className="w-full flex-1 space-y-2">
        {buckets.map((bucket) => (
          <div key={bucket.key} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-2 text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ background: bucket.colour }} />
              {bucket.label}
            </span>
            <span className="font-mono text-slate-200">{bucket.value}</span>
          </div>
        ))}
        <div className="mt-3 border-t border-white/[0.06] pt-2 text-[10px] text-slate-500">
          {sessions.length ? `${sessions.length} tab records in the current run` : 'Start a run to populate outcomes'}
        </div>
      </div>
    </div>
  );
}

export default function RunCharts() {
  const { sessions, totals } = useStore();
  return (
    <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
      <div className="card p-4">
        <SectionHeading
          icon={Activity}
          title="Page load duration"
          subtitle="Real navigation timings per tab (DOM content loaded → session close)"
          right={<span className="pill bg-white/[0.04] font-mono text-[10px] text-slate-400">{sessions.filter((s) => s.durationMs).length} timed</span>}
        />
        <DurationChart sessions={sessions} />
      </div>
      <div className="card p-4">
        <SectionHeading
          icon={totals.failed > 0 ? Alert : Check}
          title="Run outcome"
          subtitle="Live status breakdown for this run"
        />
        <OutcomeChart sessions={sessions} totals={totals} />
      </div>
    </section>
  );
}
