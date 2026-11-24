export function Logomark({ size = 36, className = '' }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-500 shadow-glow-sm ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div className="absolute inset-[1px] rounded-[11px] bg-ink-900/85" />
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full p-[22%] text-white" fill="none">
        <path d="M7 28V12l7 8 6-6 6 6 7-8v16" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="31" r="1.6" fill="currentColor" />
      </svg>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent" />
    </div>
  );
}

export function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logomark size={compact ? 30 : 36} />
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-bold tracking-[0.12em] text-white">MANSU<span className="text-violet-400">101</span></span>
        </div>
        {!compact && (
          <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.22em] text-slate-500">
            Remote automation
          </div>
        )}
      </div>
    </div>
  );
}
