import { useMemo, useState } from 'react';
import { formatNumber, formatShortDate, CHART_COLOURS } from '../lib/format.js';
import { EmptyState } from './ui.jsx';
import { Chart } from './Icons.jsx';

/**
 * Dependency-free SVG charts. They render only the series they are given —
 * no smoothing that would invent data points, no zero-filled gaps presented
 * as traffic.
 */

function useHover() {
  const [hovered, setHovered] = useState(null);
  return [hovered, setHovered];
}

export function TrendChart({
  series = [],
  height = 220,
  metrics = [{ key: 'clicks', label: 'Clicks', colour: CHART_COLOURS[0] }],
  xKey = 'date',
  emptyTitle = 'No data for this period',
  emptyDescription = 'Sync Google Search Console or Analytics to populate this chart.',
  formatX = formatShortDate,
}) {
  const [hovered, setHovered] = useHover();
  const active = metrics.filter((metric) => series.some((row) => Number(row[metric.key]) > 0));

  const bounds = useMemo(() => {
    if (!series.length) return null;
    const values = series.flatMap((row) => active.map((metric) => Number(row[metric.key]) || 0));
    const max = Math.max(1, ...values);
    return { max };
  }, [series, active]);

  if (!series.length || !active.length) {
    return (
      <EmptyState
        compact
        icon={Chart}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  const width = 760;
  const padding = { top: 14, right: 12, bottom: 26, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const step = series.length > 1 ? chartWidth / (series.length - 1) : 0;

  const toPoint = (row, index, max) => {
    const value = Number(row) || 0;
    return {
      x: padding.left + step * index,
      y: padding.top + chartHeight - (value / (bounds?.max ?? max ?? 1)) * chartHeight,
    };
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: Math.round((bounds?.max ?? 1) * (1 - ratio)),
    y: padding.top + chartHeight * ratio,
  }));

  const labelEvery = Math.max(1, Math.ceil(series.length / 8));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${active.map((m) => m.label).join(' and ')} over time`}>
        {ticks.map((tick) => (
          <g key={tick.ratio}>
            <line x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} stroke="rgb(var(--line))" strokeWidth="1" />
            <text x={padding.left - 8} y={tick.y + 3.5} textAnchor="end" fontSize="9.5" fill="rgb(var(--faint))">
              {formatNumber(tick.value, { compact: true })}
            </text>
          </g>
        ))}

        {active.map((metric, metricIndex) => {
          const points = series.map((row, index) => toPoint(row[metric.key], index));
          const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
          const area = `${path} L${points[points.length - 1].x.toFixed(1)},${padding.top + chartHeight} L${points[0].x.toFixed(1)},${padding.top + chartHeight} Z`;
          return (
            <g key={metric.key}>
              <defs>
                <linearGradient id={`fill-${metric.key}-${metricIndex}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={metric.colour} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={metric.colour} stopOpacity="0" />
                </linearGradient>
              </defs>
              {active.length === 1 && <path d={area} fill={`url(#fill-${metric.key}-${metricIndex})`} />}
              <path d={path} fill="none" stroke={metric.colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hovered !== null && points[hovered] && (
                <circle cx={points[hovered].x} cy={points[hovered].y} r="3.5" fill={metric.colour} stroke="rgb(var(--elevated))" strokeWidth="2" />
              )}
            </g>
          );
        })}

        {series.map((row, index) => (
          index % labelEvery === 0 ? (
            <text key={index} x={padding.left + step * index} y={height - 8} textAnchor="middle" fontSize="9.5" fill="rgb(var(--faint))">
              {formatX(row[xKey])}
            </text>
          ) : null
        ))}

        {series.map((_, index) => (
          <rect
            key={`hit-${index}`}
            x={padding.left + step * index - step / 2}
            y={padding.top}
            width={Math.max(1, step)}
            height={chartHeight}
            fill="transparent"
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </svg>

      {hovered !== null && series[hovered] && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-elevated px-2.5 py-2 text-[11px] shadow-card"
          style={{ left: `${Math.min(88, Math.max(2, (hovered / Math.max(1, series.length - 1)) * 88))}%` }}
        >
          <p className="mb-1 font-semibold text-ink">{formatX(series[hovered][xKey])}</p>
          {active.map((metric) => (
            <p key={metric.key} className="flex items-center justify-between gap-3 text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: metric.colour }} />
                {metric.label}
              </span>
              <span className="font-mono tabular-nums text-ink">{formatNumber(series[hovered][metric.key])}</span>
            </p>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted">
        {active.map((metric) => (
          <span key={metric.key} className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: metric.colour }} />
            {metric.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BarList({ items = [], valueKey = 'clicks', labelKey = 'key', formatLabel, formatValue, emptyTitle = 'Nothing here yet' }) {
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey]) || 0));
  if (!items.length) {
    return <EmptyState compact title={emptyTitle} description="Data appears once Google has recorded activity for this period." />;
  }
  return (
    <div className="space-y-2.5">
      {items.map((item, index) => {
        const value = Number(item[valueKey]) || 0;
        const width = (value / max) * 100;
        return (
          <div key={`${item[labelKey]}-${index}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] text-ink" title={String(item[labelKey])}>
                {formatLabel ? formatLabel(item) : item[labelKey]}
              </span>
              <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted">
                {formatValue ? formatValue(item) : formatNumber(value)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand-500/70 transition-all duration-500"
                style={{ width: `${Math.max(2, width)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DonutChart({ items = [], size = 140, thickness = 16, centerLabel, centerValue }) {
  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  if (!total) {
    return <EmptyState compact title="No segment data" description="Device and country breakdowns appear after a Search Console sync." />;
  }
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--line))" strokeWidth={thickness} />
          {items.map((item, index) => {
            const value = Number(item.value) || 0;
            const length = (value / total) * circumference;
            const dash = `${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`;
            const circle = (
              <circle
                key={item.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={item.colour ?? CHART_COLOURS[index % CHART_COLOURS.length]}
                strokeWidth={thickness}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += length;
            return circle;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-ink">{centerValue ?? formatNumber(total, { compact: true })}</span>
          {centerLabel && <span className="text-[9.5px] uppercase tracking-wider text-faint">{centerLabel}</span>}
        </div>
      </div>
      <div className="w-full space-y-1.5">
        {items.map((item, index) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-[11.5px]">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.colour ?? CHART_COLOURS[index % CHART_COLOURS.length] }} />
              <span className="truncate capitalize">{item.label}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-ink">{formatNumber(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values = [], width = 96, height = 30, colour = CHART_COLOURS[0] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const path = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${(height - (Number(value) / max) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <path d={path} fill="none" stroke={colour} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function DistributionBars({ items = [], valueKey = 'impressions' }) {
  if (!items.length) return null;
  const total = items.reduce((sum, item) => sum + (Number(item[valueKey]) || 0), 0);
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const share = total ? ((Number(item[valueKey]) || 0) / total) * 100 : 0;
        return (
          <div key={item.key} className="flex items-center gap-3 text-[12px]">
            <span className="w-20 shrink-0 capitalize text-muted">{item.key || 'unknown'}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-info/70" style={{ width: `${share}%` }} />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink">{share.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}
