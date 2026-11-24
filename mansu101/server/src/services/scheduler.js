import crypto from 'node:crypto';
import { schedulerConfig } from '../config.js';

/**
 * Background job scheduler.
 *
 * A single-process, persisted job runner:
 *  · jobs are stored as entities ('job') so they survive restarts;
 *  · each job has a type, payload, cron-ish interval, retry budget and state;
 *  · a tick claims due jobs, runs at most one at a time per type, records
 *    duration/error, and retries with backoff up to SCHEDULER_MAX_RETRIES.
 *
 * Job types map 1:1 to real work: Search Console sync, GA4 sync, site audit,
 * daily/weekly report generation. Nothing is simulated.
 */

const KIND = 'job';
const HISTORY_LIMIT = 300;

export class Scheduler {
  constructor({ store, bus, handlers }) {
    this.store = store;
    this.bus = bus;
    this.handlers = handlers;
    this.timer = null;
    this.running = new Set();
    this.lastTickAt = null;
    this.startedAt = null;
  }

  async init() {
    const jobs = await this.store.listEntities(KIND, { limit: 1000 });
    // Any job that was mid-flight when the process stopped is marked failed
    // so it can be retried instead of looking stuck forever.
    for (const job of jobs.filter((item) => item.status === 'running')) {
      await this.store.putEntity(KIND, {
        ...job,
        status: 'pending',
        lastError: 'Interrupted by server restart',
        updatedAt: new Date().toISOString(),
        nextRunAt: new Date().toISOString(),
      });
    }
    if (schedulerConfig.enabled) this.start();
    return this.list();
  }

  start() {
    if (this.timer) return;
    this.startedAt = new Date().toISOString();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.bus.log(`SCHEDULER TICK FAILED — ${error.message}`, { type: 'scheduler', level: 'error' });
      });
    }, schedulerConfig.tickMs);
    this.timer.unref?.();
    this.tick().catch(() => {});
    this.bus.log(`SCHEDULER STARTED — tick every ${Math.round(schedulerConfig.tickMs / 1000)}s`, {
      type: 'scheduler',
      level: 'success',
    });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async list() {
    const jobs = await this.store.listEntities(KIND, { limit: 1000 });
    return jobs.sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)));
  }

  async get(id) {
    return this.store.getEntity(KIND, id);
  }

  async create(input = {}) {
    const type = String(input.type || '');
    if (!this.handlers[type]) {
      const error = new Error(`Unknown job type "${type}". Available: ${Object.keys(this.handlers).join(', ')}`);
      error.status = 400;
      throw error;
    }
    const now = new Date();
    const intervalMinutes = Math.max(0, Number(input.intervalMinutes) || 0);
    const firstRunAt = input.runAt
      ? new Date(input.runAt)
      : new Date(now.getTime() + (Number(input.delayMinutes ?? 0) * 60_000));
    const job = {
      id: crypto.randomUUID(),
      type,
      label: String(input.label || this.handlers[type].label || type).slice(0, 120),
      payload: input.payload ?? {},
      intervalMinutes,
      status: 'pending',
      enabled: input.enabled !== false,
      attempts: 0,
      maxRetries: Number.isFinite(Number(input.maxRetries)) ? Number(input.maxRetries) : schedulerConfig.maxRetries,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt: (Number.isFinite(firstRunAt.getTime()) ? firstRunAt : now).toISOString(),
      lastRunAt: null,
      lastFinishedAt: null,
      lastDurationMs: null,
      lastError: null,
      lastResult: null,
      history: [],
    };
    await this.store.putEntity(KIND, job);
    this.bus.log(`JOB SCHEDULED — ${job.label} (${job.type})`, { type: 'scheduler', level: 'success' });
    return job;
  }

  async update(id, patch = {}) {
    const job = await this.store.getEntity(KIND, id);
    if (!job) {
      const error = new Error('Job not found');
      error.status = 404;
      throw error;
    }
    const next = { ...job };
    if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
    if (patch.label !== undefined) next.label = String(patch.label).slice(0, 120);
    if (patch.intervalMinutes !== undefined) next.intervalMinutes = Math.max(0, Number(patch.intervalMinutes) || 0);
    if (patch.payload !== undefined && typeof patch.payload === 'object') next.payload = patch.payload;
    if (patch.runAt !== undefined) {
      const at = new Date(patch.runAt);
      if (Number.isFinite(at.getTime())) next.nextRunAt = at.toISOString();
    }
    next.updatedAt = new Date().toISOString();
    await this.store.putEntity(KIND, next);
    return next;
  }

  async remove(id) {
    const job = await this.store.getEntity(KIND, id);
    if (!job) return false;
    await this.store.deleteEntity(KIND, id);
    return true;
  }

  /** Run now, ignoring the schedule (used by the dashboard "Run" button). */
  async runNow(id) {
    const job = await this.store.getEntity(KIND, id);
    if (!job) {
      const error = new Error('Job not found');
      error.status = 404;
      throw error;
    }
    if (this.running.has(job.id)) {
      const error = new Error('This job is already running');
      error.status = 409;
      throw error;
    }
    await this.execute(job);
    return this.get(id);
  }

  async tick() {
    this.lastTickAt = new Date().toISOString();
    const jobs = await this.list();
    const now = Date.now();
    for (const job of jobs) {
      if (!job.enabled || job.status === 'running') continue;
      if (this.running.has(job.id)) continue;
      if (new Date(job.nextRunAt).getTime() > now) continue;
      // One job per type at a time keeps resource use predictable.
      if ([...this.running].some((id) => id === job.id)) continue;
      const sameTypeRunning = (await Promise.all([...this.running].map((id) => this.get(id))))
        .some((other) => other?.type === job.type);
      if (sameTypeRunning) continue;
      await this.execute(job);
    }
  }

  async execute(job) {
    const handler = this.handlers[job.type];
    if (!handler) {
      await this.persist(job, {
        status: 'failed',
        lastError: `No handler for job type ${job.type}`,
      });
      return;
    }
    this.running.add(job.id);
    const startedAt = Date.now();
    const runRecord = { at: new Date().toISOString(), status: 'running' };
    await this.persist(job, {
      status: 'running',
      lastRunAt: runRecord.at,
      attempts: (job.attempts ?? 0) + 1,
    });
    this.bus.log(`JOB STARTED — ${job.label}`, { type: 'scheduler' });

    try {
      const result = await handler.run(job.payload ?? {}, { job, bus: this.bus });
      const durationMs = Date.now() - startedAt;
      const attempts = (job.attempts ?? 0) + 1;
      const intervalMinutes = Math.max(0, Number(job.intervalMinutes) || 0);
      const nextRunAt = intervalMinutes
        ? new Date(Date.now() + intervalMinutes * 60_000).toISOString()
        : null;
      await this.persist(job, {
        status: nextRunAt ? 'pending' : 'completed',
        attempts: 0,
        lastFinishedAt: new Date().toISOString(),
        lastDurationMs: durationMs,
        lastError: null,
        lastResult: summarize(result),
        nextRunAt: nextRunAt ?? job.nextRunAt,
        history: pushHistory(job.history, { at: runRecord.at, status: 'success', durationMs, summary: summarize(result) }),
      });
      this.bus.log(`JOB FINISHED — ${job.label} in ${durationMs}ms`, { type: 'scheduler', level: 'success' });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const attempts = (job.attempts ?? 0) + 1;
      const canRetry = attempts <= (job.maxRetries ?? schedulerConfig.maxRetries);
      const backoffMinutes = Math.min(60, 2 ** attempts);
      const nextRunAt = canRetry
        ? new Date(Date.now() + backoffMinutes * 60_000).toISOString()
        : (job.intervalMinutes ? new Date(Date.now() + job.intervalMinutes * 60_000).toISOString() : job.nextRunAt);
      await this.persist(job, {
        status: canRetry ? 'pending' : 'failed',
        lastFinishedAt: new Date().toISOString(),
        lastDurationMs: durationMs,
        lastError: String(error.message || error).slice(0, 500),
        nextRunAt,
        history: pushHistory(job.history, {
          at: runRecord.at,
          status: 'error',
          durationMs,
          error: String(error.message || error).slice(0, 300),
        }),
      });
      this.bus.log(
        `JOB FAILED — ${job.label}: ${String(error.message || error).slice(0, 200)}${canRetry ? ` (retry in ${backoffMinutes}m)` : ''}`,
        { type: 'scheduler', level: 'error' },
      );
      if (schedulerConfig.alertWebhook && !canRetry) {
        notifyWebhook(schedulerConfig.alertWebhook, {
          event: 'job_failed',
          job: { id: job.id, type: job.type, label: job.label },
          error: String(error.message || error).slice(0, 500),
          at: new Date().toISOString(),
        }).catch(() => {});
      }
    } finally {
      this.running.delete(job.id);
    }
  }

  async persist(job, patch) {
    const current = (await this.store.getEntity(KIND, job.id)) ?? job;
    const next = { ...current, ...patch, id: job.id, updatedAt: new Date().toISOString() };
    if (Array.isArray(next.history) && next.history.length > HISTORY_LIMIT) {
      next.history = next.history.slice(-HISTORY_LIMIT);
    }
    await this.store.putEntity(KIND, next);
    return next;
  }

  status() {
    return {
      enabled: schedulerConfig.enabled,
      running: this.running.size,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      tickSeconds: Math.round(schedulerConfig.tickMs / 1000),
    };
  }
}

function summarize(result) {
  if (result === null || result === undefined) return null;
  if (typeof result !== 'object') return String(result).slice(0, 200);
  const out = {};
  for (const [key, value] of Object.entries(result)) {
    if (['rows', 'pages', 'issues', 'score', 'created', 'sent', 'skipped', 'startDate', 'endDate', 'auditId'].includes(key)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

function pushHistory(history = [], entry) {
  return [...(history ?? []), entry].slice(-HISTORY_LIMIT);
}

async function notifyWebhook(url, payload) {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
}

export { notifyWebhook };
