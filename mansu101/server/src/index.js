import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';

import { config, dirs } from './config.js';
import { bus } from './bus.js';
import { createStore, seedUrls, recoverInterrupted } from './store/index.js';
import { AuthService } from './auth.js';
import { HealthMonitor } from './health.js';
import { BrowserManager, findChromium } from './engine/browser.js';
import { AutomationEngine } from './engine/runner.js';
import { createApi } from './routes.js';
import { initRealtime } from './realtime.js';

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

async function main() {
  const log = {
    info: (message) => bus.log(message, { type: 'system' }),
    warn: (message) => bus.log(message, { type: 'system', level: 'warn' }),
    error: (message) => bus.log(message, { type: 'system', level: 'error' }),
  };

  const { store, engine: storeEngine } = await createStore(log);

  // Persist + print every event, even before Socket.IO clients connect.
  bus.on('log', (event) => {
    consoleLog(event);
    store.addEvent(event).catch(() => {});
  });

  bus.log(`MANSU101 SERVER STARTING — ${config.env} (${storeEngine} store)`, {
    type: 'system',
    level: 'success',
  });

  await recoverInterrupted(store, log);
  await seedUrls(store, log);

  const browser = new BrowserManager({ bus });
  const automation = new AutomationEngine({ store, browser, bus });
  const auth = new AuthService({ store, bus });
  const health = new HealthMonitor({ bus });

  await automation.init();

  if (auth.disabled) {
    bus.log('AUTHENTICATION DISABLED (AUTH_DISABLED=true) — never use this on a public VPS', {
      type: 'security',
      level: 'warn',
    });
  } else if (config.appPasswordWeak) {
    bus.log('WEAK OR DEFAULT DASHBOARD PASSWORD — set a long random APP_PASSWORD in .env before exposing this server', {
      type: 'security',
      level: 'warn',
    });
  }

  const executable = findChromium();
  if (executable) {
    bus.log(`CHROMIUM FOUND — ${executable}`, { type: 'browser' });
  } else {
    bus.log(
      'CHROMIUM NOT FOUND — install chromium on the VPS or set CHROMIUM_PATH. Automation will fail until fixed.',
      { type: 'browser', level: 'warn' },
    );
  }

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const api = createApi({ store, engine: automation, auth, health, bus });
  app.use('/api', api);

  const indexHtml = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    // Vite fingerprints everything under /assets, so those files can be cached
    // aggressively while index.html must always be revalidated.
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
        'MANSU101 API is running. Frontend build not found — run "pnpm build" or use "pnpm dev" for the Vite dev server.',
      );
    });
  }

  const server = http.createServer(app);
  const io = new Server(server, {
    path: '/socket.io',
    maxHttpBufferSize: 2e6,
    pingInterval: 20000,
    pingTimeout: 25000,
    cors: config.isProd
      ? undefined
      : { origin: true, credentials: true },
  });

  initRealtime({ io, engine: automation, auth, health, store });
  health.start(5000);

  const maintenance = async () => {
    try {
      await store.pruneOldData(config.retentionDays);
      const cutoff = Date.now() - config.retentionDays * 86400000;
      for (const file of await fs.promises.readdir(dirs.screenshots)) {
        const target = path.join(dirs.screenshots, file);
        const stat = await fs.promises.stat(target).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fs.promises.unlink(target).catch(() => {});
      }
    } catch (error) {
      bus.log(`MAINTENANCE FAILED — ${error.message}`, { type: 'maintenance', level: 'warn' });
    }
  };
  maintenance();
  const maintenanceTimer = setInterval(maintenance, 6 * 60 * 60 * 1000);
  maintenanceTimer.unref?.();

  server.listen(config.port, () => {
    bus.log(`DASHBOARD READY — http://0.0.0.0:${config.port}`, {
      type: 'system',
      level: 'success',
    });
    if (config.vncUrl) bus.log(`REMOTE DESKTOP LINK CONFIGURED — ${config.vncUrl}`, { type: 'vnc' });
  });

  server.on('error', (error) => {
    bus.log(`HTTP SERVER ERROR — ${error.message}`, { type: 'system', level: 'error' });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    bus.log(`SHUTDOWN SIGNAL (${signal}) — closing browsers and database`, {
      type: 'system',
      level: 'warn',
    });
    const force = setTimeout(() => process.exit(1), 12000);
    force.unref?.();
    health.stop();
    clearInterval(maintenanceTimer);
    io.close();
    try {
      if (automation.isBusy()) await automation.stop();
    } catch {
      /* ignore */
    }
    await browser.close('shutdown').catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await store.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    bus.log(`UNHANDLED REJECTION — ${reason?.message || reason}`, {
      type: 'system',
      level: 'error',
    });
  });

  process.on('uncaughtException', (error) => {
    bus.log(`UNCAUGHT EXCEPTION — ${error.stack || error.message}`, {
      type: 'system',
      level: 'error',
    });
    console.error(error);
    setTimeout(() => process.exit(1), 1500);
  });
}

main().catch((error) => {
  console.error('[fatal] Server failed to start:', error);
  process.exit(1);
});
