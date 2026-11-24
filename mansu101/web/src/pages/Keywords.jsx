import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { useApi } from '../lib/hooks.js';
import { get, post, patch, del, queryString } from '../lib/api.js';
import {
  Card,
  Tabs,
  EmptyState,
  ErrorState,
  Badge,
  SearchInput,
  Modal,
  Field,
  Notice,
  StatTile,
  InlineCode,
} from '../components/ui.jsx';

import {
  Sparkles,
  Plus,
  Trash,
  Search,
  Target,
  Link2,
  AlertCircle,
  Trend,
  Layers,
  Info,
  Refresh,
} from '../components/Icons.jsx';
import {
  formatNumber,
  formatPercent,
  formatPosition,
  INTENT_META,
  STATUS_META,
  truncate,
} from '../lib/format.js';

const INTENTS = [
  { value: 'all', label: 'All intents' },
  { value: 'informational', label: 'Informational' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'transactional', label: 'Transactional' },
  { value: 'navigational', label: 'Navigational' },
];

export default function Keywords({ onNavigate }) {
  const { siteId, activeSite, range, toast } = useApp();
  const [intent, setIntent] = useState('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [seed, setSeed] = useState('');
  const [research, setResearch] = useState(null);
  const [researching, setResearching] = useState(false);

  const listPath = `/keywords${queryString({ siteId, intent: intent === 'all' ? undefined : intent })}`;
  const list = useApi(listPath, { enabled: Boolean(siteId) });

  const perfPath = siteId
    ? `/sites/${siteId}/keywords/performance?${queryString({ days: range.days, from: range.from, to: range.to })}`
    : null;
  const perf = useApi(perfPath ?? '/bootstrap', { enabled: Boolean(perfPath) });

  const rows = list.data?.keywords ?? [];
  const performance = perf.data?.keywords ?? [];
  const opportunities = perf.data?.opportunities ?? [];

  const merged = useMemo(() => {
    const byId = new Map(performance.map((item) => [item.id, item]));
    return rows.map((row) => ({ ...row, performance: byId.get(row.id)?.performance ?? row.performance ?? null }));
  }, [rows, performance]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return merged;
    return merged.filter((row) => row.keyword.toLowerCase().includes(needle));
  }, [merged, search]);

  const withPosition = merged.filter((row) => row.performance?.position > 0);
  const top3 = withPosition.filter((row) => row.performance.position <= 3).length;
  const top10 = withPosition.filter((row) => row.performance.position <= 10).length;

  const researchSeed = async () => {
    if (!seed.trim()) return;
    setResearching(true);
    try {
      const data = await get(`/keywords/research?seed=${encodeURIComponent(seed.trim())}`);
      setResearch(data);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setResearching(false);
    }
  };

  const remove = async (row) => {
    try {
      await del(`/keywords/${row.id}`);
      toast('Keyword removed', 'success');
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const addFromOpportunity = async (item) => {
    try {
      await post('/keywords', { siteId, keyword: item.keyword, intent: item.intent });
      toast(`Tracking "${truncate(item.keyword, 40)}"`, 'success');
      list.refetch();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  if (!siteId) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No site selected"
        description="Keywords are tracked per site. Add a site first, then add the queries you want to monitor."
        action={<button type="button" className="btn-primary" onClick={() => onNavigate('dashboard')}>Go to dashboard</button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Tracked keywords" value={formatNumber(merged.length)} icon={Search} hint={`for ${activeSite?.name ?? 'this site'}`} />
        <StatTile label="In top 3" value={formatNumber(top3)} icon={Trend} hint="measured by Search Console" />
        <StatTile label="In top 10" value={formatNumber(top10)} icon={Target} hint="measured by Search Console" />
        <StatTile
          label="Opportunities"
          value={formatNumber(opportunities.length)}
          icon={Sparkles}
          hint="queries with impressions, not tracked"
        />
      </section>

      <Card
        title="Keyword tracker"
        description="Research keywords you add, plus measured performance for queries Google already shows this site for."
        icon={Sparkles}
        actions={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => list.refetch()} disabled={list.loading}>
              <Refresh size={12} className={list.loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setAddOpen(true)}>
              <Plus size={13} /> Add keywords
            </button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs items={INTENTS} value={intent} onChange={setIntent} />
          <SearchInput value={search} onChange={setSearch} placeholder="Filter keywords…" className="w-[180px]" />
        </div>

        {list.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-10 skeleton" />)}
          </div>
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : !filtered.length ? (
          <EmptyState
            compact
            icon={Sparkles}
            title={rows.length ? 'No keywords match this filter' : 'No keywords yet'}
            description={rows.length
              ? 'Clear the filter or choose a different intent.'
              : 'Add the queries you want to rank for. Performance appears once Search Console has data for them.'}
            action={<button type="button" className="btn-secondary btn-sm" onClick={() => setAddOpen(true)}>Add keywords</button>}
          />
        ) : (
          <div className="scroll-x">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Intent</th>
                  <th className="text-right">Difficulty</th>
                  <th className="text-right">Position</th>
                  <th className="text-right">Clicks</th>
                  <th className="text-right">Impressions</th>
                  <th className="text-right">CTR</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const intentMeta = INTENT_META[row.intent] ?? INTENT_META.unknown;
                  const difficulty = row.difficulty ?? {};
                  return (
                    <tr key={row.id}>
                      <td className="max-w-[260px]">
                        <button
                          type="button"
                          onClick={() => setEditing(row)}
                          className="block max-w-full truncate text-left text-[12.5px] font-medium text-ink hover:text-brand-600 dark:hover:text-brand-400"
                          title={row.keyword}
                        >
                          {row.keyword}
                        </button>
                        {row.targetUrl && (
                          <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-faint">
                            <Link2 size={10} /> {truncate(row.targetUrl.replace(/^https?:\/\/[^/]+/, ''), 34)}
                          </span>
                        )}
                      </td>
                      <td><Badge tone={intentMeta.tone}>{intentMeta.label}</Badge></td>
                      <td className="text-right">
                        {difficulty.score !== undefined ? (
                          <span className="inline-flex items-center gap-1.5" title={difficulty.note}>
                            <span className={`font-mono text-[11.5px] ${difficulty.score < 30 ? 'text-positive' : difficulty.score < 55 ? 'text-warning' : 'text-negative'}`}>
                              {difficulty.score}
                            </span>
                            <span className="hidden text-[10px] uppercase tracking-wide text-faint sm:inline">{difficulty.label}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-right font-mono text-[11.5px]">
                        {row.performance?.position ? formatPosition(row.performance.position) : '—'}
                      </td>
                      <td className="text-right">{row.performance ? formatNumber(row.performance.clicks) : '—'}</td>
                      <td className="text-right">{row.performance ? formatNumber(row.performance.impressions) : '—'}</td>
                      <td className="text-right">{row.performance ? formatPercent(row.performance.ctr) : '—'}</td>
                      <td className="text-right">
                        <button type="button" className="btn-icon" onClick={() => remove(row)} aria-label={`Remove ${row.keyword}`}>
                          <Trash size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="Opportunities" description="Queries Google already shows this site for that you are not tracking." icon={Sparkles}>
          {perf.loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 skeleton" />)}
            </div>
          ) : opportunities.length === 0 ? (
            <EmptyState
              compact
              icon={AlertCircle}
              title="No untracked queries yet"
              description="Opportunities come from real Search Console impressions. Sync data or widen the range to find them."
            />
          ) : (
            <ul className="divide-y divide-line">
              {opportunities.slice(0, 8).map((item) => (
                <li key={item.keyword} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink" title={item.keyword}>{item.keyword}</p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">{item.reason}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
                      <Badge tone={(INTENT_META[item.intent] ?? INTENT_META.unknown).tone}>
                        {(INTENT_META[item.intent] ?? INTENT_META.unknown).label}
                      </Badge>
                      <span className="font-mono">{formatNumber(item.impressions)} impressions</span>
                      <span className="font-mono">pos {formatPosition(item.position)}</span>
                    </div>
                  </div>
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => addFromOpportunity(item)}>
                    <Plus size={11} /> Track
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Research a topic" description="Intent, clusters and long-tail variants derived from the seed phrase." icon={Layers}>
          <div className="flex gap-2">
            <input
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') researchSeed(); }}
              placeholder="e.g. technical seo audit"
              className="input"
            />
            <button type="button" className="btn-primary shrink-0" onClick={researchSeed} disabled={researching || !seed.trim()}>
              {researching ? 'Analysing…' : 'Analyse'}
            </button>
          </div>

          {research ? (
            <div className="mt-4 space-y-4">
              <div>
                <p className="label mb-1.5">Detected intent</p>
                <div className="flex flex-wrap gap-1.5">
                  {research.intents.map((item) => (
                    <Badge key={item.keyword} tone={(INTENT_META[item.intent] ?? INTENT_META.unknown).tone}>
                      {item.keyword} · {(INTENT_META[item.intent] ?? INTENT_META.unknown).label}
                      {item.confidence ? ` (${Math.round(item.confidence * 100)}%)` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="label mb-1.5">Long-tail suggestions</p>
                <div className="flex flex-wrap gap-1.5">
                  {research.longTail.slice(0, 12).map((item) => (
                    <button
                      key={item.keyword}
                      type="button"
                      onClick={() => post('/keywords', { siteId, keyword: item.keyword })
                        .then(() => { toast(`Tracking "${truncate(item.keyword, 34)}"`, 'success'); list.refetch(); })
                        .catch((error) => toast(error.message, 'error'))}
                      className="rounded-full border border-line bg-sunken px-2 py-0.5 text-[11px] text-muted transition hover:border-brand-500/40 hover:text-ink"
                      title={`Difficulty proxy ${item.difficulty.score}/100 — click to track`}
                    >
                      {item.keyword}
                      <span className="ml-1 font-mono text-[9.5px] text-faint">{item.difficulty.score}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Notice tone="info" icon={Info}>
                Difficulty is a transparent heuristic (query length and intent), not a third-party metric.
                Real position and CTR come from Search Console once the page ranks.
              </Notice>
            </div>
          ) : (
            <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
              Enter a phrase to see intent classification, cluster grouping and long-tail templates. Click any
              suggestion to start tracking it.
            </p>
          )}
        </Card>
      </section>

      <AddKeywordsModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        siteId={siteId}
        onAdded={() => list.refetch()}
      />
      <EditKeywordModal
        keyword={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { list.refetch(); setEditing(null); }}
      />
    </div>
  );
}

function AddKeywordsModal({ open, onClose, siteId, onAdded }) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await post('/keywords/bulk', { siteId, keywords: text.split(/\r?\n/) });
      toast(`${result.added} keyword(s) added${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`, result.added ? 'success' : 'warn');
      setText('');
      onAdded();
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
      title="Add keywords"
      description="One per line. Duplicates for this site are skipped."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-keywords-form" className="btn-primary" disabled={saving || !text.trim()}>
            {saving ? 'Adding…' : 'Add keywords'}
          </button>
        </div>
      }
    >
      <form id="add-keywords-form" onSubmit={submit} className="space-y-3">
        <Field label="Keywords" hint="Up to 500 at a time">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={7}
            className="input font-mono text-[12px]"
            placeholder={'seo audit checklist\nhow to improve core web vitals\nbest keyword research tools'}
            autoFocus
          />
        </Field>
        {error && <p className="text-[12px] text-negative">{error}</p>}
      </form>
    </Modal>
  );
}

function EditKeywordModal({ keyword, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(keyword ? {
      keyword: keyword.keyword,
      intent: keyword.intent,
      status: keyword.status,
      targetUrl: keyword.targetUrl ?? '',
      notes: keyword.notes ?? '',
      tags: (keyword.tags ?? []).join(', '),
    } : null);
  }, [keyword]);

  if (!keyword || !form) return null;

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await patch(`/keywords/${keyword.id}`, {
        keyword: form.keyword,
        intent: form.intent,
        status: form.status,
        targetUrl: form.targetUrl || null,
        notes: form.notes,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
      toast('Keyword updated', 'success');
      onSaved();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit keyword"
      description={keyword.performance ? `${formatNumber(keyword.performance.impressions)} impressions in this range` : 'No measured performance yet'}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => del(`/keywords/${keyword.id}`).then(() => { toast('Keyword removed', 'success'); onSaved(); }).catch((error) => toast(error.message, 'error'))}
          >
            <Trash size={12} /> Delete
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" form="edit-keyword-form" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      }
    >
      <form id="edit-keyword-form" onSubmit={save} className="space-y-3.5">
        <Field label="Keyword">
          <input value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value })} className="input" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Intent">
            <select className="select" value={form.intent} onChange={(event) => setForm({ ...form, intent: event.target.value })}>
              {Object.entries(INTENT_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {['tracking', 'planned', 'published', 'archived'].map((value) => (
                <option key={value} value={value}>{STATUS_META[value]?.label ?? value}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Target URL" hint="The page you want to rank for this keyword">
          <input value={form.targetUrl} onChange={(event) => setForm({ ...form, targetUrl: event.target.value })} className="input font-mono text-[12px]" placeholder="https://example.com/guide" />
        </Field>
        <Field label="Tags" hint="Comma separated">
          <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} className="input" placeholder="pillar, product" />
        </Field>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="input" />
        </Field>
        {keyword.difficulty && (
          <Notice tone="info" icon={Info}>
            Difficulty proxy <InlineCode>{keyword.difficulty.score}</InlineCode> ({keyword.difficulty.label}). {keyword.difficulty.note}
          </Notice>
        )}
      </form>
    </Modal>
  );
}
