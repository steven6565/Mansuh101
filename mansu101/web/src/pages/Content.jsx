import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { post, patch, del, queryString } from '../lib/api.js';
import {
  Card,
  StatTile,
  Tabs,
  EmptyState,
  ErrorState,
  Badge,
  Modal,
  Field,
  Notice,
  SearchInput,
  Select,
  Collapsible,
} from '../components/ui.jsx';
import {
  FileText,
  Plus,
  Trash,
  Sparkles,
  Link2,
  AlertCircle,
  Refresh,
  Info,
  ClipboardCheck,
  ArrowUpRight,
  Search,
} from '../components/Icons.jsx';
import {
  formatNumber,
  formatDate,
  relativeTime,
  INTENT_META,
  STATUS_META,
  TONE_CLASS,
  truncate,
  pathOf,
} from '../lib/format.js';

const STATUSES = ['idea', 'outline', 'drafting', 'review', 'scheduled', 'published'];

export default function Content({ onNavigate }) {
  const { siteId, activeSite, range, toast } = useApp();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const listPath = `/content${queryString({ siteId })}`;
  const list = useApi(listPath, { enabled: Boolean(siteId) });

  const gapPath = siteId ? `/sites/${siteId}/content/gaps?${queryString({ days: range.days, from: range.from, to: range.to })}` : null;
  const gaps = useApi(gapPath ?? '/bootstrap', { enabled: Boolean(gapPath) });

  useEffect(() => { setStatus('all'); setSearch(''); }, [siteId]);

  const items = list.data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => !needle || `${item.title} ${item.keyword}`.toLowerCase().includes(needle));
  }, [items, status, search]);

  const gapRows = gaps.data?.gaps ?? [];
  const linkRows = gaps.data?.internalLinks ?? [];

  const counts = useMemo(() => {
    const out = { all: items.length };
    for (const value of STATUSES) out[value] = items.filter((item) => item.status === value).length;
    return out;
  }, [items]);

  const updateStatus = async (item, next) => {
    try {
      await patch(`/content/${item.id}`, { status: next });
      toast('Status updated', 'success');
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const remove = async (item) => {
    try {
      await del(`/content/${item.id}`);
      toast('Content item removed', 'success');
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const createFromGap = async (gap) => {
    try {
      await post('/content', {
        siteId,
        keyword: gap.query,
        title: gap.suggestedTitle,
        intent: gap.intent,
        status: 'idea',
        notes: `Detected gap: ${formatNumber(gap.impressions)} impressions at average position ${gap.position.toFixed(1)}.`,
      });
      toast(`Brief created for "${truncate(gap.query, 34)}"`, 'success');
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
        description="Content briefs are attached to a site so they can be derived from its crawled pages and Search Console queries."
        action={<button type="button" className="btn-primary" onClick={() => onNavigate('dashboard')}>Go to dashboard</button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Content items" value={formatNumber(items.length)} icon={FileText} hint={activeSite?.name} />
        <StatTile label="Published" value={formatNumber(counts.published ?? 0)} icon={ClipboardCheck} hint="live on the site" />
        <StatTile label="In progress" value={formatNumber((counts.drafting ?? 0) + (counts.review ?? 0) + (counts.outline ?? 0))} icon={Sparkles} hint="outline → review" />
        <StatTile label="Content gaps" value={formatNumber(gapRows.length)} icon={Search} hint="queries with no dedicated page" />
      </section>

      <Card
        title="Content workflow"
        description="Briefs derived from real queries — a human writes the article, the platform prepares the structure."
        icon={FileText}
        actions={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => list.refetch()} disabled={list.loading}>
              <Refresh size={12} className={list.loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <Plus size={13} /> New brief
            </button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={status}
            onChange={setStatus}
            items={[
              { value: 'all', label: 'All', count: counts.all },
              ...STATUSES.map((value) => ({ value, label: STATUS_META[value]?.label ?? value, count: counts[value] ?? 0 })),
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search briefs…" className="w-[172px]" />
        </div>

        {list.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 skeleton" />)}
          </div>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : !filtered.length ? (
          <EmptyState
            compact
            icon={FileText}
            title={items.length ? 'No briefs match this filter' : 'No content briefs yet'}
            description={items.length
              ? 'Try another status or clear the search.'
              : 'Create a brief from a keyword, or turn a detected content gap into one with a single click.'}
            action={<button type="button" className="btn-secondary btn-sm" onClick={() => setCreateOpen(true)}>New brief</button>}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((item) => (
              <Collapsible
                key={item.id}
                summary={
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink" title={item.title}>{item.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted">
                        <span className={`pill ${TONE_CLASS[STATUS_META[item.status]?.tone ?? 'neutral']}`}>
                          {STATUS_META[item.status]?.label ?? item.status}
                        </span>
                        <Badge tone={(INTENT_META[item.intent] ?? INTENT_META.unknown).tone}>
                          {(INTENT_META[item.intent] ?? INTENT_META.unknown).label}
                        </Badge>
                        <span className="font-mono">{item.wordCountTarget} words target</span>
                        {item.publishDate && <span>· {formatDate(item.publishDate)}</span>}
                        <span>· updated {relativeTime(item.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                }
              >
                <div className="space-y-3">
                  <div>
                    <p className="label mb-1">Meta description</p>
                    <p className="text-[12px] leading-relaxed text-muted">{item.metaDescription || '—'}</p>
                    {item.metaDescription && (
                      <p className={`mt-1 font-mono text-[10px] ${item.metaDescription.length > 160 ? 'text-negative' : 'text-faint'}`}>
                        {item.metaDescription.length} characters
                      </p>
                    )}
                  </div>

                  {item.outline?.length > 0 && (
                    <div>
                      <p className="label mb-1.5">Outline</p>
                      <ol className="space-y-1">
                        {item.outline.map((section, index) => (
                          <li key={`${section}-${index}`} className="flex gap-2 text-[11.5px] text-muted">
                            <span className="w-4 shrink-0 text-right font-mono text-[10px] text-faint">{index + 1}.</span>
                            {section}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {item.internalLinks?.length > 0 && (
                    <div>
                      <p className="label mb-1.5">Internal links</p>
                      <ul className="space-y-1">
                        {item.internalLinks.slice(0, 6).map((link) => (
                          <li key={typeof link === 'string' ? link : link.to} className="truncate font-mono text-[10.5px] text-muted">
                            <Link2 size={10} className="mr-1 inline" />
                            {typeof link === 'string' ? link : `${link.from ?? ''} → ${link.to ?? ''}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                    <Select
                      ariaLabel="Status"
                      className="w-[132px] !py-1 text-[11.5px]"
                      value={item.status}
                      onChange={(next) => updateStatus(item, next)}
                      options={STATUSES.map((value) => ({ value, label: STATUS_META[value]?.label ?? value }))}
                    />
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(item)}>Edit</button>
                    {item.targetUrl && (
                      <a href={item.targetUrl} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm">
                        <ArrowUpRight size={11} /> Open page
                      </a>
                    )}
                    <button type="button" className="btn-danger btn-sm ml-auto" onClick={() => remove(item)}>
                      <Trash size={11} />
                    </button>
                  </div>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Content gaps"
          description="Queries that earn impressions but have no page covering them."
          icon={Search}
          actions={<Badge tone="info">{formatNumber(gapRows.length)}</Badge>}
        >
          {gaps.loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 skeleton" />)}
            </div>
          ) : gaps.error ? (
            <ErrorState error={gaps.error} onRetry={gaps.refetch} />
          ) : !gapRows.length ? (
            <EmptyState
              compact
              icon={AlertCircle}
              title="No gaps detected"
              description={
                gaps.data?.basedOn?.pages
                  ? 'Every query with meaningful impressions is covered by a crawled page.'
                  : 'Run a site audit and sync Search Console first — gaps are computed from both.'
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {gapRows.slice(0, 10).map((gap) => (
                <li key={gap.query} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink" title={gap.query}>{gap.query}</p>
                    <p className="mt-0.5 text-[10.5px] text-muted">
                      <span className="font-mono">{formatNumber(gap.impressions)}</span> impressions · position{' '}
                      <span className="font-mono">{gap.position.toFixed(1)}</span> · {formatNumber(gap.clicks)} clicks
                    </p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => createFromGap(gap)}>
                    <Plus size={11} /> Brief
                  </button>
                </li>
              ))}
            </ul>
          )}
          {gaps.data?.basedOn && (
            <p className="mt-2.5 text-[10.5px] text-faint">
              Based on {gaps.data.basedOn.pages} crawled page(s) and {gaps.data.basedOn.queries} queries
              {gaps.data.basedOn.auditId ? ` from audit ${gaps.data.basedOn.auditId.slice(0, 8)}` : ''}.
            </p>
          )}
        </Card>

        <Card
          title="Internal link suggestions"
          description="Section headings that overlap with another page's topic."
          icon={Link2}
          actions={<Badge tone="info">{formatNumber(linkRows.length)}</Badge>}
        >
          {!linkRows.length ? (
            <EmptyState
              compact
              icon={Link2}
              title="No suggestions yet"
              description="Suggestions are derived from headings in your most recent audit. Run an audit with at least a few pages."
            />
          ) : (
            <ul className="space-y-2.5">
              {linkRows.slice(0, 8).map((link, index) => (
                <li key={`${link.from}-${index}`} className="rounded-lg border border-line bg-sunken px-2.5 py-2">
                  <p className="truncate font-mono text-[10.5px] text-muted" title={link.from}>{pathOf(link.from)}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    In <span className="font-medium text-ink">“{truncate(link.section, 46)}”</span> link to
                  </p>
                  <p className="truncate font-mono text-[10.5px] text-brand-600 dark:text-brand-400" title={link.to}>{pathOf(link.to)}</p>
                  <p className="mt-1 text-[10.5px] text-faint">Anchor: {truncate(link.anchor, 60)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <BriefModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        item={null}
        siteId={siteId}
        onSaved={() => list.refetch()}
      />
      <BriefModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        item={editing}
        siteId={siteId}
        onSaved={() => { setEditing(null); list.refetch(); }}
      />
    </div>
  );
}

function BriefModal({ open, onClose, item, siteId, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ keyword: '', title: '', status: 'idea', targetUrl: '', publishDate: '', wordCountTarget: 1200, notes: '' });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(item
      ? {
        keyword: item.keyword,
        title: item.title,
        status: item.status,
        targetUrl: item.targetUrl ?? '',
        publishDate: item.publishDate ?? '',
        wordCountTarget: item.wordCountTarget ?? 1200,
        notes: item.notes ?? '',
      }
      : { keyword: '', title: '', status: 'idea', targetUrl: '', publishDate: '', wordCountTarget: 1200, notes: '' });
    setPreview(null);
    setError(null);
  }, [open, item]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        siteId,
        title: form.title || undefined,
        publishDate: form.publishDate || null,
        wordCountTarget: Number(form.wordCountTarget) || 1200,
      };
      if (item) {
        await patch(`/content/${item.id}`, payload);
        toast('Brief updated', 'success');
      } else {
        await post('/content', payload);
        toast('Brief created', 'success');
      }
      onSaved();
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
      title={item ? 'Edit brief' : 'New content brief'}
      description={item ? item.keyword : 'The platform drafts the structure; you write the content.'}
      size="max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="brief-form" className="btn-primary" disabled={saving || !form.keyword.trim()}>
            {saving ? 'Saving…' : item ? 'Save changes' : 'Create brief'}
          </button>
        </div>
      }
    >
      <form id="brief-form" onSubmit={save} className="space-y-3.5">
        <Field label="Primary keyword or topic" hint="Drives the generated outline and meta description">
          <input
            value={form.keyword}
            onChange={(event) => setForm({ ...form, keyword: event.target.value })}
            className="input"
            placeholder="technical seo audit"
            autoFocus
          />
        </Field>

        <Field label="Working title" hint="Leave blank to accept the generated title">
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="input" placeholder="Optional" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status">
            <select className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_META[value]?.label ?? value}</option>)}
            </select>
          </Field>
          <Field label="Target words">
            <input type="number" min="200" step="100" value={form.wordCountTarget} onChange={(event) => setForm({ ...form, wordCountTarget: event.target.value })} className="input" />
          </Field>
          <Field label="Publish date">
            <input type="date" value={form.publishDate} onChange={(event) => setForm({ ...form, publishDate: event.target.value })} className="input" />
          </Field>
        </div>

        <Field label="Target URL" hint="Where the finished article will live">
          <input value={form.targetUrl} onChange={(event) => setForm({ ...form, targetUrl: event.target.value })} className="input font-mono text-[12px]" placeholder="https://example.com/blog/technical-seo-audit" />
        </Field>

        <Field label="Notes">
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="input" />
        </Field>

        {item?.brief && (
          <Notice tone="info" icon={Info}>
            Generated outline has {item.brief.outline?.length ?? 0} section(s). Open the brief to see the full structure.
          </Notice>
        )}
        {error && <p className="text-[12px] text-negative">{error}</p>}
      </form>
    </Modal>
  );
}
