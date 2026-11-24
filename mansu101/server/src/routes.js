import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, BROWSER_PROFILES, screenshotsDir, normalizeUrl } from './config.js';
import { buildReport, reportToCsv } from './report.js';

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function createApi({ store, engine, auth, health, bus }) {
  const router = express.Router();

  // ─── Public ────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      app: 'MANSU101',
      engine: engine.engine,
      browser: engine.browser.state.status,
      uptimeSeconds: Math.round(process.uptime()),
      at: new Date().toISOString(),
    });
  });

  router.post('/auth/login', asyncRoute(async (req, res) => {
    if (auth.disabled) return res.json({ ok: true, authDisabled: true });
    const { token, expiresAt } = await auth.login(req.body?.password, req.ip);
    res.cookie(auth.cookieName, token, auth.cookieOptions(req));
    res.json({ ok: true, expiresAt });
  }));

  router.get('/auth/me', asyncRoute(async (req, res) => {
    res.json(await auth.me(req));
  }));

  router.post('/auth/logout', asyncRoute(async (req, res) => {
    await auth.logout(req, res);
    res.json({ ok: true });
  }));

  // ─── Protected ─────────────────────────────────────────────────────────
  router.use(auth.authenticateRequest.bind(auth));

  router.get('/state', (req, res) => {
    res.json(engine.snapshot());
  });

  router.get('/config', (req, res) => {
    res.json({
      profiles: Object.entries(BROWSER_PROFILES).map(([id, profile]) => ({
        id,
        label: profile.label,
        userAgent: profile.userAgent,
        viewport: profile.viewport,
      })),
      maxConcurrency: config.maxConcurrency,
      authDisabled: auth.disabled,
      vncUrl: config.vncUrl || null,
      retentionDays: config.retentionDays,
      version: '1.0.0',
    });
  });

  router.get('/health/full', asyncRoute(async (req, res) => {
    res.json(health.latest ?? (await health.sample()));
  }));

  // Run controls
  router.post('/run/start', asyncRoute(async (req, res) => {
    const snapshot = await engine.start();
    res.json({ ok: true, state: snapshot });
  }));

  router.post('/run/pause', asyncRoute(async (req, res) => {
    res.json({ ok: true, state: await engine.pause() });
  }));

  router.post('/run/resume', asyncRoute(async (req, res) => {
    res.json({ ok: true, state: await engine.resume() });
  }));

  router.post('/run/stop', asyncRoute(async (req, res) => {
    res.json({ ok: true, state: await engine.stop() });
  }));

  router.post('/run/restart', asyncRoute(async (req, res) => {
    const state = engine.isBusy() ? await engine.stop({ restart: true }) : await engine.start();
    res.json({ ok: true, state });
  }));

  router.post('/sessions/:id/close', asyncRoute(async (req, res) => {
    await engine.closeSession(req.params.id);
    res.json({ ok: true });
  }));

  router.get('/sessions', asyncRoute(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const filters = { runId: req.query.runId, status: req.query.status, limit, offset };
    const [sessions, total] = await Promise.all([
      store.listSessions(filters),
      store.countSessions({ runId: filters.runId, status: filters.status }),
    ]);
    res.json({ sessions, total, limit, offset });
  }));

  router.get('/sessions/:id', asyncRoute(async (req, res) => {
    const session = await store.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const events = await store.listEvents({ runId: session.runId, limit: 1000 });
    res.json({ session, events: events.filter((e) => e.sessionId === session.id) });
  }));

  router.get('/runs', asyncRoute(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const [runs, total] = await Promise.all([
      store.listRuns({ limit, offset }),
      store.countRuns(),
    ]);
    res.json({ runs, total, limit, offset });
  }));

  router.get('/runs/:id', asyncRoute(async (req, res) => {
    const run = await store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const sessions = await store.listSessions({ runId: run.id, limit: 2000 });
    const events = await store.listEvents({ runId: run.id, limit: 1000 });
    res.json({ run, sessions, events });
  }));

  router.get('/reports/export', asyncRoute(async (req, res) => {
    const format = (req.query.format || 'json').toLowerCase();
    let run = req.query.runId ? await store.getRun(String(req.query.runId)) : null;
    if (!run) {
      const runs = await store.listRuns({ limit: 1 });
      run = runs[0] ?? null;
    }
    if (!run) return res.status(404).json({ error: 'No run history to export yet' });
    const sessions = await store.listSessions({ runId: run.id, limit: 5000 });
    const includeEvents = req.query.events === '1';
    const events = includeEvents ? await store.listEvents({ runId: run.id, limit: 5000 }) : [];
    const report = buildReport({ run, sessions, events });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mansu101-${run.id.slice(0, 8)}.csv"`);
      return res.send(reportToCsv(report));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mansu101-${run.id.slice(0, 8)}.json"`);
    return res.send(JSON.stringify(report, null, 2));
  }));

  // URLs
  router.get('/urls', asyncRoute(async (req, res) => {
    res.json({ urls: await store.listUrls() });
  }));

  router.post('/urls', asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    let raw = [];
    if (Array.isArray(body.urls)) raw = body.urls;
    else if (typeof body.urls === 'string') raw = body.urls.split(/\r?\n/);
    else if (typeof body.url === 'string') raw = [body.url];
    raw = raw.map((value) => String(value).trim()).filter(Boolean);
    if (!raw.length) return res.status(400).json({ error: 'Provide at least one URL' });
    const valid = raw.filter((value) => normalizeUrl(value));
    if (!valid.length) {
      return res.status(400).json({ error: 'No valid http(s) URLs provided' });
    }
    const before = await store.listUrls();
    const urls = await engine.addUrls(raw);
    res.status(201).json({
      ok: true,
      urls,
      added: Math.max(0, urls.length - before.length),
      accepted: valid.length,
      rejected: raw.length - valid.length,
    });
  }));

  router.patch('/urls/:id', asyncRoute(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }
    const urls = await engine.toggleUrl(req.params.id, req.body.enabled);
    res.json({ ok: true, urls });
  }));

  router.delete('/urls/:id', asyncRoute(async (req, res) => {
    const urls = await engine.removeUrl(req.params.id);
    res.json({ ok: true, urls });
  }));

  // Settings
  router.get('/settings', (req, res) => {
    res.json({ settings: engine.settings });
  });

  router.put('/settings', asyncRoute(async (req, res) => {
    const settings = await engine.updateSettings(req.body ?? {});
    res.json({ ok: true, settings });
  }));

  // Logs
  router.get('/logs', asyncRoute(async (req, res) => {
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 300));
    const events = await store.listEvents({ runId: req.query.runId, limit });
    res.json({ events });
  }));

  router.post('/logs/clear', asyncRoute(async (req, res) => {
    await engine.clearLogs();
    res.json({ ok: true });
  }));

  router.post('/history/clear', asyncRoute(async (req, res) => {
    const result = await engine.clearHistory();
    res.json({ ok: true, ...result });
  }));

  // Screenshots (cookie-authenticated; filenames are strictly validated)
  router.get('/screenshots/:file', (req, res) => {
    const file = req.params.file;
    if (!/^[a-f0-9-]{16,64}\.jpg$/i.test(file)) {
      return res.status(400).json({ error: 'Invalid screenshot name' });
    }
    const target = path.join(screenshotsDir, file);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Screenshot not found' });
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.sendFile(target);
  });

  router.get('/browser', (req, res) => {
    res.json(engine.browser.snapshot());
  });

  router.post('/browser/restart', asyncRoute(async (req, res) => {
    if (engine.isBusy()) {
      return res.status(409).json({ error: 'Stop the active run before restarting Chromium' });
    }
    await engine.browser.close('operator restart');
    const browser = await engine.browser.launch(engine.settings);
    res.json({ ok: true, browser: browser ? engine.browser.snapshot() : null });
  }));

  router.post('/browser/close', asyncRoute(async (req, res) => {
    if (engine.isBusy()) {
      return res.status(409).json({ error: 'Stop the active run before closing Chromium' });
    }
    await engine.browser.close('operator');
    res.json({ ok: true, browser: engine.browser.snapshot() });
  }));

  router.use((req, res) => res.status(404).json({ error: 'Unknown API route' }));

  // eslint-disable-next-line no-unused-vars
  router.use((error, req, res, next) => {
    const status = error.status && error.status >= 400 ? error.status : 500;
    if (status >= 500) {
      bus.log(`API ERROR — ${error.message}`, { type: 'api', level: 'error' });
    }
    res.status(status).json({ error: error.message || 'Internal server error' });
  });

  return router;
}
