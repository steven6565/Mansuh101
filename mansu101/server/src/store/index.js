import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SqlStore } from './sql-store.js';
import { JsonStore } from './json-store.js';
import { SqliteDriver, PostgresDriver } from './drivers.js';
import { ROOT_DIR, config, normalizeUrl } from '../config.js';

const TERMINAL = new Set(['completed', 'failed', 'stopped', 'interrupted']);

function resolveSqlitePath(databaseUrl) {
  const raw = databaseUrl.replace(/^sqlite:/, '');
  if (raw === ':memory:') return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

export async function createStore(log = console) {
  const url = config.databaseUrl;

  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const driver = new PostgresDriver(url);
    await driver.open();
    const store = new SqlStore(driver, 'postgres');
    await store.init();
    log.info?.('[store] PostgreSQL connected');
    return { store, engine: 'postgres' };
  }

  if (url.startsWith('sqlite:') || url.endsWith('.db') || url.endsWith('.sqlite')) {
    try {
      const driver = new SqliteDriver(resolveSqlitePath(url));
      await driver.open();
      const store = new SqlStore(driver, 'sqlite');
      await store.init();
      log.info?.('[store] SQLite ready');
      return { store, engine: 'sqlite' };
    } catch (error) {
      log.warn?.(`[store] SQLite unavailable (${error.message}); falling back to JSON store`);
    }
  }

  const jsonPath = path.join(config.dataDir, 'mansu101.json');
  const store = new JsonStore(jsonPath);
  await store.init();
  log.info?.('[store] JSON store ready');
  return { store, engine: 'json' };
}

export function readSeedUrls() {
  try {
    const raw = JSON.parse(fs.readFileSync(config.seedFile, 'utf8'));
    const entries = Array.isArray(raw) ? raw : raw.urls ?? [];
    return entries
      .map((entry) => {
        const value = typeof entry === 'string' ? entry : entry?.url;
        const normalized = normalizeUrl(value);
        if (!normalized) return null;
        return {
          id: crypto.randomUUID(),
          url: normalized,
          enabled: typeof entry === 'object' ? entry.enabled !== false : true,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function seedUrls(store, log = console) {
  const existing = await store.listUrls();
  if (existing.length > 0) return existing;
  const seeds = readSeedUrls();
  if (!seeds.length) return existing;
  await store.addUrls(seeds);
  log.info?.(`[store] Seeded ${seeds.length} URL(s) from config/urls.json`);
  return store.listUrls();
}

/**
 * Restart safety: any run/session that was in flight when the process died is
 * marked interrupted instead of looking like it is still running.
 */
export async function recoverInterrupted(store, log = console) {
  const runs = await store.listRuns({ limit: 50 });
  let recovered = 0;
  for (const run of runs) {
    if (!['running', 'paused', 'stopping'].includes(run.status)) continue;
    const sessions = await store.listSessions({ runId: run.id, limit: 5000 });
    for (const session of sessions) {
      if (TERMINAL.has(session.status)) continue;
      await store.updateSession(session.id, {
        status: 'interrupted',
        finishedAt: new Date().toISOString(),
        error: session.error || 'Server restarted before this session finished',
        errorCode: 'SERVER_RESTART',
      });
      recovered += 1;
    }
    await store.updateRun(run.id, {
      status: 'interrupted',
      finishedAt: run.finishedAt || new Date().toISOString(),
    });
    recovered += 1;
  }
  if (recovered) log.warn?.(`[store] Recovered ${recovered} interrupted run/session record(s)`);
  return recovered;
}
