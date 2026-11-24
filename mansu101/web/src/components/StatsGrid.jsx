import { useStore } from '../store.jsx';
import { STATUS_META, hostname } from '../lib/format.js';
import { StatCard } from './ui.jsx';
import {
  Globe, Check, Alert, Layers, Monitor, Activity, Cpu, Zap,
} from './Icons.jsx';

export default function StatsGrid() {
  const { urls, totals, stats, sessions } = useStore();
  const enabled = urls.filter((url) => url.enabled).length;
  const current = stats.current ?? stats.lastFinished;
  const pageStatus = current ? (current.stage || STATUS_META[current.status]?.label || current.status) : 'No active page';
  const statusTone = current?.httpStatus
    ? current.httpStatus < 400 ? 'emerald' : 'rose'
    : current?.status === 'failed' ? 'rose' : 'violet';

  const succeeded = totals.succeeded ?? 0;
  const failed = totals.failed ?? 0;
  const completed = totals.completed ?? 0;

  return (
    <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatCard
        icon={Globe}
        label="Total URLs"
        value={urls.length}
        hint={`${enabled} enabled · ${urls.length - enabled} disabled`}
        tone="violet"
      />
      <StatCard
        icon={Check}
        label="Completed URLs"
        value={completed}
        hint={`of ${totals.total || enabled} in this run`}
        tone="cyan"
      />
      <StatCard
        icon={Zap}
        label="Successful pages"
        value={succeeded}
        hint={completed ? `${Math.round((succeeded / Math.max(1, completed)) * 100)}% of completed` : 'waiting for run'}
        tone="emerald"
      />
      <StatCard
        icon={Alert}
        label="Failed pages"
        value={failed}
        hint={failed ? 'check logs for error codes' : 'no failures recorded'}
        tone="rose"
      />
      <StatCard
        icon={Monitor}
        label="Active sessions"
        value={stats.activeSessions}
        hint={`${sessions.length} session records`}
        tone="violet"
      />
      <StatCard
        icon={Layers}
        label="Active tabs"
        value={stats.activeTabs}
        hint={`${totals.queued ?? 0} queued tab(s)`}
        tone="blue"
      />
      <StatCard
        icon={Cpu}
        label="HTTP status"
        value={current?.httpStatus ?? '—'}
        hint={current?.url ? hostname(current.url) : 'no response yet'}
        tone={statusTone}
        valueClass="font-mono"
      />
      <StatCard
        icon={Activity}
        label="Page status"
        value={pageStatus}
        hint={current?.title ? current.title : 'idle monitor'}
        tone={current?.status === 'failed' ? 'rose' : 'slate'}
        valueClass="!text-base"
      />
    </section>
  );
}
