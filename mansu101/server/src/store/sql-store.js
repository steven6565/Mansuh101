/**
 * Generic SQL store shared by SQLite and PostgreSQL.
 * The only differences are the event-id column DDL and placeholder syntax,
 * both handled by the injected driver.
 *
 * This store keeps the small pieces of shared state that are not SEO
 * documents: UI/settings JSON, the activity event log and dashboard auth
 * sessions. SEO entities and metric rows live in SeoStore.
 */
import { mapEvent, eventRow } from './mappers.js';

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
      CREATE INDEX IF NOT EXISTS idx_events_at ON events (at);
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

  async addEvent(event) {
    const row = eventRow(event);
    await this.driver.run(
      'INSERT INTO events (run_id, session_id, level, type, message, at) VALUES (?, ?, ?, ?, ?, ?)',
      [row.run_id, row.session_id, row.level, row.type, row.message, row.at],
    );
  }

  async listEvents({ limit = 200 } = {}) {
    const rows = await this.driver.all('SELECT * FROM events ORDER BY id DESC LIMIT ?', [limit]);
    return rows.map(mapEvent).reverse();
  }

  async clearEvents() {
    await this.driver.run('DELETE FROM events');
  }

  async countEvents() {
    const row = await this.driver.get('SELECT COUNT(*) AS count FROM events');
    return Number(row?.count ?? 0);
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

  /** Retention: drop old activity events and expired login sessions. */
  async pruneOldData(days) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    await this.driver.run('DELETE FROM events WHERE at < ?', [cutoff]);
    await this.pruneTokens();
  }
}
