import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  BROWSER_PROFILES,
  sanitizeSettings,
  normalizeUrl,
  config,
  screenshotsDir,
} from '../config.js';

const TERMINAL = new Set(['completed', 'failed', 'stopped', 'interrupted']);
const ACTIVE = new Set(['starting', 'navigating', 'loaded']);

class PauseGate {
  constructor() {
    this.paused = false;
    this.waiters = [];
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  async wait() {
    if (!this.paused) return;
    await new Promise((resolve) => this.waiters.push(resolve));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyError(error, timedOut) {
  const raw = String(error?.message || error || 'Unknown error');
  if (timedOut || /timeout/i.test(raw)) {
    return { code: 'TIMEOUT', label: 'Navigation timed out' };
  }
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|DNS/i.test(raw)) {
    return { code: 'DNS_ERROR', label: 'DNS lookup failed' };
  }
  if (/ERR_CERT|SSL|TLS|certificate/i.test(raw)) {
    return { code: 'SSL_ERROR', label: 'SSL/TLS certificate error' };
  }
  if (/ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i.test(raw)) {
    return { code: 'CONNECTION_ERROR', label: 'Connection failed' };
  }
  if (/ERR_ABORTED/i.test(raw)) {
    return { code: 'ABORTED', label: 'Navigation aborted' };
  }
  if (/net::ERR_/i.test(raw)) {
    return { code: 'NAVIGATION_ERROR', label: 'Navigation error' };
  }
  return { code: 'SESSION_ERROR', label: 'Session error' };
}

export class AutomationEngine {
  constructor({ store, browser, bus }) {
    this.store = store;
    this.browser = browser;
    this.bus = bus;

    this.settings = { ...DEFAULT_SETTINGS };
    this.urls = [];
    this.run = null;
    this.sessions = new Map();
    this.order = [];

    this.gate = new PauseGate();
    this.stopRequested = false;
    this.starting = false;
    this.runPromise = null;
    this.activePages = new Map(); // sessionId -> page
    this.engine = 'idle';
    this.lastError = null;

    this.bus.on('browser:disconnected', () => {
      if (this.engine === 'running' || this.engine === 'paused') {
        this.bus.log('BROWSER LOST — aborting active sessions', {
          type: 'engine',
          level: 'error',
          runId: this.run?.id,
        });
        for (const page of this.activePages.values()) page.close().catch(() => {});
      }
    });

    this.bus.on('browser', () => this._emitState());
  }

  async init() {
    const stored = await this.store.getSettings();
    this.settings = sanitizeSettings(stored ?? {}, DEFAULT_SETTINGS);
    this.urls = await this.store.listUrls();
    this.engine = 'idle';
    this._emitState();
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────

  snapshot() {
    const sessions = this.order
      .map((id) => this.sessions.get(id))
      .filter(Boolean);

    const totals = this.run?.totals ?? {
      total: this.urls.filter((u) => u.enabled).length,
      queued: 0,
      running: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      stopped: 0,
      interrupted: 0,
    };

    return {
      engine: this.engine,
      run: this.run,
      totals,
      sessions,
      urls: this.urls,
      settings: this.settings,
      browser: this.browser.snapshot(),
      vncUrl: config.vncUrl || null,
      limits: {
        maxConcurrency: config.maxConcurrency,
        navigationTimeoutMs: this.settings.navigationTimeoutMs,
      },
      serverTime: new Date().toISOString(),
    };
  }

  _emitState() {
    this.bus.emit('state', this.snapshot());
  }

  _emitRun() {
    this.engine = this.run
      ? ({
        running: 'running',
        paused: 'paused',
        stopping: 'stopping',
        completed: 'completed',
        failed: 'failed',
        stopped: 'stopped',
        interrupted: 'interrupted',
      }[this.run.status] ?? 'idle')
      : 'idle';
    this.bus.emit('run:update', { run: this.run, engine: this.engine, totals: this.run?.totals });
  }

  _emitSession(session) {
    this.bus.emit('session:update', { ...session });
  }

  _log(message, session, level = 'info', type = 'session') {
    return this.bus.log(message, {
      level,
      type,
      runId: this.run?.id ?? null,
      sessionId: session?.id ?? null,
    });
  }

  // ─── Settings & URLs ───────────────────────────────────────────────────

  async updateSettings(patch) {
    this.settings = sanitizeSettings(patch, this.settings);
    await this.store.saveSettings(this.settings);
    this.bus.emit('settings:update', this.settings);
    this._emitState();
    this.bus.log(`SETTINGS UPDATED — concurrency ${this.settings.concurrency}, timeout ${this.settings.navigationTimeoutMs}ms, visits/url ${this.settings.visitsPerUrl}, repeat delay ${this.settings.repeatDelayMs}ms${this.settings.loopUntilStopped ? ', loop until stopped' : ''}, scroll ${this.settings.scrollEnabled ? `on (${this.settings.scrollPasses} pass(es), ${this.settings.scrollStepPx}px/${this.settings.scrollPauseMs}ms)` : 'off'}, internal clicks ${this.settings.clickInternalLinks ? this.settings.clicksPerVisit : 'off'}`, {
      type: 'settings',
    });
    return this.settings;
  }

  async addUrls(rawUrls) {
    const normalized = [...new Set(rawUrls.map(normalizeUrl).filter(Boolean))];
    const rejected = rawUrls.filter((raw) => !normalizeUrl(raw));
    if (normalized.length) {
      const added = await this.store.addUrls(
        normalized.map((url) => ({ id: crypto.randomUUID(), url, enabled: true })),
      );
      this.urls = await this.store.listUrls();
      this.bus.emit('urls:update', this.urls);
      this._emitState();
      this.bus.log(`ADDED ${added.length} URL(S) TO THE QUEUE`, { type: 'urls', level: 'success' });
      if (added.length < normalized.length) {
        this.bus.emit('notice', {
          level: 'warn',
          message: 'Some URLs were already in the list and were skipped.',
        });
      }
    }
    if (rejected.length) {
      this.bus.emit('notice', {
        level: 'warn',
        message: `Rejected ${rejected.length} invalid URL(s). Only http(s) URLs are allowed.`,
      });
    }
    return this.urls;
  }

  async removeUrl(id) {
    const target = this.urls.find((u) => u.id === id);
    await this.store.removeUrl(id);
    this.urls = await this.store.listUrls();
    this.bus.emit('urls:update', this.urls);
    this._emitState();
    if (target) this.bus.log(`REMOVED URL — ${target.url}`, { type: 'urls' });
    return this.urls;
  }

  async toggleUrl(id, enabled) {
    await this.store.updateUrl(id, { enabled });
    this.urls = await this.store.listUrls();
    this.bus.emit('urls:update', this.urls);
    this._emitState();
    return this.urls;
  }

  // ─── Run controls ──────────────────────────────────────────────────────

  isBusy() {
    return Boolean(this.run && !TERMINAL.has(this.run.status));
  }

  async start() {
    if (this.isBusy() || this.starting) {
      const error = new Error('An automation run is already active. Stop it first.');
      error.status = 409;
      throw error;
    }
    const enabled = this.urls.filter((u) => u.enabled);
    if (enabled.length === 0) {
      const error = new Error('No enabled URLs. Add at least one URL before starting.');
      error.status = 400;
      throw error;
    }

    this.starting = true;
    try {
      await this.browser.ensure(this.settings);
    } catch (error) {
      this.lastError = error.message;
      this.bus.log(`CANNOT START — ${error.message}`, { type: 'engine', level: 'error' });
      this.bus.emit('notice', { level: 'error', message: error.message });
      error.status = 503;
      throw error;
    } finally {
      this.starting = false;
    }

    this.stopRequested = false;
    this.gate = new PauseGate();
    this.sessions.clear();
    this.order = [];
    this.activePages.clear();

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    // Repeat visits: every enabled URL is visited `visitsPerUrl` times.
    // When loopUntilStopped is on, the first round is queued here and the
    // workers keep re-queueing the same URLs until Stop is pressed.
    const visitsPerUrl = Math.max(1, this.settings.visitsPerUrl ?? 1);
    const total = enabled.length * visitsPerUrl;
    this.run = {
      id: runId,
      status: 'running',
      startedAt,
      finishedAt: null,
      settings: { ...this.settings },
      totals: {
        total,
        queued: total,
        running: 0,
        completed: 0,
        succeeded: 0,
        failed: 0,
        stopped: 0,
        interrupted: 0,
      },
    };

    await this.store.createRun(this.run);
    this.bus.log(`RUN STARTED — ${enabled.length} URL(s) × ${visitsPerUrl} visit(s) = ${total} session(s), concurrency ${Math.min(this.settings.concurrency, total)}${this.settings.loopUntilStopped ? ', loop until stopped' : ''}`, {
      type: 'run',
      level: 'success',
      runId,
    });

    let tabIndex = 0;
    for (const url of enabled) {
      for (let visit = 1; visit <= visitsPerUrl; visit += 1) {
        tabIndex += 1;
        const session = {
          id: crypto.randomUUID(),
          runId,
          url: url.url,
          status: 'queued',
          stage: 'Queued',
          tabIndex,
          visitNumber: visit,
          title: null,
          finalUrl: null,
          httpStatus: null,
          error: null,
          errorCode: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          screenshot: null,
          screenshotVersion: null,
          errors: [],
          networkFailures: [],
          attempts: 0,
          progress: 0,
          scrolls: 0,
          clicks: 0,
          createdAt: new Date().toISOString(),
        };
        this.sessions.set(session.id, session);
        this.order.push(session.id);
        await this.store.createSession(session);
        this._emitSession(session);
      }
    }

    this._emitRun();
    this._emitState();

    this.runPromise = this._execute(runId).catch((error) => {
      this.lastError = error.message;
      this.bus.log(`RUN FAILED — ${error.message}`, { type: 'run', level: 'error', runId });
    });

    return this.snapshot();
  }

  _nextQueued() {
    for (const id of this.order) {
      const session = this.sessions.get(id);
      if (session?.status === 'queued') return session;
    }
    return null;
  }

  async _execute(runId) {
    const workers = Math.max(
      1,
      Math.min(this.settings.concurrency, config.maxConcurrency, this.sessions.size),
    );
    this._recomputeTotals();
    await Promise.all(Array.from({ length: workers }, () => this._worker()));
    if (this.stopRequested) {
      for (const session of this.sessions.values()) {
        if (session.status === 'queued') {
          this._updateSession(session.id, {
            status: 'stopped',
            stage: 'Stopped',
            finishedAt: new Date().toISOString(),
            progress: 0,
            error: 'Stopped before this URL started',
          });
        }
      }
    }
    await this._finalizeRun(runId);
  }

  async _worker() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.stopRequested) break;
      await this.gate.wait();
      if (this.stopRequested) break;
      const session = this._nextQueued();
      if (!session) break;
      // Wait between two visits of the same URL so repeats are spaced out.
      if ((session.visitNumber ?? 1) > 1 && (this.settings.repeatDelayMs ?? 0) > 0) {
        const keepGoing = await this._delayBetweenVisits(this.settings.repeatDelayMs);
        if (!keepGoing) break;
      }
      await this._processSession(session);
      // Loop mode: queue the same URL once more until Stop is pressed.
      if (this.settings.loopUntilStopped && !this.stopRequested) {
        await this._queueRepeat(session);
      }
    }
  }

  // Sleep in small chunks so Stop / Pause takes effect during the delay.
  async _delayBetweenVisits(ms) {
    const step = 250;
    let remaining = ms;
    while (remaining > 0) {
      if (this.stopRequested) return false;
      await this.gate.wait();
      if (this.stopRequested) return false;
      await sleep(Math.min(step, remaining));
      remaining -= step;
    }
    return !this.stopRequested;
  }

  // Short sleep that stops early when Stop is pressed. Used between
  // scroll steps so a run ends quickly even mid-scroll.
  async _sleepInterruptible(ms) {
    const step = 250;
    let remaining = ms;
    while (remaining > 0) {
      if (this.stopRequested) return false;
      await this.gate.wait();
      if (this.stopRequested) return false;
      await sleep(Math.min(step, remaining));
      remaining -= step;
    }
    return !this.stopRequested;
  }

  // Smooth scrolling, like a real reader: step down to the bottom of the
  // page, pause at each step, then step back up to the top. Going down
  // brings below-fold content and ads into view, which is what makes an
  // ad impression register. Returns the number of passes completed.
  async _scrollPage(page, session) {
    if (!this.settings.scrollEnabled) return 0;
    const step = Math.max(200, this.settings.scrollStepPx ?? 600);
    const pause = Math.max(0, this.settings.scrollPauseMs ?? 1200);
    const passes = Math.max(1, this.settings.scrollPasses ?? 1);
    let done = 0;
    for (let pass = 1; pass <= passes; pass += 1) {
      if (this.stopRequested || page.isClosed()) break;
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      ).catch(() => 0);
      if (!height || height <= 0) break;
      // Down: smooth steps to the bottom.
      let top = 0;
      while (top < height) {
        if (this.stopRequested || page.isClosed()) break;
        top = Math.min(top + step, height);
        await page.evaluate(
          (y) => window.scrollTo({ top: y, behavior: 'smooth' }),
          top,
        ).catch(() => {});
        if (!(await this._sleepInterruptible(pause))) break;
      }
      if (this.stopRequested || page.isClosed()) break;
      // Up: smooth steps back to the top so the visit stays on the page.
      top = height;
      while (top > 0) {
        if (this.stopRequested || page.isClosed()) break;
        top = Math.max(top - step, 0);
        await page.evaluate(
          (y) => window.scrollTo({ top: y, behavior: 'smooth' }),
          top,
        ).catch(() => {});
        if (!(await this._sleepInterruptible(pause))) break;
      }
      if (this.stopRequested || page.isClosed()) break;
      done += 1;
      this._log(`SCROLLED — pass ${pass}/${passes} (down to bottom and back up)`, session, 'info', 'scroll');
    }
    return done;
  }

  // Clicks on same-site internal links only, then comes back to the
  // original page so the visit stays on the website. Ads are never
  // clicked: ad iframes live in a different frame (evaluate() only sees
  // the main page), and any link inside an ad container is skipped.
  // Clicking an ad with a bot is invalid traffic and can get the ad
  // account banned, so this is deliberately excluded.
  async _clickInternalLinks(page, session) {
    if (!this.settings.clickInternalLinks) return 0;
    const maxClicks = Math.max(0, this.settings.clicksPerVisit ?? 0);
    if (maxClicks === 0) return 0;
    let origin = null;
    try {
      origin = new URL(session.url).origin;
    } catch {
      return 0;
    }
    const originalUrl = page.url();
    let clicked = 0;
    const tried = new Set();
    for (let i = 0; i < maxClicks; i += 1) {
      if (this.stopRequested || page.isClosed()) break;
      await this.gate.wait();
      if (this.stopRequested || page.isClosed()) break;
      const handles = await page.$$('a[href]').catch(() => []);
      let target = null;
      for (const handle of handles) {
        const info = await handle.evaluate((el, originValue) => {
          // Skip anything inside an ad container.
          if (el.closest('[id*="adsbygoogle"], [id*="google_ads"], [class*="adsbygoogle"], [class*="advertisement"], [class*="sponsored"]')) return null;
          let u;
          try {
            u = new URL(el.href, location.href);
          } catch {
            return null;
          }
          if (u.origin !== originValue) return null;
          if (u.href === location.href || u.hash) return null;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return null;
          return { href: u.href };
        }, origin).catch(() => null);
        if (info && !tried.has(info.href)) {
          target = { handle, href: info.href };
          break;
        }
      }
      if (!target) break;
      tried.add(target.href);
      await target.handle.click().catch(() => {});
      // Let the click land, then come back to the original page.
      await this._sleepInterruptible(2000);
      if (this.stopRequested || page.isClosed()) break;
      if (page.url() !== originalUrl) {
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(async () => {
          await page.goto(originalUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        });
        await this._sleepInterruptible(1000);
      }
      clicked += 1;
      this._log(`CLICKED internal link — ${target.href}`, session, 'info', 'click');
    }
    return clicked;
  }

  async _queueRepeat(session) {
    if (!this.run) return;
    const next = {
      id: crypto.randomUUID(),
      runId: this.run.id,
      url: session.url,
      status: 'queued',
      stage: 'Queued',
      tabIndex: this.order.length + 1,
      visitNumber: (session.visitNumber ?? 1) + 1,
      title: null,
      finalUrl: null,
      httpStatus: null,
      error: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      screenshot: null,
      screenshotVersion: null,
      errors: [],
      networkFailures: [],
      attempts: 0,
      progress: 0,
      scrolls: 0,
      clicks: 0,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(next.id, next);
    this.order.push(next.id);
    await this.store.createSession(next).catch(() => {});
    this._emitSession(next);
    this._recomputeTotals();
    this._log(`REPEAT QUEUED — ${next.url} (visit ${next.visitNumber})`, next, 'info', 'run');
  }

  _recomputeTotals() {
    if (!this.run) return;
    const totals = {
      total: this.sessions.size,
      queued: 0,
      running: 0,
      completed: 0,
      succeeded: 0,
      failed: 0,
      stopped: 0,
      interrupted: 0,
    };
    for (const session of this.sessions.values()) {
      if (session.status === 'queued') totals.queued += 1;
      if (ACTIVE.has(session.status)) totals.running += 1;
      if (session.status === 'completed') {
        totals.completed += 1;
        totals.succeeded += 1;
      }
      if (session.status === 'failed') {
        totals.completed += 1;
        totals.failed += 1;
      }
      if (session.status === 'stopped') totals.stopped += 1;
      if (session.status === 'interrupted') totals.interrupted += 1;
    }
    this.run.totals = totals;
    this.store.updateRun(this.run.id, { totals }).catch(() => {});
    this._emitRun();
  }

  _updateSession(id, patch, { persist = true } = {}) {
    const session = this.sessions.get(id);
    if (!session) return null;
    Object.assign(session, patch);
    if (persist) {
      this.store.updateSession(id, patch).catch((error) => {
        this.bus.log(`DB WRITE FAILED — ${error.message}`, { type: 'storage', level: 'warn' });
      });
    }
    this._emitSession(session);
    this._recomputeTotals();
    return session;
  }

  async _screenshot(session, page) {
    const filename = `${session.id}.jpg`;
    const target = path.join(screenshotsDir, filename);
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 72,
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    fs.writeFileSync(target, buffer);
    return filename;
  }

  async _processSession(session) {
    const startedAt = Date.now();
    let context = null;
    let page = null;
    let timer = null;
    let screenshotTimer = null;
    let timedOut = false;
    let finished = false;
    const networkFailures = [];
    const jsErrors = [];

    this._updateSession(session.id, {
      status: 'starting',
      stage: 'Creating browser context',
      startedAt: new Date().toISOString(),
      progress: 5,
      attempts: session.attempts + 1,
    });
    this._log(`BROWSER SESSION CREATED — ${session.url}${(session.visitNumber ?? 1) > 1 ? ` (visit ${session.visitNumber})` : ''}`, session, 'info', 'session');

    const finish = (status, extra = {}) => {
      if (finished) return;
      finished = true;
      const durationMs = Date.now() - startedAt;
      this._updateSession(session.id, {
        status,
        finishedAt: new Date().toISOString(),
        durationMs,
        ...extra,
      });
      this._log(
        status === 'completed'
          ? `SESSION COMPLETED — ${durationMs}ms${extra.summary ? `, ${extra.summary}` : ''}`
          : status === 'failed'
            ? `SESSION FAILED — ${extra.error || 'unknown error'}`
            : `SESSION ${String(status).toUpperCase()}`,
        session,
        status === 'completed' ? 'success' : status === 'stopped' ? 'warn' : 'error',
        'session',
      );
    };

    try {
      context = await this.browser.createContext(this.settings);
      page = await context.newPage();
      this.activePages.set(session.id, page);
      page.setDefaultTimeout(this.settings.navigationTimeoutMs);
      page.setDefaultNavigationTimeout(this.settings.navigationTimeoutMs);

      const profile = BROWSER_PROFILES[this.settings.profile] ?? BROWSER_PROFILES['desktop-chrome-windows'];
      const userAgent = this.settings.profile === 'custom'
        ? this.settings.customUserAgent || profile.userAgent
        : profile.userAgent;
      if (userAgent) await page.setUserAgent(userAgent);
      await page.setViewport({
        width: this.settings.viewport.width,
        height: this.settings.viewport.height,
        deviceScaleFactor: profile.viewport.deviceScaleFactor ?? 1,
        isMobile: Boolean(profile.viewport.isMobile),
        hasTouch: Boolean(profile.viewport.hasTouch),
      });
      if (profile.locale) {
        await page.setExtraHTTPHeaders({ 'Accept-Language': `${profile.locale},en;q=0.9` });
      }
      if (profile.timezoneId) {
        await page.emulateTimezone(profile.timezoneId).catch(() => {});
      }
      if (this.settings.blockImages) {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          if (request.resourceType() === 'image') request.abort().catch(() => {});
          else request.continue().catch(() => {});
        });
      }

      page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
      page.on('pageerror', (error) => {
        if (jsErrors.length >= 20) return;
        const entry = { message: String(error.message || error).slice(0, 500), at: new Date().toISOString() };
        jsErrors.push(entry);
        this._updateSession(session.id, { errors: jsErrors }, { persist: false });
        this._log(`JS ERROR — ${entry.message}`, session, 'warn', 'page');
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (jsErrors.length >= 20) return;
        const text = message.text().slice(0, 500);
        jsErrors.push({ message: text, at: new Date().toISOString() });
        this._updateSession(session.id, { errors: jsErrors }, { persist: false });
        this._log(`CONSOLE ERROR — ${text}`, session, 'warn', 'page');
      });
      page.on('requestfailed', (request) => {
        if (networkFailures.length >= 20) return;
        const entry = {
          type: 'request',
          url: request.url(),
          error: request.failure()?.errorText || 'Request failed',
          at: new Date().toISOString(),
        };
        networkFailures.push(entry);
        this._updateSession(session.id, { networkFailures }, { persist: false });
        this._log(`NETWORK FAILURE — ${entry.error}`, session, 'warn', 'network');
      });
      page.on('response', (response) => {
        if (response.status() < 400 || networkFailures.length >= 20) return;
        networkFailures.push({
          type: 'http',
          url: response.url(),
          status: response.status(),
          at: new Date().toISOString(),
        });
        this._updateSession(session.id, { networkFailures }, { persist: false });
      });

      this._updateSession(session.id, {
        status: 'navigating',
        stage: 'Opening tab',
        progress: 20,
      });
      this._log('NEW TAB OPENED', session, 'info', 'browser');
      this._log(`NAVIGATING TO WEBSITE — ${session.url}`, session, 'info', 'navigation');

      timer = setTimeout(() => {
        timedOut = true;
        this._log(`SESSION DURATION EXCEEDED (${this.settings.sessionDurationMs}ms) — closing tab`, session, 'error', 'engine');
        page?.close().catch(() => {});
      }, this.settings.sessionDurationMs);

      if (this.settings.screenshotIntervalMs >= 1000) {
        screenshotTimer = setInterval(() => {
          if (!page || page.isClosed()) return;
          this._screenshot(session, page)
            .then((filename) => {
              this._updateSession(
                session.id,
                { screenshot: filename, screenshotVersion: Date.now() },
                { persist: false },
              );
            })
            .catch(() => {});
        }, this.settings.screenshotIntervalMs);
      }

      this._updateSession(session.id, { stage: 'Waiting for DOM content', progress: 40 });
      const response = await page.goto(session.url, {
        waitUntil: 'domcontentloaded',
        timeout: this.settings.navigationTimeoutMs,
      });

      if (this.settings.blockImages && page) {
        // Image interception is configured above; navigation proceeds normally.
      }

      const httpStatus = response?.status() ?? null;
      this._log('PAGE LOADED — DOM content ready', session, 'info', 'navigation');
      this._log(`HTTP STATUS: ${httpStatus ?? 'none'}`, session, httpStatus && httpStatus >= 400 ? 'warn' : 'info', 'http');

      this._updateSession(session.id, {
        status: 'loaded',
        stage: 'Loading network activity',
        httpStatus,
        finalUrl: page.url(),
        progress: 65,
      });

      if (this.settings.networkIdleTimeoutMs > 0) {
        await page.waitForNetworkIdle({
          idleTime: 700,
          timeout: this.settings.networkIdleTimeoutMs,
        }).catch(() => {});
      }
      if (this.settings.waitAfterLoadMs > 0) {
        await sleep(this.settings.waitAfterLoadMs);
      }

      // Read the page like a visitor: smooth scroll down to the bottom
      // and back up, then click a few same-site internal links and come
      // back. Scrolling brings below-fold ads into view (impressions);
      // clicks are internal links only, never ads.
      let scrolls = 0;
      let clicks = 0;
      if (!timedOut && !page.isClosed()) {
        this._updateSession(session.id, { stage: 'Scrolling page', progress: 80 });
        scrolls = await this._scrollPage(page, session);
        if (!this.stopRequested && !page.isClosed() && !timedOut) {
          this._updateSession(session.id, { stage: 'Clicking internal links', progress: 88 });
          clicks = await this._clickInternalLinks(page, session);
        }
        // Counts are in-memory only (like visitNumber) and shown in logs.
        this._updateSession(session.id, { scrolls, clicks }, { persist: false });
        if (scrolls > 0 || clicks > 0) {
          this._log(`PAGE READ — ${scrolls} scroll pass(es), ${clicks} internal click(s)`, session, 'info', 'scroll');
        }
      }

      const title = await page.title().catch(() => null);
      this._updateSession(session.id, {
        title: title ? title.slice(0, 300) : null,
        finalUrl: page.url(),
        progress: 90,
        stage: 'Capturing screenshot',
      });

      let screenshot = null;
      if (!timedOut && !page.isClosed()) {
        screenshot = await this._screenshot(session, page).catch(() => null);
        if (screenshot) {
          this._updateSession(session.id, {
            screenshot,
            screenshotVersion: Date.now(),
            errors: jsErrors,
            networkFailures,
            progress: 95,
          });
          this._log('SCREENSHOT CAPTURED', session, 'info', 'browser');
        }
      }

      if (timedOut) {
        finish('failed', {
          error: `Session duration limit (${this.settings.sessionDurationMs}ms) exceeded`,
          errorCode: 'TIMEOUT',
          errors: jsErrors,
          networkFailures,
        });
      } else if (httpStatus === null) {
        finish('failed', {
          error: 'No HTTP response received',
          errorCode: 'NO_RESPONSE',
          errors: jsErrors,
          networkFailures,
        });
      } else if (httpStatus >= 400) {
        finish('failed', {
          httpStatus,
          error: `HTTP ${httpStatus}`,
          errorCode: 'HTTP_ERROR',
          errors: jsErrors,
          networkFailures,
        });
      } else {
        finish('completed', {
          httpStatus,
          errors: jsErrors,
          networkFailures,
          progress: 100,
          stage: 'Completed',
          summary: (scrolls > 0 || clicks > 0) ? `${scrolls} scroll pass(es), ${clicks} internal click(s)` : undefined,
        });
      }
    } catch (error) {
      const classification = classifyError(error, timedOut);
      if (this.stopRequested || session.operatorClosed) {
        finish('stopped', {
          error: session.operatorClosed ? 'Closed by operator' : 'Stopped by operator',
          errorCode: 'STOPPED',
          errors: jsErrors,
          networkFailures,
        });
      } else {
        finish('failed', {
          error: classification.label === 'Session error'
            ? String(error?.message || error).slice(0, 500)
            : `${classification.label}: ${String(error?.message || error).slice(0, 300)}`,
          errorCode: classification.code,
          errors: jsErrors,
          networkFailures,
        });
      }
      this.bus.log(
        `NAVIGATION ERROR [${classification.code}] — ${String(error?.message || error).slice(0, 300)}`,
        { type: 'navigation', level: 'error', runId: this.run?.id, sessionId: session.id },
      );
    } finally {
      if (timer) clearTimeout(timer);
      if (screenshotTimer) clearInterval(screenshotTimer);
      this.activePages.delete(session.id);
      if (page) await page.close().catch(() => {});
      if (context) await this.browser.releaseContext(context);
      if (!finished) finish('failed', { error: 'Session ended unexpectedly', errorCode: 'UNKNOWN' });
    }
  }

  async _finalizeRun(runId) {
    if (!this.run || this.run.id !== runId) return;
    const stopped = this.stopRequested;
    this.run.status = stopped ? 'stopped' : 'completed';
    this.run.finishedAt = new Date().toISOString();
    this._recomputeTotals();
    await this.store.updateRun(runId, {
      status: this.run.status,
      finishedAt: this.run.finishedAt,
      totals: this.run.totals,
    }).catch(() => {});
    const t = this.run.totals;
    this.bus.log(
      `${stopped ? 'RUN STOPPED' : 'RUN COMPLETED'} — ${t.succeeded}/${t.total} succeeded, ${t.failed} failed, ${t.stopped} stopped`,
      { type: 'run', level: stopped ? 'warn' : t.failed > 0 ? 'warn' : 'success', runId },
    );
    this.engine = this.run.status;
    this._emitRun();
    this._emitState();
    this.runPromise = null;
    this.browser.scheduleIdleClose();
  }

  async pause() {
    if (!this.run || this.run.status !== 'running') {
      const error = new Error('No running automation to pause.');
      error.status = 409;
      throw error;
    }
    this.gate.pause();
    this.run.status = 'paused';
    await this.store.updateRun(this.run.id, { status: 'paused' });
    this._log('RUN PAUSED — active tabs finish, queue is held', null, 'warn', 'run');
    this._emitRun();
    this._emitState();
    return this.snapshot();
  }

  async resume() {
    if (!this.run || this.run.status !== 'paused') {
      const error = new Error('Automation is not paused.');
      error.status = 409;
      throw error;
    }
    this.run.status = 'running';
    this.gate.resume();
    await this.store.updateRun(this.run.id, { status: 'running' });
    this._log('RUN RESUMED', null, 'success', 'run');
    this._emitRun();
    this._emitState();
    return this.snapshot();
  }

  async stop({ restart = false } = {}) {
    if (!this.run || TERMINAL.has(this.run.status)) {
      if (restart) return this.start();
      const error = new Error('No active automation run.');
      error.status = 409;
      throw error;
    }
    const runId = this.run.id;
    this._log(restart ? 'RESTART REQUESTED — stopping current run' : 'STOP REQUESTED — closing active tabs', null, 'warn', 'run');
    this.stopRequested = true;
    this.run.status = 'stopping';
    this.gate.resume();
    await this.store.updateRun(runId, { status: 'stopping' });
    this._emitRun();
    this._emitState();

    const pages = [...this.activePages.values()];
    await Promise.all(pages.map((page) => page.close().catch(() => {})));

    if (this.runPromise) {
      await Promise.race([this.runPromise, sleep(15000)]);
    }
    this.gate = new PauseGate();
    this.stopRequested = false;

    if (restart) {
      await sleep(200);
      return this.start();
    }
    return this.snapshot();
  }

  async closeSession(id) {
    const session = this.sessions.get(id);
    if (!session) {
      const error = new Error('Session not found');
      error.status = 404;
      throw error;
    }
    if (!ACTIVE.has(session.status)) {
      const error = new Error('This session is not active');
      error.status = 409;
      throw error;
    }
    session.operatorClosed = true;
    this._log('TAB CLOSE REQUESTED BY OPERATOR', session, 'warn', 'browser');
    const page = this.activePages.get(id);
    await page?.close().catch(() => {});
    return true;
  }

  async clearLogs() {
    await this.store.clearEvents();
    this.bus.emit('logs:cleared');
    this._log('LOG BUFFER CLEARED', null, 'warn', 'system');
    return true;
  }

  /**
   * Clear stored run history. Refuses while a run is in flight so the live
   * dashboard state never points at deleted rows.
   */
  async clearHistory() {
    if (this.isBusy()) {
      const error = new Error('Stop the active run before clearing history');
      error.status = 409;
      throw error;
    }
    const result = await this.store.clearHistory();
    for (const file of result.screenshots) {
      await fs.promises.unlink(path.join(screenshotsDir, file)).catch(() => {});
    }
    this.sessions.clear();
    this.order = [];
    this.run = null;
    this.engine = 'idle';
    this.bus.emit('history:cleared');
    this._emitState();
    this.bus.log(
      `HISTORY CLEARED — ${result.runs} run(s), ${result.screenshots.length} screenshot(s) removed`,
      { type: 'maintenance', level: 'warn' },
    );
    return result;
  }

  activeSummary() {
    let active = 0;
    let current = null;
    for (const session of this.sessions.values()) {
      if (ACTIVE.has(session.status)) {
        active += 1;
        if (!current) current = session;
      }
    }
    return { active, current };
  }
}
