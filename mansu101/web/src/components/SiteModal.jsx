import { useCallback, useState } from 'react';
import { post } from '../lib/api.js';
import { useApp } from '../store.jsx';
import { Modal, Field, Notice } from './ui.jsx';
import { Globe, Info } from './Icons.jsx';

/**
 * Register a site you own or administer.
 *
 * The URL is used for crawls (technical audits, link checks) and maps to a
 * Search Console property. Nothing is crawled before the user adds it.
 */
export default function SiteModal({ open, onClose, onCreated }) {
  const { refreshBoot, toast } = useApp();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [gscProperty, setGscProperty] = useState('');
  const [ga4Property, setGa4Property] = useState('');
  const [syncDays, setSyncDays] = useState('28');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setUrl('');
    setName('');
    setGscProperty('');
    setGa4Property('');
    setSyncDays('28');
    setError(null);
  }, []);

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { site } = await post('/sites', {
        url,
        name: name || undefined,
        gscProperty: gscProperty || null,
        ga4Property: ga4Property || null,
        syncDays: Number(syncDays) || 28,
      });
      toast(`${site.name} added`, 'success');
      await refreshBoot();
      onCreated?.(site);
      reset();
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
      onClose={close}
      title="Add a site"
      description="Only add properties you own or are authorized to audit."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
          <button type="submit" form="add-site-form" className="btn-primary" disabled={saving || !url}>
            {saving ? 'Adding…' : 'Add site'}
          </button>
        </div>
      }
    >
      <form id="add-site-form" onSubmit={submit} className="space-y-4">
        <Field label="Site URL" hint="The canonical origin, e.g. https://example.com" htmlFor="site-url">
          <div className="relative">
            <Globe size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              id="site-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              className="input pl-8"
              autoFocus
              required
            />
          </div>
        </Field>

        <Field label="Display name" hint="Optional — defaults to the hostname" htmlFor="site-name">
          <input
            id="site-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Example Blog"
            className="input"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Search Console property" hint="e.g. sc-domain:example.com" htmlFor="site-gsc">
            <input
              id="site-gsc"
              value={gscProperty}
              onChange={(event) => setGscProperty(event.target.value)}
              placeholder="sc-domain:example.com"
              className="input font-mono text-[12px]"
            />
          </Field>
          <Field label="GA4 property ID" hint="Numeric ID, e.g. 123456789" htmlFor="site-ga4">
            <input
              id="site-ga4"
              value={ga4Property}
              onChange={(event) => setGa4Property(event.target.value)}
              placeholder="123456789"
              className="input font-mono text-[12px]"
            />
          </Field>
        </div>

        <Field label="Initial sync window" hint="How many days of Google data to fetch on first sync" htmlFor="site-days">
          <select id="site-days" className="select" value={syncDays} onChange={(event) => setSyncDays(event.target.value)}>
            <option value="7">7 days</option>
            <option value="28">28 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
          </select>
        </Field>

        <Notice tone="info" icon={Info}>
          Property IDs can also be picked from the Integrations page after connecting Google — you do not
          need to type them now.
        </Notice>

        {error && <p className="text-[12px] text-negative">{error}</p>}
      </form>
    </Modal>
  );
}
