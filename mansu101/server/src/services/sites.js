import crypto from 'node:crypto';
import { normalizeUrl, siteOrigin } from '../config.js';

/**
 * Site registry.
 *
 * A "site" is a property the user owns. It links a URL to a Google Search
 * Console property and an optional GA4 property, and scopes every audit,
 * keyword and report to that site. KPIs are always read from stored Google
 * metrics or audit results — never computed from fake traffic.
 */

export function createSiteService({ store, bus }) {
  const KIND = 'site';

  async function list() {
    const sites = await store.listEntities(KIND);
    return Promise.all(sites.map(enrich));
  }

  async function get(id) {
    const site = await store.getEntity(KIND, id);
    return site ? enrich(site) : null;
  }

  async function create(input = {}) {
    const url = normalizeUrl(input.url);
    if (!url) {
      const error = new Error('A valid website URL is required (https://example.com).');
      error.status = 400;
      throw error;
    }
    const origin = siteOrigin(url);
    const existing = await store.listEntities(KIND, { limit: 500 });
    if (existing.some((site) => site.origin === origin)) {
      const error = new Error('This website is already registered.');
      error.status = 409;
      throw error;
    }
    const now = new Date().toISOString();
    const site = {
      id: crypto.randomUUID(),
      name: String(input.name || origin.replace(/^https?:\/\//, '')).slice(0, 120),
      url,
      origin,
      gscProperty: input.gscProperty ? String(input.gscProperty).slice(0, 300) : null,
      ga4Property: input.ga4Property ? String(input.ga4Property).slice(0, 200) : null,
      locale: String(input.locale || 'en').slice(0, 12),
      timezone: String(input.timezone || 'UTC').slice(0, 64),
      notes: String(input.notes || '').slice(0, 2000),
      createdAt: now,
      updatedAt: now,
      lastAuditAt: null,
      lastSyncAt: null,
      lastSyncStatus: null,
    };
    await store.putEntity(KIND, site);
    bus.log(`SITE ADDED — ${site.url}`, { type: 'site', level: 'success' });
    return enrich(site);
  }

  async function update(id, patch = {}) {
    const site = await store.getEntity(KIND, id);
    if (!site) {
      const error = new Error('Site not found');
      error.status = 404;
      throw error;
    }
    const next = { ...site };
    if (patch.name !== undefined) next.name = String(patch.name).slice(0, 120);
    if (patch.url !== undefined) {
      const url = normalizeUrl(patch.url);
      if (!url) {
        const error = new Error('Invalid website URL');
        error.status = 400;
        throw error;
      }
      next.url = url;
      next.origin = siteOrigin(url);
    }
    if (patch.gscProperty !== undefined) next.gscProperty = patch.gscProperty ? String(patch.gscProperty).slice(0, 300) : null;
    if (patch.ga4Property !== undefined) next.ga4Property = patch.ga4Property ? String(patch.ga4Property).slice(0, 200) : null;
    if (patch.locale !== undefined) next.locale = String(patch.locale).slice(0, 12);
    if (patch.timezone !== undefined) next.timezone = String(patch.timezone).slice(0, 64);
    if (patch.notes !== undefined) next.notes = String(patch.notes).slice(0, 2000);
    next.updatedAt = new Date().toISOString();
    await store.putEntity(KIND, next);
    return enrich(next);
  }

  async function remove(id) {
    const site = await store.getEntity(KIND, id);
    if (!site) return false;
    await store.putEntity(KIND, { ...site, deletedAt: new Date().toISOString() });
    await store.deleteEntity(KIND, id);
    await store.deleteMetrics({ siteId: id });
    // Detach related records so they do not point at a deleted site.
    for (const kind of ['keyword', 'campaign', 'audit', 'report', 'content']) {
      const records = await store.listEntities(kind, { limit: 2000 });
      for (const record of records.filter((item) => item.siteId === id)) {
        await store.deleteEntity(kind, record.id);
      }
    }
    bus.log(`SITE REMOVED — ${site.url}`, { type: 'site', level: 'warn' });
    return true;
  }

  async function markSynced(id, status) {
    const site = await store.getEntity(KIND, id);
    if (!site) return null;
    const next = {
      ...site,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: status,
      updatedAt: new Date().toISOString(),
    };
    await store.putEntity(KIND, next);
    return next;
  }

  /** Attach the latest audit score and metric freshness for list views. */
  async function enrich(site) {
    const audits = await store.listEntities('audit', { limit: 200 });
    const siteAudits = audits.filter((audit) => audit.siteId === site.id);
    const latest = siteAudits.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] ?? null;
    const gscLatest = await store.latestMetricDate({ siteId: site.id, source: 'gsc' });
    const ga4Latest = await store.latestMetricDate({ siteId: site.id, source: 'ga4' });
    return {
      ...site,
      auditCount: siteAudits.length,
      lastAuditAt: site.lastAuditAt || latest?.startedAt || null,
      latestScore: latest?.score?.value ?? null,
      latestAuditId: latest?.id ?? null,
      metrics: { gsc: gscLatest, ga4: ga4Latest },
    };
  }

  return { list, get, create, update, remove, markSynced };
}

export function dateRange(days = 28, lagDays = 0) {
  const end = new Date(Date.now() - lagDays * 86400000);
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86400000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function previousRange({ from, to }) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const span = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (span - 1) * 86400000);
  return { from: prevStart.toISOString().slice(0, 10), to: prevEnd.toISOString().slice(0, 10), span };
}

export function delta(current, previous) {
  if (!previous) return null;
  const change = current - previous;
  const percent = previous === 0 ? null : (change / previous) * 100;
  return { change, percent: percent === null ? null : Number(percent.toFixed(1)) };
}
