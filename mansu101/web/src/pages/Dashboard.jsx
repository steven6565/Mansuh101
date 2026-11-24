import { useEffect } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { queryString } from '../lib/api.js';
import {
  StatTile,
  Card,
  ScoreRing,
  Badge,
  EmptyState,
  ErrorState,
  Notice,
} from '../components/ui.jsx';
import { TrendChart, BarList, DonutChart, DistributionBars } from '../components/Charts.jsx';
import {
  MousePointer,
  Eye,
  Target,
  Trend,
  Chart,
  Search,
  Sparkles,
  ClipboardCheck,
  ArrowUpRight,
  Globe,
  AlertCircle,
  Plug,
  Refresh,
  FileText,
} from '../components/Icons.jsx';
import {
  formatNumber,
  formatPercent,
  formatPosition,
  deltaOf,
  relativeTime,
  hostOf,
  truncate,
  pathOf,
  CHART_COLOURS,
} from '../lib/format.js';

export default function Dashboard({ onNavigate, onAddSite }) {
  const { siteId, activeSite, range, loadingBoot, integrations } = useApp();
  const path = siteId ? `/sites/${siteId}/overview?${queryString({ days: range.days, from: range.from, to: range.to })}` : null;
  const { data, loading, error, refetch } = useApi(path ?? '/bootstrap', { enabled: Boolean(path) });

  useEffect(() => {
    const onChange = () => refetch();
    window.addEventListener('visitor:data-changed', onChange);
    return () => window.removeEventListener('visitor:data-changed', onChange);
  }, [refetch]);

  if (loadingBoot) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="card h-[102px] skeleton" />)}
        </div>
        <div className="card h-72 skeleton" />
      </div>
    );
  }

  if (!siteId) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Globe}
          title="Add your first site"
          description="Register a site you own. Visitor will then link it to Search Console and GA4, crawl it for technical issues, and track the keywords you care about."
          action={<button type="button" className="btn-primary" onClick={onAddSite}>Add a site</button>}
        />
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { icon: Plug, title: '1. Connect Google', body: 'Authorise Search Console and Analytics read-only access with OAuth 2.0.', tab: 'integrations' },
            { icon: Refresh, title: '2. Sync real data', body: 'Clicks, impressions, CTR, position and sessions are imported from Google.', tab: 'search-console' },
            { icon: ClipboardCheck, title: '3. Fix what matters', body: 'Run a technical audit and work through prioritised, page-specific issues.', tab: 'audit' },
          ].map((step) => (
            <button
              key={step.title}
              type="button"
              onClick={() => onNavigate(step.tab)}
              className="card group p-4 text-left transition hover:border-brand-500/40"
            >
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
                <step.icon size={15} />
              </span>
              <p className="text-[13px] font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{step.body}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="card h-[102px] skeleton" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="card h-72 skeleton xl:col-span-2" />
          <div className="card h-72 skeleton" />
        </div>
      </div>
    );
  }

  const gsc = data.searchConsole?.current;
  const gscPrev = data.searchConsole?.previous;
  const ga4 = data.analytics?.current;
  const ga4Prev = data.analytics?.previous;
  const google = integrations?.google ?? { status: 'disconnected' };

  const kpis = [
    {
      label: 'Organic clicks',
      value: formatNumber(gsc?.clicks),
      delta: deltaOf(gsc?.clicks, gscPrev?.clicks),
      icon: MousePointer,
      hint: 'Search Console · measured',
    },
    {
      label: 'Impressions',
      value: formatNumber(gsc?.impressions, { compact: true }),
      delta: deltaOf(gsc?.impressions, gscPrev?.impressions),
      icon: Eye,
      hint: 'Search Console · measured',
    },
    {
      label: 'Average CTR',
      value: gsc?.ctr ? formatPercent(gsc.ctr) : '—',
      delta: deltaOf(gsc?.ctr, gscPrev?.ctr),
      icon: Target,
      hint: 'Clicks ÷ impressions',
    },
    {
      label: 'Average position',
      value: formatPosition(gsc?.position),
      delta: gsc?.position && gscPrev?.position ? invertDelta(deltaOf(gsc.position, gscPrev.position)) : null,
      icon: Trend,
      hint: 'Lower is better',
    },
  ];

  return (
    <div className="space-y-5">
      {!data.hasData && (
        <Notice tone="warning" icon={AlertCircle} title="No Google data for this period yet">
          {google.status === 'connected'
            ? 'Run a sync to import Search Console and Analytics rows. Until then every chart stays empty rather than showing placeholder numbers.'
            : 'Connect Google Search Console and GA4 to populate this dashboard with measured data.'}{' '}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => onNavigate(google.status === 'connected' ? 'integrations' : 'integrations')}
          >
            {google.status === 'connected' ? 'Open integrations' : 'Set up integration'}
          </button>
        </Notice>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => <StatTile key={kpi.label} {...kpi} />)}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="GA4 sessions"
          value={formatNumber(ga4?.sessions)}
          delta={deltaOf(ga4?.sessions, ga4Prev?.sessions)}
          icon={Chart}
          hint="Analytics · all channels"
        />
        <StatTile
          label="Active users"
          value={formatNumber(ga4?.activeUsers)}
          delta={deltaOf(ga4?.activeUsers, ga4Prev?.activeUsers)}
          icon={Globe}
          hint="Analytics · all channels"
        />
        <StatTile
          label="Engagement rate"
          value={ga4?.engagementRate ? formatPercent(ga4.engagementRate) : '—'}
          delta={deltaOf(ga4?.engagementRate, ga4Prev?.engagementRate)}
          icon={Sparkles}
          hint="Analytics · engaged sessions"
        />
        <StatTile
          label="Tracked keywords"
          value={formatNumber(data.trackedKeywords ?? 0)}
          icon={Search}
          hint="See the Keywords page"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card
          title="Search performance"
          description="Clicks and impressions recorded by Google Search Console for this site."
          icon={Trend}
          actions={
            <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate('search-console')}>
              Details <ArrowUpRight size={12} />
            </button>
          }
        >
          <TrendChart
            series={data.searchConsole?.series ?? []}
            metrics={[
              { key: 'clicks', label: 'Clicks', colour: CHART_COLOURS[0] },
              { key: 'impressions', label: 'Impressions', colour: CHART_COLOURS[1] },
            ]}
            emptyDescription="Search Console shows no rows for this window. Sync after connecting Google, or widen the date range."
          />
        </Card>

        <Card title="Health & freshness" icon={ClipboardCheck}>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {data.audit?.score ? (
                <>
                  <ScoreRing value={data.audit.score.value} size={62} label="score" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-ink">
                      Latest audit · {data.audit.score.grade}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {relativeTime(data.audit.startedAt)} · {data.audit.summary?.total ?? 0} issue(s)
                    </p>
                    <button type="button" className="btn-ghost btn-sm mt-1.5 -ml-2" onClick={() => onNavigate('audit')}>
                      Open audit <ArrowUpRight size={11} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="w-full">
                  <p className="text-[12.5px] font-medium text-ink">No audit yet</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                    Crawl the site to find missing meta tags, broken links, canonical problems and more.
                  </p>
                  <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => onNavigate('audit')}>
                    Run a crawl
                  </button>
                </div>
              )}
            </div>

            <div className="divider" />

            <dl className="space-y-2">
              <FreshnessRow label="Search Console" value={data.dataFreshness?.gsc} icon={Search} />
              <FreshnessRow label="Analytics" value={data.dataFreshness?.ga4} icon={Chart} />
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="inline-flex items-center gap-1.5 text-muted"><Refresh size={12} /> Last sync</span>
                <span className="text-ink">{relativeTime(activeSite?.lastSyncAt)}</span>
              </div>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="inline-flex items-center gap-1.5 text-muted"><Globe size={12} /> Property</span>
                <span className="truncate font-mono text-[10.5px] text-ink" title={activeSite?.url}>{hostOf(activeSite?.url)}</span>
              </div>
            </dl>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card title="Top queries" description="By clicks in the selected period" icon={Search}>
          <BarList
            items={data.searchConsole?.topQueries ?? []}
            valueKey="clicks"
            formatLabel={(item) => truncate(item.key, 42)}
            formatValue={(item) => formatNumber(item.clicks)}
            emptyTitle="No queries recorded"
          />
        </Card>
        <Card title="Top pages" description="Search landing pages" icon={FileText}>
          <BarList
            items={data.searchConsole?.topPages ?? []}
            valueKey="clicks"
            formatLabel={(item) => truncate(pathOf(item.key), 34)}
            formatValue={(item) => formatNumber(item.clicks)}
            emptyTitle="No pages recorded"
          />
        </Card>
        <Card title="Acquisition" description="GA4 sessions by source" icon={Chart}>
          <BarList
            items={(data.analytics?.sources ?? []).slice(0, 6)}
            valueKey="sessions"
            formatLabel={(item) => truncate(item.key, 24)}
            formatValue={(item) => formatNumber(item.sessions)}
            emptyTitle="No GA4 sources"
          />
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="Devices" description="Impressions by device type" icon={Globe}>
          <DonutChart
            items={(data.searchConsole?.devices ?? []).map((row, index) => ({
              label: row.key, value: row.impressions, colour: CHART_COLOURS[index % CHART_COLOURS.length],
            }))}
            centerLabel="impressions"
          />
        </Card>
        <Card title="Countries" description="Impressions by country" icon={Globe}>
          <DistributionBars items={data.searchConsole?.countries ?? []} />
          {(data.searchConsole?.countries ?? []).length === 0 && (
            <p className="mt-3 text-[11.5px] text-faint">
              Country breakdowns appear after a Search Console sync that includes dimension data.
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}

function FreshnessRow({ label, value, icon: Icon }) {
  const fresh = value ? daysSince(value) : null;
  return (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Icon size={12} /> {label}
      </span>
      {value ? (
        <span className="inline-flex items-center gap-1.5 text-ink">
          <span className="font-mono text-[10.5px]">{value}</span>
          <Badge tone={fresh <= 3 ? 'positive' : fresh <= 10 ? 'warning' : 'neutral'}>{fresh}d old</Badge>
        </span>
      ) : (
        <span className="text-faint">no data</span>
      )}
    </div>
  );
}

function daysSince(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 86400000));
}

function invertDelta(delta) {
  if (!delta) return null;
  return { ...delta, positive: delta.change < 0, neutral: delta.change === 0 };
}
