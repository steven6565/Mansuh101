import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { queryString } from '../lib/api.js';
import {
  Card,
  StatTile,
  Tabs,
  EmptyState,
  ErrorState,
  Notice,
  SearchInput,
  DataTable,
  Select,
} from '../components/ui.jsx';
import { TrendChart } from '../components/Charts.jsx';
import {
  Search,
  MousePointer,
  Eye,
  Target,
  Trend,
  Download,
  Plug,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
} from '../components/Icons.jsx';
import {
  formatNumber,
  formatPercent,
  formatPosition,
  formatShortDate,
  deltaOf,
  truncate,
  pathOf,
  CHART_COLOURS,
} from '../lib/format.js';

const DIMENSIONS = [
  { value: 'query', label: 'Queries' },
  { value: 'page', label: 'Pages' },
  { value: 'country', label: 'Countries' },
  { value: 'device', label: 'Devices' },
];

const SORTS = [
  { value: 'clicks', label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'ctr', label: 'CTR' },
  { value: 'position', label: 'Position' },
];

export default function SearchConsole({ onNavigate }) {
  const { siteId, activeSite, range, integrations, loadingBoot } = useApp();
  const [dimension, setDimension] = useState('query');
  const [orderBy, setOrderBy] = useState('clicks');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const overviewPath = siteId
    ? `/sites/${siteId}/overview?${queryString({ days: range.days, from: range.from, to: range.to })}`
    : null;
  const overview = useApi(overviewPath ?? '/bootstrap', { enabled: Boolean(overviewPath) });

  const perfPath = siteId
    ? `/sites/${siteId}/performance?${queryString({
      source: 'gsc', dimension, orderBy, limit: 500, from: range.from, to: range.to, days: range.days,
    })}`
    : null;
  const perf = useApi(perfPath ?? '/bootstrap', { enabled: Boolean(perfPath) });

  useEffect(() => {
    setPage(0);
  }, [dimension, orderBy, range.days, range.from, range.to, siteId]);

  const google = integrations?.google ?? { status: 'disconnected' };
  const rows = perf.data?.rows ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => String(row.key).toLowerCase().includes(needle));
  }, [rows, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const current = overview.data?.searchConsole?.current;
  const previous = overview.data?.searchConsole?.previous;

  if (loadingBoot) return <Loading />;

  if (!siteId) {
    return (
      <EmptyState
        icon={Search}
        title="No site selected"
        description="Add a site on the dashboard, then link its Search Console property to see clicks, impressions, CTR and position."
        action={<button type="button" className="btn-primary" onClick={() => onNavigate('dashboard')}>Go to dashboard</button>}
      />
    );
  }

  if (google.status !== 'connected') {
    return (
      <div className="space-y-4">
        <Notice tone="warning" icon={AlertCircle} title="Search Console is not connected">
          Visitor reads Search Console through Google's official API with OAuth 2.0. Until an account is
          connected there is nothing to display — and nothing is invented to fill the gap.
        </Notice>
        <EmptyState
          icon={Plug}
          title="Connect Google Search Console"
          description="You need GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server .env, then authorise the account that owns this property."
          action={<button type="button" className="btn-primary" onClick={() => onNavigate('integrations')}>Open integrations</button>}
        />
      </div>
    );
  }

  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.refetch} />;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Clicks" value={formatNumber(current?.clicks)}
          delta={deltaOf(current?.clicks, previous?.clicks)} icon={MousePointer}
          hint="vs previous period"
        />
        <StatTile
          label="Impressions" value={formatNumber(current?.impressions, { compact: true })}
          delta={deltaOf(current?.impressions, previous?.impressions)} icon={Eye}
          hint="vs previous period"
        />
        <StatTile
          label="CTR" value={current?.ctr ? formatPercent(current.ctr) : '—'}
          delta={deltaOf(current?.ctr, previous?.ctr)} icon={Target}
          hint="clicks ÷ impressions"
        />
        <StatTile
          label="Avg. position" value={formatPosition(current?.position)}
          delta={current?.position && previous?.position ? invert(deltaOf(current.position, previous.position)) : null}
          icon={Trend} hint="lower is better"
        />
      </section>

      <Card
        title="Performance over time"
        description={`Daily clicks and impressions · ${overview.data?.dataFreshness?.gsc ? `data through ${overview.data.dataFreshness.gsc}` : 'no stored data'}`}
        icon={Trend}
      >
        <TrendChart
          series={overview.data?.searchConsole?.series ?? []}
          metrics={[
            { key: 'clicks', label: 'Clicks', colour: CHART_COLOURS[0] },
            { key: 'impressions', label: 'Impressions', colour: CHART_COLOURS[1] },
          ]}
          formatX={formatShortDate}
        />
      </Card>

      <Card
        title="Breakdown"
        description="Every row is a value Google reported for this property."
        icon={Filter}
        actions={
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={!filtered.length}
            onClick={() => exportCsv(dimension, filtered)}
          >
            <Download size={12} /> CSV
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Tabs items={DIMENSIONS} value={dimension} onChange={setDimension} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Filter rows…" className="w-[168px]" />
            <Select
              ariaLabel="Sort by"
              className="w-[124px] !py-1.5 text-[12px]"
              value={orderBy}
              onChange={setOrderBy}
              options={SORTS}
            />
          </div>
        </div>

        {perf.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-9 skeleton" />)}
          </div>
        ) : perf.error ? (
          <ErrorState error={perf.error} onRetry={perf.refetch} />
        ) : !filtered.length ? (
          <EmptyState
            compact
            icon={Search}
            title="No rows for this period"
            description={
              rows.length
                ? 'No rows match your filter.'
                : 'Search Console has not recorded data for this dimension and date range. Try a wider range or run a sync.'
            }
          />
        ) : (
          <>
            <DataTable
              columns={columnsFor(dimension)}
              rows={visible}
              rowKey={(row) => row.key}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
              <span>
                {filtered.length} row{filtered.length === 1 ? '' : 's'}
                {perf.data?.total ? ` · ${perf.data.total} total groups` : ''}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className="btn-icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft size={14} />
                </button>
                <span className="px-1 font-mono text-[11px]">{page + 1} / {pageCount}</span>
                <button type="button" className="btn-icon" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Notice tone="info" icon={AlertCircle}>
        Search Console only returns data for properties verified in the connected Google account, and
        typically lags 2–3 days. Visitor requests the last {range.days} days and stores what Google returns.
      </Notice>
    </div>
  );
}

function columnsFor(dimension) {
  const label = {
    query: 'Query', page: 'Page', country: 'Country', device: 'Device',
  }[dimension];

  return [
    {
      key: 'key',
      header: label,
      render: (row) => (
        <span className="block max-w-[340px] truncate text-[12.5px] text-ink" title={row.key}>
          {dimension === 'page' ? pathOf(row.key) : row.key || '—'}
        </span>
      ),
    },
    { key: 'clicks', header: 'Clicks', align: 'right', render: (row) => formatNumber(row.clicks) },
    { key: 'impressions', header: 'Impressions', align: 'right', render: (row) => formatNumber(row.impressions) },
    { key: 'ctr', header: 'CTR', align: 'right', render: (row) => formatPercent(row.ctr) },
    {
      key: 'position',
      header: 'Position',
      align: 'right',
      render: (row) => (
        <span className={row.position <= 3 ? 'font-semibold text-positive' : row.position <= 10 ? 'text-ink' : 'text-muted'}>
          {formatPosition(row.position)}
        </span>
      ),
    },
  ];
}

function exportCsv(dimension, rows) {
  const header = ['key', 'clicks', 'impressions', 'ctr', 'position'];
  const body = rows.map((row) => [row.key, row.clicks, row.impressions, row.ctr, row.position]);
  const csv = [header, ...body]
    .map((line) => line.map((cell) => {
      const text = cell === null || cell === undefined ? '' : String(cell);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `search-console-${dimension}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function invert(delta) {
  if (!delta) return null;
  return { ...delta, positive: delta.change < 0, neutral: delta.change === 0 };
}

function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="card h-[102px] skeleton" />)}
      </div>
      <div className="card h-72 skeleton" />
    </div>
  );
}
