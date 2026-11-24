import path from 'node:path';
import { SqlStore } from './sql-store.js';
import { JsonStore } from './json-store.js';
import { SeoStore } from './seo-store.js';
import { SqliteDriver, PostgresDriver } from './drivers.js';
import { ROOT_DIR, config } from '../config.js';

function resolveSqlitePath(databaseUrl) {
  const raw = databaseUrl.replace(/^sqlite:/, '');
  if (raw === ':memory:') return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

/**
 * Compose the persistence layer.
 *
 * `store` keeps the generic API used by auth/health (settings, tokens,
 * events, legacy run history). The SEO document + metric methods from
 * SeoStore are mixed onto the same object so services get one dependency
 * with a single driver and one connection pool.
 */
export async function createStore(log = console) {
  const url = config.databaseUrl;
  let driver = null;
  let engine = 'json';

  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    driver = new PostgresDriver(url);
    await driver.open();
    engine = 'postgres';
  } else if (url.startsWith('sqlite:') || url.endsWith('.db') || url.endsWith('.sqlite')) {
    try {
      driver = new SqliteDriver(resolveSqlitePath(url));
      await driver.open();
      engine = 'sqlite';
    } catch (error) {
      log.warn?.(`[store] SQLite unavailable (${error.message}); falling back to JSON store`);
    }
  }

  if (driver) {
    const store = new SqlStore(driver, engine);
    await store.init();
    const seo = new SeoStore(driver, engine);
    await seo.init();
    store.engine = engine;
    store.initSeo = async () => seo.init();
    for (const method of Object.getOwnPropertyNames(SeoStore.prototype)) {
      if (method === 'constructor' || method === 'init' || store[method]) continue;
      store[method] = seo[method].bind(seo);
    }
    log.info?.(`[store] ${engine === 'sqlite' ? 'SQLite' : 'PostgreSQL'} ready`);
    return { store, engine };
  }

  // JSON fallback: entities and metrics live in the same file, so the
  // platform still works on runtimes without node:sqlite (dev machines).
  const jsonPath = path.join(config.dataDir, 'visitor.json');
  const store = new JsonStore(jsonPath);
  await store.init();
  attachJsonSeo(store);
  store.engine = 'json';
  store.initSeo = async () => {};
  log.info?.('[store] JSON store ready (SEO data included)');
  return { store, engine: 'json' };
}

function attachJsonSeo(store) {
  store.data.entities = store.data.entities ?? {};
  store.data.metrics = store.data.metrics ?? [];

  store.getEntity = async (kind, id) => store.data.entities?.[kind]?.[id] ?? null;
  store.putEntity = async (kind, doc) => {
    store.data.entities[kind] = store.data.entities[kind] ?? {};
    store.data.entities[kind][doc.id] = doc;
    store.schedule();
    return doc;
  };
  store.deleteEntity = async (kind, id) => {
    if (store.data.entities?.[kind]) delete store.data.entities[kind][id];
    store.schedule();
  };
  store.listEntities = async (kind, { limit = 500 } = {}) => Object.values(store.data.entities?.[kind] ?? {})
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, limit);

  store.upsertMetrics = async (rows = []) => {
    let written = 0;
    for (const row of rows) {
      const index = store.data.metrics.findIndex((item) =>
        item.siteId === row.siteId
        && item.source === row.source
        && item.dimension === row.dimension
        && item.key === String(row.key ?? '')
        && item.date === row.date);
      const record = {
        siteId: row.siteId,
        source: row.source,
        dimension: row.dimension,
        key: String(row.key ?? ''),
        date: row.date,
        clicks: Math.round(Number(row.clicks) || 0),
        impressions: Math.round(Number(row.impressions) || 0),
        ctr: Number(row.ctr) || 0,
        position: Number(row.position) || 0,
        sessions: Math.round(Number(row.sessions) || 0),
        activeUsers: Math.round(Number(row.activeUsers) || 0),
        engagedSessions: Math.round(Number(row.engagedSessions) || 0),
        engagementRate: Number(row.engagementRate) || 0,
        conversions: Number(row.conversions) || 0,
      };
      if (index >= 0) store.data.metrics[index] = record;
      else store.data.metrics.push(record);
      written += 1;
    }
    if (written) store.schedule();
    return written;
  };

  store.aggregateMetrics = async ({
    siteId, source = 'gsc', dimension = 'date', key, from, to, groupBy = 'key', orderBy = 'clicks', limit = 25, offset = 0,
  } = {}) => {
    const rows = store.data.metrics.filter((row) =>
      row.siteId === siteId
      && row.source === source
      && row.dimension === dimension
      && (key === undefined || row.key === String(key))
      && (!from || row.date >= from)
      && (!to || row.date <= to));
    const sum = (field) => rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
    const average = (field) => {
      const values = rows.map((row) => Number(row[field]) || 0).filter((value) => value > 0);
      return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;
    };
    const totals = {
      clicks: sum('clicks'),
      impressions: sum('impressions'),
      sessions: sum('sessions'),
      activeUsers: sum('activeUsers'),
      engagedSessions: sum('engagedSessions'),
      conversions: sum('conversions'),
      engagementRate: average('engagementRate'),
      position: average('position'),
    };
    totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    if (groupBy === 'none') return [totals];

    const buckets = new Map();
    for (const row of rows) {
      const bucket = groupBy === 'date' ? row.date : row.key;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(row);
    }
    const out = [...buckets.entries()].map(([bucket, bucketRows]) => {
      const totalOf = (field) => bucketRows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
      const impressionTotal = totalOf('impressions');
      const positions = bucketRows.map((row) => Number(row.position) || 0).filter((value) => value > 0);
      return {
        [groupBy === 'date' ? 'date' : 'key']: bucket,
        clicks: totalOf('clicks'),
        impressions: impressionTotal,
        ctr: impressionTotal > 0 ? totalOf('clicks') / impressionTotal : 0,
        position: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0,
        sessions: totalOf('sessions'),
        activeUsers: totalOf('activeUsers'),
        engagedSessions: totalOf('engagedSessions'),
        engagementRate: bucketRows.length ? bucketRows.reduce((acc, row) => acc + (Number(row.engagementRate) || 0), 0) / bucketRows.length : 0,
        conversions: totalOf('conversions'),
      };
    });
    if (groupBy === 'date') {
      return out.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(offset, offset + limit);
    }
    const direction = orderBy === 'position' ? 1 : -1;
    return out
      .sort((a, b) => ((a[orderBy] ?? 0) - (b[orderBy] ?? 0)) * direction)
      .slice(offset, offset + limit);
  };

  store.countMetricGroups = async ({ siteId, source = 'gsc', dimension = 'query', from, to } = {}) => {
    const keys = new Set(store.data.metrics
      .filter((row) => row.siteId === siteId
        && row.source === source
        && row.dimension === dimension
        && (!from || row.date >= from)
        && (!to || row.date <= to))
      .map((row) => row.key));
    return keys.size;
  };

  store.latestMetricDate = async ({ siteId, source = 'gsc' } = {}) => store.data.metrics
    .filter((row) => row.siteId === siteId && row.source === source)
    .map((row) => row.date)
    .sort()
    .pop() ?? null;

  store.deleteMetrics = async ({ siteId, source, before } = {}) => {
    store.data.metrics = store.data.metrics.filter((row) =>
      !((!siteId || row.siteId === siteId)
        && (!source || row.source === source)
        && (!before || row.date < before)));
    store.schedule();
  };
}
