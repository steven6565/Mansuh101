import crypto from 'node:crypto';
import { AuditEngine } from '../engine/audit.js';
import { fetchPage, assertPublicUrl } from '../lib/net.js';
import { parseRobots, parseSitemap, buildSitemap } from '../lib/robots.js';
import { DEFAULT_SETTINGS, crawlerConfig, sanitizeSettings, config } from '../config.js';

/**
 * Audit orchestration: crawl + persist, sitemap validation, robots inspection
 * and the optional Chrome-rendered screenshot pass.
 *
 * Rendered checks only run on the site the user registered, with a hard page
 * cap, and are never used to imitate visitors.
 */
export function createAuditService({ store, bus, browser }) {
  const engine = new AuditEngine({ bus, store });

  async function getSettings() {
    const stored = await store.getSettings();
    return sanitizeSettings(stored ?? {}, DEFAULT_SETTINGS);
  }

  async function updateSettings(patch) {
    const current = await getSettings();
    const next = sanitizeSettings(patch, current);
    await store.saveSettings(next);
    bus.log(`SETTINGS UPDATED — max ${next.maxPages} pages, depth ${next.maxDepth}, concurrency ${next.concurrency}`, {
      type: 'settings',
    });
    return next;
  }

  async function run({ site, options = {} }) {
    const settings = await getSettings();
    const merged = {
      ...settings,
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    };
    const live = { pages: 0, queued: 0, phase: 'starting', message: 'Starting crawl' };
    const audit = await engine.run({
      siteId: site.id,
      startUrl: options.startUrl || site.url,
      options: merged,
      onProgress: (progress) => Object.assign(live, progress),
    });

    // Optional rendered pass (screenshots / mobile viewport evidence).
    if (merged.renderPages) {
      audit.rendered = await renderSample({
        pages: audit.pages.slice(0, Math.min(merged.renderLimit ?? 3, 5)),
        settings: merged,
        siteId: site.id,
      }).catch((error) => {
        bus.log(`RENDERED AUDIT SKIPPED — ${error.message}`, { type: 'audit', level: 'warn' });
        return { error: error.message, items: [] };
      });
    }

    await store.putEntity('audit', audit);
    const siteRecord = await store.getEntity('site', site.id);
    if (siteRecord) {
      await store.putEntity('site', {
        ...siteRecord,
        lastAuditAt: audit.startedAt,
        updatedAt: new Date().toISOString(),
      });
    }
    bus.log(
      `AUDIT COMPLETE — ${audit.pages.length} page(s), score ${audit.score.value}/100, ${audit.issues.length} issue(s)`,
      { type: 'audit', level: audit.score.value >= 75 ? 'success' : 'warn' },
    );
    return audit;
  }

  async function renderSample({ pages, settings, siteId }) {
    const items = [];
    for (const page of pages) {
      const context = await browser.createContext(settings);
      try {
        const tab = await context.newPage();
        await tab.setViewport({
          width: settings.viewport?.width ?? 1440,
          height: settings.viewport?.height ?? 900,
          deviceScaleFactor: 1,
        });
        const response = await tab.goto(page.url, {
          waitUntil: 'domcontentloaded',
          timeout: settings.requestTimeoutMs ?? 20000,
        });
        const id = crypto.randomUUID();
        const filename = `${id}.jpg`;
        const buffer = await tab.screenshot({ type: 'jpeg', quality: 70, captureBeyondViewport: false });
        const { screenshotsDir } = await import('../config.js');
        const path = await import('node:path');
        const fs = await import('node:fs');
        fs.writeFileSync(path.join(screenshotsDir, filename), buffer);
        items.push({
          url: page.url,
          httpStatus: response?.status() ?? null,
          screenshot: filename,
          title: await tab.title().catch(() => null),
        });
      } catch (error) {
        items.push({ url: page.url, error: String(error.message).slice(0, 200) });
      } finally {
        await browser.releaseContext(context);
      }
    }
    void siteId;
    return { items, at: new Date().toISOString(), viewport: settings.viewport };
  }

  /** Validate a sitemap (either the site's discovered one or a supplied URL). */
  async function validateSitemap({ site, url }) {
    const target = url || `${site.origin}/sitemap.xml`;
    await assertPublicUrl(target);
    const response = await fetchPage(target, { maxBytes: 3_000_000 });
    const looksXml = /<(urlset|sitemapindex)\b/i.test(response.body);
    const parsed = looksXml ? parseSitemap(response.body) : { isIndex: false, entries: [] };
    const problems = [];
    if (response.status !== 200) problems.push(`HTTP ${response.status}`);
    if (!looksXml) problems.push('Response is not a valid sitemap XML document');
    if (looksXml && parsed.entries.length === 0) problems.push('Sitemap contains zero URLs');

    const entries = parsed.entries.slice(0, 500);
    const hosts = new Set();
    const duplicates = new Set();
    const seen = new Set();
    for (const entry of entries) {
      try {
        hosts.add(new URL(entry.loc).host);
      } catch {
        problems.push(`Invalid <loc>: ${entry.loc.slice(0, 80)}`);
      }
      const key = entry.loc.replace(/\/$/, '');
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    if (hosts.size > 1) problems.push(`Sitemap mixes ${hosts.size} hosts: ${[...hosts].join(', ')}`);
    if (duplicates.size) problems.push(`${duplicates.size} duplicate URL(s)`);
    const siteHost = new URL(site.url).host;
    if (hosts.size && ![...hosts].some((host) => host === siteHost || host === `www.${siteHost}` || `www.${host}` === siteHost)) {
      problems.push(`Sitemap host (${[...hosts].join(', ')}) does not match the site host (${siteHost})`);
    }

    return {
      url: target,
      status: response.status,
      isIndex: parsed.isIndex,
      count: parsed.entries.length,
      hosts: [...hosts],
      duplicates: [...duplicates].slice(0, 20),
      problems,
      valid: problems.length === 0,
      entries: entries.slice(0, 100),
      checkedAt: new Date().toISOString(),
    };
  }

  async function fetchRobots({ site }) {
    const target = `${site.origin}/robots.txt`;
    await assertPublicUrl(target);
    const response = await fetchPage(target, { maxBytes: 500_000 });
    const parsed = response.ok ? parseRobots(response.body) : { groups: [], sitemaps: [], raw: '' };
    const problems = [];
    if (response.status !== 200) problems.push(`robots.txt returned HTTP ${response.status}`);
    if (response.status === 200 && !parsed.groups.length) problems.push('No User-agent groups found');
    if (!/sitemap\s*:/i.test(parsed.raw)) problems.push('No Sitemap: directive');
    const blocksEverything = parsed.groups.some((group) =>
      group.agents.includes('*')
      && group.rules.some((rule) => rule.type === 'disallow' && rule.path === '/'));
    if (blocksEverything) problems.push('A "Disallow: /" rule blocks every crawler');

    return {
      url: target,
      status: response.status,
      body: parsed.raw.slice(0, 8000),
      groups: parsed.groups.length,
      sitemaps: parsed.sitemaps,
      problems,
      valid: problems.length === 0,
      checkedAt: new Date().toISOString(),
    };
  }

  function browserSnapshot() {
    return browser?.snapshot?.() ?? { status: 'offline' };
  }

  return {
    run,
    validateSitemap,
    fetchRobots,
    getSettings,
    updateSettings,
    browserSnapshot,
    buildSitemap,
    isRunning: (id) => engine.isRunning(id),
    cancel: (id) => engine.cancel(id),
    meta: { maxPages: crawlerConfig.maxPages, concurrency: crawlerConfig.concurrency, version: config.version },
  };
}
