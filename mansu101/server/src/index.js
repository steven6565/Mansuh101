import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';

import { config, dirs } from './config.js';
import { bus } from './bus.js';
import { createStore } from './store/index.js';
import { AuthService } from './auth.js';
import { HealthMonitor } from './health.js';
import { BrowserManager, findChromium } from './engine/browser.js';
import { createApi } from './routes.js';
import { initRealtime } from './realtime.js';

import { createGoogleService } from './integrations/google.js';
import { createSiteService } from './services/sites.js';
import { createKeywordService } from './services/keywords.js';
import { createCampaignService } from './services/campaigns.js';
import { createContentService } from './services/content.js';
import { createAuditService } from './services/audits.js';
import { createReportService } from './services/reports.js';
import { Scheduler } from './services/scheduler.js';
import { vault } from './lib/vault.js';

const LEVEL_COLOURS = {
  info: '\x1b[36m',
  success: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

function consoleLog(event) {
  const time = new Date(event.at ?? Date.now()).toLocaleTimeString('en-GB', { hour12: false });
  const colour = LEVEL_COLOURS[event.level] ?? '';
  // eslint-disable-next-line no-console
  console.log(`${colour}[${time}] ${event.message}${RESET}`);
}

/**
 * Build the scheduler handlers. Each handler maps to real work and never
 * fabricates data: syncs call Google, audits crawl the user's own site,
 * reports aggregate what was stored.
 */
function buildJobHandlers({ store, google, audits, reports, sites, campaignService, bus }) {
  return {
    'gsc-sync': {
      label: 'Sync Google Search Console',
      run: async (payload) => {
        const site = payload.siteId ? await sites.get(payload.siteId) : null;
        if (!site) throw new Error('Site not found for gsc-sync');
        if (!site.gscProperty) throw new Error(`${site.name} has no Search Console property linked`);
        const days = Number(payload.days) || site.syncDays || 28;
        const result = await google.syncSearchConsole({ siteId: site.id, siteUrl: site.gscProperty, days });
        await sites.markSynced(site.id, 'success');
        return { site: site.id, ...result };
      },
    },
    'ga4-sync': {
      label: 'Sync Google Analytics 4',
      run: async (payload) => {
        const site = payload.siteId ? await sites.get(payload.siteId) : null;
        if (!site) throw new Error('Site not found for ga4-sync');
        if (!site.ga4Property) throw new Error(`${site.name} has no GA4 property linked`);
        const days = Number(payload.days) || site.syncDays || 28;
        const result = await google.syncAnalytics({ siteId: site.id, property: site.ga4Property, days });
        await sites.markSynced(site.id, 'success');
        return { site: site.id, ...result };
      },
    },
    'site-audit': {
      label: 'Run technical site audit',
      run: async (payload) => {
        const site = payload.siteId ? await sites.get(payload.siteId) : null;
        if (!site) throw new Error('Site not found for site-audit');
        const audit = await audits.run({ site, options: payload.options ?? {} });
        return { site: site.id, auditId: audit.id, pages: audit.pages.length, issues: audit.issues.length, score: audit.score.value };
      },
    },
    'daily-report': {
      label: 'Daily SEO report',
      run: async (payload) => {
        const site = payload.siteId ? await sites.get(payload.siteId) : null;
        if (!site) throw new Error('Site not found for daily-report');
        const report = await reports.generate({ siteId: site.id, days: Number(payload.days) || 1, type: 'daily' });
        let delivered = false;
        if (payload.email) {
          await reports.deliver(report.id, payload.email).catch((error) => {
            bus.log(`DAILY REPORT DELIVERY FAILED — ${error.message}`, { type: 'report', level: 'warn' });
          });
          delivered = true;
        }
        return { site: site.id, reportId: report.id, delivered };
      },
    },
    'weekly-report': {
      label: 'Weekly SEO report',
      run: async (payload) => {
        const site = payload.siteId ? await sites.get(payload.siteId) : null;
        if (!site) throw new Error('Site not found for weekly-report');
        const report = await reports.generate({ siteId: site.id, days: Number(payload.days) || 7, type: 'weekly' });
        let delivered = false;
        if (payload.email) {
          await reports.deliver(report.id, payload.email).catch((error) => {
            bus.log(`WEEKLY REPORT DELIVERY FAILED — ${error.message}`, { type: 'report', level: 'warn' });
          });
          delivered = true;
        }
        return { site: site.id, reportId: report.id, delivered };
      },
    },
    'campaign-review': {
      label: 'Campaign performance review',
      run: async (payload) => {
        const site = payload.siteId ? await sites.get(payload.siteId) : null;
        if (!site) throw new Error('Site not found for campaign-review');
        const result = await campaignService.attributed(site.id, await store.aggregateMetrics({
          siteId: site.id,
          source: 'ga4',
          dimension: 'source',
          groupBy: 'key',
          limit: 500,
          orderBy: 'sessions',
        }));
        return { site: site.id, campaigns: result.length };
      },
    },
  };
}

async function main() {
  const log = {
    info: (message) => bus.log(message, { type: 'system' }),
    warn: (message) => bus.log(message, { type: 'system', level: 'warn' }),
    error: (message) => bus.log(message, { type: 'system', level: 'error' }),
  };

  const { store, engine: storeEngine } = await createStore(log);

  bus.on('log', (event) => {
    consoleLog(event);
    store.addEvent(event).catch(() => {});
  });

  bus.log(
    `VISITOR SEO PLATFORM STARTING — ${config.env} · ${config.mode} mode (${storeEngine} store, ${process.platform}/${process.arch})`,
    { type: 'system', level: 'success' },
  );

  // Attach the SEO document/metric layer to the same driver.
  await store.initSeo?.();
  const sites = createSiteService({ store, bus });
  const keywords = createKeywordService({ store, bus });
  const campaignService = createCampaignService({ store, bus });
  const content = createContentService({ store, bus });
  const google = createGoogleService({ store, bus });
  const browser = new BrowserManager({ bus });
  const audits = createAuditService({ store, bus, browser });
  const reports = createReportService({ store, bus, google, sites });

  const handlers = buildJobHandlers({ store, google, audits, reports, sites, campaignService, bus });
  const scheduler = new Scheduler({ store, bus, handlers });
  await scheduler.init();

  const auth = new AuthService({ store, bus });
  const health = new HealthMonitor({ bus });

  if (auth.disabled) {
    bus.log('AUTHENTICATION DISABLED (AUTH_DISABLED=true) — never use this on a public server', {
      type: 'security',
      level: 'warn',
    });
  } else if (config.appPasswordWeak) {
    bus.log('WEAK OR DEFAULT PASSWORD — set a long random APP_PASSWORD in .env before exposing this server', {
      type: 'security',
      level: 'warn',
    });
  }
  bus.log(`Token vault ready (${vault.status().source}) — OAuth tokens are encrypted with AES-256-GCM`, {
    type: 'security',
  });

  const executable = findChromium();
  if (executable) {
    bus.log(`CHROMIUM FOUND — ${executable} (used only for authorized rendered audits)`, { type: 'browser' });
  } else {
    bus.log(
      'CHROMIUM NOT FOUND — rendered audits and screenshots are unavailable. Install Chromium or set CHROMIUM_PATH.',
      { type: 'browser', level: 'warn' },
    );
  }

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (config.publicUrl.startsWith('https://')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = createApi({
    store, sites, google, keywords, campaigns: campaignService, content, audits, reports,
    scheduler, health, auth, bus,
  });
  app.use('/api', api);

  const indexHtml = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use('/assets', express.static(path.join(config.webDist, 'assets'), {
      index: false,
      immutable: true,
      maxAge: '365d',
    }));
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (req, res) => {
      res.status(200).send(
        'Visitor API is running. Frontend build not found — run "pnpm build" or use "pnpm dev" for the Vite dev server.',
      );
    });
  }

  const server = http.createServer(app);
  const io = new Server(server, {
    path: '/socket.io',
    maxHttpBufferSize: 1e6,
    pingInterval: 20000,
    pingTimeout: 25000,
    cors: config.isProd ? undefined : { origin: true, credentials: true },
  });

  initRealtime({ io, auth, health, bus, scheduler, audits });
  health.start(10000);

  const maintenance = async () => {
    try {
      await store.pruneOldData(config.retentionDays);
      const cutoff = Date.now() - config.retentionDays * 86400000;
      for (const file of await fs.promises.readdir(dirs.screenshots)) {
        const target = path.join(dirs.screenshots, file);
        const stat = await fs.promises.stat(target).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fs.promises.unlink(target).catch(() => {});
      }
      // Drop Google metric rows older than the retention window.
      const metricCutoff = new Date(Date.now() - config.retentionDays * 86400000).toISOString().slice(0, 10);
      await store.deleteMetrics?.({ before: metricCutoff });
    } catch (error) {
      bus.log(`MAINTENANCE FAILED — ${error.message}`, { type: 'maintenance', level: 'warn' });
    }
  };
  maintenance();
  const maintenanceTimer = setInterval(maintenance, 6 * 60 * 60 * 1000);
  maintenanceTimer.unref?.();

  server.listen(config.port, config.host, () => {
    const shown = config.host === '0.0.0.0' || config.host === '::' ? '0.0.0.0' : config.host;
    bus.log(`DASHBOARD READY — ${config.mode} mode · http://${shown}:${config.port}`, {
      type: 'system',
      level: 'success',
    });
    if (config.mode !== 'vps') {
      bus.log(`LOCAL-ONLY BIND — ${config.host}. Set HOST=0.0.0.0 to expose this instance on the network.`, {
        type: 'system',
      });
    }
  });

  server.on('error', (error) => {
    bus.log(`HTTP SERVER ERROR — ${error.message}`, { type: 'system', level: 'error' });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    bus.log(`SHUTDOWN SIGNAL (${signal}) — closing scheduler, browser and database`, {
      type: 'system',
      level: 'warn',
    });
    const force = setTimeout(() => process.exit(1), 12000);
    force.unref?.();
    scheduler.stop();
    health.stop();
    clearInterval(maintenanceTimer);
    io.close();
    await browser.close('shutdown').catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await store.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    bus.log(`UNHANDLED REJECTION — ${reason?.message || reason}`, { type: 'system', level: 'error' });
  });

  process.on('uncaughtException', (error) => {
    bus.log(`UNCAUGHT EXCEPTION — ${error.stack || error.message}`, { type: 'system', level: 'error' });
    console.error(error);
    setTimeout(() => process.exit(1), 1500);
  });
}

main().catch((error) => {
  console.error('[fatal] Server failed to start:', error);
  process.exit(1);
});
