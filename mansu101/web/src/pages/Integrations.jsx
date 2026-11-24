import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { get, post } from '../lib/api.js';
import {
  Card,
  Notice,
  Badge,
  EmptyState,
  Field,
  InlineCode,
  Select,
  Modal,
} from '../components/ui.jsx';
import {
  Plug,
  Shield,
  CheckCircle,
  AlertCircle,
  Info,
  Mail,
  Refresh,
  Globe,
  Search,
  Chart,
  Layers,
} from '../components/Icons.jsx';
import { formatDateTime, relativeTime, truncate } from '../lib/format.js';

export default function Integrations() {
  const { boot, sites, refreshBoot, toast } = useApp();
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState(null);
  const [selectOpen, setSelectOpen] = useState(false);

  const google = boot?.integrations?.google ?? { status: 'disconnected', configured: false };
  const email = boot?.integrations?.email ?? { ok: false };
  const vault = boot?.integrations?.vault ?? { configured: false };

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await get('/integrations/google/authorize?redirect=/integrations');
      const popup = window.open(url, 'visitor-google-oauth', 'width=520,height=680');
      if (!popup) {
        window.location.href = url;
        return;
      }
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          refreshBoot();
        }
      }, 900);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setConnecting(false);
    }
  };

  const refreshProperties = async () => {
    setRefreshing(true);
    try {
      await post('/integrations/google/properties/refresh', {});
      await refreshBoot();
      toast('Properties refreshed', 'success');
    } catch (requestError) {
      toast(requestError.message, 'error', 7000);
    } finally {
      setRefreshing(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await post('/integrations/google/disconnect', {});
      await refreshBoot();
      toast('Google account disconnected', 'success');
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  const gscProperties = google.properties?.gsc ?? [];
  const ga4Properties = google.properties?.ga4 ?? [];

  return (
    <div className="space-y-4">
      <section className="grid gap-3 lg:grid-cols-3">
        <Card
          title="Google Search Console"
          description="Clicks, impressions, CTR, position and query data."
          icon={Search}
          actions={
            google.status === 'connected'
              ? <Badge tone="positive" dot>connected</Badge>
              : <Badge tone={google.configured ? 'warning' : 'neutral'}>
                {google.configured ? 'not connected' : 'needs credentials'}
              </Badge>
          }
        >
          <div className="space-y-3">
            {google.status === 'connected' ? (
              <>
                <dl className="space-y-1.5 text-[11.5px]">
                  <Row label="Account" value={google.email ?? '—'} />
                  <Row label="Connected" value={formatDateTime(google.connectedAt)} />
                  <Row label="Last sync" value={google.lastSyncAt ? relativeTime(google.lastSyncAt) : 'never'} />
                  <Row label="Properties" value={`${gscProperties.length} found`} />
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="btn-secondary btn-sm" onClick={refreshProperties} disabled={refreshing}>
                    <Refresh size={11} className={refreshing ? 'animate-spin' : ''} /> Refresh
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectOpen(true)}>
                    <Layers size={11} /> Choose properties
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={disconnect} disabled={disconnecting}>
                    Disconnect
                  </button>
                </div>
              </>
            ) : google.configured ? (
              <>
                <p className="text-[11.5px] leading-relaxed text-muted">
                  Credentials are present. Authorise the Google account that owns your Search Console
                  properties to start importing data.
                </p>
                <button type="button" className="btn-primary btn-sm w-full" onClick={connect} disabled={connecting}>
                  <Plug size={13} /> {connecting ? 'Opening Google…' : 'Connect Google account'}
                </button>
              </>
            ) : (
              <>
                <Notice tone="warning" icon={AlertCircle} title="Credentials missing">
                  Set <InlineCode>GOOGLE_CLIENT_ID</InlineCode>, <InlineCode>GOOGLE_CLIENT_SECRET</InlineCode> and{' '}
                  <InlineCode>GOOGLE_REDIRECT_URI</InlineCode> in the server <InlineCode>.env</InlineCode>, then restart.
                </Notice>
                <p className="text-[11px] leading-relaxed text-faint">
                  Create an OAuth 2.0 Web application in Google Cloud Console, enable the Search Console API
                  and Google Analytics Data API, and add the redirect URI {google.redirectUri ? <InlineCode>{google.redirectUri}</InlineCode> : 'shown in the README'}.
                </p>
              </>
            )}
            {google.lastError && (
              <p className="rounded-lg border border-negative/25 bg-negative/5 px-2 py-1.5 text-[10.5px] text-negative">
                {google.lastError}
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Google Analytics 4"
          description="Sessions, users, engagement and acquisition."
          icon={Chart}
          actions={
            google.selected?.ga4
              ? <Badge tone="positive" dot>linked</Badge>
              : <Badge tone="neutral">not linked</Badge>
          }
        >
          <div className="space-y-3">
            <dl className="space-y-1.5 text-[11.5px]">
              <Row label="Uses auth" value="Same OAuth connection" />
              <Row label="Property" value={google.selected?.ga4 || 'none selected'} mono />
              <Row label="Available" value={`${ga4Properties.length} propert${ga4Properties.length === 1 ? 'y' : 'ies'}`} />
            </dl>
            {google.status === 'connected' ? (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectOpen(true)}>
                <Layers size={11} /> Choose GA4 property
              </button>
            ) : (
              <p className="text-[11px] leading-relaxed text-faint">
                GA4 uses the same Google connection as Search Console. Connect above first.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Email delivery"
          description="Optional SMTP relay for scheduled reports."
          icon={Mail}
          actions={email.ok ? <Badge tone="positive" dot>configured</Badge> : <Badge tone="neutral">not configured</Badge>}
        >
          {email.ok ? (
            <p className="text-[11.5px] leading-relaxed text-muted">
              SMTP settings are present. Report emails will actually be sent — check the report detail to
              confirm delivery status.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11.5px] leading-relaxed text-muted">
                Set these variables to enable emailed reports:
              </p>
              <ul className="space-y-1 font-mono text-[10.5px] text-faint">
                {['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'].map((variable) => (
                  <li key={variable}><InlineCode>{variable}</InlineCode></li>
                ))}
              </ul>
              <p className="text-[10.5px] text-faint">{email.reason ? `Currently: ${email.reason}` : ''}</p>
            </div>
          )}
        </Card>
      </section>

      <Card title="Site ↔ property mapping" description="Each site reads from exactly one Search Console property and one GA4 property." icon={Globe}>
        {!sites.length ? (
          <EmptyState
            compact
            icon={Globe}
            title="No sites registered"
            description="Add a site first, then map it to its Google properties."
          />
        ) : (
          <div className="scroll-x">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Search Console property</th>
                  <th>GA4 property</th>
                  <th className="text-right">Last sync</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id}>
                    <td>
                      <p className="text-[12.5px] font-medium text-ink">{site.name}</p>
                      <p className="font-mono text-[10px] text-faint">{site.url}</p>
                    </td>
                    <td className="font-mono text-[11px]">
                      {site.gscProperty || <span className="text-warning">not mapped</span>}
                    </td>
                    <td className="font-mono text-[11px]">
                      {site.ga4Property || <span className="text-faint">not mapped</span>}
                    </td>
                    <td className="text-right text-[11px] text-muted">{relativeTime(site.lastSyncAt)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setSelectOpen(true)}
                      >
                        Map
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card title="Security posture" description="How credentials and access are handled." icon={Shield}>
          <ul className="space-y-2.5 text-[11.5px]">
            <SecurityRow
              ok={vault.configured}
              title="OAuth tokens encrypted at rest"
              detail={`AES-256-GCM · key source: ${vault.source ?? 'unknown'}`}
            />
            <SecurityRow
              ok
              title="Read-only Google scopes"
              detail="webmasters.readonly + analytics.readonly — Visitor cannot modify your properties."
            />
            <SecurityRow
              ok
              title="Same-origin API guard"
              detail="State-changing requests from another origin are rejected; login attempts are rate limited."
            />
            <SecurityRow
              ok={!boot?.app?.authDisabled}
              title="Dashboard authentication"
              detail={boot?.app?.authDisabled
                ? 'AUTH_DISABLED is on — turn it off before exposing this server.'
                : 'Password login with an HttpOnly session cookie.'}
            />
            <SecurityRow
              ok
              title="Crawler SSRF guard"
              detail="Crawls refuse private hosts, loopback and link-local addresses unless explicitly allowed."
            />
          </ul>
        </Card>

        <Card title="What this platform will not do" description="Deliberate limits, stated plainly." icon={Info}>
          <ul className="space-y-2 text-[11.5px] leading-relaxed text-muted">
            {[
              'Generate fake visits, clicks or impressions — every number comes from Google or your own crawl.',
              'Click your ads or manipulate search results to influence ranking.',
              'Rotate proxies to imitate real users or bypass CAPTCHAs.',
              'Crawl sites you have not registered and authorised.',
              'Report a metric it cannot verify. Missing data is shown as missing, never estimated.',
            ].map((text) => (
              <li key={text} className="flex gap-2">
                <span className="mt-0.5 shrink-0 text-positive"><CheckCircle size={12} /></span>
                {text}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <PropertyModal
        open={selectOpen}
        onClose={() => setSelectOpen(false)}
        gscProperties={googleProperties(gscProperties)}
        ga4Properties={ga4Properties}
        sites={sites}
        onSaved={async () => { await refreshBoot(); toast('Property selection saved', 'success'); setSelectOpen(false); }}
      />

      {error && (
        <Notice tone="negative" icon={AlertCircle} title="Connection failed">{error}</Notice>
      )}
    </div>
  );
}

function googleProperties(list) {
  return list.map((item) => ({
    value: item.siteUrl ?? item.value ?? String(item),
    label: item.siteUrl ?? item.value ?? String(item),
    permission: item.permissionLevel,
  }));
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`truncate ${mono ? 'font-mono text-[10.5px]' : ''} text-ink`} title={String(value)}>{value}</dd>
    </div>
  );
}

function SecurityRow({ ok, title, detail }) {
  return (
    <li className="flex gap-2.5">
      <span className={`mt-0.5 shrink-0 ${ok ? 'text-positive' : 'text-warning'}`}>
        {ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
      </span>
      <span>
        <span className="block font-medium text-ink">{title}</span>
        <span className="block text-[10.5px] leading-relaxed text-muted">{detail}</span>
      </span>
    </li>
  );
}

function PropertyModal({ open, onClose, gscProperties, ga4Properties, sites, onSaved }) {
  const { toast } = useApp();
  const [siteId, setSiteId] = useState('');
  const [gsc, setGsc] = useState('');
  const [ga4, setGa4] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSiteId(sites[0]?.id ?? '');
  }, [open, sites]);

  const save = async (event) => {
    event.preventDefault();
    if (!siteId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/sites/${siteId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gscProperty: gsc || null, ga4Property: ga4 || null }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }
      await onSaved();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Map properties to a site"
      description="Choose which Search Console and GA4 property belong to the selected site."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="property-form" className="btn-primary" disabled={saving || !siteId}>
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      }
    >
      <form id="property-form" onSubmit={save} className="space-y-3.5">
        <Field label="Site">
          <Select
            ariaLabel="Site"
            value={siteId}
            onChange={setSiteId}
            options={sites.map((site) => ({ value: site.id, label: `${site.name} · ${site.url}` }))}
          />
        </Field>

        <Field label="Search Console property" hint={gscProperties.length ? undefined : 'No properties discovered — connect Google first'}>
          <select className="select" value={gsc} onChange={(event) => setGsc(event.target.value)}>
            <option value="">— not mapped —</option>
            {gscProperties.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}{item.permission ? ` (${item.permission})` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="GA4 property" hint={ga4Properties.length ? undefined : 'No GA4 properties discovered'}>
          <select className="select" value={ga4} onChange={(event) => setGa4(event.target.value)}>
            <option value="">— not mapped —</option>
            {ga4Properties.map((item) => (
              <option key={item.property ?? item.value} value={item.property ?? item.value}>
                {item.displayName ?? item.name ?? item.property}
                {item.property ? ` · ${item.property}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Notice tone="info" icon={Info}>
          Mapping only tells Visitor which property to read. It does not grant access — the connected Google
          account must already have permission on that property.
        </Notice>
      </form>
    </Modal>
  );
}
