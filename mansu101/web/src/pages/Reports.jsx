import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { post, del, queryString } from '../lib/api.js';
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
} from '../components/ui.jsx';
import {
  FileText,
  Plus,
  Trash,
  Download,
  Mail,
  AlertCircle,
  Refresh,
  Calendar,
  Chart,
  Search,
  Info,
} from '../components/Icons.jsx';
import {
  formatNumber,
  formatPercent,
  formatDate,
  formatDateTime,
  relativeTime,
  truncate,
} from '../lib/format.js';

export default function Reports({ onNavigate }) {
  const { siteId, activeSite, boot, toast } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [delivering, setDelivering] = useState(null);

  const listPath = `/reports${queryString({ siteId })}`;
  const list = useApi(listPath, { enabled: Boolean(siteId) });

  const detailPath = preview ? `/reports/${preview}` : null;
  const detail = useApi(detailPath ?? '/bootstrap', { enabled: Boolean(detailPath) });

  useEffect(() => { setPreview(null); }, [siteId]);

  const reports = list.data?.reports ?? [];
  const email = boot?.integrations?.email ?? { ok: false };

  const remove = async (report) => {
    try {
      await del(`/reports/${report.id}`);
      toast('Report deleted', 'success');
      if (preview === report.id) setPreview(null);
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  if (!siteId) {
    return (
      <EmptyState
        icon={FileText}
        title="No site selected"
        description="Reports snapshot the measured performance of one site for one period."
        action={<button type="button" className="btn-primary" onClick={() => onNavigate('dashboard')}>Go to dashboard</button>}
      />
    );
  }

  const openReport = detail.data?.report ?? null;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Reports" value={formatNumber(reports.length)} icon={FileText} hint={activeSite?.name} />
        <StatTile
          label="Latest"
          value={reports[0] ? relativeTime(reports[0].createdAt) : '—'}
          icon={Calendar}
          hint={reports[0] ? reports[0].period?.from : 'none generated yet'}
        />
        <StatTile
          label="Email delivery"
          value={email.ok ? 'Ready' : 'Not set'}
          icon={Mail}
          hint={email.ok ? 'SMTP configured' : 'Set SMTP_* variables'}
        />
        <StatTile
          label="Has data"
          value={reports.filter((report) => report.data?.hasData).length}
          icon={Chart}
          hint="reports with Google rows"
        />
      </section>

      <Card
        title="Generated reports"
        description="Immutable snapshots — regenerate rather than editing a sent report."
        icon={FileText}
        actions={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => list.refetch()} disabled={list.loading}>
              <Refresh size={12} className={list.loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Plus size={13} /> Generate
            </button>
          </>
        }
      >
        {list.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 skeleton" />)}
          </div>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : !reports.length ? (
          <EmptyState
            compact
            icon={FileText}
            title="No reports yet"
            description="Generate a report to snapshot this period's Search Console and GA4 numbers, then export or email it."
            action={<button type="button" className="btn-secondary btn-sm" onClick={() => setCreateOpen(true)}>Generate report</button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ink">
                      {formatDate(report.period?.from)} → {formatDate(report.period?.to)}
                    </p>
                    <Badge tone={report.type === 'weekly' ? 'brand' : report.type === 'daily' ? 'info' : 'neutral'}>
                      {report.type}
                    </Badge>
                    {report.data?.hasData
                      ? <Badge tone="positive" dot>data</Badge>
                      : <Badge tone="warning">no data</Badge>}
                    {report.deliveryStatus === 'sent' && <Badge tone="positive"><Mail size={9} /> sent</Badge>}
                  </div>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    Generated {formatDateTime(report.createdAt)}
                    {report.data?.searchConsole?.totals
                      ? ` · ${formatNumber(report.data.searchConsole.totals.clicks)} clicks · ${formatNumber(report.data.analytics?.totals?.sessions)} sessions`
                      : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setPreview(report.id)}>
                    View
                  </button>
                  <a className="btn-ghost btn-sm" href={`/api/reports/${report.id}/export?format=md`} download>
                    <Download size={11} /> MD
                  </a>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={!email.ok}
                    onClick={() => setDelivering(report)}
                  >
                    <Mail size={11} /> Email
                  </button>
                  <button type="button" className="btn-icon" onClick={() => remove(report)} aria-label="Delete report">
                    <Trash size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!email.ok && (
        <Notice tone="info" icon={Info} title="Email delivery is optional">
          Set <code className="font-mono">SMTP_HOST</code>, <code className="font-mono">SMTP_USER</code>,{' '}
          <code className="font-mono">SMTP_PASS</code> and <code className="font-mono">EMAIL_FROM</code> in the
          server <code className="font-mono">.env</code> to email reports. Until then the export links still work —
          nothing is marked as sent.
        </Notice>
      )}

      {openReport && (
        <Modal
          open
          onClose={() => setPreview(null)}
          title={`Report ${openReport.period.from} → ${openReport.period.to}`}
          description={`${openReport.data.site.name} · generated ${formatDateTime(openReport.createdAt)}`}
          size="max-w-2xl"
          footer={
            <div className="flex justify-end gap-2">
              <a className="btn-secondary" href={`/api/reports/${openReport.id}/export?format=md`} download>
                <Download size={13} /> Markdown
              </a>
              <a className="btn-primary" href={`/api/reports/${openReport.id}/export?format=json`} download>
                <Download size={13} /> JSON
              </a>
            </div>
          }
        >
          <ReportBody report={openReport} />
        </Modal>
      )}

      <GenerateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        siteId={siteId}
        onCreated={(report) => { list.refetch(); setPreview(report.id); }}
      />
      <DeliverModal
        open={Boolean(delivering)}
        onClose={() => setDelivering(null)}
        report={delivering}
        onSent={() => { list.refetch(); setDelivering(null); }}
      />
    </div>
  );
}

function ReportBody({ report }) {
  const gsc = report.data.searchConsole?.totals ?? {};
  const ga4 = report.data.analytics?.totals ?? {};
  return (
    <div className="space-y-4">
      {!report.data.hasData && (
        <Notice tone="warning" icon={AlertCircle} title="No Google data in this period">
          The snapshot is accurate — it simply contains zeros because no Search Console or GA4 rows were stored
          for these dates. Sync and regenerate.
        </Notice>
      )}

      <section className="grid gap-2 sm:grid-cols-4">
        <Mini label="Clicks" value={formatNumber(gsc.clicks)} />
        <Mini label="Impressions" value={formatNumber(gsc.impressions)} />
        <Mini label="CTR" value={formatPercent(gsc.ctr)} />
        <Mini label="Position" value={gsc.position ? gsc.position.toFixed(1) : '—'} />
      </section>

      <section className="grid gap-2 sm:grid-cols-3">
        <Mini label="Sessions" value={formatNumber(ga4.sessions)} />
        <Mini label="Active users" value={formatNumber(ga4.activeUsers)} />
        <Mini label="Engagement" value={formatPercent(ga4.engagementRate)} />
      </section>

      {report.data.searchConsole?.topQueries?.length > 0 && (
        <div>
          <p className="label mb-1.5">Top queries</p>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="table-base">
              <thead><tr><th>Query</th><th className="text-right">Clicks</th><th className="text-right">Position</th></tr></thead>
              <tbody>
                {report.data.searchConsole.topQueries.slice(0, 8).map((row) => (
                  <tr key={row.key}>
                    <td className="max-w-[300px] truncate text-[11.5px]">{row.key}</td>
                    <td className="text-right font-mono text-[11px]">{formatNumber(row.clicks)}</td>
                    <td className="text-right font-mono text-[11px]">{row.position?.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.audit && (
        <div className="rounded-lg border border-line bg-sunken px-3 py-2">
          <p className="text-[11.5px] text-muted">
            Latest audit score <span className="font-mono font-semibold text-ink">{report.audit.score?.value ?? '—'}/100</span>
            {' '}with {report.audit.summary?.total ?? 0} issue(s), recorded {relativeTime(report.audit.startedAt)}.
          </p>
        </div>
      )}

      <p className="text-[10.5px] leading-relaxed text-faint">
        Clicks and impressions are Google Search Console numbers. Sessions come from GA4 and cover all
        channels, so the two are not directly comparable.
      </p>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div className="rounded-lg border border-line bg-sunken px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function GenerateModal({ open, onClose, siteId, onCreated }) {
  const { toast } = useApp();
  const [days, setDays] = useState('28');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { report } = await post('/reports', { siteId, days: Number(days) });
      toast('Report generated', 'success');
      onCreated(report);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate report"
      description="Snapshots the current stored data for the selected period."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="generate-report-form" className="btn-primary" disabled={saving}>
            {saving ? 'Generating…' : 'Generate'}
          </button>
        </div>
      }
    >
      <form id="generate-report-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Period">
          <Select
            ariaLabel="Report period"
            value={days}
            onChange={setDays}
            options={[
              { value: '1', label: 'Last 24 hours' },
              { value: '7', label: 'Last 7 days' },
              { value: '28', label: 'Last 28 days' },
              { value: '90', label: 'Last 90 days' },
              { value: '180', label: 'Last 180 days' },
            ]}
          />
        </Field>
        <Notice tone="info" icon={Info}>
          The report reads only what is already stored. Sync Google first if the period shows no data.
        </Notice>
        {error && <p className="text-[12px] text-negative">{error}</p>}
      </form>
    </Modal>
  );
}

function DeliverModal({ open, onClose, report, onSent }) {
  const { toast } = useApp();
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await post(`/reports/${report.id}/deliver`, { to });
      toast(`Report emailed to ${to}`, 'success');
      onSent();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Email this report"
      description={report ? `${report.period.from} → ${report.period.to}` : ''}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="deliver-form" className="btn-primary" disabled={sending || !to}>
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      }
    >
      <form id="deliver-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Recipient email">
          <input type="email" value={to} onChange={(event) => setTo(event.target.value)} className="input" placeholder="you@company.com" autoFocus required />
        </Field>
        <p className="text-[11px] leading-relaxed text-faint">
          Delivered through your configured SMTP server. The report is never sent anywhere else.
        </p>
        {error && <p className="text-[12px] text-negative">{error}</p>}
      </form>
    </Modal>
  );
}
