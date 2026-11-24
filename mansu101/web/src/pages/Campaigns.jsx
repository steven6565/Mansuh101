import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { post, patch, del, queryString } from '../lib/api.js';
import {
  Card,
  StatTile,
  EmptyState,
  ErrorState,
  Badge,
  Modal,
  Field,
  Notice,
  SearchInput,
  InlineCode,
} from '../components/ui.jsx';
import {
  Megaphone,
  Plus,
  Trash,
  Copy,
  Link2,
  AlertCircle,
  Refresh,
  MousePointer,
  Chart,
  Globe,
  Info,
  External,
} from '../components/Icons.jsx';
import { formatNumber, formatPercent } from '../lib/format.js';

const MEDIUMS = [
  { value: 'social', label: 'Social' },
  { value: 'email', label: 'Email' },
  { value: 'cpc', label: 'Paid search' },
  { value: 'referral', label: 'Referral' },
  { value: 'affiliate', label: 'Affiliate' },
  { value: 'display', label: 'Display' },
];

export default function Campaigns({ onNavigate }) {
  const { siteId, activeSite, range, integrations, toast } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');

  const listPath = `/campaigns${queryString({ siteId })}`;
  const list = useApi(listPath, { enabled: Boolean(siteId) });

  const perfPath = siteId
    ? `/sites/${siteId}/campaigns/performance?${queryString({ days: range.days, from: range.from, to: range.to })}`
    : null;
  const perf = useApi(perfPath ?? '/bootstrap', { enabled: Boolean(perfPath) });

  useEffect(() => { setSearch(''); }, [siteId]);

  const campaigns = list.data?.campaigns ?? [];
  const performance = perf.data?.campaigns ?? [];
  const google = integrations?.google ?? { status: 'disconnected' };

  const merged = useMemo(() => {
    const byId = new Map(performance.map((item) => [item.id, item]));
    return campaigns.map((campaign) => {
      const measured = byId.get(campaign.id);
      return { ...campaign, performance: measured?.performance ?? null };
    });
  }, [campaigns, performance]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return merged;
    return merged.filter((item) => `${item.name} ${item.source} ${item.medium}`.toLowerCase().includes(needle));
  }, [merged, search]);

  const totals = merged.reduce((acc, item) => ({
    sessions: acc.sessions + (item.performance?.sessions ?? 0),
    users: acc.users + (item.performance?.activeUsers ?? 0),
    conversions: acc.conversions + (item.performance?.conversions ?? 0),
  }), { sessions: 0, users: 0, conversions: 0 });

  const remove = async (item) => {
    try {
      await del(`/campaigns/${item.id}`);
      toast('Campaign removed', 'success');
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const toggleStatus = async (item) => {
    try {
      await patch(`/campaigns/${item.id}`, { status: item.status === 'active' ? 'paused' : 'active' });
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  if (!siteId) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No site selected"
        description="Campaigns measure the traffic you actually send to a site using UTM parameters and GA4 attribution."
        action={<button type="button" className="btn-primary" onClick={() => onNavigate('dashboard')}>Go to dashboard</button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Campaigns" value={formatNumber(campaigns.length)} icon={Megaphone} hint={activeSite?.name} />
        <StatTile label="Active" value={formatNumber(campaigns.filter((item) => item.status === 'active').length)} icon={Chart} hint="currently running" />
        <StatTile label="Attributed sessions" value={formatNumber(totals.sessions)} icon={MousePointer} hint="GA4 · this range" />
        <StatTile label="Conversions" value={formatNumber(totals.conversions)} icon={Globe} hint="GA4 · this range" />
      </section>

      <Notice tone="info" icon={Info} title="How measurement works here">
        Visitor does not generate traffic. Each campaign gives you a tagged URL; when real people use it, GA4
        records the session against that <InlineCode>utm_source</InlineCode> / <InlineCode>utm_campaign</InlineCode>,
        and that measured row is what you see below.
      </Notice>

      <Card
        title="Campaigns"
        description="Tagged links you distribute yourself — social posts, newsletters, partner placements."
        icon={Megaphone}
        actions={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => { list.refetch(); perf.refetch(); }} disabled={list.loading}>
              <Refresh size={12} className={list.loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Plus size={13} /> New campaign
            </button>
          </>
        }
      >
        <div className="mb-3 flex justify-end">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter campaigns…" className="w-[176px]" />
        </div>

        {list.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 skeleton" />)}
          </div>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : !filtered.length ? (
          <EmptyState
            compact
            icon={Megaphone}
            title={campaigns.length ? 'No campaigns match' : 'No campaigns yet'}
            description={campaigns.length
              ? 'Clear the filter to see all campaigns.'
              : 'Create a campaign to get a UTM-tagged URL plus honest attribution once traffic arrives.'}
            action={<button type="button" className="btn-secondary btn-sm" onClick={() => setCreateOpen(true)}>New campaign</button>}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((campaign) => (
              <div key={campaign.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-ink">{campaign.name}</p>
                      <Badge tone={campaign.status === 'active' ? 'positive' : campaign.status === 'paused' ? 'warning' : 'neutral'} dot>
                        {campaign.status}
                      </Badge>
                      <Badge tone="brand">{campaign.medium}</Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10.5px] text-muted" title={campaign.destination}>
                      {campaign.destination}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => toggleStatus(campaign)}>
                      {campaign.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                    <button type="button" className="btn-icon" onClick={() => setEditing(campaign)} aria-label="Edit campaign">
                      <Link2 size={13} />
                    </button>
                    <button type="button" className="btn-icon" onClick={() => remove(campaign)} aria-label="Delete campaign">
                      <Trash size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted" title={campaign.trackingUrl}>
                    {campaign.trackingUrl}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm shrink-0"
                    onClick={() => navigator.clipboard?.writeText(campaign.trackingUrl)
                      .then(() => toast('Tracking URL copied', 'success'))
                      .catch(() => toast('Could not copy — select the URL manually', 'warn'))}
                  >
                    <Copy size={11} /> Copy
                  </button>
                  <a href={campaign.trackingUrl} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm shrink-0">
                    <External size={11} /> Open
                  </a>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <CampaignStat label="Sessions" value={campaign.performance ? formatNumber(campaign.performance.sessions) : '—'} />
                  <CampaignStat label="Users" value={campaign.performance ? formatNumber(campaign.performance.activeUsers) : '—'} />
                  <CampaignStat label="Engagement" value={campaign.performance ? formatPercent(campaign.performance.engagementRate) : '—'} />
                  <CampaignStat label="Conversions" value={campaign.performance ? formatNumber(campaign.performance.conversions) : '—'} />
                </div>

                {!campaign.performance && google.status === 'connected' && (
                  <p className="mt-2 text-[10.5px] text-faint">
                    No GA4 rows yet for <InlineCode>utm_source={campaign.source}</InlineCode> +
                    <InlineCode>utm_campaign={campaign.campaignSlug}</InlineCode> in this range.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {google.status !== 'connected' && (
        <Notice tone="warning" icon={AlertCircle} title="GA4 not connected — attribution unavailable">
          Campaign links still work. Visit them in GA4 directly, or connect Google to see sessions and
          conversions measured per campaign.{' '}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onNavigate('integrations')}>
            Connect Google
          </button>
        </Notice>
      )}

      <CampaignModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        siteId={siteId}
        siteUrl={activeSite?.url}
        onSaved={() => list.refetch()}
      />
      <CampaignModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        siteId={siteId}
        siteUrl={activeSite?.url}
        campaign={editing}
        onSaved={() => { setEditing(null); list.refetch(); }}
      />
    </div>
  );
}

function CampaignStat({ label, value }) {
  return (
    <div className="rounded-md border border-line/70 bg-elevated px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <p className="font-mono text-[13px] font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function CampaignModal({ open, onClose, siteId, siteUrl, campaign, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(campaign
      ? {
        name: campaign.name,
        destination: campaign.destination,
        source: campaign.source,
        medium: campaign.medium,
        slug: campaign.campaignSlug,
        notes: campaign.notes ?? '',
        status: campaign.status,
      }
      : {
        name: '',
        destination: siteUrl ?? '',
        source: '',
        medium: 'social',
        slug: '',
        notes: '',
        status: 'active',
      });
    setError(null);
  }, [open, campaign, siteUrl]);

  if (!form) return null;

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (campaign) {
        await patch(`/campaigns/${campaign.id}`, { ...form, campaignSlug: form.slug });
        toast('Campaign updated', 'success');
      } else {
        await post('/campaigns', { ...form, campaignSlug: form.slug, siteId });
        toast('Campaign created', 'success');
      }
      onSaved();
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const slug = form.slug || slugify(form.name);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={campaign ? 'Edit campaign' : 'New campaign'}
      description="A campaign is a tagged link — Visitor measures what GA4 records, it never sends traffic."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="campaign-form" className="btn-primary" disabled={saving || !form.name || !form.destination}>
            {saving ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
          </button>
        </div>
      }
    >
      <form id="campaign-form" onSubmit={save} className="space-y-3.5">
        <Field label="Campaign name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="input" placeholder="Spring newsletter" autoFocus />
        </Field>

        <Field label="Destination URL" hint="The page people land on">
          <input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} className="input font-mono text-[12px]" placeholder="https://example.com/pricing" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="UTM source" hint="e.g. twitter, newsletter">
            <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="input" placeholder="newsletter" />
          </Field>
          <Field label="UTM medium">
            <select className="select" value={form.medium} onChange={(event) => setForm({ ...form, medium: event.target.value })}>
              {MEDIUMS.map((medium) => <option key={medium.value} value={medium.value}>{medium.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="UTM campaign slug" hint={`Generated from the name if left blank: ${slug}`}>
          <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} className="input font-mono text-[12px]" placeholder={slug} />
        </Field>

        <Field label="Notes">
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} className="input" />
        </Field>

        <Notice tone="info" icon={Info}>
          Final URL preview:
          <span className="mt-1 block break-all rounded-md bg-sunken px-2 py-1 font-mono text-[10.5px] text-muted">
            {previewUrl(form, slug)}
          </span>
        </Notice>

        {error && <p className="text-[12px] text-negative">{error}</p>}
      </form>
    </Modal>
  );
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function previewUrl(form, slug) {
  try {
    const url = new URL(form.destination || siteUrlFallback(form));
    url.searchParams.set('utm_source', form.source || 'source');
    url.searchParams.set('utm_medium', form.medium || 'medium');
    url.searchParams.set('utm_campaign', slug || 'campaign');
    return url.toString();
  } catch {
    return 'Enter a valid destination URL to preview the tracking link.';
  }
}

function siteUrlFallback(form) {
  return form.destination || 'https://example.com';
}
