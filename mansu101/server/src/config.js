import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../..');

const env = process.env;
const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: int(env.PORT, 4000),
  appPassword: env.APP_PASSWORD || 'visitor',
  appPasswordWeak: !env.APP_PASSWORD
    || env.APP_PASSWORD === 'visitor'
    || env.APP_PASSWORD === 'mansu101'
    || env.APP_PASSWORD === 'change-me-to-a-long-random-password'
    || env.APP_PASSWORD.length < 12,
  authDisabled: bool(env.AUTH_DISABLED, false),
  sessionTtlDays: int(env.SESSION_TTL_DAYS, 14),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
  trustProxy: bool(env.TRUST_PROXY, true),
  dataDir: path.resolve(ROOT_DIR, env.DATA_DIR || 'data'),
  databaseUrl: env.DATABASE_URL || 'sqlite:./data/visitor.db',
  retentionDays: int(env.RETENTION_DAYS, 90),
  chromiumPath: env.CHROMIUM_PATH || '',
  browserHeadless: bool(env.BROWSER_HEADLESS, true),
  maxConcurrency: Math.max(1, Math.min(8, int(env.MAX_CONCURRENCY, 4))),
  browserIdleCloseMs: int(env.BROWSER_IDLE_CLOSE_MS, 120000),
  chromiumExtraArgs: (env.CHROMIUM_EXTRA_ARGS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  webDist: path.resolve(ROOT_DIR, 'web/dist'),
  appName: 'Visitor',
  version: '2.0.0',
};

export const dirs = {
  data: config.dataDir,
  screenshots: path.join(config.dataDir, 'screenshots'),
  reports: path.join(config.dataDir, 'reports'),
  logs: path.join(config.dataDir, 'logs'),
};

for (const dir of Object.values(dirs)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const screenshotsDir = dirs.screenshots;

// ─── Google integrations ──────────────────────────────────────────────────
const googleScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
];

export const googleConfig = {
  clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
  clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
  redirectUri: (env.GOOGLE_REDIRECT_URI || '').trim()
    || (config.publicUrl ? `${config.publicUrl}/api/integrations/google/callback` : ''),
  scopes: googleScopes,
  cruxApiKey: (env.GOOGLE_API_KEY || '').trim(),
  // Search Console usually lags 2-3 days behind. Default windows end here.
  dataLagDays: Math.max(0, int(env.GSC_DATA_LAG_DAYS, 1)),
};

export const googleConfigured = Boolean(googleConfig.clientId && googleConfig.clientSecret);

// ─── Crawler / audit engine ───────────────────────────────────────────────
export const crawlerConfig = {
  userAgent: env.CRAWLER_USER_AGENT
    || `VisitorSEO/2.0 (+https://github.com/5skr0ll3r/Visitor; authorized SEO audit)`,
  timeoutMs: Math.max(3000, int(env.CRAWLER_TIMEOUT_MS, 15000)),
  maxPages: Math.max(1, Math.min(200, int(env.MAX_AUDIT_PAGES, 25))),
  concurrency: Math.max(1, Math.min(6, int(env.CRAWLER_CONCURRENCY, 3))),
  maxHtmlBytes: Math.max(200_000, int(env.CRAWLER_MAX_BYTES, 3_000_000)),
  allowPrivateTargets: bool(env.CRAWLER_ALLOW_PRIVATE, false),
};

export const schedulerConfig = {
  enabled: bool(env.SCHEDULER_ENABLED, true),
  tickMs: Math.max(10_000, int(env.SCHEDULER_TICK_MS, 30_000)),
  maxRetries: Math.max(0, Math.min(5, int(env.SCHEDULER_MAX_RETRIES, 2))),
  timezone: env.REPORT_TIMEZONE || 'UTC',
  alertWebhook: (env.ALERT_WEBHOOK_URL || '').trim(),
};

export const securityConfig = {
  rateLimitPerMinute: Math.max(30, int(env.RATE_LIMIT_PER_MINUTE, 300)),
  expensiveLimitPerMinute: Math.max(2, int(env.EXPENSIVE_RATE_LIMIT_PER_MINUTE, 12)),
  secretsFile: path.join(dirs.data, '.secrets.json'),
  trustOrigin: bool(env.CSRF_ORIGIN_CHECK, true),
};

// ─── Browser profiles (kept for rendered audits / screenshots) ────────────
export const BROWSER_PROFILES = {
  'desktop-chrome-windows': {
    label: 'Desktop · Chrome / Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  'desktop-chrome-mac': {
    label: 'Desktop · Chrome / macOS',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1512, height: 982, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  },
  'mobile-android': {
    label: 'Mobile · Chrome / Android',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  'mobile-ios': {
    label: 'Mobile · Safari / iPhone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
};

export const DEFAULT_SETTINGS = {
  // Crawl limits used by new site audits.
  maxPages: Math.min(25, crawlerConfig.maxPages),
  maxDepth: 2,
  concurrency: crawlerConfig.concurrency,
  requestTimeoutMs: crawlerConfig.timeoutMs,
  respectRobots: true,
  checkExternalLinks: false,
  followRedirects: true,
  // Retention for metrics/events, in days (falls back to RETENTION_DAYS).
  retainDays: config.retentionDays,
  // Optional rendered pass with Chromium (screenshots + mobile viewport).
  renderPages: false,
  renderLimit: 5,
  viewport: { width: 1440, height: 900 },
  profile: 'desktop-chrome-windows',
  // Scheduler / sync defaults.
  syncDays: 28,
  autoSyncEnabled: false,
  autoSyncIntervalHours: 12,
  weeklyReportEnabled: true,
  dailyReportEnabled: false,
};

export function sanitizeSettings(input = {}, current = DEFAULT_SETTINGS) {
  const num = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const profile = BROWSER_PROFILES[input.profile] ? input.profile : current.profile;
  const viewport = {
    width: num(input.viewport?.width, 320, 3840, current.viewport?.width ?? 1440),
    height: num(input.viewport?.height, 240, 2160, current.viewport?.height ?? 900),
  };
  const flag = (key) => (typeof input[key] === 'boolean' ? input[key] : Boolean(current[key]));
  return {
    maxPages: num(input.maxPages, 1, 200, current.maxPages),
    maxDepth: num(input.maxDepth, 1, 4, current.maxDepth),
    concurrency: num(input.concurrency, 1, crawlerConfig.concurrency, current.concurrency),
    requestTimeoutMs: num(input.requestTimeoutMs, 5000, 60000, current.requestTimeoutMs),
    respectRobots: flag('respectRobots'),
    checkExternalLinks: flag('checkExternalLinks'),
    followRedirects: flag('followRedirects'),
    renderPages: flag('renderPages'),
    renderLimit: num(input.renderLimit, 1, 20, current.renderLimit),
    retainDays: num(input.retainDays, 7, 730, current.retainDays ?? 90),
    viewport,
    profile,
    syncDays: num(input.syncDays, 7, 480, current.syncDays),
    autoSyncEnabled: flag('autoSyncEnabled'),
    autoSyncIntervalHours: num(input.autoSyncIntervalHours, 1, 168, current.autoSyncIntervalHours),
    weeklyReportEnabled: flag('weeklyReportEnabled'),
    dailyReportEnabled: flag('dailyReportEnabled'),
  };
}

export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!url.hostname.includes('.')) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function siteOrigin(raw) {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.origin;
  } catch {
    return null;
  }
}

export function buildPublicUrl(pathname = '/') {
  return config.publicUrl ? `${config.publicUrl}${pathname}` : pathname;
}
