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
} from '../components/ui.jsx';
import { TrendChart, BarList, DonutChart } from '../components/Charts.jsx';
import {
  Chart,
  Globe,
  Sparkles,
  AlertCircle,
  Plug,
  Download,
  MousePointer,
  Users,
  Timer,
  Target,
} from '../components/Icons.jsx';
import {
  formatNumber,
  formatPercent,
  formatShortDate,
  deltaOf,
  truncate,
  pathOf,
  CHART_COLOURS,
} from '../lib/format.js';

const DIMENSIONS = [
  { value: 'source', label: 'Sources' },
  { value: 'landing', label: 'Landing pages' },
  { value: 'country', label: 'Countries' },
  { value: 'device', label: 'Devices' },
];

export default function Analytics({ onNavigate }) {
  const { siteId, range, integrations, loadingBoot } = useApp();
  const [dimension, setDimension] = useState('source');
  const [search, setSearch] = useState('');

  const overviewPath = siteId
    ? `/sites/${siteId}/overview?${queryString({ days: range.days, from: range.from, to: range.to })}`
    : null;
  const overview = useApi(overviewPath ?? '/bootstrap', { enabled: Boolean(overviewPath) });

  const perfPath = siteId
    ? `/sites/${siteId}/performance?${queryString({
      source: 'ga4', dimension, orderBy: 'sessions', limit: 400, from: range.from, to: range.to, days: range.days,
    })}`
    : null;
  const perf = useApi(perfPath ?? '/bootstrap', { enabled: Boolean(perfPath) });

  useEffect(() => { setSearch(''); }, [dimension, siteId]);

  const google = integrations?.google ?? { status: 'disconnected' };
  const rows = perf.data?.rows ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? rows.filter((row) => String(row.key).toLowerCase().includes(needle)) : rows;
  }, [rows, search]);

  const current = overview.data?.analytics?.current;
  const previous = overview.data?.analytics?.previous;
  const sources = overview.data?.analytics?.sources ?? [];

  if (loadingBoot) {
    return <div className="card h-64 skeleton" />;
  }

  if (!siteId) {
    return (
      <EmptyState
        icon={Chart}
        title="No site selected"
        description="Add the site you want to analyse, then link its GA4 property."
        action={<button type="button" className="btn-primary" onClick={() => onNavigate('dashboard')}>Go to dashboard</button>}
      />
    );
  }

  if (google.status !== 'connected') {
    return (
      <div className="space-y-4">
        <Notice tone="warning" icon={AlertCircle} title="Google Analytics is not connected">
          GA4 data is read through the Google Analytics Data API using the same OAuth connection as Search
          Console. Connect Google to import sessions, users and acquisition.
        </Notice>
        <EmptyState
          icon={Plug}
          title="Connect Google Analytics 4"
          description="After connecting, choose the GA4 property that belongs to this site on the Integrations page."
          action={<button type="button" className="btn-primary" onClick={() => onNavigate('integrations')}>Open integrations</button>}
        />
      </div>
    );
  }

  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-info/25 bg-info/5 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted sm:flex-row sm:items-center">
        <span className="flex shrink-0 items-center gap-1.5 font-semibold text-info">
          <AlertCircle size={13} /> GA4 vs Search Console
        </span>
        <p>
          Search Console counts impressions in Google results and clicks that leave the SERP. GA4 counts
          sessions on your site from <em>all</em> channels, so the two totals are never expected to match.
          Compare trends, not absolute numbers.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Sessions" value={formatNumber(current?.sessions)}
          delta={deltaOf(current?.sessions, previous?.sessions)} icon={MousePointer}
        />
        <StatTile
          label="Active users" value={formatNumber(current?.activeUsers)}
          delta={deltaOf(current?.activeUsers, previous?.activeUsers)} icon={Users}
        />
        <StatTile
          label="Engaged sessions" value={formatNumber(current?.engagedSessions)}
          delta={deltaOf(current?.engagedSessions, previous?.engagedSessions)} icon={Target}
        />
        <StatTile
          label="Engagement rate" value={current?.engagementRate ? formatPercent(current.engagementRate) : '—'}
          delta={deltaOf(current?.engagementRate, previous?.engagementRate)} icon={Timer}
        />
      </section>

      <Card
        title="Sessions over time"
        description={`${overview.data?.dataFreshness?.ga4 ? `Data through ${overview.data.dataFreshness.ga4}` : 'No stored GA4 data'}`}
        icon={Chart}
      >
        <TrendChart
          series={overview.data?.analytics?.series ?? []}
          metrics={[
            { key: 'sessions', label: 'Sessions', colour: CHART_COLOURS[2] },
            { key: 'activeUsers', label: 'Active users', colour: CHART_COLOURS[1] },
          ]}
          formatX={formatShortDate}
          emptyDescription="GA4 has no rows for this window. Sync after connecting Google, or widen the range."
        />
      </Card>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card title="Top sources" description="Session source / medium" icon={Globe}>
          <BarList
            items={sources.slice(0, 7)}
            valueKey="sessions"
            formatLabel={(item) => truncate(item.key || '(direct)', 26)}
            formatValue={(item) => formatNumber(item.sessions)}
            emptyTitle="No acquisition data"
          />
        </Card>
        <Card title="Landing pages" description="Sessions by entry page" icon={Chart}>
          <BarList
            items={overview.data?.analytics?.landingPages ?? []}
            valueKey="sessions"
            formatLabel={(item) => truncate(pathOf(item.key), 28)}
            formatValue={(item) => formatNumber(item.sessions)}
            emptyTitle="No landing page data"
          />
        </Card>
        <Card title="Device split" description="Sessions by device category" icon={Sparkles}>
          <DonutChart
            items={(perf.data?.rows ?? []).filter((row) => dimension === 'device').map((row, index) => ({
              label: row.key, value: row.sessions, colour: CHART_COLOURS[index % CHART_COLOURS.length],
            }))}
            centerLabel="sessions"
          />
        </Card>
      </section>

      <Card
        title="Breakdown"
        description="GA4 rows stored by Visitor for this period."
        icon={Chart}
        actions={
          <button type="button" className="btn-secondary btn-sm" disabled={!filtered.length} onClick={() => exportCsv(dimension, filtered)}>
            <Download size={12} /> CSV
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs items={DIMENSIONS} value={dimension} onChange={setDimension} />
          <SearchInput value={search} onChange={setSearch} placeholder="Filter…" className="w-[168px]" />
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
            icon={Chart}
            title="No GA4 rows"
            description="Nothing stored for this dimension and range yet. Sync or widen the date range."
          />
        ) : (
          <DataTable
            columns={[
              {
                key: 'key',
                header: DIMENSIONS.find((item) => item.value === dimension)?.label ?? 'Value',
                render: (row) => (
                  <span className="block max-w-[360px] truncate text-[12.5px] text-ink" title={row.key}>
                    {dimension === 'landing' ? pathOf(row.key) : row.key || '(none)'}
                  </span>
                ),
              },
              { key: 'sessions', header: 'Sessions', align: 'right', render: (row) => formatNumber(row.sessions) },
              { key: 'activeUsers', header: 'Users', align: 'right', render: (row) => formatNumber(row.activeUsers) },
              { key: 'engagedSessions', header: 'Engaged', align: 'right', render: (row) => formatNumber(row.engagedSessions) },
              { key: 'engagementRate', header: 'Engagement', align: 'right', render: (row) => formatPercent(row.engagementRate) },
            ]}
            rows={filtered}
            rowKey={(row) => row.key}
          />
        )}
      </Card>
    </div>
  );
}

function exportCsv(dimension, rows) {
  const header = ['key', 'sessions', 'activeUsers', 'engagedSessions', 'engagementRate'];
  const body = rows.map((row) => [row.key, row.sessions, row.activeUsers, row.engagedSessions, row.engagementRate]);
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
  anchor.download = `analytics-${dimension}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
