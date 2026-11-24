export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '—';
  const total = Math.max(0, Number(ms));
  if (total < 1000) return `${Math.round(total)}ms`;
  const seconds = Math.floor(total / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatClock(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function elapsed(startIso, endIso, now = Date.now()) {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now;
  return Math.max(0, end - start);
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function truncate(value, max = 60) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const STATUS_META = {
  queued: { label: 'Queued', tone: 'slate' },
  starting: { label: 'Starting', tone: 'violet' },
  navigating: { label: 'Navigating', tone: 'blue' },
  loaded: { label: 'Loaded', tone: 'cyan' },
  completed: { label: 'Success', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  stopped: { label: 'Stopped', tone: 'amber' },
  interrupted: { label: 'Interrupted', tone: 'amber' },
  running: { label: 'Running', tone: 'violet' },
  paused: { label: 'Paused', tone: 'amber' },
  stopping: { label: 'Stopping', tone: 'amber' },
  idle: { label: 'Idle', tone: 'slate' },
};

export const TONE_CLASS = {
  slate: 'bg-slate-500/10 text-slate-400 ring-1 ring-inset ring-slate-400/20',
  violet: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-400/25',
  blue: 'bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-400/25',
  cyan: 'bg-cyan-500/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/25',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25',
  rose: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/25',
  amber: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/25',
};

export const LOG_LEVEL_CLASS = {
  info: 'text-slate-300',
  success: 'text-emerald-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};
