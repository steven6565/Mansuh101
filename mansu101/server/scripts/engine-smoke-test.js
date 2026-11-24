/**
 * Engine smoke test with a fake Chromium implementation.
 * Verifies queueing, concurrency, HTTP/JS/network capture, error
 * classification, per-session timeout, persistence and final totals
 * without requiring Chromium (useful on dev machines / CI).
 *
 * Run: node server/scripts/engine-smoke-test.js
 *      node server/scripts/engine-smoke-test.js --sqlite   (exercise the SQL store)
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Isolate screenshots (and any other artefacts) from the real ./data directory
// before the config module is evaluated. Static imports are hoisted, so the
// app modules are loaded dynamically below.
const useSqlite = process.argv.includes('--sqlite');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mansu-smoke-'));
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.DATABASE_URL = `sqlite:${path.join(tempDir, 'unused.db')}`;

const { JsonStore } = await import('../src/store/json-store.js');
const { AutomationEngine } = await import('../src/engine/runner.js');
const { bus } = await import('../src/bus.js');
const { screenshotsDir } = await import('../src/config.js');

let store;
if (useSqlite) {
  const { SqliteDriver } = await import('../src/store/drivers.js');
  const { SqlStore } = await import('../src/store/sql-store.js');
  const driver = new SqliteDriver(path.join(tempDir, 'smoke.db'));
  await driver.open();
  store = new SqlStore(driver, 'sqlite');
  await store.init();
  console.log('store: sqlite (node:sqlite)');
} else {
  store = new JsonStore(path.join(tempDir, 'db.json'));
  await store.init();
  console.log('store: json');
}

class FakePage {
  constructor(url) {
    this.urlValue = 'about:blank';
    this.closed = false;
    this.handlers = new Map();
    this.rejectGoto = null;
  }

  static behaviourFor(url) {
    if (url.includes('dns-fail')) return { dns: true };
    if (url.includes('hang')) return { hang: true };
    if (url.includes('status-404')) return { status: 404 };
    return { status: 200 };
  }

  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}
  async setUserAgent() {}
  async setViewport() {}
  async setExtraHTTPHeaders() {}
  async emulateTimezone() {}
  async setRequestInterception() {}
  on(event, handler) { this.handlers.set(event, handler); }
  isClosed() { return this.closed; }

  async goto(url) {
    this.urlValue = url;
    this.behaviour = FakePage.behaviourFor(url);
    if (this.behaviour.hang) {
      return new Promise((resolve, reject) => { this.rejectGoto = reject; });
    }
    if (this.behaviour.dns) {
      throw new Error('net::ERR_NAME_NOT_RESOLVED at ' + url);
    }
    if (this.behaviour.status === 200) {
      this.handlers.get('console')?.({ type: () => 'error', text: () => 'Fake console error' });
      this.handlers.get('pageerror')?.(new Error('Fake uncaught error'));
      this.handlers.get('requestfailed')?.({
        url: () => 'https://cdn.example/broken.js',
        failure: () => ({ errorText: 'net::ERR_FAILED' }),
      });
      this.handlers.get('response')?.({
        status: () => 200,
        url: () => url,
      });
    }
    if (this.behaviour.status === 404) {
      this.handlers.get('response')?.({ status: () => 404, url: () => url });
    }
    return { status: () => this.behaviour.status };
  }

  async waitForNetworkIdle() {}
  async title() { return 'Fake page title'; }
  url() { return this.urlValue; }
  async screenshot() { return Buffer.from('fake-jpeg-bytes'); }

  async close() {
    this.closed = true;
    this.rejectGoto?.(new Error('Target closed'));
  }
}

const urls = [
  'https://success.test/page',
  'https://status-404.test/page',
  'https://dns-fail.test/page',
  'https://hang.test/page',
];
const urlQueue = [];
const fakeBrowser = {
  status: { status: 'online', activeContexts: 0 },
  snapshot() { return { status: 'online', activeContexts: 0, version: 'FakeChromium/1.0' }; },
  async ensure() {},
  async launch() {},
  async close() {},
  scheduleIdleClose() {},
  async createContext() {
    const url = urlQueue.shift() ?? 'https://success.test/default';
    return {
      newPage: async () => new FakePage(url),
      close: async () => {},
    };
  },
  async releaseContext() {},
};

const engine = new AutomationEngine({ store, browser: fakeBrowser, bus });
await engine.init();
await engine.updateSettings({
  concurrency: 2,
  navigationTimeoutMs: 2500,
  sessionDurationMs: 1500,
  screenshotIntervalMs: 0,
  waitAfterLoadMs: 0,
  networkIdleTimeoutMs: 0,
  viewport: { width: 800, height: 600 },
  profile: 'desktop-chrome-windows',
  headless: true,
  blockImages: false,
});

await engine.addUrls(urls);
urlQueue.push(...urls);

await engine.start();
const deadline = Date.now() + 15000;
while (engine.engine !== 'completed' && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const snapshot = engine.snapshot();
const byUrl = Object.fromEntries(snapshot.sessions.map((session) => [session.url, session]));

console.log('\n--- engine smoke results ---');
console.log('engine state:', snapshot.engine);
console.log('totals:', snapshot.totals);
for (const session of snapshot.sessions) {
  console.log(
    `${session.tabIndex}. ${session.url} -> ${session.status}` +
    ` [${session.errorCode ?? 'OK'}] http=${session.httpStatus ?? '-'} ` +
    `js=${session.errors.length} net=${session.networkFailures.length} shot=${session.screenshot ? 'yes' : 'no'} err=${session.error ?? '-'}`,
  );
}

assert.equal(snapshot.engine, 'completed', 'engine should complete');
assert.equal(snapshot.totals.total, 4, '4 sessions');
assert.equal(byUrl['https://success.test/page'].status, 'completed');
assert.equal(byUrl['https://success.test/page'].httpStatus, 200);
assert.equal(byUrl['https://success.test/page'].errors.length, 2, 'console + pageerror captured');
assert.equal(byUrl['https://success.test/page'].networkFailures.length, 1, 'request failure captured');
assert.ok(byUrl['https://success.test/page'].screenshot, 'screenshot recorded');
assert.equal(byUrl['https://status-404.test/page'].status, 'failed');
assert.equal(byUrl['https://status-404.test/page'].errorCode, 'HTTP_ERROR');
assert.equal(byUrl['https://dns-fail.test/page'].errorCode, 'DNS_ERROR');
assert.equal(byUrl['https://hang.test/page'].errorCode, 'TIMEOUT');
assert.equal(snapshot.totals.succeeded, 1);
assert.equal(snapshot.totals.failed, 3);

const storedRun = await store.getRun(snapshot.run.id);
assert.equal(storedRun.status, 'completed', 'run persisted');
const storedSessions = await store.listSessions({ runId: snapshot.run.id, limit: 10 });
assert.equal(storedSessions.length, 4, 'sessions persisted');

// ── Phase 2: pause / resume / stop controls against hanging tabs ──────────
urlQueue.push('https://hang-one.test', 'https://hang-two.test', 'https://hang-three.test');
await engine.start();
await new Promise((resolve) => setTimeout(resolve, 500));
assert.equal(engine.engine, 'running', 'second run running');
await engine.pause();
assert.equal(engine.engine, 'paused', 'run pauses');
await engine.resume();
assert.equal(engine.engine, 'running', 'run resumes');
await new Promise((resolve) => setTimeout(resolve, 300));
await engine.stop();
const stopDeadline = Date.now() + 5000;
while (engine.engine === 'running' && Date.now() < stopDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const stoppedSnapshot = engine.snapshot();
assert.equal(stoppedSnapshot.run.status, 'stopped', 'run marked stopped');
assert.ok(
  stoppedSnapshot.sessions.every((session) => ['stopped', 'completed', 'failed'].includes(session.status)),
  'no sessions left running after stop',
);
assert.ok(stoppedSnapshot.sessions.some((session) => session.status === 'stopped'), 'sessions stopped by operator');
console.log('pause/resume/stop controls: OK');

// ── Phase 3: close a single active tab via operator action ────────────────
urlQueue.push('https://hang-single.test');
await engine.start();
let closeDeadline = Date.now() + 4000;
let activeSession = null;
while (Date.now() < closeDeadline && !activeSession) {
  activeSession = engine.snapshot().sessions.find((session) => session.status === 'navigating');
  if (!activeSession) await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(activeSession, 'active tab available to close');
await engine.closeSession(activeSession.id);
closeDeadline = Date.now() + 5000;
let closedSession = null;
while (Date.now() < closeDeadline && !closedSession) {
  closedSession = engine.snapshot().sessions.find((session) => session.id === activeSession.id && session.status === 'stopped');
  if (!closedSession) await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(closedSession, 'operator-closed tab marked stopped');
console.log('single-tab close control: OK');

// ── Phase 4: history clearing (with screenshot file deletion) ─────────────
// Make sure the phase-3 run has fully settled before starting a new one.
if (engine.isBusy()) await engine.stop();
{
  const settle = Date.now() + 5000;
  while (engine.isBusy() && Date.now() < settle) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
urlQueue.push('https://hang-clear.test');
await engine.start();
await new Promise((resolve) => setTimeout(resolve, 300));
let blocked = false;
try {
  await engine.clearHistory();
} catch (error) {
  blocked = error.status === 409;
}
assert.ok(blocked, 'history clearing blocked while a run is active');
await engine.stop();
const clearDeadline = Date.now() + 5000;
while (engine.isBusy() && Date.now() < clearDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const shotsBefore = engine.snapshot().sessions.filter((session) => session.screenshot).map((s) => s.screenshot);
const cleared = await engine.clearHistory();
assert.ok(cleared.runs >= 1, 'at least one finished run cleared');
assert.equal(await store.countRuns(), 0, 'no runs left after clearing history');
assert.equal((await store.listSessions({ limit: 100 })).length, 0, 'no sessions left after clearing history');
assert.equal(engine.snapshot().sessions.length, 0, 'live session list emptied');
for (const file of shotsBefore) {
  assert.ok(!fs.existsSync(path.join(screenshotsDir, file)), 'screenshot file deleted with history');
}
assert.equal((await store.listUrls()).length > 0, true, 'URL queue preserved');
console.log('history clearing: OK');

for (const session of [...snapshot.sessions, ...stoppedSnapshot.sessions, ...engine.snapshot().sessions]) {
  if (session.screenshot) {
    fs.rmSync(path.join(screenshotsDir, session.screenshot), { force: true });
  }
}
await store.close();
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('\nSMOKE TEST PASSED ✅\n');
process.exit(0);
