import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { EmptyState, SectionHeading } from '../components/ui.jsx';
import { formatDateTime, hostname } from '../lib/format.js';
import { Globe, Plus, Trash, External, Play, Layers, Search } from '../components/Icons.jsx';

export default function UrlsPage() {
  const { urls, addUrls, removeUrl, toggleUrl, runAction, busyAction } = useStore();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');

  const enabled = urls.filter((url) => url.enabled).length;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return urls;
    return urls.filter((url) => url.url.toLowerCase().includes(query));
  }, [urls, search]);

  const submit = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    await addUrls(text);
    setText('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">URL queue</h1>
          <p className="mt-1 text-xs text-slate-500">
            Every enabled URL opens in its own fresh Chromium context on the VPS. Changes apply to the next run.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="label">Enabled</p>
            <p className="mt-0.5 font-mono text-sm text-slate-200">{enabled} / {urls.length}</p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => runAction('start')}
            disabled={Boolean(busyAction) || enabled === 0}
          >
            <Play size={14} /> Start run
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.75fr]">
        <section className="card h-fit p-4">
          <SectionHeading icon={Plus} title="Add URLs" subtitle="Bulk paste supported — one address per line" />
          <form onSubmit={submit} className="space-y-3">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={7}
              placeholder={'https://example.com\nhttps://your-site.com/pricing\nshop.example.com/product/42'}
              className="input resize-y font-mono text-[11px] leading-relaxed"
              spellCheck={false}
            />
            <p className="text-[10px] leading-relaxed text-slate-600">
              Only <span className="font-mono text-slate-500">http(s)</span> URLs are accepted. Missing schemes default to HTTPS.
              Duplicates are skipped. Invalid entries are rejected with a notice.
            </p>
            <button type="submit" className="btn-primary w-full" disabled={!text.trim()}>
              <Plus size={14} /> Add to queue
            </button>
          </form>
          <div className="mt-4 rounded-lg border border-white/[0.06] bg-black/20 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Layers size={11} /> Batch strategy
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              Each tab gets a new incognito context, selected profile, navigation timeout, screenshot, and full
              diagnostics. Concurrency and limits are configured in Settings.
            </p>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Configured URLs</h2>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search URLs…"
                className="h-8 w-44 rounded-lg border border-white/[0.07] bg-black/25 pl-7 pr-2 text-[11px] text-slate-300 outline-none placeholder:text-slate-600 focus:border-violet-500/40"
              />
            </div>
          </div>

          {urls.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Globe}
                title="No URLs configured"
                description="Add target addresses on the left. They will be stored in SQLite and preserved across restarts."
              />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-slate-600">No URLs match “{search}”.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {filtered.map((url, index) => (
                <li key={url.id} className={`flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.02] ${url.enabled ? '' : 'opacity-45'}`}>
                  <span className="w-6 shrink-0 font-mono text-[10px] text-slate-600">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Globe size={11} className="shrink-0 text-violet-300/70" />
                      <p className="truncate text-[12px] font-medium text-slate-200" title={url.url}>{hostname(url.url)}</p>
                      <span className="hidden truncate font-mono text-[9px] text-slate-600 md:inline">{url.url}</span>
                    </div>
                    <p className="mt-0.5 text-[9px] text-slate-600">added {formatDateTime(url.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={url.enabled}
                    onClick={() => toggleUrl(url.id, !url.enabled)}
                    title={url.enabled ? 'Disable URL' : 'Enable URL'}
                    className={`relative h-5 w-9 shrink-0 rounded-full border transition ${url.enabled ? 'border-violet-400/40 bg-violet-500/70' : 'border-white/10 bg-white/[0.06]'}`}
                  >
                    <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${url.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                  <a
                    href={url.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-icon !h-7 !w-7"
                    title="Open in local browser"
                  >
                    <External size={13} />
                  </a>
                  <button
                    type="button"
                    onClick={() => removeUrl(url.id)}
                    className="btn-icon !h-7 !w-7 hover:!text-rose-300"
                    title="Remove URL"
                  >
                    <Trash size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/15 px-4 py-2 text-[10px] text-slate-600">
            <span>{filtered.length} shown · {urls.length} total</span>
            <span>{enabled} enabled</span>
          </div>
        </section>
      </div>
    </div>
  );
}
