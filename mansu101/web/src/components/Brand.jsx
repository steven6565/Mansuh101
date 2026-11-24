export function Logomark({ size = 32, className = '' }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-brand-500 to-info text-white shadow-sm ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill="none" className="h-full w-full p-[22%]">
        <path d="M6 22V10l5.5 6.5L16 11l4.5 5.5L26 10v12" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Brand({ compact = false }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logomark size={compact ? 26 : 30} />
      <span className="leading-tight">
        <span className="block text-[14px] font-semibold tracking-tight text-ink">Visitor</span>
        {!compact && (
          <span className="block text-[9.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Organic growth
          </span>
        )}
      </span>
    </span>
  );
}
