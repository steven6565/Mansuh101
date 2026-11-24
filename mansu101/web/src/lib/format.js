export function formatNumber(value, { compact = false, decimals = 0 } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  if (compact && Math.abs(number) >= 1000) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
  }
  return new Intl.NumberFormat('en', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(number);
}

export function formatPercent(value, { decimals = 1, fromRatio = true } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const number = fromRatio ? Number(value) * 100 : Number(value);
  return `${number.toFixed(decimals)}%`;
}

export function formatPosition(value) {
  if (value === null || value === undefined || !Number(value)) return '—';
  return Number(value).toFixed(1);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatShortDate(iso) {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function relativeTime(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  return formatDate(iso);
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '—';
  const total = Math.max(0, Number(ms));
  if (total < 1000) return `${Math.round(total)}ms`;
  const seconds = total / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url ?? '').replace(/^https?:\/\//, '').split('/')[0];
  }
}

export function pathOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

export function truncate(value, max = 60) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function deltaOf(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const change = Number(current) - Number(previous);
  const percent = Number(previous) === 0 ? null : (change / Number(previous)) * 100;
  return {
    change,
    percent: percent === null ? null : Number(percent.toFixed(1)),
    positive: change > 0,
    neutral: change === 0,
  };
}

export const SEVERITY_META = {
  critical: { label: 'Critical', tone: 'negative' },
  high: { label: 'High', tone: 'negative' },
  medium: { label: 'Medium', tone: 'warning' },
  low: { label: 'Low', tone: 'info' },
  info: { label: 'Info', tone: 'neutral' },
};

export const INTENT_META = {
  informational: { label: 'Informational', tone: 'info' },
  commercial: { label: 'Commercial', tone: 'brand' },
  transactional: { label: 'Transactional', tone: 'positive' },
  navigational: { label: 'Navigational', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const STATUS_META = {
  draft: { label: 'Draft', tone: 'neutral' },
  idea: { label: 'Idea', tone: 'neutral' },
  outline: { label: 'Outline', tone: 'info' },
  drafting: { label: 'Drafting', tone: 'warning' },
  review: { label: 'Review', tone: 'warning' },
  scheduled: { label: 'Scheduled', tone: 'brand' },
  published: { label: 'Published', tone: 'positive' },
  active: { label: 'Active', tone: 'positive' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'neutral' },
  tracking: { label: 'Tracking', tone: 'brand' },
  planned: { label: 'Planned', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  failed: { label: 'Failed', tone: 'negative' },
  success: { label: 'Success', tone: 'positive' },
  error: { label: 'Error', tone: 'negative' },
  connected: { label: 'Connected', tone: 'positive' },
  disconnected: { label: 'Not connected', tone: 'neutral' },
};

export const TONE_CLASS = {
  brand: 'bg-brand-500/10 text-brand-700 dark:text-brand-400',
  positive: 'bg-positive/10 text-positive',
  negative: 'bg-negative/10 text-negative',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  neutral: 'bg-sunken text-muted',
};

export const TONE_TEXT = {
  brand: 'text-brand-600 dark:text-brand-400',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-muted',
};

export const CHART_COLOURS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];
