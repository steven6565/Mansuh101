import fs from 'node:fs';
import path from 'node:path';

/**
 * Zero-dependency JSON fallback store.
 * Used only when SQLite/PostgreSQL is unavailable. Same API as SqlStore,
 * with debounced atomic writes so a crash cannot corrupt the file.
 *
 * Holds the shared state (settings, activity events, dashboard sessions) and
 * receives the SEO entity/metric methods from store/index.js.
 */
export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = {
      settings: null,
      events: [],
      tokens: [],
      nextEventId: 1,
    };
    this.timer = null;
    this.closed = false;
  }

  async init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...this.data, ...parsed };
      } catch {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        fs.copyFileSync(this.file, backup);
      }
    }
    await this.flush();
  }

  schedule() {
    if (this.closed) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, 150);
    this.timer.unref?.();
  }

  async flush() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  async close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
  }

  async getSettings() {
    return this.data.settings;
  }

  async saveSettings(settings) {
    this.data.settings = settings;
    this.schedule();
  }

  async addEvent(event) {
    const stored = { ...event, id: this.data.nextEventId++ };
    this.data.events.push(stored);
    if (this.data.events.length > 8000) {
      this.data.events.splice(0, this.data.events.length - 8000);
    }
    this.schedule();
    return stored;
  }

  async listEvents({ limit = 200 } = {}) {
    return this.data.events.slice(-limit);
  }

  async clearEvents() {
    this.data.events = [];
    this.schedule();
  }

  async countEvents() {
    return this.data.events.length;
  }

  async saveToken(token, expiresAt) {
    this.data.tokens.push({ token, createdAt: new Date().toISOString(), expiresAt });
    this.schedule();
  }

  async getToken(token) {
    return this.data.tokens.find((t) => t.token === token) ?? null;
  }

  async deleteToken(token) {
    this.data.tokens = this.data.tokens.filter((t) => t.token !== token);
    this.schedule();
  }

  async pruneTokens(now = new Date().toISOString()) {
    this.data.tokens = this.data.tokens.filter((t) => t.expiresAt >= now);
    this.schedule();
  }

  async pruneOldData(days) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    this.data.events = this.data.events.filter((e) => e.at >= cutoff);
    await this.pruneTokens();
  }
}
