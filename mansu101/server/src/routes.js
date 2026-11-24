import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, googleConfig, schedulerConfig, securityConfig, crawlerConfig, screenshotsDir, runtimeInfo, BROWSER_PROFILES } from './config.js';
import { displayUrl } from './runtime.js';
import { createRateLimiter, originGuard, asyncRoute, asString, asInt, asEnum, ValidationError } from './lib/http.js';
import { cacheable } from './lib/response.js';
import { buildSitemap } from './lib/robots.js';
import { verifyConnection as verifyEmail } from './lib/smtp.js';
import { vault } from './lib/vault.js';

/**
 * Visitor REST API.
 *
 * Every analytics number returned here is either (a) stored Google Search
 * Console / GA4 data, or (b) the result of a crawl the user requested. There
 * is no endpoint that generates traffic, clicks or impressions.
 */
export function createApi({
  store,
  sites,
  google,
  keywords,
  campaigns,
  content,
  audits,
  reports,
  scheduler,
  health,
  auth,
  bus,
}) {
  const router = express.Router();
  const readLimit = createRateLimiter({ max: securityConfig.rateLimitPerMinute, key: 'read' });
  const writeLimit = createRateLimiter({ max: Math.round(securityConfig.rateLimitPerMinute / 5), key: 'write' });
  const expensiveLimit = createRateLimiter({ max: securityConfig.expensiveLimitPerMinute, key: 'expensive' });

  router.use(originGuard);

  // ─── Public ────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      app: config.appName,
      version: config.version,
      uptimeSeconds: Math.round(process.uptime()),
      scheduler: scheduler.status(),
      google: { configured: google.isConfigured() },
      at: new Date().toISOString(),
    });
  });

  router.post('/auth/login', writeLimit, asyncRoute(async (req, res) => {
    if (auth.disabled) return res.json({ ok: true, authDisabled: true });
    const password = asString(req.body?.password, { max: 400, field: 'password' });
    const { token, expiresAt } = await auth.login(password, req.ip);
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

  // Google calls this back directly; the signed state is what authorises it.
  router.get('/integrations/google/callback', asyncRoute(async (req, res) => {
    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    const entry = google.consumeState(state);
    if (!entry) {
      return res.status(400).send(oauthPage('Connection failed', 'This authorisation link is invalid or has expired. Start again from the dashboard.'));
    }
    if (req.query.error) {
      return res.status(400).send(oauthPage('Connection cancelled', String(req.query.error_description || req.query.error)));
    }
    if (!code) {
      return res.status(400).send(oauthPage('Connection failed', 'Google did not return an authorisation code.'));
    }
    try {
      const integration = await google.exchangeCode(code);
      await google.listProperties().catch((error) => {
        bus.log(`PROPERTY DISCOVERY FAILED — ${error.message}`, { type: 'integration', level: 'warn' });
      });
      if (integration.email) bus.log(`GOOGLE CONNECTED AS ${integration.email}`, { type: 'integration', level: 'success' });
      return res.send(oauthPage('Google account connected', 'You can close this window and return to the dashboard.', '/integrations'));
    } catch (error) {
      bus.log(`GOOGLE OAUTH FAILED — ${error.message}`, { type: 'integration', level: 'error' });
      return res.status(400).send(oauthPage('Connection failed', error.message));
    }
  }));

  // ─── Protected ─────────────────────────────────────────────────────────
  router.use(auth.authenticateRequest.bind(auth));
  router.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? readLimit(req, res, next) : writeLimit(req, res, next)));

  // ── Bootstrap payload: everything the shell needs in one request ──────
  router.get('/bootstrap', asyncRoute(async (req, res) => {
    const [siteList, integration, jobs, recentAudits, recentReports] = await Promise.all([
      sites.list(),
      google.loadIntegration(),
      scheduler.list(),
      store.listEntities('audit', { limit: 5 }),
      reports.list({ limit: 5 }),
    ]);
    res.json({
      app: {
        name: config.appName,
        version: config.version,
        env: config.env,
        publicUrl: config.publicUrl || null,
        authDisabled: auth.disabled,
        retentionDays: config.retentionDays,
        timezone: schedulerConfig.timezone,
      },
      integrations: {
        google: google.publicIntegration(integration),
        email: verifyEmail(),
        vault: vault.status(),
      },
      profiles: Object.entries(BROWSER_PROFILES).map(([id, profile]) => ({
        id,
        label: profile.label,
        viewport: profile.viewport,
      })),
      sites: siteList,
      jobs,
      recentAudits,
      recentReports,
      scheduler: scheduler.status(),
      limits: {
        maxAuditPages: crawlerConfig.maxPages,
        maxConcurrency: config.maxConcurrency,
        rateLimitPerMinute: securityConfig.rateLimitPerMinute,
        expensivePerMinute: securityConfig.expensiveLimitPerMinute,
      },
    });
  }));

  // ── Sites ─────────────────────────────────────────────────────────────
  router.get('/sites', asyncRoute(async (req, res) => {
    res.json({ sites: await sites.list() });
  }));

  router.post('/sites', asyncRoute(async (req, res) => {
    const site = await sites.create(req.body ?? {});
    res.status(201).json({ site });
  }));

  router.get('/sites/:id', asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  router.patch('/sites/:id', asyncRoute(async (req, res) => {
    res.json({ site: await sites.update(req.params.id, req.body ?? {}) });
  }));

  router.delete('/sites/:id', asyncRoute(async (req, res) => {
    const removed = await sites.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Site not found' });
    res.json({ ok: true });
  }));

  // ── Overview / analytics ──────────────────────────────────────────────
  router.get('/sites/:id/overview', asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { from, to } = windowOf(req.query);
    const previous = previousWindow(from, to);

    const [
      gsc, gscPrev, ga4, ga4Prev,
      topQueries, topPages, countries, devices, ga4Sources, ga4Landings,
    ] = await Promise.all([
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'date', groupBy: 'none', from, to }),
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'date', groupBy: 'none', from: previous.from, to: previous.to }),
      store.aggregateMetrics({ siteId: site.id, source: 'ga4', dimension: 'date', groupBy: 'none', from, to }),
      store.aggregateMetrics({ siteId: site.id, source: 'ga4', dimension: 'date', groupBy: 'none', from: previous.from, to: previous.to }),
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'query', groupBy: 'key', from, to, limit: 10 }),
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'page', groupBy: 'key', from, to, limit: 10 }),
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'country', groupBy: 'key', from, to, limit: 8 }),
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'device', groupBy: 'key', from, to, limit: 4 }),
      store.aggregateMetrics({ siteId: site.id, source: 'ga4', dimension: 'source', groupBy: 'key', from, to, limit: 8, orderBy: 'sessions' }),
      store.aggregateMetrics({ siteId: site.id, source: 'ga4', dimension: 'landing', groupBy: 'key', from, to, limit: 8, orderBy: 'sessions' }),
    ]);

    const [gscSeries, ga4Series] = await Promise.all([
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'date', groupBy: 'date', from, to, limit: 400 }),
      store.aggregateMetrics({ siteId: site.id, source: 'ga4', dimension: 'date', groupBy: 'date', from, to, limit: 400 }),
    ]);

    const auditList = await store.listEntities('audit', { limit: 100 });
    const siteAudits = auditList
      .filter((audit) => audit.siteId === site.id)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const keywordList = await store.listEntities('keyword', { limit: 2000 });
    const trackedKeywords = keywordList.filter((keyword) => keyword.siteId === site.id).length;

    cacheable(res, 45);
    res.json({
      site,
      range: { from, to, previous },
      searchConsole: {
        current: gsc[0] ?? null,
        previous: gscPrev[0] ?? null,
        series: gscSeries,
        topQueries,
        topPages,
        countries,
        devices,
      },
      analytics: {
        current: ga4[0] ?? null,
        previous: ga4Prev[0] ?? null,
        series: ga4Series,
        sources: ga4Sources,
        landingPages: ga4Landings,
      },
      audit: siteAudits[0] ? { id: siteAudits[0].id, score: siteAudits[0].score, summary: siteAudits[0].summary, startedAt: siteAudits[0].startedAt } : null,
      trackedKeywords,
      hasData: Boolean((gsc[0]?.impressions ?? 0) || (ga4[0]?.sessions ?? 0)),
      dataFreshness: { gsc: await store.latestMetricDate({ siteId: site.id, source: 'gsc' }), ga4: await store.latestMetricDate({ siteId: site.id, source: 'ga4' }) },
    });
  }));

  router.get('/sites/:id/performance', asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { from, to } = windowOf(req.query);
    const source = req.query.source === 'ga4' ? 'ga4' : 'gsc';
    const dimension = asEnum(req.query.dimension ?? (source === 'gsc' ? 'query' : 'landing'), source === 'gsc'
      ? ['query', 'page', 'country', 'device', 'date']
      : ['landing', 'source', 'country', 'device', 'date'], { field: 'dimension' });
    const limit = asInt(req.query.limit, { min: 1, max: 500, fallback: 50 });
    const offset = asInt(req.query.offset, { min: 0, max: 100_000, fallback: 0 });
    const groupBy = dimension === 'date' ? 'date' : 'key';
    const orderBy = source === 'gsc' ? (req.query.orderBy || 'clicks') : (req.query.orderBy || 'sessions');

    const [rows, total] = await Promise.all([
      store.aggregateMetrics({ siteId: site.id, source, dimension, groupBy, from, to, limit, offset, orderBy }),
      store.countMetricGroups({ siteId: site.id, source, dimension, from, to }),
    ]);
    cacheable(res, 45);
    res.json({ rows, total, limit, offset, dimension, source, range: { from, to } });
  }));

  // ── Google integration ────────────────────────────────────────────────
  router.get('/integrations/google', asyncRoute(async (req, res) => {
    const integration = await google.loadIntegration();
    res.json({
      integration: google.publicIntegration(integration),
      setup: {
        configured: google.isConfigured(),
        redirectUri: googleConfig.redirectUri || null,
        requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
        docs: 'See README → Google OAuth setup.',
      },
      vault: vault.status(),
    });
  }));

  router.get('/integrations/google/authorize', expensiveLimit, asyncRoute(async (req, res) => {
    const redirectAfter = typeof req.query.redirect === 'string' && req.query.redirect.startsWith('/')
      ? req.query.redirect
      : '/integrations';
    const { url } = google.buildAuthUrl({ redirectAfter });
    res.json({ url });
  }));

  router.post('/integrations/google/disconnect', asyncRoute(async (req, res) => {
    res.json({ integration: google.publicIntegration(await google.disconnect()) });
  }));

  router.post('/integrations/google/properties/refresh', expensiveLimit, asyncRoute(async (req, res) => {
    res.json({ integration: await google.listProperties() });
  }));

  router.post('/integrations/google/select', asyncRoute(async (req, res) => {
    const gsc = req.body?.gsc === undefined ? undefined : asString(req.body.gsc, { max: 300, field: 'gsc', optional: true });
    const ga4 = req.body?.ga4 === undefined ? undefined : asString(req.body.ga4, { max: 200, field: 'ga4', optional: true });
    res.json({ integration: await google.selectProperties({ gsc, ga4 }) });
  }));

  // Manual + scheduled data sync
  router.post('/sites/:id/sync', expensiveLimit, asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const days = asInt(req.body?.days ?? site.syncDays ?? 28, { min: 7, max: 480, fallback: 28 });
    const sources = Array.isArray(req.body?.sources) && req.body.sources.length
      ? req.body.sources.filter((value) => ['gsc', 'ga4'].includes(value))
      : ['gsc', 'ga4'];
    const results = {};
    const errors = {};
    for (const source of sources) {
      try {
        if (source === 'gsc') {
          if (!site.gscProperty) throw Object.assign(new Error('No Search Console property linked to this site'), { status: 400 });
          results.gsc = await google.syncSearchConsole({ siteId: site.id, siteUrl: site.gscProperty, days });
        } else {
          if (!site.ga4Property) throw Object.assign(new Error('No GA4 property linked to this site'), { status: 400 });
          results.ga4 = await google.syncAnalytics({ siteId: site.id, property: site.ga4Property, days });
        }
      } catch (error) {
        errors[source] = error.message;
        bus.log(`SYNC FAILED (${source}) — ${error.message}`, { type: 'integration', level: 'error' });
      }
    }
    const ok = Object.keys(results).length > 0;
    await sites.markSynced(site.id, ok ? 'success' : 'error');
    res.status(ok ? 200 : 502).json({ ok, results, errors });
  }));

  // ── Keywords ──────────────────────────────────────────────────────────
  router.get('/keywords', asyncRoute(async (req, res) => {
    const siteId = req.query.siteId ? String(req.query.siteId) : undefined;
    const rows = await keywords.list({ siteId, intent: req.query.intent, tag: req.query.tag });
    res.json({ keywords: rows });
  }));

  router.post('/keywords', asyncRoute(async (req, res) => {
    res.status(201).json({ keyword: await keywords.create(req.body ?? {}) });
  }));

  router.post('/keywords/bulk', asyncRoute(async (req, res) => {
    const raw = Array.isArray(req.body?.keywords) ? req.body.keywords : String(req.body?.keywords ?? '').split(/\r?\n/);
    const list = raw.map((value) => String(value).trim()).filter(Boolean).slice(0, 500);
    if (!list.length) throw new ValidationError('Provide at least one keyword');
    const created = [];
    const skipped = [];
    for (const phrase of list) {
      try {
        created.push(await keywords.create({ ...req.body, keyword: phrase }));
      } catch (error) {
        skipped.push({ keyword: phrase, reason: error.message });
      }
    }
    res.status(201).json({ created, skipped, added: created.length });
  }));

  router.patch('/keywords/:id', asyncRoute(async (req, res) => {
    res.json({ keyword: await keywords.update(req.params.id, req.body ?? {}) });
  }));

  router.delete('/keywords/:id', asyncRoute(async (req, res) => {
    const removed = await keywords.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Keyword not found' });
    res.json({ ok: true });
  }));

  router.get('/keywords/research', asyncRoute(async (req, res) => {
    const seed = asString(req.query.seed, { max: 200, field: 'seed', optional: true }) ?? '';
    const list = typeof req.query.keywords === 'string' ? req.query.keywords.split(',').map((value) => value.trim()).filter(Boolean) : [];
    res.json(keywords.research({ seed, keywords: list }));
  }));

  router.get('/sites/:id/keywords/performance', asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { from, to } = windowOf(req.query);
    const queries = await store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'query', groupBy: 'key', from, to, limit: 1000 });
    res.json({ ...(await keywords.withPerformance(site.id, queries)), range: { from, to } });
  }));

  router.get('/keywords/:id/history', asyncRoute(async (req, res) => {
    const keyword = await store.getEntity('keyword', req.params.id);
    if (!keyword) return res.status(404).json({ error: 'Keyword not found' });
    if (!keyword.siteId) return res.json({ history: [], reason: 'Keyword is not attached to a site' });
    res.json({ history: await keywords.history({ siteId: keyword.siteId, keyword: keyword.keyword }) });
  }));

  // ── Audits ────────────────────────────────────────────────────────────
  router.get('/sites/:id/audits', asyncRoute(async (req, res) => {
    const rows = (await store.listEntities('audit', { limit: 200 }))
      .filter((audit) => audit.siteId === req.params.id)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    res.json({
      audits: rows.map((audit) => ({
        id: audit.id,
        siteId: audit.siteId,
        startUrl: audit.startUrl,
        startedAt: audit.startedAt,
        finishedAt: audit.finishedAt,
        durationMs: audit.durationMs,
        score: audit.score,
        summary: audit.summary,
        pages: audit.pages?.length ?? 0,
      })),
    });
  }));

  router.post('/sites/:id/audits', expensiveLimit, asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const body = req.body ?? {};
    const result = await audits.run({ site, options: body });
    res.status(201).json({ audit: result });
  }));

  router.get('/audits/:id', asyncRoute(async (req, res) => {
    const audit = await store.getEntity('audit', req.params.id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    res.json({ audit });
  }));

  router.delete('/audits/:id', asyncRoute(async (req, res) => {
    await store.deleteEntity('audit', req.params.id);
    res.json({ ok: true });
  }));

  router.get('/audits/:id/export', asyncRoute(async (req, res) => {
    const audit = await store.getEntity('audit', req.params.id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const stem = `visitor-audit-${audit.id.slice(0, 8)}`;
    if (format === 'csv') {
      const rows = [['severity', 'category', 'title', 'url', 'detail']];
      for (const issue of audit.issues) rows.push([issue.severity, issue.category, issue.title, issue.url ?? '', issue.detail]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${stem}.csv"`);
      return res.send(rows.map((row) => row.map(csvCell).join(',')).join('\n'));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${stem}.json"`);
    return res.send(JSON.stringify(audit, null, 2));
  }));

  // ── Sitemap tools ─────────────────────────────────────────────────────
  router.get('/sites/:id/sitemap', asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const auditList = (await store.listEntities('audit', { limit: 100 }))
      .filter((audit) => audit.siteId === site.id)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const latest = auditList[0];
    const urls = latest?.pages?.map((page) => ({ loc: page.url, lastmod: latest.finishedAt?.slice(0, 10) })) ?? [{ loc: site.url }];
    const xml = buildSitemap(urls.length ? urls : [{ loc: site.url }]);
    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${hostslug(site.url)}-sitemap.xml"`);
      return res.send(xml);
    }
    res.json({ xml, source: latest ? `audit ${latest.id}` : 'site root', count: urls.length });
  }));

  router.post('/sites/:id/sitemap/validate', expensiveLimit, asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ report: await audits.validateSitemap({ site, url: req.body?.url }) });
  }));

  router.get('/sites/:id/robots', expensiveLimit, asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ report: await audits.fetchRobots({ site }) });
  }));

  // ── Campaigns ─────────────────────────────────────────────────────────
  router.get('/campaigns', asyncRoute(async (req, res) => {
    const siteId = req.query.siteId ? String(req.query.siteId) : undefined;
    res.json({ campaigns: await campaigns.list(siteId) });
  }));

  router.post('/campaigns', asyncRoute(async (req, res) => {
    res.status(201).json({ campaign: await campaigns.create(req.body ?? {}) });
  }));

  router.patch('/campaigns/:id', asyncRoute(async (req, res) => {
    res.json({ campaign: await campaigns.update(req.params.id, req.body ?? {}) });
  }));

  router.delete('/campaigns/:id', asyncRoute(async (req, res) => {
    const removed = await campaigns.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ ok: true });
  }));

  router.get('/sites/:id/campaigns/performance', asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { from, to } = windowOf(req.query);
    const rows = await store.aggregateMetrics({ siteId: site.id, source: 'ga4', dimension: 'source', groupBy: 'key', from, to, limit: 500, orderBy: 'sessions' });
    const withPerf = await campaigns.attributed(site.id, rows);
    res.json({ campaigns: withPerf, range: { from, to } });
  }));

  // ── Content ───────────────────────────────────────────────────────────
  router.get('/content', asyncRoute(async (req, res) => {
    const siteId = req.query.siteId ? String(req.query.siteId) : undefined;
    const items = await content.list({ siteId });
    res.json({ items, calendar: content.calendar(items) });
  }));

  router.post('/content', asyncRoute(async (req, res) => {
    res.status(201).json({ item: await content.create(req.body ?? {}) });
  }));

  router.patch('/content/:id', asyncRoute(async (req, res) => {
    res.json({ item: await content.update(req.params.id, req.body ?? {}) });
  }));

  router.delete('/content/:id', asyncRoute(async (req, res) => {
    const removed = await content.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Content item not found' });
    res.json({ ok: true });
  }));

  router.get('/sites/:id/content/gaps', expensiveLimit, asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { from, to } = windowOf(req.query);
    const [queries, auditList] = await Promise.all([
      store.aggregateMetrics({ siteId: site.id, source: 'gsc', dimension: 'query', groupBy: 'key', from, to, limit: 500 }),
      store.listEntities('audit', { limit: 100 }),
    ]);
    const latest = auditList
      .filter((audit) => audit.siteId === site.id)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    const pages = latest?.pages ?? [];
    res.json({
      gaps: content.contentGaps({ queries, pages }),
      internalLinks: latest ? content.internalLinkSuggestions({ pages }) : [],
      basedOn: { auditId: latest?.id ?? null, pages: pages.length, queries: queries.length },
    });
  }));

  router.post('/sites/:id/content/optimize', asyncRoute(async (req, res) => {
    const site = await sites.get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const keyword = asString(req.body?.keyword, { max: 200, field: 'keyword' });
    const targetUrl = req.body?.url ? asString(req.body.url, { max: 2000, field: 'url' }) : null;
    const auditList = (await store.listEntities('audit', { limit: 100 }))
      .filter((audit) => audit.siteId === site.id)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const pages = auditList[0]?.pages ?? [];
    const page = targetUrl ? pages.find((candidate) => candidate.url === targetUrl) : pages[0];
    res.json(content.optimize({ keyword, page }));
  }));

  // ── Reports ───────────────────────────────────────────────────────────
  // One-shot export kept for bookmarks: generates the snapshot, then returns it.
  router.get('/reports/export', expensiveLimit, asyncRoute(async (req, res) => {
    const siteId = req.query.siteId ? String(req.query.siteId) : (await sites.list())[0]?.id;
    if (!siteId) return res.status(404).json({ error: 'Add a site first' });
    const days = asInt(req.query.days, { min: 1, max: 480, fallback: 28 });
    const report = await reports.generate({ siteId, days, type: 'manual' });
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const stem = `visitor-report-${report.id.slice(0, 8)}`;
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${stem}.csv"`);
      const rows = [['dimension', 'key', 'clicks', 'impressions', 'ctr', 'position', 'sessions']];
      for (const row of report.data.searchConsole.topQueries) rows.push(['query', row.key, row.clicks, row.impressions, row.ctr, row.position, '']);
      for (const row of report.data.analytics.sources) rows.push(['source', row.key, '', '', '', '', row.sessions]);
      return res.send(rows.map((row) => row.map(csvCell).join(',')).join('\n'));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${stem}.json"`);
    return res.send(JSON.stringify(report, null, 2));
  }));

  router.get('/reports', asyncRoute(async (req, res) => {
    res.json({ reports: await reports.list({ siteId: req.query.siteId, limit: 100 }) });
  }));

  router.post('/reports', expensiveLimit, asyncRoute(async (req, res) => {
    const siteId = asString(req.body?.siteId, { max: 100, field: 'siteId' });
    const days = asInt(req.body?.days ?? 28, { min: 1, max: 480, fallback: 28 });
    const report = await reports.generate({ siteId, days, type: 'manual' });
    res.status(201).json({ report });
  }));

  router.get('/reports/:id', asyncRoute(async (req, res) => {
    const report = await reports.get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ report });
  }));

  router.get('/reports/:id/export', asyncRoute(async (req, res) => {
    const report = await reports.get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const stem = `visitor-report-${report.id.slice(0, 8)}`;
    if (req.query.format === 'md' || req.query.format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${stem}.md"`);
      return res.send(reports.toMarkdown(report));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${stem}.json"`);
    return res.send(JSON.stringify(report, null, 2));
  }));

  router.post('/reports/:id/deliver', expensiveLimit, asyncRoute(async (req, res) => {
    const to = asString(req.body?.to, { max: 320, field: 'to' });
    res.json({ report: await reports.deliver(req.params.id, to) });
  }));

  router.delete('/reports/:id', asyncRoute(async (req, res) => {
    const removed = await reports.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Report not found' });
    res.json({ ok: true });
  }));

  // ── Scheduler / jobs ──────────────────────────────────────────────────
  router.get('/jobs', asyncRoute(async (req, res) => {
    res.json({ jobs: await scheduler.list(), scheduler: scheduler.status() });
  }));

  router.post('/jobs', asyncRoute(async (req, res) => {
    res.status(201).json({ job: await scheduler.create(req.body ?? {}) });
  }));

  router.patch('/jobs/:id', asyncRoute(async (req, res) => {
    res.json({ job: await scheduler.update(req.params.id, req.body ?? {}) });
  }));

  router.delete('/jobs/:id', asyncRoute(async (req, res) => {
    const removed = await scheduler.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Job not found' });
    res.json({ ok: true });
  }));

  router.post('/jobs/:id/run', expensiveLimit, asyncRoute(async (req, res) => {
    res.json({ job: await scheduler.runNow(req.params.id) });
  }));

  router.get('/activity', asyncRoute(async (req, res) => {
    const limit = asInt(req.query.limit, { min: 1, max: 500, fallback: 100 });
    const events = await store.listEvents({ limit });
    res.json({ events });
  }));

  // ── Settings ──────────────────────────────────────────────────────────
  router.get('/settings', asyncRoute(async (req, res) => {
    res.json({ settings: await audits.getSettings() });
  }));

  router.put('/settings', asyncRoute(async (req, res) => {
    const settings = await audits.updateSettings(req.body ?? {});
    res.json({ ok: true, settings });
  }));

  // ── Health / diagnostics ──────────────────────────────────────────────
  router.get('/health/full', asyncRoute(async (req, res) => {
    res.json(health.latest ?? (await health.sample()));
  }));

  router.get('/diagnostics', asyncRoute(async (req, res) => {
    const integration = await google.loadIntegration();
    res.json({
      app: { name: config.appName, version: config.version, env: config.env, uptimeSeconds: Math.round(process.uptime()) },
      runtime: {
        ...runtimeInfo,
        bindHost: config.host,
        port: config.port,
        url: displayUrl(config.host, config.port),
      },
      node: process.version,
      store: { engine: store.engine ?? null },
      browser: audits.browserSnapshot(),
      integrations: {
        google: google.publicIntegration(integration),
        email: verifyEmail(),
        vault: vault.status(),
      },
      scheduler: scheduler.status(),
      security: {
        authDisabled: auth.disabled,
        passwordWeak: config.appPasswordWeak,
        publicUrl: config.publicUrl || null,
        secureCookies: config.publicUrl.startsWith('https://'),
        trustProxy: config.trustProxy,
        localOnly: !['0.0.0.0', '::'].includes(config.host),
      },
      limits: { retentionDays: config.retentionDays, maxConcurrency: config.maxConcurrency },
    });
  }));

  router.get('/screenshots/:file', (req, res) => {
    const file = req.params.file;
    if (!/^[a-f0-9-]{16,64}\.jpg$/i.test(file)) {
      return res.status(400).json({ error: 'Invalid screenshot name' });
    }
    const target = path.join(screenshotsDir, file);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Screenshot not found' });
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(target);
  });

  router.use((req, res) => res.status(404).json({ error: 'Unknown API route' }));

  // eslint-disable-next-line no-unused-vars
  router.use((error, req, res, next) => {
    const status = error.status && error.status >= 400 ? error.status : 500;
    if (status >= 500) {
      bus.log(`API ERROR — ${req.method} ${req.path} — ${error.message}`, { type: 'api', level: 'error' });
    }
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : error.message || 'Request failed',
      ...(status >= 500 && !config.isProd ? { detail: error.message } : {}),
    });
  });

  return router;
}

// ─── helpers ──────────────────────────────────────────────────────────────
function windowOf(query = {}) {
  const days = Math.min(480, Math.max(1, Number(query.days) || 28));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '')
    ? query.from
    : new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function previousWindow(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const span = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (span - 1) * 86400000);
  return { from: prevStart.toISOString().slice(0, 10), to: prevEnd.toISOString().slice(0, 10) };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function hostslug(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  } catch {
    return 'site';
  }
}

function oauthPage(title, message, redirectPath = '/') {
  const target = redirectPath === '/' ? '/' : redirectPath;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070d;color:#e2e8f0;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;padding:24px}
.card{max-width:440px;width:100%;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.03);border-radius:18px;padding:28px;text-align:center}
h1{font-size:19px;margin:0 0 8px}
p{color:#94a3b8;font-size:13.5px;margin:0 0 18px}
a{display:inline-block;padding:9px 16px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;text-decoration:none;font-size:13px;font-weight:600}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
<a href="${escapeHtml(target)}">Return to Visitor</a></div></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}
