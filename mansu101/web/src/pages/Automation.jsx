import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { post, patch, del } from '../lib/api.js';
import {
  Card,
  StatTile,
  EmptyState,
  ErrorState,
  Badge,
  Modal,
  Field,
  Notice,
  Select,
  SearchInput,
  Tabs,
  Collapsible,
  InlineCode,
} from '../components/ui.jsx';
import {
  Clock,
  Plus,
  Trash,
  Play,
  Refresh,
  AlertCircle,
  CheckCircle,
  Info,
  Calendar,
  Chart,
  ClipboardCheck,
  FileText,
  Search,
  Pause,
} from '../components/Icons.jsx';
import {
  formatDateTime,
  formatDuration,
  relativeTime,
  truncate,
  STATUS_META,
  TONE_CLASS,
} from '../lib/format.js';

const JOB_TYPES = [
  {
    value: 'gsc-sync',
    label: 'Search Console sync',
    icon: Search,
    description: 'Import clicks, impressions, CTR and position for the last N days.',
    payload: { days: 28 },
    interval: 1440,
  },
  {
    value: 'ga4-sync',
    label: 'GA4 sync',
    icon: Chart,
    description: 'Import sessions, users and acquisition rows for the last N days.',
    payload: { days: 28 },
    interval: 1440,
  },
  {
    value: 'site-audit',
    label: 'Technical audit',
    icon: ClipboardCheck,
    description: 'Crawl the site and record a technical quality score.',
    payload: { options: { maxPages: 25 } },
    interval: 10080,
  },
  {
    value: 'daily-report',
    label: 'Daily report',
    icon: FileText,
    description: 'Generate a 1-day snapshot; optionally email it.',
    payload: { days: 1 },
    interval: 1440,
  },
  {
    value: 'weekly-report',
    label: 'Weekly report',
    icon: Calendar,
    description: 'Generate a 7-day snapshot; optionally email it.',
    payload: { days: 7 },
    interval: 10080,
  },
  {
    value: 'campaign-review',
    label: 'Campaign review',
    icon: Refresh,
    description: 'Reconcile campaigns with the latest GA4 source rows.',
    payload: {},
    interval: 1440,
  },
];

export default function Automation({ onNavigate }) {
  const { sites, siteId, activeSite, toast, scheduler } = useApp();
  const [createOpen, setCreateOpen] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState(null);

  const list = useApi('/jobs');

  const jobs = list.data?.jobs ?? [];
  const schedulerStatus = scheduler ?? list.data?.scheduler ?? {};

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return jobs
      .filter((job) => filter === 'all' || (filter === 'failing' ? job.status === 'failed' : job.status === filter))
      .filter((job) => !needle || `${job.label} ${job.type}`.toLowerCase().includes(needle));
  }, [jobs, filter, search]);

  const runNow = async (job) => {
    setRunning(job.id);
    try {
      await post(`/jobs/${job.id}/run`, {});
      toast(`Ran ${job.label}`, 'success');
      list.refetch();
    } catch (error) {
      toast(error.message, 'error', 7000);
    } finally {
      setRunning(null);
    }
  };

  const toggle = async (job) => {
    try {
      await patch(`/jobs/${job.id}`, { enabled: !job.enabled });
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const remove = async (job) => {
    try {
      await del(`/jobs/${job.id}`);
      toast('Job deleted', 'success');
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const counts = useMemo(() => ({
    all: jobs.length,
    pending: jobs.filter((job) => job.status === 'pending').length,
    running: jobs.filter((job) => job.status === 'running').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    completed: jobs.filter((job) => job.status === 'completed').length,
  }), [jobs]);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Scheduled jobs" value={jobs.length} icon={Clock} hint={`${counts.pending} pending`} />
        <StatTile
          label="Scheduler"
          value={schedulerStatus.enabled ? 'Running' : 'Stopped'}
          icon={Refresh}
          hint={schedulerStatus.enabled ? `tick every ${schedulerStatus.tickSeconds}s` : 'enable in .env'}
        />
        <StatTile label="Active now" value={schedulerStatus.running ?? 0} icon={Play} hint="jobs executing" />
        <StatTile label="Failed" value={counts.failed} icon={AlertCircle} hint="needs attention" />
      </section>

      <Notice tone="info" icon={Info} title="How the scheduler behaves">
        Jobs are persisted and survive restarts. Failed runs retry with exponential backoff up to the
        configured limit, then stop and (optionally) alert your{' '}
        <InlineCode>ALERT_WEBHOOK_URL</InlineCode>. A job interrupted by a restart is re-queued rather
        than left hanging.
      </Notice>

      <Card
        title="Jobs"
        description="Recurring syncs, audits and reports."
        icon={Clock}
        actions={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => list.refetch()} disabled={list.loading}>
              <Refresh size={12} className={list.loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(JOB_TYPES[0].value)}>
              <Plus size={13} /> New job
            </button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'pending', label: 'Pending', count: counts.pending },
              { value: 'running', label: 'Running', count: counts.running },
              { value: 'failing', label: 'Failed', count: counts.failed },
              { value: 'completed', label: 'Completed', count: counts.completed },
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search jobs…" className="w-[172px]" />
        </div>

        {list.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-16 skeleton" />)}
          </div>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : !filtered.length ? (
          <EmptyState
            compact
            icon={Clock}
            title={jobs.length ? 'No jobs match this filter' : 'No scheduled jobs'}
            description={jobs.length
              ? 'Try another status or clear the search.'
              : 'Schedule a daily Search Console sync so the dashboard stays current without manual work.'}
            action={<button type="button" className="btn-secondary btn-sm" onClick={() => setCreateOpen(JOB_TYPES[0].value)}>Create job</button>}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((job) => (
              <Collapsible
                key={job.id}
                summary={
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12.5px] font-medium text-ink">{job.label}</p>
                        <span className={`pill ${TONE_CLASS[STATUS_META[job.status]?.tone ?? 'neutral']}`}>
                          {STATUS_META[job.status]?.label ?? job.status}
                        </span>
                        {!job.enabled && <Badge tone="neutral">disabled</Badge>}
                        {job.intervalMinutes > 0 && (
                          <Badge tone="info">
                            every {job.intervalMinutes >= 1440
                              ? `${Math.round(job.intervalMinutes / 1440)}d`
                              : job.intervalMinutes >= 60 ? `${Math.round(job.intervalMinutes / 60)}h` : `${job.intervalMinutes}m`}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-muted">
                        {job.type} · next run {relativeTime(job.nextRunAt)}
                        {job.lastFinishedAt ? ` · last ${relativeTime(job.lastFinishedAt)} (${formatDuration(job.lastDurationMs)})` : ''}
                      </p>
                    </div>
                  </div>
                }
              >
                <div className="space-y-3">
                  {job.lastError && (
                    <div className="rounded-lg border border-negative/25 bg-negative/5 px-2.5 py-2 text-[11.5px] text-negative">
                      <span className="font-semibold">Last error: </span>{job.lastError}
                    </div>
                  )}

                  {job.lastResult && (
                    <div>
                      <p className="label mb-1">Last result</p>
                      <pre className="overflow-x-auto rounded-lg border border-line bg-sunken p-2 font-mono text-[10.5px] text-muted">
                        {JSON.stringify(job.lastResult, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="grid gap-2 sm:grid-cols-3">
                    <Meta label="Attempts" value={`${job.attempts} / ${job.maxRetries + 1}`} />
                    <Meta label="Created" value={formatDateTime(job.createdAt)} />
                    <Meta label="Next run at" value={formatDateTime(job.nextRunAt)} />
                  </div>

                  {job.payload && Object.keys(job.payload).length > 0 && (
                    <div>
                      <p className="label mb-1">Payload</p>
                      <pre className="overflow-x-auto rounded-lg border border-line bg-sunken p-2 font-mono text-[10.5px] text-muted">
                        {JSON.stringify(job.payload, null, 2)}
                      </pre>
                    </div>
                  )}

                  {job.history?.length > 0 && (
                    <div>
                      <p className="label mb-1">Recent runs</p>
                      <ul className="space-y-1">
                        {job.history.slice(-6).reverse().map((entry, index) => (
                          <li key={`${entry.at}-${index}`} className="flex items-center justify-between gap-2 text-[10.5px]">
                            <span className="inline-flex items-center gap-1.5 text-muted">
                              {entry.status === 'success'
                                ? <CheckCircle size={10} className="text-positive" />
                                : <AlertCircle size={10} className="text-negative" />}
                              {formatDateTime(entry.at)}
                            </span>
                            <span className="font-mono text-faint">
                              {entry.status === 'success' ? formatDuration(entry.durationMs) : truncate(entry.error ?? 'failed', 40)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => runNow(job)} disabled={running === job.id || job.status === 'running'}>
                      <Play size={11} /> {running === job.id ? 'Running…' : 'Run now'}
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => toggle(job)}>
                      {job.enabled ? <><Pause size={11} /> Disable</> : <><Play size={11} /> Enable</>}
                    </button>
                    <button type="button" className="btn-danger btn-sm ml-auto" onClick={() => remove(job)}>
                      <Trash size={11} /> Delete
                    </button>
                  </div>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </Card>

      <Card title="Quick schedules" description="One-click jobs for the most useful recurring work." icon={Calendar}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {JOB_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => setCreateOpen(type.value)}
              className="rounded-lg border border-line bg-sunken p-2.5 text-left transition hover:border-brand-500/40"
            >
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
                <type.icon size={12} className="text-brand-600 dark:text-brand-400" />
                {type.label}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted">{type.description}</span>
            </button>
          ))}
        </div>
      </Card>

      <CreateJobModal
        open={Boolean(createOpen)}
        initialType={createOpen}
        onClose={() => setCreateOpen(null)}
        sites={sites}
        defaultSiteId={siteId}
        onCreated={() => { list.refetch(); setCreateOpen(null); }}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div className="rounded-md border border-line/70 bg-elevated px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <p className="truncate text-[11px] text-ink" title={value}>{value}</p>
    </div>
  );
}

function CreateJobModal({ open, initialType, onClose, sites, defaultSiteId, onCreated, onNavigate }) {
  const { toast } = useApp();
  const [type, setType] = useState(initialType ?? 'gsc-sync');
  const [siteId, setSiteId] = useState(defaultSiteId ?? '');
  const [label, setLabel] = useState('');
  const [interval, setIntervalMinutes] = useState('1440');
  const [days, setDays] = useState('28');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setType(initialType ?? 'gsc-sync');
    setSiteId(defaultSiteId ?? sites[0]?.id ?? '');
    setLabel('');
    setError(null);
  }, [open, initialType, defaultSiteId, sites]);

  useEffect(() => {
    const meta = JOB_TYPES.find((item) => item.value === type);
    if (!meta) return;
    setIntervalMinutes(String(meta.interval));
    if (meta.payload.days) setDays(String(meta.payload.days));
    setLabel('');
  }, [type]);

  if (!open) return null;

  const meta = JOB_TYPES.find((item) => item.value === type) ?? JOB_TYPES[0];

  const submit = async (event) => {
    event.preventDefault();
    if (!siteId) {
      setError('Select a site for this job.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...meta.payload };
      if (payload.days !== undefined) payload.days = Number(days) || 28;
      if (type === 'daily-report' || type === 'weekly-report') {
        if (email.trim()) payload.email = email.trim();
      }
      await post('/jobs', {
        type,
        siteId,
        label: label || `${meta.label} · ${sites.find((site) => site.id === siteId)?.name ?? 'site'}`,
        payload: { ...payload, siteId },
        intervalMinutes: Number(interval) || 0,
        delayMinutes: 1,
      });
      toast('Job scheduled', 'success');
      onCreated();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const needsDays = ['gsc-sync', 'ga4-sync', 'daily-report', 'weekly-report'].includes(type);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule a job"
      description="Choose what runs, where, and how often."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="job-form" className="btn-primary" disabled={saving || !siteId}>
            {saving ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      }
    >
      {!sites.length ? (
        <EmptyState
          icon={AlertCircle}
          title="Add a site first"
          description="Jobs run against a registered site so their payload is unambiguous."
          action={<button type="button" className="btn-primary btn-sm" onClick={() => { onClose(); onNavigate('dashboard'); }}>Go to dashboard</button>}
        />
      ) : (
        <form id="job-form" onSubmit={submit} className="space-y-3.5">
          <Field label="Job type">
            <Select
              ariaLabel="Job type"
              value={type}
              onChange={setType}
              options={JOB_TYPES.map((item) => ({ value: item.value, label: item.label }))}
            />
          </Field>

          <p className="rounded-lg border border-line bg-sunken px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
            {meta.description}
          </p>

          <Field label="Site">
            <Select
              ariaLabel="Site"
              value={siteId}
              onChange={setSiteId}
              options={sites.map((site) => ({ value: site.id, label: site.name }))}
            />
          </Field>

          <Field label="Label" hint="Shown in the job list">
            <input value={label} onChange={(event) => setLabel(event.target.value)} className="input" placeholder={`${meta.label} · daily`} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Repeat every" hint="0 = run once">
              <Select
                ariaLabel="Interval"
                value={interval}
                onChange={setIntervalMinutes}
                options={[
                  { value: '60', label: 'Every hour' },
                  { value: '360', label: 'Every 6 hours' },
                  { value: '720', label: 'Every 12 hours' },
                  { value: '1440', label: 'Every day' },
                  { value: '10080', label: 'Every week' },
                  { value: '0', label: 'Once (no repeat)' },
                ]}
              />
            </Field>
            {needsDays && (
              <Field label="Data window" hint="Days of history per run">
                <Select
                  ariaLabel="Data window"
                  value={days}
                  onChange={setDays}
                  options={[
                    { value: '1', label: '1 day' },
                    { value: '7', label: '7 days' },
                    { value: '28', label: '28 days' },
                    { value: '90', label: '90 days' },
                  ]}
                />
              </Field>
            )}
          </div>

          {(type === 'daily-report' || type === 'weekly-report') && (
            <Field label="Email report to" hint="Optional — requires SMTP configuration">
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="input" placeholder="you@company.com" />
            </Field>
          )}

          {error && <p className="text-[12px] text-negative">{error}</p>}
        </form>
      )}
    </Modal>
  );
}
