import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { get, put } from '../lib/api.js';
import { Card, Badge, Field, InlineCode, Toggle, Modal } from '../components/ui.jsx';
import {
  Settings as SettingsIcon,
  Shield,
  Server,
  Globe,
  Info,
  CheckCircle,
  Refresh,
  Lock,
  Layers,
} from '../components/Icons.jsx';
import { relativeTime, truncate } from '../lib/format.js';

export default function Settings() {
  const { boot, sites, toast, refreshBoot, theme, toggleTheme } = useApp();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const app = boot?.app ?? {};

  useEffect(() => {
    get('/settings')
      .then((data) => setForm(data.settings ?? {}))
      .catch((error) => toast(error.message, 'error'));
  }, [toast]);

  const loadDiagnostics = async () => {
    try {
      const data = await get('/diagnostics');
      setDiagnostics(data);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  useEffect(() => {
    loadDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { settings } = await put('/settings', {
        maxPages: Number(form.maxPages),
        maxDepth: Number(form.maxDepth),
        concurrency: Number(form.concurrency),
        requestTimeoutMs: Number(form.requestTimeoutMs),
        retainDays: Number(form.retainDays),
        respectRobots: Boolean(form.respectRobots),
        checkExternalLinks: Boolean(form.checkExternalLinks),
        followRedirects: Boolean(form.followRedirects),
        renderPages: Boolean(form.renderPages),
        renderLimit: Number(form.renderLimit),
      });
      setForm(settings);
      toast('Settings saved', 'success');
      await refreshBoot();
      loadDiagnostics();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return (
      <div className="space-y-4">
        <div className="card h-48 skeleton" />
        <div className="card h-64 skeleton" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Crawl limits" description="Applied to every technical audit unless overridden per run." icon={SettingsIcon}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Maximum pages" hint="Hard cap per crawl">
              <input
                type="number" min="1" max="200"
                value={form.maxPages ?? 25}
                onChange={(event) => setForm({ ...form, maxPages: event.target.value })}
                className="input"
              />
            </Field>
            <Field label="Maximum depth" hint="Link levels from the start URL">
              <input
                type="number" min="1" max="10"
                value={form.maxDepth ?? 3}
                onChange={(event) => setForm({ ...form, maxDepth: event.target.value })}
                className="input"
              />
            </Field>
            <Field label="Concurrency" hint="Parallel requests">
              <input
                type="number" min="1" max="16"
                value={form.concurrency ?? 4}
                onChange={(event) => setForm({ ...form, concurrency: event.target.value })}
                className="input"
              />
            </Field>
            <Field label="Request timeout" hint="Milliseconds per page">
              <input
                type="number" min="3000" max="120000" step="1000"
                value={form.requestTimeoutMs ?? 20000}
                onChange={(event) => setForm({ ...form, requestTimeoutMs: event.target.value })}
                className="input"
              />
            </Field>
            <Field label="Render limit" hint="Pages passed to Chromium when enabled">
              <input
                type="number" min="1" max="10"
                value={form.renderLimit ?? 3}
                onChange={(event) => setForm({ ...form, renderLimit: event.target.value })}
                className="input"
              />
            </Field>
            <Field label="Data retention" hint="Days to keep events and metrics">
              <input
                type="number" min="7" max="730"
                value={form.retainDays ?? app.retentionDays ?? 90}
                onChange={(event) => setForm({ ...form, retainDays: event.target.value })}
                className="input"
              />
            </Field>
          </div>

          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <Toggle
              checked={form.respectRobots !== false}
              onChange={(value) => setForm({ ...form, respectRobots: value })}
              label="Respect robots.txt"
              description="Skip disallowed paths during crawls. Strongly recommended."
            />
            <Toggle
              checked={Boolean(form.checkExternalLinks)}
              onChange={(value) => setForm({ ...form, checkExternalLinks: value })}
              label="Check external links"
              description="Send a HEAD request to outbound links to find dead references."
            />
            <Toggle
              checked={form.followRedirects !== false}
              onChange={(value) => setForm({ ...form, followRedirects: value })}
              label="Follow redirects"
              description="Record redirect chains and crawl the final destination."
            />
            <Toggle
              checked={Boolean(form.renderPages)}
              onChange={(value) => setForm({ ...form, renderPages: value })}
              label="Rendered crawl"
              description="Use headless Chromium for JavaScript-rendered pages. Requires Chromium on the server."
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-[11px] text-faint">
              Crawling is limited to sites you register. The SSRF guard blocks private and loopback hosts.
            </p>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </Card>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card title="Appearance & session" description="Local preferences for this browser." icon={Layers}>
          <div className="space-y-4">
            <Toggle
              checked={theme === 'dark'}
              onChange={toggleTheme}
              label="Dark mode"
              description="Saved in local storage for this browser."
            />
            <div className="divider" />
            <dl className="space-y-1.5 text-[11.5px]">
              <Row label="Version" value={app.version ?? '—'} />
              <Row label="Environment" value={app.env ?? '—'} />
              <Row label="Timezone" value={app.timezone ?? 'UTC'} />
              <Row label="Retention" value={`${app.retentionDays ?? '—'} days`} />
              <Row label="Public URL" value={app.publicUrl ?? 'not set'} mono />
            </dl>
            {!app.publicUrl && (
              <p className="text-[10.5px] leading-relaxed text-faint">
                Set <InlineCode>PUBLIC_URL</InlineCode> to your https domain so OAuth redirects and secure
                cookies work correctly in production.
              </p>
            )}
          </div>
        </Card>

        <Card title="Security" description="Access control and credential handling." icon={Shield}>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-medium text-ink">Dashboard authentication</p>
                <p className="mt-0.5 text-[10.5px] text-muted">
                  {app.authDisabled
                    ? 'Currently disabled — anyone who can reach this port has full access.'
                    : 'Password protected with an HttpOnly session cookie.'}
                </p>
              </div>
              <Badge tone={app.authDisabled ? 'negative' : 'positive'} dot>
                {app.authDisabled ? 'disabled' : 'enabled'}
              </Badge>
            </div>
            <div className="divider" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-medium text-ink">Token vault</p>
                <p className="mt-0.5 text-[10.5px] text-muted">
                  OAuth tokens are encrypted with AES-256-GCM. Key source: {boot?.integrations?.vault?.source ?? 'unknown'}.
                </p>
              </div>
              <Badge tone={boot?.integrations?.vault?.configured ? 'positive' : 'warning'} dot>
                {boot?.integrations?.vault?.configured ? 'ready' : 'fallback'}
              </Badge>
            </div>
            <div className="divider" />
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPasswordOpen(true)}>
              <Lock size={12} /> Password guidance
            </button>
          </div>
        </Card>
      </section>

      <Card
        title="Diagnostics"
        description="Live snapshot of the running server."
        icon={Server}
        actions={
          <button type="button" className="btn-secondary btn-sm" onClick={loadDiagnostics}>
            <Refresh size={12} /> Refresh
          </button>
        }
      >
        {!diagnostics ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-8 skeleton" />)}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <dl className="space-y-1.5 text-[11.5px]">
              <Row label="App" value={`${diagnostics.app.name} ${diagnostics.app.version}`} />
              <Row label="Node" value={diagnostics.node} mono />
              <Row label="Store" value={diagnostics.store.engine ?? 'json'} />
              <Row label="Uptime" value={formatDurationSeconds(diagnostics.app.uptimeSeconds)} />
              <Row label="Scheduler" value={diagnostics.scheduler.enabled ? `on · ${diagnostics.scheduler.tickSeconds}s tick` : 'off'} />
              <Row label="Active jobs" value={String(diagnostics.scheduler.running)} />
            </dl>
            <dl className="space-y-1.5 text-[11.5px]">
              <Row label="Browser" value={diagnostics.browser?.status ?? 'unknown'} />
              <Row label="Chromium" value={diagnostics.browser?.executable ? truncate(diagnostics.browser.executable, 34) : 'not found'} mono />
              <Row label="Google" value={diagnostics.integrations.google.status} />
              <Row label="Email" value={diagnostics.integrations.email.ok ? 'configured' : diagnostics.integrations.email.reason ?? 'missing'} />
              <Row label="Secure cookies" value={diagnostics.security.secureCookies ? 'yes' : 'no'} />
              <Row label="Trust proxy" value={diagnostics.security.trustProxy ? 'yes' : 'no'} />
            </dl>
          </div>
        )}
      </Card>

      <Card title="Sites" description="Registered properties and their crawl state." icon={Globe}>
        {!sites.length ? (
          <p className="text-[11.5px] text-muted">No sites yet. Add one from the dashboard.</p>
        ) : (
          <div className="scroll-x">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Origin</th>
                  <th className="text-right">Last crawl</th>
                  <th className="text-right">Last sync</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id}>
                    <td className="text-[12px] font-medium text-ink">{site.name}</td>
                    <td className="font-mono text-[10.5px] text-muted">{site.origin}</td>
                    <td className="text-right text-[11px] text-muted">{relativeTime(site.lastAuditAt)}</td>
                    <td className="text-right text-[11px] text-muted">{relativeTime(site.lastSyncAt)}</td>
                    <td className="text-right">
                      <Badge tone={site.lastSyncStatus === 'error' ? 'negative' : site.lastSyncStatus === 'success' ? 'positive' : 'neutral'}>
                        {site.lastSyncStatus ?? 'pending'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Data & privacy" description="What is stored and how long it is kept." icon={Info}>
        <ul className="space-y-2 text-[11.5px] leading-relaxed text-muted">
          {[
            'Google metrics are stored per site, dimension and day — aggregated rows only, never raw visitor logs.',
            'Screenshots from rendered audits are deleted after the retention window.',
            'Audit records and reports can be deleted individually at any time.',
            'OAuth refresh tokens stay encrypted and are removed when you disconnect.',
            'No data is sent to any third party other than the Google APIs you authorise.',
          ].map((text) => (
            <li key={text} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-positive"><CheckCircle size={12} /></span>
              {text}
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Password guidance"
        description="Visitor uses a single administrator password from the environment."
        footer={<button type="button" className="btn-secondary" onClick={() => setPasswordOpen(false)}>Close</button>}
      >
        <div className="space-y-3 text-[12px] leading-relaxed text-muted">
          <p>
            Set <InlineCode>APP_PASSWORD</InlineCode> in the server <InlineCode>.env</InlineCode> file to a long
            random string (32+ characters). Generate one with:
          </p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-sunken p-2.5 font-mono text-[10.5px] text-muted">
            openssl rand -base64 32
          </pre>
          <p>
            Sessions last <InlineCode>SESSION_TTL_DAYS</InlineCode> days and use an HttpOnly, SameSite=Lax
            cookie. Serve the app over HTTPS and set <InlineCode>PUBLIC_URL</InlineCode> so the cookie is
            marked Secure.
          </p>
          <p>
            Six failed attempts from one IP trigger a 15-minute lockout. Authentication can be disabled for
            local development only via <InlineCode>AUTH_DISABLED=true</InlineCode> — never on a public server.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`truncate ${mono ? 'font-mono text-[10.5px]' : ''} text-ink`} title={String(value)}>{value}</dd>
    </div>
  );
}

function formatDurationSeconds(seconds) {
  const total = Number(seconds) || 0;
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  if (total < 86400) return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
  return `${Math.floor(total / 86400)}d ${Math.floor((total % 86400) / 3600)}h`;
}
