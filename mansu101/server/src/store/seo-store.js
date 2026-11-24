/**
 * SEO data layer shared by SQLite and PostgreSQL.
 *
 * Design:
 *  · `entities` holds JSON documents (sites, integrations, campaigns,
 *    keywords, audits, jobs…) because their shape evolves and they are read
 *    by id or filtered in small sets.
 *  · `seo_metrics` is a real table with a numeric schema because the
 *    dashboard needs SQL aggregation (SUM clicks / impressions, weighted
 *    CTR & position, date grouping).
 *
 * Every number in `seo_metrics` comes from Google Search Console / Google
 * Analytics or from an authenticated crawl. Nothing is synthetic.
 */
const METRIC_COLUMNS = [
  'id',
  'site_id',
  'source',
  'dimension',
  'dimension_key',
  'date',
  'clicks',
  'impressions',
  'ctr',
  'position',
  'sessions',
  'active_users',
  'engaged_sessions',
  'engagement_rate',
  'conversions',
  'updated_at',
];

const METRIC_INDEX = [
  'site_id',
  'source',
  'dimension',
  'dimension_key',
  'date',
];

export class SeoStore {
  constructor(driver, dialect) {
    this.driver = driver;
    this.dialect = dialect;
  }

  async init() {
    const idColumn = this.dialect === 'postgres'
      ? 'BIGSERIAL PRIMARY KEY'
      : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    await this.driver.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        doc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities (kind, updated_at);
      CREATE TABLE IF NOT EXISTS seo_metrics (
        id ${idColumn},
        site_id TEXT NOT NULL,
        source TEXT NOT NULL,
        dimension TEXT NOT NULL,
        dimension_key TEXT NOT NULL,
        date TEXT NOT NULL,
        clicks INTEGER DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        ctr REAL DEFAULT 0,
        position REAL DEFAULT 0,
        sessions INTEGER DEFAULT 0,
        active_users INTEGER DEFAULT 0,
        engaged_sessions INTEGER DEFAULT 0,
        engagement_rate REAL DEFAULT 0,
        conversions REAL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique
        ON seo_metrics (site_id, source, dimension, dimension_key, date);
      CREATE INDEX IF NOT EXISTS idx_metrics_lookup
        ON seo_metrics (site_id, source, dimension, date);
    `);
  }

  // ─── Entities ──────────────────────────────────────────────────────────
  async getEntity(kind, id) {
    const row = await this.driver.get(
      'SELECT doc FROM entities WHERE kind = ? AND id = ?',
      [kind, id],
    );
    if (!row) return null;
    try {
      return JSON.parse(row.doc);
    } catch {
      return null;
    }
  }

  async putEntity(kind, doc) {
    const now = new Date().toISOString();
    await this.driver.run(
      `INSERT INTO entities (kind, id, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (kind, id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
      [kind, doc.id, JSON.stringify(doc), doc.createdAt ?? now, now],
    );
    return doc;
  }

  async deleteEntity(kind, id) {
    await this.driver.run('DELETE FROM entities WHERE kind = ? AND id = ?', [kind, id]);
  }

  async listEntities(kind, { limit = 500 } = {}) {
    const rows = await this.driver.all(
      'SELECT doc FROM entities WHERE kind = ? ORDER BY updated_at DESC LIMIT ?',
      [kind, limit],
    );
    const out = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.doc));
      } catch {
        /* skip corrupt doc */
      }
    }
    return out;
  }

  // ─── Metrics ───────────────────────────────────────────────────────────
  async upsertMetrics(rows = []) {
    if (!rows.length) return 0;
    let written = 0;
    const updatedAt = new Date().toISOString();
    for (const row of rows) {
      await this.driver.run(
        `INSERT INTO seo_metrics
           (site_id, source, dimension, dimension_key, date, clicks, impressions, ctr, position,
            sessions, active_users, engaged_sessions, engagement_rate, conversions, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (site_id, source, dimension, dimension_key, date) DO UPDATE SET
           clicks = excluded.clicks,
           impressions = excluded.impressions,
           ctr = excluded.ctr,
           position = excluded.position,
           sessions = excluded.sessions,
           active_users = excluded.active_users,
           engaged_sessions = excluded.engaged_sessions,
           engagement_rate = excluded.engagement_rate,
           conversions = excluded.conversions,
           updated_at = excluded.updated_at`,
        [
          row.siteId,
          row.source,
          row.dimension,
          String(row.key ?? ''),
          row.date,
          Math.round(Number(row.clicks) || 0),
          Math.round(Number(row.impressions) || 0),
          Number(row.ctr) || 0,
          Number(row.position) || 0,
          Math.round(Number(row.sessions) || 0),
          Math.round(Number(row.activeUsers) || 0),
          Math.round(Number(row.engagedSessions) || 0),
          Number(row.engagementRate) || 0,
          Number(row.conversions) || 0,
          updatedAt,
        ],
      );
      written += 1;
    }
    return written;
  }

  /**
   * Aggregate metrics. `groupBy` is 'date' | 'key' | 'none'.
   * CTR and position are recalculated from sums so they stay meaningful.
   */
  async aggregateMetrics({
    siteId,
    source = 'gsc',
    dimension = 'date',
    key,
    from,
    to,
    groupBy = 'key',
    orderBy = 'clicks',
    limit = 25,
    offset = 0,
  } = {}) {
    const where = ['site_id = ?', 'source = ?', 'dimension = ?'];
    const params = [siteId, source, dimension];
    if (key !== undefined && key !== null) {
      where.push('dimension_key = ?');
      params.push(String(key));
    }
    if (from) {
      where.push('date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('date <= ?');
      params.push(to);
    }
    const clause = where.join(' AND ');
    const allowedOrder = new Set(['clicks', 'impressions', 'sessions', 'active_users', 'position', 'date', 'dimension_key']);
    const orderColumn = allowedOrder.has(orderBy) ? orderBy : 'clicks';
    const dir = orderColumn === 'position' ? 'ASC' : 'DESC';

    if (groupBy === 'none') {
      const row = await this.driver.get(
        `SELECT
           COALESCE(SUM(clicks), 0) AS clicks,
           COALESCE(SUM(impressions), 0) AS impressions,
           COALESCE(SUM(sessions), 0) AS sessions,
           COALESCE(SUM(active_users), 0) AS active_users,
           COALESCE(SUM(engaged_sessions), 0) AS engaged_sessions,
           COALESCE(SUM(conversions), 0) AS conversions,
           COALESCE(AVG(NULLIF(engagement_rate, 0)), 0) AS engagement_rate,
           COALESCE(AVG(NULLIF(position, 0)), 0) AS position
         FROM seo_metrics WHERE ${clause}`,
        params,
      );
      return [normalizeAggregate(row)];
    }

    const groupColumn = groupBy === 'date' ? 'date' : 'dimension_key';
    const rows = await this.driver.all(
      `SELECT ${groupColumn} AS bucket,
         COALESCE(SUM(clicks), 0) AS clicks,
         COALESCE(SUM(impressions), 0) AS impressions,
         COALESCE(SUM(sessions), 0) AS sessions,
         COALESCE(SUM(active_users), 0) AS active_users,
         COALESCE(SUM(engaged_sessions), 0) AS engaged_sessions,
         COALESCE(SUM(conversions), 0) AS conversions,
         COALESCE(AVG(NULLIF(engagement_rate, 0)), 0) AS engagement_rate,
         COALESCE(AVG(NULLIF(position, 0)), 0) AS position
       FROM seo_metrics WHERE ${clause}
       GROUP BY ${groupColumn}
       ORDER BY ${groupBy === 'date' ? 'bucket ASC' : `${orderColumn} ${dir}`}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows.map((row) => ({
      ...normalizeAggregate(row),
      [groupBy === 'date' ? 'date' : 'key']: row.bucket,
    }));
  }

  async countMetricGroups({ siteId, source = 'gsc', dimension = 'query', from, to } = {}) {
    const where = ['site_id = ?', 'source = ?', 'dimension = ?'];
    const params = [siteId, source, dimension];
    if (from) {
      where.push('date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('date <= ?');
      params.push(to);
    }
    const row = await this.driver.get(
      `SELECT COUNT(DISTINCT dimension_key) AS count FROM seo_metrics WHERE ${where.join(' AND ')}`,
      params,
    );
    return Number(row?.count ?? 0);
  }

  async latestMetricDate({ siteId, source = 'gsc' } = {}) {
    const row = await this.driver.get(
      'SELECT MAX(date) AS date FROM seo_metrics WHERE site_id = ? AND source = ?',
      [siteId, source],
    );
    return row?.date ?? null;
  }

  async deleteMetrics({ siteId, source, before } = {}) {
    const where = [];
    const params = [];
    if (siteId) {
      where.push('site_id = ?');
      params.push(siteId);
    }
    if (source) {
      where.push('source = ?');
      params.push(source);
    }
    if (before) {
      where.push('date < ?');
      params.push(before);
    }
    if (!where.length) throw new Error('Refusing to delete every metric row');
    await this.driver.run(`DELETE FROM seo_metrics WHERE ${where.join(' AND ')}`, params);
  }
}

function normalizeAggregate(row = {}) {
  const clicks = Number(row.clicks) || 0;
  const impressions = Number(row.impressions) || 0;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: Number(row.position) || 0,
    sessions: Number(row.sessions) || 0,
    activeUsers: Number(row.active_users) || 0,
    engagedSessions: Number(row.engaged_sessions) || 0,
    engagementRate: Number(row.engagement_rate) || 0,
    conversions: Number(row.conversions) || 0,
  };
}

export { METRIC_COLUMNS };
