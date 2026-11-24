import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { get, post, del } from '../lib/api.js';
import {
  Card,
  EmptyState,
  ErrorState,
  Badge,
  ScoreRing,
  Tabs,
  Select,
  SearchInput,
  Collapsible,
} from '../components/ui.jsx';
import {
  ClipboardCheck,
  Play,
  Trash,
  Download,
  Alert,
  AlertCircle,
  CheckCircle,
  FileText,
  Link2,
  Image,
  Sitemap,
  Layers,
} from '../components/Icons.jsx';
import {
  formatNumber,
  formatDateTime,
  formatDuration,
  relativeTime,
  SEVERITY_META,
  TONE_CLASS,
  truncate,
  pathOf,
} from '../lib/format.js';

const SEVERITIES = ['all', 'critical', 'high', 'medium', 'low', 'info'];

export default function Audit({ onNavigate }) {
  const { siteId, activeSite, toast, profiles } = useApp();
  const [selectedId, setSelectedId] = useState(null);
  const [running, setRunning] = useState(false);
  const [severity, setSeverity] = useState('all');
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState('desktop-chrome-windows');
  const [maxPages, setMaxPages] = useState('25');
  const [robotsOpen, setRobotsOpen] = useState(null);
  const [sitemapReport, setSitemapReport] = useState(null);
  const [checking, setChecking] = useState(false);

  const auditsPath = siteId ? `/sites/${siteId}/audits` : null;
  const list = useApi(auditsPath ?? '/bootstrap', { enabled: Boolean(auditsPath) });

  const activeList = list.data?.audits ?? [];
  const activeAudit = useMemo(() => {
    const id = selectedId ?? activeList[0]?.id;
    return activeList.find((item) => item.id === id) ?? activeList[0] ?? null;
  }, [activeList, selectedId]);

  const detailPath = activeAudit ? `/audits/${activeAudit.id}` : null;
  const detail = useApi(detailPath ?? '/bootstrap', { enabled: Boolean(detailPath) });
  const audit = detail.data?.audit ?? null;

  useEffect(() => {
    setSelectedId(null);
    setSitemapReport(null);
    setRobotsOpen(null);
    setSeverity('all');
    setSearch('');
  }, [siteId]);

  const runAudit = async () => {
    if (!activeSite) return;
    setRunning(true);
    try {
      const body = {
        maxPages: Number(maxPages) || 25,
        profile,
        renderPages: Boolean(profiles.find((item) => item.id === profile) && profile !== 'http-default'),
      };
      const { audit: created } = await post(`/sites/${activeSite.id}/audits`, body);
      toast(`Audit finished · score ${created.score.value}/100`, created.score.value >= 75 ? 'success' : 'warn', 6000);
      setSelectedId(created.id);
      await list.refetch();
      await detail.refetch(`/audits/${created.id}`);
    } catch (error) {
      toast(error.message, 'error', 8000);
    } finally {
      setRunning(false);
    }
  };

  const validateSitemap = async () => {
    if (!activeSite) return;
    setChecking(true);
    try {
      const { report } = await post(`/sites/${activeSite.id}/sitemap/validate`, {});
      setSitemapReport(report);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  const checkRobots = async () => {
    if (!activeSite) return;
    try {
      const { report } = await get(`/sites/${activeSite.id}/robots`);
      setRobotsOpen(report);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const removeAudit = async (item) => {
    try {
      await del(`/audits/${item.id}`);
      toast('Audit deleted', 'success');
      if (selectedId === item.id) setSelectedId(null);
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  if (!siteId) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No site selected"
        description="Technical audits crawl a site you own and report concrete, page-specific issues."
        action={<button type="button" className="btn-primary" onClick={() => onNavigate('dashboard')}>Go to dashboard</button>}
      />
    );
  }

  const issues = audit?.issues ?? [];
  const filteredIssues = issues
    .filter((issue) => severity === 'all' || issue.severity === severity)
    .filter((issue) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return `${issue.title} ${issue.detail} ${issue.url ?? ''}`.toLowerCase().includes(needle);
    });

  return (
    <div className="space-y-4">
      <Card
        title="Technical crawl"
        description="Visitor requests the pages you register, respects robots.txt, and never simulates visitors."
        icon={ClipboardCheck}
        actions={
          <button type="button" className="btn-primary btn-sm" onClick={runAudit} disabled={running}>
            <Play size={12} /> {running ? 'Crawling…' : 'Run audit'}
          </button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="label mb-1.5">Page limit</p>
            <Select
              ariaLabel="Page limit"
              value={maxPages}
              onChange={setMaxPages}
              options={[
                { value: '10', label: '10 pages' },
                { value: '25', label: '25 pages' },
                { value: '50', label: '50 pages' },
                { value: '100', label: '100 pages' },
                { value: '200', label: '200 pages' },
              ]}
            />
          </div>
          <div>
            <p className="label mb-1.5">Viewport profile</p>
            <Select
              ariaLabel="Viewport profile"
              value={profile}
              onChange={setProfile}
              options={[
                { value: 'http-default', label: 'HTTP only (no browser)' },
                ...profiles.filter((item) => item.id !== 'http-default').map((item) => ({
                  value: item.id, label: item.label,
                })),
              ]}
            />
          </div>
          <div className="flex items-end">
            <button type="button" className="btn-secondary btn-sm w-full" onClick={checkRobots}>
              <FileText size={12} /> Inspect robots.txt
            </button>
          </div>
          <div className="flex items-end">
            <button type="button" className="btn-secondary btn-sm w-full" onClick={validateSitemap} disabled={checking}>
              <Sitemap size={12} /> {checking ? 'Checking…' : 'Validate sitemap'}
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Rendered checks need Chromium on the server. When it is missing the crawl still runs over plain
          HTTP — you simply get no screenshots or viewport rendering evidence.
        </p>
      </Card>

      {sitemapReport && (
        <Card
          title="Sitemap validation"
          description={sitemapReport.url}
          icon={Sitemap}
          actions={<button type="button" className="btn-ghost btn-sm" onClick={() => setSitemapReport(null)}>Dismiss</button>}
        >
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={sitemapReport.valid ? 'positive' : 'negative'} dot>
                {sitemapReport.valid ? 'Valid' : 'Problems found'}
              </Badge>
              <span className="text-[11.5px] text-muted">HTTP {sitemapReport.status}</span>
              <span className="text-[11.5px] text-muted">{formatNumber(sitemapReport.count)} URLs</span>
              {sitemapReport.isIndex && <Badge tone="info">sitemap index</Badge>}
            </div>
            {sitemapReport.problems.length > 0 && (
              <ul className="space-y-1.5">
                {sitemapReport.problems.map((problem) => (
                  <li key={problem} className="flex items-start gap-2 text-[11.5px] text-muted">
                    <Alert size={12} className="mt-0.5 shrink-0 text-negative" />
                    {problem}
                  </li>
                ))}
              </ul>
            )}
            {sitemapReport.entries?.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-sunken p-2">
                {sitemapReport.entries.slice(0, 40).map((entry) => (
                  <p key={entry.loc} className="truncate font-mono text-[10.5px] text-muted">{entry.loc}</p>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {robotsOpen && (
        <Card
          title="robots.txt"
          description={robotsOpen.url}
          icon={FileText}
          actions={<button type="button" className="btn-ghost btn-sm" onClick={() => setRobotsOpen(null)}>Dismiss</button>}
        >
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={robotsOpen.valid ? 'positive' : 'warning'} dot>{robotsOpen.valid ? 'Healthy' : 'Needs attention'}</Badge>
              <span className="text-[11.5px] text-muted">HTTP {robotsOpen.status}</span>
              <span className="text-[11.5px] text-muted">{robotsOpen.groups} user-agent group(s)</span>
              <span className="text-[11.5px] text-muted">{robotsOpen.sitemaps.length} sitemap(s)</span>
            </div>
            {robotsOpen.problems.length > 0 && (
              <ul className="space-y-1.5">
                {robotsOpen.problems.map((problem) => (
                  <li key={problem} className="flex items-start gap-2 text-[11.5px] text-muted">
                    <Alert size={12} className="mt-0.5 shrink-0 text-warning" /> {problem}
                  </li>
                ))}
              </ul>
            )}
            {robotsOpen.body && (
              <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-sunken p-2.5 font-mono text-[10.5px] leading-relaxed text-muted">
                {robotsOpen.body}
              </pre>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <Card title="Audit history" icon={ClipboardCheck} flush>
          {list.loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 skeleton" />)}
            </div>
          ) : list.error ? (
            <div className="p-3"><ErrorState error={list.error} onRetry={list.refetch} /></div>
          ) : !activeList.length ? (
            <div className="p-3">
              <EmptyState
                compact
                icon={ClipboardCheck}
                title="No audits yet"
                description="Run the first crawl to get a baseline score and a prioritised issue list."
              />
            </div>
          ) : (
            <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
              {activeList.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition ${
                      activeAudit?.id === item.id ? 'bg-brand-50/60 dark:bg-brand-500/10' : 'hover:bg-sunken'
                    }`}
                  >
                    <ScoreRing value={item.score?.value ?? 0} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11.5px] font-medium text-ink">{item.score?.grade ?? 'n/a'}</span>
                      <span className="block truncate text-[10.5px] text-muted">
                        {relativeTime(item.startedAt)} · {item.pages} page(s)
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] font-mono text-faint">{item.summary?.total ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          {detail.loading && activeAudit ? (
            <div className="card h-64 skeleton" />
          ) : !audit ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No audit selected"
              description="Run a crawl or pick an entry from the history to see its findings."
              action={<button type="button" className="btn-primary btn-sm" onClick={runAudit} disabled={running}>Run audit</button>}
            />
          ) : (
            <>
              <Card
                title={`Audit · ${formatDateTime(audit.startedAt)}`}
                description={`${audit.pages.length} page(s) · ${formatDuration(audit.durationMs)} · ${audit.startUrl}`}
                icon={ClipboardCheck}
                actions={
                  <>
                    <a className="btn-secondary btn-sm" href={`/api/audits/${audit.id}/export?format=csv`} download>
                      <Download size={12} /> CSV
                    </a>
                    <button type="button" className="btn-danger btn-sm" onClick={() => removeAudit(audit)}>
                      <Trash size={12} />
                    </button>
                  </>
                }
              >
                <div className="flex flex-wrap items-center gap-5">
                  <ScoreRing value={audit.score.value} size={76} label="score" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold capitalize text-ink">{audit.score.grade}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted">
                      {audit.summary.total} issue(s) across {audit.summary.byCategory ? Object.keys(audit.summary.byCategory).length : 0} categories
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {Object.entries(audit.summary.bySeverity ?? {})
                        .filter(([, count]) => count > 0)
                        .map(([key, count]) => (
                          <Badge key={key} tone={SEVERITY_META[key]?.tone ?? 'neutral'}>
                            {count} {SEVERITY_META[key]?.label ?? key}
                          </Badge>
                        ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <MiniStat label="Crawled pages" value={audit.pages.length} />
                  <MiniStat
                    label="Broken links"
                    value={issues.filter((issue) => issue.category === 'links').length}
                    tone={issues.some((issue) => issue.category === 'links') ? 'negative' : 'positive'}
                  />
                  <MiniStat
                    label="Missing alt text"
                    value={audit.pages.reduce((sum, page) => sum + (page.imagesMissingAlt ?? 0), 0)}
                    tone={audit.pages.some((page) => page.imagesMissingAlt > 0) ? 'warning' : 'positive'}
                  />
                  <MiniStat
                    label="Duplicate titles"
                    value={issues.filter((issue) => issue.title.toLowerCase().includes('duplicate')).length}
                    tone={issues.some((issue) => issue.title.toLowerCase().includes('duplicate')) ? 'warning' : 'positive'}
                  />
                </div>
              </Card>

              <Card
                title="Issues"
                description="Filter by severity and jump straight to the affected page."
                icon={AlertCircle}
                actions={<SearchInput value={search} onChange={setSearch} placeholder="Filter issues…" className="w-[172px]" />}
              >
                <Tabs
                  className="mb-3"
                  value={severity}
                  onChange={setSeverity}
                  items={SEVERITIES.map((value) => ({
                    value,
                    label: value === 'all' ? 'All' : SEVERITY_META[value]?.label ?? value,
                    count: value === 'all' ? issues.length : issues.filter((issue) => issue.severity === value).length,
                  }))}
                />

                {!filteredIssues.length ? (
                  <EmptyState
                    compact
                    icon={CheckCircle}
                    title={issues.length ? 'No issues match this filter' : 'No issues found'}
                    description={issues.length
                      ? 'Try a different severity or clear the search filter.'
                      : 'This crawl found no rule violations. Re-run after your next deploy.'}
                  />
                ) : (
                  <div className="space-y-2">
                    {filteredIssues.slice(0, 60).map((issue, index) => (
                      <Collapsible
                        key={`${issue.title}-${index}`}
                        summary={
                          <div className="flex items-start gap-2">
                            <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${issue.severity === 'critical' || issue.severity === 'high' ? 'bg-negative' : issue.severity === 'medium' ? 'bg-warning' : 'bg-info'}`} />
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-medium text-ink">{issue.title}</p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted">
                                <span className={`pill ${TONE_CLASS[SEVERITY_META[issue.severity]?.tone ?? 'neutral']}`}>
                                  {SEVERITY_META[issue.severity]?.label ?? issue.severity}
                                </span>
                                <span className="capitalize">{issue.category}</span>
                                {issue.url && <span className="max-w-[280px] truncate font-mono">{pathOf(issue.url)}</span>}
                              </p>
                            </div>
                          </div>
                        }
                      >
                        <p className="text-[12px] leading-relaxed text-muted">{issue.detail}</p>
                        {fixFor(issue) && (
                          <p className="mt-2 rounded-lg border border-line bg-sunken px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
                            <span className="font-semibold text-ink">How to fix: </span>{fixFor(issue)}
                          </p>
                        )}
                        {issue.url && (
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] text-brand-600 hover:underline dark:text-brand-400"
                          >
                            <Link2 size={10} /> {truncate(issue.url, 70)}
                          </a>
                        )}
                      </Collapsible>
                    ))}
                    {filteredIssues.length > 60 && (
                      <p className="pt-1 text-center text-[11px] text-faint">
                        Showing the first 60 of {filteredIssues.length} issues — export the CSV for the full list.
                      </p>
                    )}
                  </div>
                )}
              </Card>

              {audit.pages?.length > 0 && (
                <Card title="Crawled pages" description="Status, title and heading structure per page." icon={Layers} flush>
                  <div className="max-h-[420px] overflow-y-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>URL</th>
                          <th>Status</th>
                          <th>Title</th>
                          <th className="text-right">Words</th>
                          <th className="text-right">Links</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.pages.map((page) => (
                          <tr key={page.url}>
                            <td className="max-w-[240px]">
                              <a href={page.url} target="_blank" rel="noreferrer noopener" className="block truncate font-mono text-[11px] text-ink hover:text-brand-600 dark:hover:text-brand-400" title={page.url}>
                                {pathOf(page.url)}
                              </a>
                            </td>
                            <td>
                              <Badge tone={page.status >= 200 && page.status < 300 ? 'positive' : page.status >= 400 ? 'negative' : 'warning'}>
                                {page.status || '—'}
                              </Badge>
                            </td>
                            <td className="max-w-[260px]">
                              <span className="block truncate text-[11.5px] text-muted" title={page.title}>{page.title || <em className="text-negative">missing</em>}</span>
                            </td>
                            <td className="text-right font-mono text-[11px]">{formatNumber(page.wordCount ?? 0)}</td>
                            <td className="text-right font-mono text-[11px]">{(page.internalLinks ?? 0) + (page.externalLinks ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {audit.rendered?.items?.length > 0 && (
                <Card title="Rendered evidence" description="Headless Chromium screenshots and mobile viewport results." icon={Image}>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {audit.rendered.items.map((item) => (
                      <div key={item.url} className="overflow-hidden rounded-lg border border-line">
                        {item.screenshot ? (
                          <a href={`/api/screenshots/${item.screenshot}`} target="_blank" rel="noreferrer noopener">
                            <img
                              src={`/api/screenshots/${item.screenshot}`}
                              alt={`Screenshot of ${item.url}`}
                              className="aspect-[4/3] w-full object-cover object-top"
                              loading="lazy"
                            />
                          </a>
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center bg-sunken text-[11px] text-faint">
                            {item.error ? 'Render failed' : 'No screenshot'}
                          </div>
                        )}
                        <div className="border-t border-line px-2.5 py-2">
                          <p className="truncate font-mono text-[10.5px] text-muted" title={item.url}>{pathOf(item.url)}</p>
                          {item.error && <p className="mt-0.5 text-[10px] text-negative">{truncate(item.error, 60)}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone = 'neutral' }) {  const colour = { positive: 'text-positive', negative: 'text-negative', warning: 'text-warning', neutral: 'text-ink' }[tone];
  return (
    <div className="rounded-lg border border-line bg-sunken px-2.5 py-2">
      <p className="label text-[9px]">{label}</p>
      <p className={`mt-0.5 font-mono text-[15px] font-semibold tabular-nums ${colour}`}>{formatNumber(value)}</p>
    </div>
  );
}
