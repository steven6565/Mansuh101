/**
 * Generic SQL store shared by SQLite and PostgreSQL.
 * The only differences are the event-id column DDL and placeholder syntax,
 * both handled by the injected driver.
 */
import {
  mapUrl,
  mapRun,
  mapSession,
  mapEvent,
  runRow,
  sessionRow,
  eventRow,
} from './mappers.js';

const SESSION_COLUMNS = [
  'id',
  'run_id',
  'url',
  'status',
  'tab_index',
  'title',
  'final_url',
  'http_status',
  'error',
  'error_code',
  'started_at',
  'finished_at',
  'duration_ms',
  'screenshot',
  'errors',
  'network_failures',
  'attempts',
  'progress',
  'created_at',
];

// camelCase patch keys -> column names for partial session updates
const SESSION_PATCH_COLUMNS = {
  runId: 'run_id',
  url: 'url',
  status: 'status',
  tabIndex: 'tab_index',
  title: 'title',
  finalUrl: 'final_url',
  httpStatus: 'http_status',
  error: 'error',
  errorCode: 'error_code',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  durationMs: 'duration_ms',
  screenshot: 'screenshot',
  errors: 'errors',
  networkFailures: 'network_failures',
  attempts: 'attempts',
  progress: 'progress',
};

const JSON_PATCH_FIELDS = new Set(['errors', 'networkFailures']);

export class SqlStore {
  constructor(driver, dialect) {
    this.driver = driver;
    this.dialect = dialect; // 'sqlite' | 'postgres'
  }

  async init() {
    const eventIdColumn = this.dialect === 'postgres'
      ? 'id BIGSERIAL PRIMARY KEY'
      : 'id INTEGER PRIMARY KEY AUTOINCREMENT';

    await this.driver.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS urls (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        settings TEXT,
        totals TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        url TEXT,
        status TEXT,
        tab_index INTEGER,
        title TEXT,
        final_url TEXT,
        http_status INTEGER,
        error TEXT,
        error_code TEXT,
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER,
        screenshot TEXT,
        errors TEXT,
        network_failures TEXT,
        attempts INTEGER DEFAULT 0,
        progress INTEGER DEFAULT 0,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        ${eventIdColumn},
        run_id TEXT,
        session_id TEXT,
        level TEXT,
        type TEXT,
        message TEXT,
        at TEXT
      );
      CREATE TABLE IF NOT EXISTS auth_tokens (
        token TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_run ON sessions (run_id);
      CREATE INDEX IF NOT EXISTS idx_events_run ON events (run_id);
      CREATE INDEX IF NOT EXISTS idx_events_at ON events (at);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at);
      CREATE INDEX IF NOT EXISTS idx_auth_expiry ON auth_tokens (expires_at);
    `);
  }

  async close() {
    await this.driver.close();
  }

  async getSettings() {
    const row = await this.driver.get('SELECT value FROM settings WHERE key = ?', ['engine']);
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  async saveSettings(settings) {
    await this.driver.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      ['engine', JSON.stringify(settings)],
    );
  }

  async listUrls() {
    const rows = await this.driver.all('SELECT * FROM urls ORDER BY position ASC, created_at ASC');
    return rows.map(mapUrl);
  }

  async addUrls(urls) {
    const existing = new Set((await this.listUrls()).map((u) => u.url));
    let position = Date.now();
    const added = [];
    for (const url of urls) {
      if (existing.has(url.url)) continue;
      const row = {
        id: url.id,
        url: url.url,
        enabled: url.enabled === false ? 0 : 1,
        position: position++,
        created_at: new Date().toISOString(),
      };
      await this.driver.run(
        'INSERT INTO urls (id, url, enabled, position, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (url) DO NOTHING',
        [row.id, row.url, row.enabled, row.position, row.created_at],
      );
      existing.add(row.url);
      added.push(mapUrl(row));
    }
    return added;
  }

  async updateUrl(id, patch) {
    if (typeof patch.enabled === 'boolean') {
      await this.driver.run('UPDATE urls SET enabled = ? WHERE id = ?', [patch.enabled ? 1 : 0, id]);
    }
    return mapUrl(await this.driver.get('SELECT * FROM urls WHERE id = ?', [id]));
  }

  async removeUrl(id) {
    await this.driver.run('DELETE FROM urls WHERE id = ?', [id]);
  }

  async createRun(run) {
    const row = runRow(run);
    await this.driver.run(
      'INSERT INTO runs (id, status, started_at, finished_at, settings, totals) VALUES (?, ?, ?, ?, ?, ?)',
      [row.id, row.status, row.started_at, row.finished_at, row.settings, row.totals],
    );
    return run;
  }

  async updateRun(id, patch) {
    const fields = [];
    const params = [];
    const map = { status: 'status', startedAt: 'started_at', finishedAt: 'finished_at' };
    for (const [key, column] of Object.entries(map)) {
      if (patch[key] !== undefined) {
        fields.push(`${column} = ?`);
        params.push(patch[key]);
      }
    }
    if (patch.totals !== undefined) {
      fields.push('totals = ?');
      params.push(JSON.stringify(patch.totals));
    }
    if (!fields.length) return;
    params.push(id);
    await this.driver.run(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  async getRun(id) {
    return mapRun(await this.driver.get('SELECT * FROM runs WHERE id = ?', [id]));
  }

  async listRuns({ limit = 20, offset = 0 } = {}) {
    const rows = await this.driver.all(
      'SELECT * FROM runs ORDER BY started_at DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
    return rows.map(mapRun);
  }

  async countRuns() {
    const row = await this.driver.get('SELECT COUNT(*) AS count FROM runs');
    return Number(row?.count ?? 0);
  }

  async createSession(session) {
    const row = sessionRow(session);
    const placeholders = SESSION_COLUMNS.map(() => '?').join(', ');
    const values = SESSION_COLUMNS.map((col) => row[col] ?? null);
    await this.driver.run(
      `INSERT INTO sessions (${SESSION_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return session;
  }

  async updateSession(id, patch) {
    const fields = [];
    const params = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = SESSION_PATCH_COLUMNS[key];
      if (!column) continue;
      fields.push(`${column} = ?`);
      params.push(JSON_PATCH_FIELDS.has(key) ? JSON.stringify(value ?? []) : value ?? null);
    }
    if (!fields.length) return;
    params.push(id);
    await this.driver.run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  async getSession(id) {
    return mapSession(await this.driver.get('SELECT * FROM sessions WHERE id = ?', [id]));
  }

  async listSessions({ runId, status, limit = 100, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (runId) {
      where.push('run_id = ?');
      params.push(runId);
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const rows = await this.driver.all(
      `SELECT * FROM sessions ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params,
    );
    return rows.map(mapSession);
  }

  async countSessions({ runId, status } = {}) {
    const where = [];
    const params = [];
    if (runId) {
      where.push('run_id = ?');
      params.push(runId);
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const row = await this.driver.get(`SELECT COUNT(*) AS count FROM sessions ${clause}`, params);
    return Number(row?.count ?? 0);
  }

  async addEvent(event) {
    const row = eventRow(event);
    await this.driver.run(
      'INSERT INTO events (run_id, session_id, level, type, message, at) VALUES (?, ?, ?, ?, ?, ?)',
      [row.run_id, row.session_id, row.level, row.type, row.message, row.at],
    );
  }

  async listEvents({ runId, limit = 200 } = {}) {
    const rows = runId
      ? await this.driver.all(
        'SELECT * FROM events WHERE run_id = ? ORDER BY id DESC LIMIT ?',
        [runId, limit],
      )
      : await this.driver.all('SELECT * FROM events ORDER BY id DESC LIMIT ?', [limit]);
    return rows.map(mapEvent).reverse();
  }

  async clearEvents({ runId } = {}) {
    if (runId) {
      await this.driver.run('DELETE FROM events WHERE run_id = ?', [runId]);
    } else {
      await this.driver.run('DELETE FROM events');
    }
  }

  async saveToken(token, expiresAt) {
    await this.driver.run(
      'INSERT INTO auth_tokens (token, created_at, expires_at) VALUES (?, ?, ?)',
      [token, new Date().toISOString(), expiresAt],
    );
  }

  async getToken(token) {
    return this.driver.get('SELECT * FROM auth_tokens WHERE token = ?', [token]);
  }

  async deleteToken(token) {
    await this.driver.run('DELETE FROM auth_tokens WHERE token = ?', [token]);
  }

  async pruneTokens(now = new Date().toISOString()) {
    await this.driver.run('DELETE FROM auth_tokens WHERE expires_at < ?', [now]);
  }

  async pruneOldData(days) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    await this.driver.run('DELETE FROM events WHERE at < ?', [cutoff]);
    await this.driver.run(
      `DELETE FROM sessions WHERE created_at < ? AND status IN ('completed', 'failed', 'stopped', 'interrupted')`,
      [cutoff],
    );
    await this.driver.run(
      'DELETE FROM runs WHERE started_at < ? AND status IN (?, ?, ?, ?)',
      [cutoff, 'completed', 'failed', 'stopped', 'interrupted'],
    );
    await this.pruneTokens();
  }

  /**
   * Delete every finished run (and its sessions/events) while keeping the
   * URL list, settings and an in-flight run intact. Returns the screenshot
   * filenames so the caller can delete the files too.
   */
  async clearHistory() {
    const terminal = ['completed', 'failed', 'stopped', 'interrupted'];
    const marks = terminal.map(() => '?').join(', ');
    const selectRunIds = `SELECT id FROM runs WHERE status IN (${marks})`;
    const rows = await this.driver.all(
      `SELECT screenshot FROM sessions WHERE run_id IN (${selectRunIds}) AND screenshot IS NOT NULL`,
      terminal,
    );
    const runCount = await this.driver.get(
      `SELECT COUNT(*) AS count FROM runs WHERE status IN (${marks})`,
      terminal,
    );
    await this.driver.run(`DELETE FROM events WHERE run_id IN (${selectRunIds})`, terminal);
    await this.driver.run(`DELETE FROM sessions WHERE run_id IN (${selectRunIds})`, terminal);
    await this.driver.run(`DELETE FROM runs WHERE status IN (${marks})`, terminal);
    return {
      runs: Number(runCount?.count ?? 0),
      screenshots: rows.map((row) => row.screenshot).filter(Boolean),
    };
  }
}
