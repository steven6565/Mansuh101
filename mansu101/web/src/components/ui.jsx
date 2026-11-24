import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TONE_CLASS } from '../lib/format.js';
import {
  Check,
  Alert,
  Info,
  X,
  ChevronDown,
  Search,
  Inbox,
} from './Icons.jsx';

export function Badge({ tone = 'neutral', children, dot = false, className = '' }) {
  return (
    <span className={`pill ${TONE_CLASS[tone] ?? TONE_CLASS.neutral} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function LiveDot({ tone = 'positive', pulse = true }) {
  return (
    <span className="relative flex h-1.5 w-1.5">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone === 'positive' ? 'bg-positive' : 'bg-negative'}`} />}
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${tone === 'positive' ? 'bg-positive' : 'bg-negative'}`} />
    </span>
  );
}

/**
 * KPI tile. `delta` comes from comparing two real date ranges; when there is
 * no previous period the change is shown as "no baseline" instead of 0%.
 */
export function StatTile({ label, value, suffix, delta, hint, icon: Icon, loading = false }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="label">{label}</span>
        {Icon && <Icon size={15} className="shrink-0 text-faint" />}
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 skeleton" />
      ) : (
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="stat-value tabular-nums">{value ?? '—'}</span>
          {suffix && <span className="text-xs font-medium text-faint">{suffix}</span>}
        </div>
      )}
      <div className="mt-2 flex min-h-[18px] items-center gap-2">
        {delta && !loading ? (
          <>
            <span className={`text-[11.5px] font-semibold tabular-nums ${delta.neutral ? 'text-muted' : delta.positive ? 'text-positive' : 'text-negative'}`}>
              {delta.percent === null
                ? `${delta.change > 0 ? '+' : ''}${delta.change}`
                : `${delta.percent > 0 ? '+' : ''}${delta.percent}%`}
            </span>
            <span className="truncate text-[11px] text-faint">{hint ?? 'vs previous period'}</span>
          </>
        ) : (
          <span className="truncate text-[11px] text-faint">{hint ?? (delta === null ? 'No baseline to compare' : '')}</span>
        )}
      </div>
    </div>
  );
}

export function SectionHeader({ title, description, actions, icon: Icon }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        {Icon && (
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
            <Icon size={14} />
          </span>
        )}
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, icon: Icon, actions, children, className = '', bodyClassName = '', flush = false }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && (
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-400">
                <Icon size={13} />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : `p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 text-center ${compact ? 'py-8' : 'py-14'}`}>
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-faint">
        <Icon size={18} />
      </span>
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-negative/20 bg-negative/5 px-6 py-10 text-center">
      <Alert size={20} className="mb-2 text-negative" />
      <p className="text-[13px] font-medium text-ink">Could not load this section</p>
      <p className="mt-1 max-w-md text-[12px] text-muted">{error?.message ?? String(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary btn-sm mt-4">Try again</button>
      )}
    </div>
  );
}

export function LoadingBlock({ rows = 4, height = 'h-10' }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className={`${height} skeleton`} style={{ opacity: 1 - index * 0.12 }} />
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-ink">{label}</label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-negative">{error}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div className={`animate-rise flex max-h-[92vh] w-full ${size} flex-col overflow-hidden rounded-t-2xl border border-line bg-elevated shadow-pop sm:rounded-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
          </div>
          <button type="button" className="btn-icon shrink-0" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line bg-sunken/50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Toasts({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  const tones = {
    success: 'border-positive/30 bg-positive/10 text-positive',
    error: 'border-negative/30 bg-negative/10 text-negative',
    warn: 'border-warning/30 bg-warning/10 text-warning',
    info: 'border-info/30 bg-info/10 text-info',
  };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 no-print">
      {toasts.map((toast) => (
        <div key={toast.id} className={`pointer-events-auto flex animate-rise items-start gap-2.5 rounded-xl border bg-elevated px-3.5 py-2.5 text-[12.5px] shadow-pop ${tones[toast.level] ?? tones.info}`}>
          <span className="mt-0.5 shrink-0">
            {toast.level === 'success' ? <Check size={14} /> : toast.level === 'error' ? <Alert size={14} /> : <Info size={14} />}
          </span>
          <p className="flex-1 leading-relaxed text-ink">{toast.message}</p>
          <button type="button" onClick={() => onDismiss(toast.id)} className="shrink-0 text-faint transition hover:text-ink" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input pl-8"
        type="search"
      />
    </div>
  );
}

export function Select({ value, onChange, options, className = '', ariaLabel }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`select ${className}`}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export function Tabs({ items, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex flex-wrap items-center gap-1 rounded-lg bg-sunken p-1 ${className}`} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${value === item.value ? 'bg-elevated text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {item.label}
          {item.count !== undefined && <span className="ml-1.5 text-[10.5px] text-faint">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value = 0, tone = 'brand', className = '' }) {
  const tones = { brand: 'bg-brand-600', positive: 'bg-positive', warning: 'bg-warning', negative: 'bg-negative' };
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${tones[tone] ?? tones.brand}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function ScoreRing({ value, size = 56, label }) {
  const safe = Math.min(100, Math.max(0, Number(value) || 0));
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = safe >= 75 ? 'text-positive' : safe >= 55 ? 'text-warning' : 'text-negative';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={5} className="fill-none stroke-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - safe / 100)}
          className={`fill-none transition-all duration-700 ${tone}`}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[13px] font-semibold tabular-nums text-ink">{Math.round(safe)}</span>
        {label && <span className="text-[8px] uppercase tracking-wider text-faint">{label}</span>}
      </div>
    </div>
  );
}

export function DataTable({ columns, rows, empty, rowKey, onRowClick }) {
  if (!rows.length) return empty ?? null;
  return (
    <div className="scroll-x">
      <table className="table-base">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={column.width ? { width: column.width } : undefined} className={column.align === 'right' ? 'text-right' : ''}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row) : index}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : ''}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'text-right tabular-nums' : ''}>
                  {column.render ? column.render(row, index) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Collapsible({ summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-flat overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">{summary}</div>
        <ChevronDown size={15} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-line px-4 py-3">{children}</div>}
    </div>
  );
}

export function InlineCode({ children }) {
  return <code className="rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{children}</code>;
}

export function Notice({ tone = 'info', title, children, icon: Icon = Info }) {
  const tones = {
    info: 'border-info/25 bg-info/5 text-info',
    warning: 'border-warning/25 bg-warning/5 text-warning',
    negative: 'border-negative/25 bg-negative/5 text-negative',
    positive: 'border-positive/25 bg-positive/5 text-positive',
  };
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3.5 py-3 ${tones[tone] ?? tones.info}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-[12px] leading-relaxed">
        {title && <p className="font-semibold text-ink">{title}</p>}
        <div className="text-muted">{children}</div>
      </div>
    </div>
  );
}
