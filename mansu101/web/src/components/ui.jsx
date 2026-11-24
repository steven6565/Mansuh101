import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Check, X } from './Icons.jsx';
import { STATUS_META, TONE_CLASS } from '../lib/format.js';

export function StatusPill({ status, label, className = '' }) {
  const meta = STATUS_META[status] ?? { label: status ?? 'Unknown', tone: 'slate' };
  return (
    <span className={`pill ${TONE_CLASS[meta.tone]} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? meta.label}
    </span>
  );
}

export function Dot({ tone = 'emerald', pulse = false }) {
  const colours = {
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    violet: 'bg-violet-400',
    slate: 'bg-slate-500',
    cyan: 'bg-cyan-400',
  };
  return (
    <span className="relative flex h-2 w-2">
      {pulse && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${colours[tone]}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colours[tone]}`} />
    </span>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = 'violet', valueClass = '' }) {
  const toneRing = {
    violet: 'from-violet-500/20 to-transparent text-violet-300',
    emerald: 'from-emerald-500/20 to-transparent text-emerald-300',
    rose: 'from-rose-500/20 to-transparent text-rose-300',
    cyan: 'from-cyan-500/20 to-transparent text-cyan-300',
    blue: 'from-blue-500/20 to-transparent text-blue-300',
    amber: 'from-amber-500/20 to-transparent text-amber-300',
    slate: 'from-white/10 to-transparent text-slate-300',
  };
  return (
    <div className="card group relative overflow-hidden p-4 transition hover:border-white/[0.12]">
      <div className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br blur-2xl ${toneRing[tone]}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label">{label}</div>
          <div className={`stat truncate ${valueClass}`} title={typeof value === 'string' ? value : undefined}>
            {value}
          </div>
          {hint && <div className="mt-1.5 truncate text-[11px] text-slate-500">{hint}</div>}
        </div>
        {Icon && (
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/[0.06] ${toneRing[tone].split(' ').pop()}`}>
            <Icon size={15} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ProgressBar({ value = 0, tone = 'violet', className = '', striped = false }) {
  const colours = {
    violet: 'from-violet-500 to-indigo-400',
    emerald: 'from-emerald-500 to-teal-400',
    rose: 'from-rose-500 to-orange-400',
    amber: 'from-amber-500 to-yellow-400',
    cyan: 'from-cyan-500 to-sky-400',
  };
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ${className}`}>
      <div
        className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${colours[tone] ?? colours.violet} ${striped ? 'bg-[length:1rem_1rem]' : ''}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Ring({ value = 0, size = 62, stroke = 5, tone = 'violet', children, className = '' }) {
  const safe = Math.min(100, Math.max(0, Number(value) || 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const colours = {
    violet: 'text-violet-400',
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
    cyan: 'text-cyan-400',
    blue: 'text-blue-400',
  };
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-white/[0.07]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - safe / 100)}
          className={`fill-none transition-all duration-700 ${colours[tone] ?? colours.violet}`}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? <span className="text-[11px] font-semibold text-white">{Math.round(safe)}%</span>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-4xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`animate-rise relative flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-ink-850 shadow-2xl sm:rounded-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" className="btn-icon shrink-0" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-white/[0.07] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-400/20">
          <Icon size={20} />
        </div>
      )}
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  const tones = {
    info: 'border-blue-400/25 bg-blue-500/[0.08] text-blue-200',
    success: 'border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-200',
    warn: 'border-amber-400/25 bg-amber-500/[0.08] text-amber-200',
    error: 'border-rose-400/25 bg-rose-500/[0.08] text-rose-200',
  };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex animate-rise items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs shadow-2xl backdrop-blur-md ${tones[toast.level] ?? tones.info}`}
        >
          <span className="mt-0.5 shrink-0">
            {toast.level === 'success' ? <Check size={14} /> : toast.level === 'info' ? <Check size={14} /> : <Alert size={14} />}
          </span>
          <p className="flex-1 leading-relaxed">{toast.message}</p>
          <button type="button" onClick={() => onDismiss(toast.id)} className="shrink-0 opacity-50 transition hover:opacity-100" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SectionHeading({ title, subtitle, right, icon: Icon }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] text-slate-300 ring-1 ring-inset ring-white/[0.06]">
            <Icon size={14} />
          </div>
        )}
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
