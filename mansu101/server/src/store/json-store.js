import fs from 'node:fs';
import path from 'node:path';

/**
 * Zero-dependency JSON fallback store.
 * Used only when SQLite/PostgreSQL is unavailable. Same API as SqlStore,
 * with debounced atomic writes so a crash cannot corrupt the file.
 */
export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = {
      settings: null,
      urls: [],
      runs: [],
      sessions: [],
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

  async listUrls() {
    return [...this.data.urls].sort((a, b) => a.position - b.position);
  }

  async addUrls(urls) {
    const existing = new Set(this.data.urls.map((u) => u.url));
    let position = Date.now();
    const added = [];
    for (const entry of urls) {
      if (existing.has(entry.url)) continue;
      const url = {
        id: entry.id,
        url: entry.url,
        enabled: entry.enabled !== false,
        position: position++,
        createdAt: new Date().toISOString(),
      };
      this.data.urls.push(url);
      existing.add(url.url);
      added.push(url);
    }
    if (added.length) this.schedule();
    return added;
  }

  async updateUrl(id, patch) {
    const url = this.data.urls.find((u) => u.id === id);
    if (!url) return null;
    if (typeof patch.enabled === 'boolean') url.enabled = patch.enabled;
    this.schedule();
    return { ...url };
  }

  async removeUrl(id) {
    this.data.urls = this.data.urls.filter((u) => u.id !== id);
    this.schedule();
  }

  async createRun(run) {
    this.data.runs.unshift({ ...run });
    this.schedule();
    return run;
  }

  async updateRun(id, patch) {
    const run = this.data.runs.find((r) => r.id === id);
    if (!run) return;
    Object.assign(run, patch);
    this.schedule();
  }

  async getRun(id) {
    return this.data.runs.find((r) => r.id === id) ?? null;
  }

  async listRuns({ limit = 20, offset = 0 } = {}) {
    return this.data.runs
      .slice()
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(offset, offset + limit);
  }

  async countRuns() {
    return this.data.runs.length;
  }

  async createSession(session) {
    this.data.sessions.push({ ...session });
    this.schedule();
    return session;
  }

  async updateSession(id, patch) {
    const session = this.data.sessions.find((s) => s.id === id);
    if (!session) return;
    Object.assign(session, patch);
    this.schedule();
  }

  async getSession(id) {
    return this.data.sessions.find((s) => s.id === id) ?? null;
  }

  async listSessions({ runId, status, limit = 100, offset = 0 } = {}) {
    return this.data.sessions
      .filter((s) => (!runId || s.runId === runId) && (!status || s.status === status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(offset, offset + limit);
  }

  async countSessions({ runId, status } = {}) {
    return this.data.sessions.filter(
      (s) => (!runId || s.runId === runId) && (!status || s.status === status),
    ).length;
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

  async listEvents({ runId, limit = 200 } = {}) {
    const filtered = runId ? this.data.events.filter((e) => e.runId === runId) : this.data.events;
    return filtered.slice(-limit);
  }

  async clearEvents({ runId } = {}) {
    this.data.events = runId
      ? this.data.events.filter((e) => e.runId !== runId)
      : [];
    this.schedule();
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
    const terminal = new Set(['completed', 'failed', 'stopped', 'interrupted']);
    this.data.events = this.data.events.filter((e) => e.at >= cutoff);
    this.data.sessions = this.data.sessions.filter(
      (s) => s.createdAt >= cutoff || !terminal.has(s.status),
    );
    this.data.runs = this.data.runs.filter((r) => r.startedAt >= cutoff || !terminal.has(r.status));
    await this.pruneTokens();
  }

  async clearHistory() {
    const terminal = new Set(['completed', 'failed', 'stopped', 'interrupted']);
    const removedRunIds = new Set(
      this.data.runs.filter((run) => terminal.has(run.status)).map((run) => run.id),
    );
    const screenshots = this.data.sessions
      .filter((session) => removedRunIds.has(session.runId) && session.screenshot)
      .map((session) => session.screenshot);
    this.data.runs = this.data.runs.filter((run) => !removedRunIds.has(run.id));
    this.data.sessions = this.data.sessions.filter((session) => !removedRunIds.has(session.runId));
    this.data.events = this.data.events.filter((event) => !removedRunIds.has(event.runId));
    this.schedule();
    return { runs: removedRunIds.size, screenshots };
  }
}
